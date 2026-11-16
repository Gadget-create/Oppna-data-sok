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


def _unique(ids: list) -> list:
    seen = set()
    out = []
    for i in ids:
        if i in seen:
            continue
        seen.add(i)
        out.append(i)
    return out


def page_scb_all(query: str, page_size: int = 40):
    page = 1
    total = None
    ids: list = []
    while page <= 30:
        url = SCB + "?" + urllib.parse.urlencode(
            {"lang": "sv", "pageNumber": page, "pageSize": page_size, "query": query}
        )
        status, _headers, data = get_json(url)
        if status != 200:
            raise RuntimeError(f"SCB sida {page} HTTP {status}")
        tables = data.get("tables") or []
        info = data.get("page") or {}
        if info.get("totalElements") is not None:
            total = info["totalElements"]
        ids.extend(t.get("id") for t in tables)
        total_pages = info.get("totalPages") or page
        if not tables or page >= total_pages:
            break
        page += 1
    return total, ids, page


def page_kolada_all(query: str, per_page: int = 80):
    page = 1
    ids: list = []
    while page <= 30:
        url = KOLADA + "?" + urllib.parse.urlencode({"page": page, "per_page": per_page, "title": query})
        status, _headers, data = get_json(url)
        if status != 200:
            raise RuntimeError(f"Kolada sida {page} HTTP {status}")
        values = data.get("values") or []
        ids.extend(k.get("id") for k in values)
        if not data.get("next_url") or not values:
            break
        page += 1
    return ids, page


def page_dataportal_all(query: str, limit: int = 20):
    offset = 0
    total = None
    ids: list = []
    pages = 0
    while pages <= 30:
        solr = f"title.sv:{query} AND rdfType:http\\://www.w3.org/ns/dcat#Dataset AND public:true"
        url = DP + "?" + urllib.parse.urlencode(
            {"type": "solr", "limit": limit, "offset": offset, "sort": "modified desc", "query": solr}
        )
        status, _headers, data = get_json(url)
        if status != 200:
            raise RuntimeError(f"Dataportal offset {offset} HTTP {status}")
        children = (data.get("resource") or {}).get("children") or []
        if data.get("results"):
            total = data["results"]
        ids.extend((c.get("contextId"), c.get("entryId")) for c in children)
        pages += 1
        if not children or (total is not None and offset + len(children) >= total):
            break
        offset += len(children)
    return total, ids, pages


def verify_paging(query: str = "bostäder") -> None:
    print("\n" + "=" * 72)
    print(f"PAGINERING: alla träffar för {query}")
    print("=" * 72)
    problems = []

    total, scb_ids, scb_pages = page_scb_all(query, 40)
    scb_unique = _unique(scb_ids)
    print(f"SCB  sidor={scb_pages}  hämtade={len(scb_ids)}  unika={len(scb_unique)}  totalElements={total}")
    if scb_pages < 2:
        problems.append("SCB borde kräva mer än en sida")
    if total is None or len(scb_unique) != total or len(scb_ids) != len(scb_unique):
        problems.append(f"SCB-sidor täcker inte totalElements ({len(scb_unique)} unika av {total})")

    kolada_ids, kolada_pages = page_kolada_all(query, 80)
    kolada_small, small_pages = page_kolada_all(query, 10)
    print(f"Kolada per_page=80  sidor={kolada_pages}  unika={len(_unique(kolada_ids))}")
    print(f"Kolada per_page=10  sidor={small_pages}  unika={len(_unique(kolada_small))}")
    if set(kolada_ids) != set(kolada_small):
        problems.append("Kolada page/per_page ger inte samma träffar för olika sidstorlek")
    if len(kolada_ids) != len(set(kolada_ids)) or len(kolada_small) != len(set(kolada_small)):
        problems.append("Kolada returnerade dubbletter mellan sidor")
    if small_pages < 2:
        problems.append("Kolada per_page=10 borde ge flera sidor")

    dp_total, dp_ids, dp_pages = page_dataportal_all(query, 20)
    dp_unique = _unique(dp_ids)
    print(f"Dataportal  sidor={dp_pages}  hämtade={len(dp_ids)}  unika={len(dp_unique)}  results={dp_total}")
    if dp_pages < 2:
        problems.append("Dataportal borde kräva mer än en sida")
    if dp_total is None or len(dp_unique) != dp_total or len(dp_ids) != len(dp_unique):
        problems.append(f"Dataportal-sidor täcker inte results ({len(dp_unique)} unika av {dp_total})")

    if problems:
        raise RuntimeError("; ".join(problems))
    print("Alla träffar nåddes utan dubbletter mellan sidor.")


def main() -> int:
    errors = []
    try:
        verify_paging("bostäder")
    except Exception as e:
        errors.append(("paginering bostäder", e))
        print(f"FEL vid paginering: {type(e).__name__}: {e}", file=sys.stderr)

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
