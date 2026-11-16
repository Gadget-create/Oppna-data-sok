#!/usr/bin/env python3
"""Verifierar sökningen mot öppna API:er utan webbläsare. Hämtar bara metadata."""
from __future__ import annotations

import json
import re
import sys
import urllib.parse
import urllib.request
from collections import Counter

SCB = "https://statistikdatabasen.scb.se/api/v2/tables"
KOLADA = "https://api.kolada.se/v3/kpi"
DP = "https://admin.dataportal.se/store/search"
UA = {
    "User-Agent": "oppna-data-sok-prototyp/0.1 (metadata-only)",
    "Accept": "application/json",
    "Origin": "http://localhost:8000",
}


def get(url: str, timeout: int = 30):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        headers = dict(r.headers)
        body = r.read()
        return r.status, headers, body


def get_json(url: str, timeout: int = 30):
    status, headers, body = get(url, timeout=timeout)
    return status, headers, json.loads(body.decode("utf-8"))


def cors_ok(headers: dict) -> str:
    for k, v in headers.items():
        if k.lower() == "access-control-allow-origin":
            return v
    return ""


def _labels(label):
    if not label:
        return []
    if isinstance(label, dict):
        return list(label.values())
    if isinstance(label, list):
        return label
    return [str(label)]


def classify_code(code: str) -> str | None:
    c = str(code or "")
    if c in ("00", "0000"):
        return "riket"
    if re.fullmatch(r"\d{2}", c):
        return "lan"
    if re.fullmatch(r"\d{4}", c):
        return "kommun"
    if re.search(r"DeSO", c, re.I) or re.match(r"\d{4}[A-C]\d+", c):
        return "deso"
    if re.search(r"RegSO", c, re.I) or re.match(r"\d{4}R\d+", c):
        return "regso"
    return None


def infer_levels_from_title(title: str, variable_names: list[str]) -> tuple[list[str], bool, str]:
    t = (title or "").lower()
    variables = [v.lower() for v in (variable_names or [])]
    levels: list[str] = []
    if re.search(r"\bdeso\b", t):
        levels.append("deso")
    if re.search(r"\bregso\b", t):
        levels.append("regso")
    if re.search(r"\bkommuner\b|\bkommun\b", t):
        levels.append("kommun")
    if re.search(r"\blän\b", t):
        levels.append("lan")
    if re.search(r"\briket\b", t):
        levels.append("riket")
    if re.search(r"tätort|småort|smaort", t):
        levels.append("tatort")
    # unique preserve order
    seen = set()
    out = []
    for lv in levels:
        if lv not in seen:
            seen.add(lv)
            out.append(lv)
    has_region = any(v in ("region", "kommun", "län", "lan") for v in variables)
    source = "titel" if out else ("okand" if has_region else "ingen")
    return out, has_region, source


def level_label(ids: list[str], has_region: bool) -> str:
    names = {
        "riket": "riket",
        "lan": "län/region",
        "kommun": "kommun",
        "deso": "DeSO",
        "regso": "RegSO",
        "tatort": "tätort/småort",
        "enhet": "enhet",
        "okand": "okänd",
    }
    if ids:
        return ", ".join(names.get(i, i) for i in ids)
    if has_region:
        return "okänd"
    return "ingen regional indelning i metadata"


def kolada_levels(kpi: dict) -> list[str]:
    levels = ["riket"]
    typ = kpi.get("municipality_type")
    if typ in ("K", "A"):
        levels.append("kommun")
    if typ in ("L", "A"):
        levels.append("lan")
    if kpi.get("has_ou_data"):
        levels.append("enhet")
    return levels


def search_scb(query: str, page_size: int = 40):
    url = SCB + "?" + urllib.parse.urlencode(
        {"lang": "sv", "pageNumber": 1, "pageSize": page_size, "query": query}
    )
    status, headers, data = get_json(url)
    tables = data.get("tables") or []
    total = (data.get("page") or {}).get("totalElements", len(tables))
    items = []
    for t in tables:
        levels, has_region, source = infer_levels_from_title(t.get("label") or "", t.get("variableNames") or [])
        items.append(
            {
                "id": t.get("id"),
                "title": t.get("label") or t.get("id"),
                "subject": t.get("subjectCode"),
                "period": f"{t.get('firstPeriod') or ''}-{t.get('lastPeriod') or ''}".strip("-"),
                "variables": t.get("variableNames") or [],
                "levels": levels,
                "has_region": has_region,
                "level_source": source,
                "level_text": level_label(levels, has_region),
            }
        )
    return url, status, cors_ok(headers), total, items


def search_kolada(query: str, per_page: int = 80):
    url = KOLADA + "?" + urllib.parse.urlencode({"page": 1, "per_page": per_page, "title": query})
    status, headers, data = get_json(url)
    values = data.get("values") or []
    items = []
    for k in values:
        levels = kolada_levels(k)
        items.append(
            {
                "id": k.get("id"),
                "title": k.get("title") or k.get("id"),
                "description": (k.get("description") or "")[:180],
                "operating_area": k.get("operating_area"),
                "municipality_type": k.get("municipality_type"),
                "has_ou_data": k.get("has_ou_data"),
                "levels": levels,
                "level_text": level_label(levels, True),
            }
        )
    return url, status, cors_ok(headers), len(items), items


def search_dataportal(query: str, limit: int = 20):
    solr = f"title.sv:{query} AND rdfType:http\\://www.w3.org/ns/dcat#Dataset AND public:true"
    url = DP + "?" + urllib.parse.urlencode(
        {"type": "solr", "limit": limit, "offset": 0, "sort": "modified desc", "query": solr}
    )
    status, headers, data = get_json(url)
    children = (data.get("resource") or {}).get("children") or []
    return url, status, cors_ok(headers), data.get("results"), len(children)


def enrich_one_scb(table_id: str, area_code: str = "2180"):
    url = f"https://statistikdatabasen.scb.se/api/v2/tables/{table_id}/metadata?lang=sv"
    status, headers, data = get_json(url, timeout=45)
    dims = data.get("dimension") or {}
    region = dims.get("Region") or dims.get("region") or {}
    index = ((region.get("category") or {}).get("index")) or {}
    codes = list(index.keys()) if isinstance(index, dict) else list(index or [])
    levels = []
    for c in codes:
        lv = classify_code(c)
        if lv and lv not in levels:
            levels.append(lv)
    has_area = area_code in set(map(str, codes))
    deso = sum(1 for c in codes if str(c).startswith(area_code) and classify_code(c) == "deso")
    return {
        "status": status,
        "cors": cors_ok(headers),
        "bytes": "n/a",
        "n_codes": len(codes),
        "levels": levels or ["okänd"],
        "has_gavle_kommun": has_area,
        "gavle_deso": deso,
        "measures": _labels(((dims.get("ContentsCode") or {}).get("category") or {}).get("label")),
        "variables": [(dims[k].get("label") or k) for k in dims],
    }


def report_query(query: str) -> None:
    print("=" * 72)
    print(f"SÖKNING: {query}")
    print("=" * 72)

    url, status, cors, total, items = search_scb(query)
    print(f"\nSCB API v2  HTTP {status}  CORS={cors or 'saknas'}  total={total}  visade={len(items)}")
    print(f"  {url}")
    print("  nivåer i visade träffar (ur titel/variabelnamn):", dict(Counter(i["level_text"] for i in items)))
    for i in items[:3]:
        print(f"  - {i['id']}: {i['title'][:110]}")
        print(f"    ämne={i['subject']}  period={i['period']}  nivå={i['level_text']}  variabler={', '.join(i['variables'][:8])}")

    url, status, cors, total, items_k = search_kolada(query)
    print(f"\nKolada API v3  HTTP {status}  CORS={cors or 'saknas'}  träffar={total}")
    print(f"  {url}")
    print("  nivåer:", dict(Counter(i["level_text"] for i in items_k)))
    for i in items_k[:3]:
        typ = i["municipality_type"]
        ou = " ja" if i["has_ou_data"] else " nej"
        print(f"  - {i['id']}: {i['title'][:110]}")
        print(f"    område={i['operating_area']}  municipality_type={typ}  enhet={ou.strip()}  nivå={i['level_text']}")
        if i["description"]:
            print(f"    definition: {i['description']}")

    try:
        url, status, cors, results, n = search_dataportal(query)
        print(f"\nSveriges dataportal  HTTP {status}  CORS={cors or 'saknas'}  results={results}  visade={n}")
        print(f"  {url}")
    except Exception as e:
        print(f"\nSveriges dataportal  FEL: {type(e).__name__}: {e}")

    return items, items_k


def main() -> int:
    errors = []
    for q in ("bostäder", "befolkning"):
        try:
            report_query(q)
        except Exception as e:
            errors.append((q, e))
            print(f"FEL vid sökning på {q}: {type(e).__name__}: {e}", file=sys.stderr)

    print("\n" + "=" * 72)
    print("Exempel: tabellmetadata för SCB TAB6473 (befolkningsstatistik) och Gävle 2180")
    print("=" * 72)
    try:
        info = enrich_one_scb("TAB6473", "2180")
        print(json.dumps(info, ensure_ascii=False, indent=2))
    except Exception as e:
        errors.append(("TAB6473", e))
        print(f"FEL: {e}")

    if errors:
        print("\nMISSlyckades:", errors)
        return 1
    print("\nAlla API-anrop i testet lyckades. Inga datavärden har hämtats utöver ev. tomma fält i metadata-svaret.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
