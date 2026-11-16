/* Öppna samhällsbyggnadsdata – sparsam prototyp. Hämtar bara metadata. */
(function () {
  "use strict";

  const SCB_TABLES = "https://statistikdatabasen.scb.se/api/v2/tables";
  const KOLADA_KPI = "https://api.kolada.se/v3/kpi";
  const KOLADA_MUNI = "https://api.kolada.se/v3/municipality";
  const DP_SEARCH = "https://admin.dataportal.se/store/search";

  const SUBJECTS = {
    AA: "Ämnesövergripande statistik",
    AM: "Arbetsmarknad",
    BE: "Befolkning",
    BO: "Boende, byggande och bebyggelse",
    EN: "Energi",
    FM: "Finansmarknad",
    HA: "Handel med varor och tjänster",
    HE: "Hushållens ekonomi",
    HS: "Hälso- och sjukvård",
    JO: "Jord- och skogsbruk, fiske",
    KU: "Kultur och fritid",
    LE: "Levnadsförhållanden",
    ME: "Demokrati",
    MI: "Miljö",
    NR: "Nationalräkenskaper",
    NV: "Näringsverksamhet",
    OE: "Offentlig ekonomi",
    OV: "Övrigt",
    PR: "Priser och konsumtion",
    SO: "Socialtjänst",
    TK: "Transporter och kommunikationer",
    UF: "Utbildning och forskning"
  };

  const THEMES = [
    { id: "bostader", label: "Bostäder", query: "bostäder", subjects: ["BO"], keywords: ["bostad", "boende", "byggande", "bebyggelse", "lägenhet", "hyresrätt", "bostadsrätt", "småhus", "flerbostad"] },
    { id: "befolkning", label: "Befolkning/demografi", query: "befolkning", subjects: ["BE"], keywords: ["befolkning", "demografi", "invånare", "folkmängd", "flytt", "födda", "döda"] },
    { id: "utbildning", label: "Utbildning", query: "utbildning", subjects: ["UF"], keywords: ["utbildning", "skola", "elev", "student", "lärare", "förskola", "gymnas"] },
    { id: "halsa", label: "Hälsa", query: "hälsa", subjects: ["HS"], keywords: ["hälsa", "sjuk", "vård", "folkhälsa", "ohälsa", "dödlighet"] },
    { id: "ekonomi", label: "Ekonomi", query: "ekonomi", subjects: ["HE", "OE", "NR", "FM"], keywords: ["ekonomi", "kostnad", "skatt", "inkomst", "utgift", "skuld"] },
    { id: "naringsliv", label: "Verksamheter/näringsliv", query: "näringsliv", subjects: ["NV"], keywords: ["närings", "företag", "verksamhet", "arbetsställe", "bransch"] }
  ];

  const SOURCES = [
    { id: "scb", label: "SCB" },
    { id: "kolada", label: "Kolada" },
    { id: "dataportal", label: "Sveriges dataportal" }
  ];

  const LEVELS = [
    { id: "riket", label: "Riket" },
    { id: "lan", label: "Län/region" },
    { id: "kommun", label: "Kommun" },
    { id: "deso", label: "DeSO" },
    { id: "regso", label: "RegSO" },
    { id: "tatort", label: "Tätort/småort" },
    { id: "enhet", label: "Enhet" },
    { id: "okand", label: "Okänd" }
  ];

  const TIME_UNIT = {
    Yearly: "Årlig",
    Quarterly: "Kvartalsvis",
    Monthly: "Månadsvis",
    Weekly: "Veckovis",
    Daily: "Daglig"
  };

  const FREQ = {
    ANNUAL: "Årlig",
    SEMIANNUAL: "Halvårsvis",
    QUARTERLY: "Kvartalsvis",
    MONTHLY: "Månadsvis",
    WEEKLY: "Veckovis",
    DAILY: "Daglig",
    CONT: "Kontinuerlig",
    IRREG: "Oregelbunden",
    BIENNIAL: "Vartannat år",
    TRIENNIAL: "Vart tredje år",
    QUINQUENNIAL: "Vart femte år",
    UPDATE_CONT: "Kontinuerligt uppdaterad"
  };

  const SAVED_KEY = "oppnaData.saved.v1";
  const SNAP_KEYS = [
    "id", "source", "tableId", "title", "description", "subjectCode", "subject",
    "pathLabels", "operatingArea", "perspective", "publisher", "keywords",
    "variables", "firstPeriod", "lastPeriod", "timeUnit", "frequency", "updated",
    "prelDate", "levels", "hasRegionVar", "levelSource", "measures", "notes",
    "sourceName", "webUrl", "metaUrl", "dataUrl", "apiUrl", "catalogUrl"
  ];

  const state = {
    theme: null,
    items: [],
    areas: [],
    selectedArea: null,
    errors: [],
    view: "sok",
    openFolder: null,
    saved: { version: 1, folders: [] },
    pendingItem: null,
    nameAction: null,
    search: null,
    loadingMore: false
  };

  const $ = (id) => document.getElementById(id);

  function normalize(s) {
    return (s || "").toLowerCase();
  }

  function unique(arr) {
    return Array.from(new Set(arr.filter(Boolean)));
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function classifyCode(code) {
    const c = String(code || "");
    if (c === "00" || c === "0000") return "riket";
    if (/^\d{2}$/.test(c)) return "lan";
    if (/^\d{4}$/.test(c)) return "kommun";
    if (/DeSO/i.test(c) || /^\d{4}[A-C]\d+/.test(c)) return "deso";
    if (/RegSO/i.test(c) || /^\d{4}R\d+/.test(c)) return "regso";
    return null;
  }

  function inferLevelsFromTitle(title, variableNames) {
    const t = normalize(title);
    const vars = (variableNames || []).map(normalize);
    const levels = [];
    if (/\bdeso\b/.test(t)) levels.push("deso");
    if (/\bregso\b/.test(t)) levels.push("regso");
    if (/\bkommuner\b|\bkommun\b/.test(t)) levels.push("kommun");
    if (/\blän\b/.test(t)) levels.push("lan");
    if (/\briket\b/.test(t)) levels.push("riket");
    if (/tätort|småort|smaort/.test(t)) levels.push("tatort");
    const hasRegion = vars.some((v) => v === "region" || v === "kommun" || v === "län" || v === "lan");
    return {
      levels: unique(levels),
      hasRegionVar: hasRegion,
      levelSource: levels.length ? "titel" : (hasRegion ? "okand" : "ingen")
    };
  }

  function levelsFromCodes(codes) {
    const levels = unique((codes || []).map(classifyCode));
    return levels.length ? levels : ["okand"];
  }

  function displayLevels(item) {
    if (item.levels && item.levels.length) return item.levels;
    if (item.hasRegionVar) return ["okand"];
    if (item.source === "scb") return [];
    return ["okand"];
  }

  function levelLabels(ids) {
    if (!ids || !ids.length) return "Ingen regional indelning i metadata";
    return ids.map((id) => {
      const hit = LEVELS.find((l) => l.id === id);
      return hit ? hit.label : id;
    }).join(", ");
  }

  function matchesTheme(item, theme) {
    if (!theme) return true;
    const subject = item.subjectCode || "";
    if (theme.subjects.includes(subject)) return true;
    const blob = normalize([item.title, item.description, item.operatingArea, item.subject, (item.keywords || []).join(" ")].join(" "));
    return theme.keywords.some((k) => blob.includes(k));
  }

  function parseAreaInput(value) {
    const v = (value || "").trim();
    if (!v) return null;
    const low = normalize(v);
    return state.areas.find((a) => {
      const title = normalize(a.title);
      const typ = a.type === "K" ? "kommun" : (a.id === "0000" ? "riket" : "region");
      return title === low || `${title} ${typ}` === low || `${a.id} ${title}` === low ||
        low === `${title} (${a.id})` || normalize(labelArea(a)) === low;
    }) || null;
  }

  function labelArea(a) {
    if (a.id === "0000") return "Riket";
    if (a.type === "K") return a.title + " kommun";
    return a.title;
  }

  function scbLanCode(area) {
    if (!area || area.type !== "L" || area.id === "0000") return null;
    return area.id.slice(-2);
  }

  function matchAreaInCodes(codes, area) {
    if (!area || !codes || !codes.length) return { kind: "ej_verifierat" };
    const list = codes.map(String);
    if (area.id === "0000") {
      return list.includes("00") || list.includes("0000")
        ? { kind: "exakt", detail: "Finns för riket" }
        : { kind: "saknas", detail: "Riket finns inte som redovisningsnivå i tabellen" };
    }
    if (area.type === "L") {
      const lan = scbLanCode(area);
      const exact = list.includes(lan);
      const kommuner = list.filter((c) => /^\d{4}$/.test(c) && c.slice(0, 2) === lan);
      const delar = list.filter((c) => c.startsWith(lan) && (classifyCode(c) === "deso" || classifyCode(c) === "regso"));
      if (exact) return { kind: "exakt", detail: "Finns för " + labelArea(area) };
      const extra = [];
      if (kommuner.length) extra.push("kommuner i länet");
      if (delar.length) extra.push("DeSO/RegSO i länet");
      if (extra.length) return { kind: "delar", detail: "Inte som länsnivå, men tabellen har " + extra.join(" och ") };
      return { kind: "saknas", detail: "Hittades inte för " + labelArea(area) };
    }
    const kid = area.id;
    if (list.includes(kid)) return { kind: "exakt", detail: "Finns för " + labelArea(area) };
    const deso = list.filter((c) => c.startsWith(kid) && classifyCode(c) === "deso");
    const regso = list.filter((c) => c.startsWith(kid) && classifyCode(c) === "regso");
    const parts = [];
    if (deso.length) parts.push("DeSO (" + deso.length + " områden)");
    if (regso.length) parts.push("RegSO (" + regso.length + " områden)");
    if (parts.length) {
      return { kind: "delar", detail: "Inte som kommun, men som " + parts.join(" och ") + " inom " + labelArea(area) };
    }
    return { kind: "saknas", detail: "Hittades inte för " + labelArea(area) };
  }

  function koladaAreaStatus(item, area) {
    if (!area) return null;
    const typ = item.municipalityType;
    if (area.id === "0000") {
      return { kind: "definierat", detail: "Nyckeltal i Kolada redovisas normalt även för riket. Om ett värde finns är inte kontrollerat." };
    }
    if (area.type === "K") {
      if (typ === "K" || typ === "A") {
        return { kind: "definierat", detail: "Nyckeltalet är definierat för kommunnivå. Om ett värde finns för " + labelArea(area) + " är inte kontrollerat (prototypen hämtar inte datavärden)." };
      }
      return { kind: "saknas", detail: "Nyckeltalet är inte definierat för kommunnivå." };
    }
    if (typ === "L" || typ === "A") {
      return { kind: "definierat", detail: "Nyckeltalet är definierat för regionnivå. Om ett värde finns för " + labelArea(area) + " är inte kontrollerat (prototypen hämtar inte datavärden)." };
    }
    return { kind: "saknas", detail: "Nyckeltalet är inte definierat för regionnivå." };
  }

  function formatDate(iso) {
    if (!iso) return "";
    const m = String(iso).match(/^(\d{4}-\d{2}-\d{2})/);
    return m ? m[1] : String(iso);
  }

  function themeById(id) {
    return THEMES.find((t) => t.id === id) || null;
  }

  function buildQuery() {
    const text = $("q").value.trim();
    const theme = themeById(state.theme);
    if (text && theme) return { text, theme, apiQuery: text, mode: "text+tema" };
    if (text) return { text, theme: null, apiQuery: text, mode: "text" };
    if (theme) return { text: "", theme, apiQuery: theme.query, mode: "tema" };
    return null;
  }

  async function fetchJson(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error("HTTP " + res.status + " för " + url);
    return res.json();
  }

  async function searchScb(query, pageNumber) {
    const pageNo = pageNumber || 1;
    const url = SCB_TABLES + "?lang=sv&pageNumber=" + pageNo + "&pageSize=40&query=" + encodeURIComponent(query);
    const data = await fetchJson(url);
    const tables = data.tables || [];
    const page = data.page || {};
    const total = page.totalElements != null ? page.totalElements : tables.length;
    const totalPages = page.totalPages != null ? page.totalPages : (tables.length < 40 ? pageNo : pageNo + 1);
    return {
      total: total,
      done: !tables.length || pageNo >= totalPages,
      items: tables.map((t) => {
        const inferred = inferLevelsFromTitle(t.label, t.variableNames);
        const path = (t.paths && t.paths[0]) || [];
        const subject = path[0] ? path[0].label : (SUBJECTS[t.subjectCode] || t.subjectCode || "okänd");
        return {
          id: "scb-" + t.id,
          source: "scb",
          tableId: t.id,
          title: t.label || t.id,
          description: t.description || "",
          subjectCode: t.subjectCode || "",
          subject: subject,
          pathLabels: path.map((p) => p.label).filter(Boolean),
          variables: t.variableNames || [],
          firstPeriod: t.firstPeriod || "",
          lastPeriod: t.lastPeriod || "",
          timeUnit: t.timeUnit || "",
          updated: t.updated || "",
          levels: inferred.levels,
          hasRegionVar: inferred.hasRegionVar,
          levelSource: inferred.levelSource,
          measures: [],
          notes: [],
          regionCodes: null,
          areaStatus: null,
          sourceName: "SCB Statistikdatabasen",
          webUrl: webUrlScb(path),
          metaUrl: "https://statistikdatabasen.scb.se/api/v2/tables/" + encodeURIComponent(t.id) + "/metadata?lang=sv",
          dataUrl: "https://statistikdatabasen.scb.se/api/v2/tables/" + encodeURIComponent(t.id) + "/data?lang=sv&outputFormat=json-stat2",
          apiUrl: "https://statistikdatabasen.scb.se/api/v2/tables/" + encodeURIComponent(t.id) + "?lang=sv"
        };
      })
    };
  }

  function webUrlScb(path) {
    if (!path || !path.length) return "https://www.statistikdatabasen.scb.se/pxweb/sv/ssd/";
    const parts = ["START"].concat(path.map((p) => p.id));
    return "https://www.statistikdatabasen.scb.se/pxweb/sv/ssd/" + parts.join("__") + "/";
  }

  function koladaLevels(kpi) {
    const levels = ["riket"];
    const typ = kpi.municipality_type;
    if (typ === "K" || typ === "A") levels.push("kommun");
    if (typ === "L" || typ === "A") levels.push("lan");
    if (kpi.has_ou_data) levels.push("enhet");
    return levels;
  }

  async function searchKolada(query, page) {
    const pageNo = page || 1;
    const url = KOLADA_KPI + "?page=" + pageNo + "&per_page=80&title=" + encodeURIComponent(query);
    const data = await fetchJson(url);
    const values = data.values || [];
    const more = !!data.next_url && values.length > 0;
    return {
      total: null,
      done: !more,
      items: values.map((k) => ({
        id: "kolada-" + k.id,
        source: "kolada",
        tableId: k.id,
        title: k.title || k.id,
        description: k.description || "",
        subjectCode: "",
        subject: k.operating_area || "",
        operatingArea: k.operating_area || "",
        perspective: k.perspective || "",
        variables: k.is_divided_by_gender ? ["kön"] : [],
        firstPeriod: "",
        lastPeriod: k.publ_period || "",
        timeUnit: "",
        updated: k.publication_date || "",
        prelDate: k.prel_publication_date || "",
        levels: koladaLevels(k),
        hasRegionVar: true,
        levelSource: "kolada",
        municipalityType: k.municipality_type,
        hasOuData: !!k.has_ou_data,
        measures: [k.title || ""],
        notes: [],
        regionCodes: null,
        areaStatus: null,
        sourceName: "Kolada",
        webUrl: "https://www.kolada.se/verktyg/fri-sokning/?kpi=" + encodeURIComponent(k.id),
        metaUrl: "https://api.kolada.se/v3/kpi/" + encodeURIComponent(k.id),
        dataUrl: "https://api.kolada.se/v3/data/kpi/" + encodeURIComponent(k.id) + "/year/" + encodeURIComponent(k.publ_period || "2024"),
        apiUrl: "https://api.kolada.se/v3/kpi/" + encodeURIComponent(k.id)
      }))
    };
  }

  function rdfValues(preds, keyPart, langPrefer) {
    const out = [];
    Object.keys(preds || {}).forEach((p) => {
      if (p === keyPart || p.endsWith("#" + keyPart) || p.endsWith("/" + keyPart)) {
        (preds[p] || []).forEach((v) => {
          const val = v && (v.value || v.uri) ? (v.value || v.uri) : v;
          const lang = v && v.lang;
          out.push({ val: val, lang: lang || "" });
        });
      }
    });
    if (langPrefer) {
      const pref = out.filter((x) => x.lang === langPrefer);
      if (pref.length) return pref.map((x) => x.val);
    }
    const sv = out.filter((x) => x.lang === "sv");
    if (sv.length) return sv.map((x) => x.val);
    const none = out.filter((x) => !x.lang);
    if (none.length) return none.map((x) => x.val);
    return out.map((x) => x.val);
  }

  async function searchDataportal(query, offset) {
    const start = offset || 0;
    const solr = "title.sv:" + query + " AND rdfType:http\\://www.w3.org/ns/dcat#Dataset AND public:true";
    const url = DP_SEARCH + "?type=solr&limit=20&offset=" + start + "&sort=" + encodeURIComponent("modified desc") + "&query=" + encodeURIComponent(solr);
    const data = await fetchJson(url);
    const children = (data.resource && data.resource.children) || [];
    const items = children.map((child) => {
      const md = child.metadata || {};
      const uri = Object.keys(md)[0] || "";
      const preds = md[uri] || {};
      const title = rdfValues(preds, "title", "sv")[0] || uri || "Datamängd utan titel";
      const description = rdfValues(preds, "description", "sv")[0] || "";
      const landing = rdfValues(preds, "landingPage")[0] || "";
      const keywords = rdfValues(preds, "keyword", "sv");
      const freqUri = rdfValues(preds, "accrualPeriodicity")[0] || "";
      const freqKey = String(freqUri).split("/").pop();
      const modified = rdfValues(preds, "modified")[0] || "";
      const publisher = rdfValues(preds, "publisher")[0] || "";
      const identifier = rdfValues(preds, "identifier")[0] || "";
      const page = (child.contextId && child.entryId)
        ? "https://www.dataportal.se/sv/datasets/" + child.contextId + "_" + child.entryId
        : "https://www.dataportal.se/sv/datasets?q=" + encodeURIComponent(title);
      return {
        id: "dp-" + (child.contextId || "") + "-" + (child.entryId || identifier || uri),
        source: "dataportal",
        tableId: identifier || "",
        title: title,
        description: description,
        subjectCode: "",
        subject: keywords[0] || "",
        keywords: keywords,
        publisher: publisher,
        variables: [],
        firstPeriod: "",
        lastPeriod: "",
        timeUnit: "",
        frequency: FREQ[freqKey] || (freqKey || ""),
        updated: modified,
        levels: [],
        hasRegionVar: false,
        levelSource: "okand",
        measures: [],
        notes: [],
        regionCodes: null,
        areaStatus: null,
        sourceName: "Sveriges dataportal",
        webUrl: landing || page,
        metaUrl: url,
        dataUrl: landing || page,
        apiUrl: page,
        catalogUrl: page
      };
    });
    const reported = typeof data.results === "number" ? data.results : null;
    const total = reported > 0 ? reported : (start === 0 ? items.length : null);
    return {
      total: total,
      done: !items.length || (total != null && start + items.length >= total),
      items: items
    };
  }

  async function loadAreas() {
    if (state.areas.length) return;
    const data = await fetchJson(KOLADA_MUNI + "?per_page=5000");
    const values = data.values || [];
    values.sort((a, b) => {
      if (a.id === "0000") return -1;
      if (b.id === "0000") return 1;
      if (a.type !== b.type) return a.type === "L" ? -1 : 1;
      return (a.title || "").localeCompare(b.title || "", "sv");
    });
    state.areas = values;
    const list = $("omradelista");
    list.innerHTML = values.map((a) => '<option value="' + escapeHtml(labelArea(a)) + '"></option>').join("");
  }

  async function enrichScb(item) {
    if (item.source !== "scb" || item.regionCodes) return item;
    const data = await fetchJson(item.metaUrl);
    const dims = data.dimension || {};
    const dimNames = Object.keys(dims);
    const labels = dimNames.map((k) => (dims[k] && dims[k].label) || k).filter((n) => {
      const low = normalize(n);
      return low !== "tabellinnehåll" && low !== "år" && low !== "kvartal" && low !== "månad" && low !== "tid";
    });
    if (labels.length) item.variables = unique(labels);
    const contents = dims.ContentsCode || dims.contentscode;
    if (contents && contents.category && contents.category.label) {
      item.measures = Object.values(contents.category.label);
    }
    const notes = data.note;
    if (Array.isArray(notes)) item.notes = notes;
    else if (notes) item.notes = [String(notes)];
    const region = dims.Region || dims.region;
    if (region && region.category) {
      const index = region.category.index;
      item.regionCodes = index && typeof index === "object" && !Array.isArray(index) ? Object.keys(index) : (Array.isArray(index) ? index.map(String) : Object.keys(region.category.label || {}));
      item.levels = levelsFromCodes(item.regionCodes);
      item.hasRegionVar = true;
      item.levelSource = "metadata";
    } else {
      item.regionCodes = [];
      if (!item.levels.length) item.levelSource = "ingen";
    }
    if (!item.description && item.notes.length) {
      item.description = item.notes[0];
    }
    return item;
  }

  function applyArea(item) {
    const area = state.selectedArea;
    if (!area) {
      item.areaStatus = null;
      return item;
    }
    if (item.source === "kolada") {
      item.areaStatus = koladaAreaStatus(item, area);
    } else if (item.source === "scb") {
      if (item.regionCodes) item.areaStatus = matchAreaInCodes(item.regionCodes, area);
      else if (!item.hasRegionVar && item.levelSource === "ingen") {
        item.areaStatus = { kind: "saknas", detail: "Tabellen har ingen regionvariabel, så områdesfilter kan inte tillämpas." };
      } else {
        item.areaStatus = { kind: "ej_verifierat", detail: "Geografin är inte verifierad ännu. Använd knappen för att hämta tabellmetadata." };
      }
    } else {
      item.areaStatus = { kind: "ej_verifierat", detail: "Sveriges dataportal anger sällan geografisk nivå på ett enhetligt sätt i sök-API:t. Nivå: okänd." };
    }
    return item;
  }

  function sourceEnabled(id) {
    const el = document.querySelector('#kallor input[value="' + id + '"]');
    return el ? el.checked : true;
  }

  function enabledLevels() {
    const boxes = Array.from(document.querySelectorAll("#nivaer input[type=checkbox]"));
    const on = boxes.filter((b) => b.checked).map((b) => b.value);
    if (!on.length || on.length === boxes.length) return null;
    return on;
  }

  function visibleItems() {
    const levels = enabledLevels();
    const onlyArea = $("baraOmrade").checked && state.selectedArea;
    return state.items.filter((item) => {
      if (!sourceEnabled(item.source)) return false;
      if (levels) {
        const lv = displayLevels(item);
        const check = lv.length ? lv : ["okand"];
        if (!check.some((l) => levels.includes(l))) return false;
      }
      if (onlyArea) {
        const st = item.areaStatus && item.areaStatus.kind;
        if (st !== "exakt" && st !== "delar" && st !== "definierat") return false;
      }
      return true;
    });
  }

  function sourcePill(id, label) {
    const n = state.items.filter((i) => i.source === id).length;
    const src = state.search && state.search.sources[id];
    if (src && src.total != null) return '<span class="pill">' + label + ": " + n + " av " + src.total + "</span>";
    if (src && !src.done) return '<span class="pill">' + label + ": " + n + "+</span>";
    return '<span class="pill">' + label + ": " + n + "</span>";
  }

  function knownTotal() {
    if (!state.search) return { n: state.items.length, open: false };
    let n = 0;
    let open = false;
    Object.keys(state.search.sources).forEach((id) => {
      const src = state.search.sources[id];
      if (src.total == null) {
        n += src.fetched || 0;
        if (!src.done) open = true;
      } else n += src.total;
    });
    return { n: n, open: open };
  }

  function hasMore() {
    if (!state.search) return false;
    if (state.loadingMore) return true;
    return Object.keys(state.search.sources).some((id) => !state.search.sources[id].done);
  }

  function moreButtonHtml() {
    if (!hasMore()) return "";
    const label = state.loadingMore ? "Hämtar fler…" : "Visa fler";
    return '<p class="mer"><button type="button" class="secondary" id="visaFler"' +
      (state.loadingMore ? " disabled" : "") + ' aria-busy="' + (state.loadingMore ? "true" : "false") + '">' +
      label + "</button></p>";
  }

  function render() {
    const items = visibleItems();
    const sum = $("sammanfattning");
    const tot = knownTotal();
    const y = tot.n + (tot.open ? "+" : "");
    sum.hidden = !state.items.length;
    sum.innerHTML = [
      sourcePill("scb", "SCB"),
      sourcePill("kolada", "Kolada"),
      sourcePill("dataportal", "Dataportal"),
      '<span class="pill">Visar ' + items.length + " av " + y + "</span>"
    ].join("");
    $("forfina").hidden = !state.items.some((i) => i.source === "scb" && !i.regionCodes);
    const root = $("traffar");
    const more = moreButtonHtml();
    if (!items.length) {
      root.innerHTML = (state.items.length ? "<p>Inga träffar med nuvarande filter.</p>" : "") + more;
      return;
    }
    root.innerHTML = items.map(renderCard).join("") + more;
    root.querySelectorAll("[data-enrich]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-enrich");
        const item = state.items.find((i) => i.id === id);
        if (!item) return;
        btn.disabled = true;
        btn.textContent = "Hämtar metadata…";
        try {
          await enrichScb(item);
          applyArea(item);
          render();
        } catch (err) {
          btn.disabled = false;
          btn.textContent = "Kunde inte hämta metadata";
          console.error(err);
        }
      });
    });
  }

  function badgeForArea(st) {
    if (!st) return "";
    const cls = st.kind === "exakt" || st.kind === "definierat" ? "ok" : (st.kind === "delar" ? "warn" : (st.kind === "saknas" ? "miss" : "warn"));
    return '<span class="badge ' + cls + '">' + escapeHtml(st.detail) + "</span>";
  }

  function renderCard(item, opts) {
    const levels = displayLevels(item);
    const levelText = levels.length ? levelLabels(levels) : (item.hasRegionVar ? "okänd" : "Ingen regional indelning i metadata");
    const period = [item.firstPeriod, item.lastPeriod].filter(Boolean).join("–") || (item.lastPeriod || "okänd");
    const freqParts = [];
    if (item.timeUnit) freqParts.push(TIME_UNIT[item.timeUnit] || item.timeUnit);
    if (item.frequency) freqParts.push(item.frequency);
    if (item.updated) freqParts.push("publicerad eller uppdaterad " + formatDate(item.updated));
    if (item.prelDate) freqParts.push("preliminärt " + formatDate(item.prelDate));
    const freq = freqParts.length ? freqParts.join(". ") : "okänd";
    const measures = item.measures && item.measures.length ? item.measures.join("; ") : (item.source === "kolada" ? item.title : "okänd (hämtas ur tabellmetadata för SCB)");
    const vars = item.variables && item.variables.length ? item.variables.join(", ") : "Inga redovisade indelningar utöver ev. tid och innehåll";
    const desc = item.description
      ? escapeHtml(item.description)
      : "Ingen beskrivning i källan.";
    const subject = item.subject || item.operatingArea || "okänd";
    const enrich = !(opts && opts.saved) && item.source === "scb" && !item.regionCodes
      ? '<button type="button" class="secondary" data-enrich="' + escapeHtml(item.id) + '">Hämta fullständig tabellmetadata</button>'
      : "";
    const area = badgeForArea(item.areaStatus);
    const sourceBadge = '<span class="badge">' + escapeHtml(item.sourceName) + "</span>";
    const saveBtn = saveButtonHtml(item, opts && opts.folderId);
    const levelNote = item.levelSource === "titel"
      ? " (utläst ur titeln, inte ur regionkoderna)"
      : (item.levelSource === "okand" ? " (regionvariabel finns, men nivån gick inte att utläsa utan tabellmetadata)" : "");
    const pub = item.publisher ? "<div><dt>Utgivare</dt><dd>" + escapeHtml(item.publisher) + "</dd></div>" : "";
    const perspektiv = item.perspective ? "<div><dt>Perspektiv</dt><dd>" + escapeHtml(item.perspective) + "</dd></div>" : "";
    const notes = item.notes && item.notes.length
      ? "<div><dt>Anmärkning</dt><dd>" + escapeHtml(item.notes[0].slice(0, 600)) + (item.notes[0].length > 600 ? "…" : "") + "</dd></div>"
      : "";
    const links = [];
    if (item.webUrl) links.push('<a href="' + escapeHtml(item.webUrl) + '" target="_blank" rel="noopener">Öppna källan</a>');
    if (item.catalogUrl && item.catalogUrl !== item.webUrl) links.push('<a href="' + escapeHtml(item.catalogUrl) + '" target="_blank" rel="noopener">Dataportalens sida</a>');
    if (item.metaUrl) links.push('<a href="' + escapeHtml(item.metaUrl) + '" target="_blank" rel="noopener">Metadata (API)</a>');
    if (item.dataUrl) links.push('<a href="' + escapeHtml(item.dataUrl) + '" target="_blank" rel="noopener">Data för export (API, hämtas inte här)</a>');
    return (
      '<article class="kort">' +
        '<div class="kort-topp">' +
          '<div class="meta-rad">' + sourceBadge + area + "</div>" +
          saveBtn +
        "</div>" +
        "<h3>" + escapeHtml(item.title) + "</h3>" +
        "<dl>" +
          "<div><dt>Vad datat avser</dt><dd>" + desc + "</dd></div>" +
          "<div><dt>Mått/enhet</dt><dd>" + escapeHtml(measures) + "</dd></div>" +
          "<div><dt>Variabler/indelningar</dt><dd>" + escapeHtml(vars) + "</dd></div>" +
          "<div><dt>Tidsperiod</dt><dd>" + escapeHtml(period) + "</dd></div>" +
          "<div><dt>Uppdatering</dt><dd>" + escapeHtml(freq) + "</dd></div>" +
          "<div><dt>Geografisk nivå</dt><dd>" + escapeHtml(levelText) + escapeHtml(levelNote) + "</dd></div>" +
          "<div><dt>Ämne/område</dt><dd>" + escapeHtml(subject) + (item.pathLabels && item.pathLabels.length ? " · " + escapeHtml(item.pathLabels.join(" / ")) : "") + "</dd></div>" +
          perspektiv + pub + notes +
          "<div><dt>Källa</dt><dd>" + escapeHtml(item.sourceName) + (item.tableId ? " (" + escapeHtml(item.tableId) + ")" : "") + "</dd></div>" +
        "</dl>" +
        '<div class="lankar">' + links.join(" ") + " " + enrich + "</div>" +
        (opts && opts.extra ? opts.extra : "") +
      "</article>"
    );
  }

  /* Sparade mappar. Metadata sparas som en ögonblicksbild plus källa och id. */
  const ICON_SAVE = '<svg class="ikon" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" d="M6 3.5h12a1 1 0 0 1 1 1V21l-7-3.5L5 21V4.5a1 1 0 0 1 1-1z"/></svg>';
  const ICON_SAVED = '<svg class="ikon" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M6 2h12a1 1 0 0 1 1 1v19l-7-3.5L5 22V3a1 1 0 0 1 1-1z"/></svg>';

  function loadStore() {
    try {
      const raw = localStorage.getItem(SAVED_KEY);
      if (!raw) return { version: 1, folders: [] };
      const data = JSON.parse(raw);
      if (!data || Number(data.version) !== 1 || !Array.isArray(data.folders)) return { version: 1, folders: [] };
      data.folders = data.folders.filter((f) => f && typeof f.name === "string" && Array.isArray(f.items));
      data.folders.forEach((f) => {
        f.items = f.items.filter((it) => it && it.id && it.snapshot);
      });
      return data;
    } catch (err) {
      return { version: 1, folders: [] };
    }
  }

  function persistStore() {
    try {
      localStorage.setItem(SAVED_KEY, JSON.stringify(state.saved));
      return true;
    } catch (err) {
      const el = $("sparStatus");
      if (el) el.textContent = "Kunde inte spara i den här webbläsaren.";
      return false;
    }
  }

  function newId(prefix) {
    return prefix + "-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
  }

  function asArray(value) {
    if (Array.isArray(value)) return value;
    if (value == null || value === "") return [];
    return [String(value)];
  }

  function snapshotItem(item) {
    const arrays = { pathLabels: 1, keywords: 1, variables: 1, levels: 1, measures: 1, notes: 1 };
    const snap = {};
    SNAP_KEYS.forEach((key) => {
      if (item[key] == null || item[key] === "") return;
      snap[key] = arrays[key] ? asArray(item[key]) : item[key];
    });
    return JSON.parse(JSON.stringify(snap));
  }

  function foldersContaining(id) {
    return state.saved.folders.filter((f) => f.items.some((it) => it.id === id));
  }

  function svCount(n, one, many) {
    return n + " " + (n === 1 ? one : many);
  }

  function saveButtonHtml(item, folderId) {
    if (!item || !item.id) return "";
    const n = foldersContaining(item.id).length;
    const label = n ? "Sparad" : "Spara";
    const title = n
      ? "Sparad i " + svCount(n, "mapp", "mappar") + ". Välj fler mappar om du vill."
      : "Spara i en mapp";
    const from = folderId ? ' data-from-folder="' + escapeHtml(folderId) + '"' : "";
    return '<button type="button" class="spara" data-save="' + escapeHtml(item.id) + '"' + from +
      ' aria-pressed="' + (n ? "true" : "false") + '" title="' + escapeHtml(title) + '">' +
      (n ? ICON_SAVED : ICON_SAVE) + " " + label + "</button>";
  }

  function showDialog(dlg) {
    try {
      if (typeof dlg.showModal === "function" && !dlg.open) {
        dlg.showModal();
        return;
      }
    } catch (err) { /* utan user gesture, eller äldre webbläsare */ }
    dlg.setAttribute("open", "");
  }

  function closeDialog(dlg) {
    if (typeof dlg.close === "function" && dlg.open) dlg.close();
    else dlg.removeAttribute("open");
  }

  function createFolder(name) {
    const trimmed = String(name || "").trim().slice(0, 80);
    if (!trimmed) return null;
    const folder = { id: newId("mapp"), name: trimmed, items: [] };
    state.saved.folders.push(folder);
    return persistStore() ? folder : null;
  }

  function renameFolder(id, name) {
    const folder = state.saved.folders.find((f) => f.id === id);
    const trimmed = String(name || "").trim().slice(0, 80);
    if (!folder || !trimmed) return false;
    folder.name = trimmed;
    return persistStore();
  }

  function deleteFolder(id) {
    const before = state.saved.folders.length;
    state.saved.folders = state.saved.folders.filter((f) => f.id !== id);
    if (state.saved.folders.length === before) return false;
    if (state.openFolder === id) state.openFolder = null;
    return persistStore();
  }

  function addItemToFolder(folderId, item) {
    const folder = state.saved.folders.find((f) => f.id === folderId);
    if (!folder || !item || !item.id) return false;
    if (folder.items.some((it) => it.id === item.id)) return false;
    folder.items.push({
      id: item.id,
      source: item.source || "",
      savedAt: new Date().toISOString(),
      note: "",
      snapshot: snapshotItem(item)
    });
    return persistStore();
  }

  function removeItem(folderId, itemId) {
    const folder = state.saved.folders.find((f) => f.id === folderId);
    if (!folder) return;
    folder.items = folder.items.filter((it) => it.id !== itemId);
    persistStore();
  }

  function setNote(folderId, itemId, note) {
    const folder = state.saved.folders.find((f) => f.id === folderId);
    const entry = folder && folder.items.find((it) => it.id === itemId);
    if (!entry) return;
    entry.note = String(note || "").slice(0, 280);
    persistStore();
  }

  function itemForSaveButton(btn) {
    const id = btn.getAttribute("data-save");
    const fromFolder = btn.getAttribute("data-from-folder");
    if (fromFolder) {
      const folder = state.saved.folders.find((f) => f.id === fromFolder);
      const entry = folder && folder.items.find((it) => it.id === id);
      if (entry && entry.snapshot) return entry.snapshot;
    }
    return state.items.find((it) => it.id === id) || null;
  }

  function openPicker(item) {
    state.pendingItem = snapshotItem(item);
    $("sparTitel").textContent = item.title || "Utan titel";
    $("sparFel").textContent = "";
    $("sparNy").value = "";
    $("sparMappar").innerHTML = state.saved.folders.length
      ? state.saved.folders.map((f) => {
          const has = f.items.some((it) => it.id === item.id);
          return '<button type="button" class="secondary" data-valj-mapp="' + escapeHtml(f.id) + '"' +
            (has ? " disabled" : "") + ">" + escapeHtml(f.name) + (has ? " · redan sparad" : "") + "</button>";
        }).join("")
      : '<p class="lead" style="margin:0">Ingen mapp ännu. Skapa en nedan.</p>';
    showDialog($("sparvaljare"));
    if (!state.saved.folders.length) $("sparNy").focus();
  }

  function openNameDialog(action) {
    state.nameAction = action;
    $("namnRubrik").textContent = action.type === "rename" ? "Byt namn" : "Ny mapp";
    $("namnInput").value = action.name || "";
    showDialog($("namndialog"));
    $("namnInput").focus();
    $("namnInput").select();
  }

  function updateSavedCount() {
    const n = state.saved.folders.reduce((sum, f) => sum + f.items.length, 0);
    $("sparAntal").textContent = n ? " (" + n + ")" : "";
  }

  function refreshViews() {
    updateSavedCount();
    if (state.view === "sparade") renderSaved();
    else if (state.items.length) render();
  }

  function showView(name) {
    state.view = name === "sparade" ? "sparade" : "sok";
    const sok = state.view === "sok";
    $("sokvy").hidden = !sok;
    $("sparvy").hidden = sok;
    $("tabSok").setAttribute("aria-pressed", sok ? "true" : "false");
    $("tabSparade").setAttribute("aria-pressed", sok ? "false" : "true");
    if (!sok) renderSaved();
    else if (state.items.length) render();
    updateSavedCount();
  }

  function savedExtra(entry, folderId) {
    return '<label class="notis">Anteckning' +
      '<input type="text" maxlength="280" data-note-folder="' + escapeHtml(folderId) + '" data-note-item="' + escapeHtml(entry.id) +
      '" value="' + escapeHtml(entry.note || "") + '" placeholder="Valfri kort anteckning"></label>' +
      '<div class="lankar"><button type="button" class="secondary" data-remove-folder="' + escapeHtml(folderId) +
      '" data-remove-item="' + escapeHtml(entry.id) + '">Ta bort från mappen</button></div>';
  }

  function renderSaved() {
    const root = $("sparInnehall");
    const folder = state.openFolder && state.saved.folders.find((f) => f.id === state.openFolder);
    if (state.openFolder && !folder) state.openFolder = null;
    if (!folder) {
      if (!state.saved.folders.length) {
        root.innerHTML = "<p>Inga mappar ännu. Spara en träff med knappen Spara, eller skapa en mapp här.</p>";
        return;
      }
      root.innerHTML = state.saved.folders.map((f) =>
        '<article class="mapp">' +
          '<button type="button" class="mapp-oppna" data-open-folder="' + escapeHtml(f.id) + '">' +
            '<span class="mapp-namn">' + escapeHtml(f.name) + "</span> " +
            '<span class="antal">' + svCount(f.items.length, "sparad", "sparade") + "</span>" +
          "</button>" +
          '<div class="mapp-rad">' +
            '<button type="button" class="secondary" data-rename-folder="' + escapeHtml(f.id) + '">Byt namn</button>' +
            '<button type="button" class="secondary" data-delete-folder="' + escapeHtml(f.id) + '">Ta bort</button>' +
          "</div>" +
        "</article>"
      ).join("");
      return;
    }
    const cards = folder.items.map((entry) => {
      const snap = entry.snapshot || {};
      if (!snap.id) snap.id = entry.id;
      if (!snap.source) snap.source = entry.source;
      return renderCard(snap, { saved: true, folderId: folder.id, extra: savedExtra(entry, folder.id) });
    }).join("");
    root.innerHTML =
      '<p><button type="button" class="secondary" data-back>Alla mappar</button></p>' +
      '<h2 class="mapp-rubrik">' + escapeHtml(folder.name) + "</h2>" +
      '<div class="mapp-rad" style="margin-bottom:.8rem">' +
        '<button type="button" class="secondary" data-rename-folder="' + escapeHtml(folder.id) + '">Byt namn</button>' +
        '<button type="button" class="secondary" data-delete-folder="' + escapeHtml(folder.id) + '">Ta bort mapp</button>' +
      "</div>" +
      (cards || "<p>Mappen är tom.</p>");
  }

  function mergeStore(incoming) {
    if (!incoming || Number(incoming.version) !== 1 || !Array.isArray(incoming.folders)) {
      throw new Error("ogiltig");
    }
    let addedFolders = 0;
    let addedItems = 0;
    incoming.folders.forEach((folder) => {
      if (!folder || typeof folder.name !== "string" || !folder.name.trim() || !Array.isArray(folder.items)) return;
      const name = folder.name.trim().slice(0, 80);
      let dest = folder.id ? state.saved.folders.find((f) => f.id === folder.id) : null;
      if (!dest) dest = state.saved.folders.find((f) => f.name.trim().toLowerCase() === name.toLowerCase());
      if (!dest) {
        const id = folder.id && !state.saved.folders.some((f) => f.id === folder.id) ? String(folder.id) : newId("mapp");
        dest = { id: id, name: name, items: [] };
        state.saved.folders.push(dest);
        addedFolders += 1;
      }
      folder.items.forEach((it) => {
        if (!it || !it.id || !it.snapshot || typeof it.snapshot !== "object") return;
        const existing = dest.items.find((x) => x.id === it.id);
        if (!existing) {
          dest.items.push({
            id: String(it.id),
            source: String(it.source || it.snapshot.source || ""),
            savedAt: typeof it.savedAt === "string" ? it.savedAt : new Date().toISOString(),
            note: typeof it.note === "string" ? it.note.slice(0, 280) : "",
            snapshot: snapshotItem(Object.assign({ id: it.id, source: it.source }, it.snapshot))
          });
          addedItems += 1;
        } else if (!existing.note && typeof it.note === "string" && it.note.trim()) {
          existing.note = it.note.slice(0, 280);
        }
      });
    });
    persistStore();
    return { addedFolders: addedFolders, addedItems: addedItems };
  }

  function mergeMessage(res) {
    if (!res.addedFolders && !res.addedItems) return "Inget nytt att lägga till. Det som redan fanns behölls.";
    const parts = [];
    if (res.addedFolders) parts.push(svCount(res.addedFolders, "mapp", "mappar"));
    if (res.addedItems) parts.push(svCount(res.addedItems, "post", "poster"));
    return "Lade till " + parts.join(" och ") + ".";
  }

  function exportSaved() {
    const blob = new Blob([JSON.stringify(state.saved, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    const url = URL.createObjectURL(blob);
    a.href = url;
    a.download = "oppna-data-sparade.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    $("sparStatus").textContent = "Exporten laddas ner som oppna-data-sparade.json.";
  }

  function includedSources() {
    return ["scb", "kolada", "dataportal"].filter(sourceEnabled);
  }

  function blankCursors(names) {
    const sources = {};
    names.forEach((name) => {
      sources[name] = { page: 1, offset: 0, fetched: 0, total: null, done: false };
    });
    return sources;
  }

  function fetchSource(name, query, src) {
    if (name === "scb") return searchScb(query, src.page);
    if (name === "kolada") return searchKolada(query, src.page);
    return searchDataportal(query, src.offset);
  }

  function acceptItem(item) {
    const s = state.search;
    if (!s) return true;
    if (s.theme && !matchesTheme(item, s.theme)) return false;
    if (s.textFilter && !normalize(item.title + " " + (item.description || "")).includes(s.textFilter)) return false;
    return true;
  }

  function appendItems(items) {
    const seen = Object.create(null);
    state.items.forEach((it) => { seen[it.id] = true; });
    let added = 0;
    items.forEach((it) => {
      if (!it || !it.id || seen[it.id]) return;
      seen[it.id] = true;
      applyArea(it);
      state.items.push(it);
      added += 1;
    });
    return added;
  }

  function noteSourcePage(name, res) {
    const src = state.search.sources[name];
    src.fetched += res.items.length;
    if (res.total != null) src.total = res.total;
    if (name === "dataportal") src.offset += res.items.length || 20;
    else src.page += 1;
    if (res.done || !res.items.length) src.done = true;
    if (src.total != null && src.fetched >= src.total) src.done = true;
    if (src.done && src.total == null) src.total = src.fetched;
  }

  function pageNote(name, res, added) {
    const src = state.search.sources[name];
    const totalTxt = src.total != null ? src.total : (res.total != null ? res.total : (src.done ? src.fetched : res.items.length + "+"));
    if (state.search.theme) {
      const matched = res.items.filter(acceptItem).length;
      return name + ": " + matched + " efter temafilter (av " + res.items.length + ", källan angav " + totalTxt + ")";
    }
    return name + ": " + added + " visade (källan angav " + totalTxt + ")";
  }

  async function fetchNextPages(names, gen) {
    const notes = [];
    for (let i = 0; i < names.length; i += 1) {
      const name = names[i];
      const src = state.search && state.search.sources[name];
      if (!src || src.done) continue;
      try {
        const res = await fetchSource(name, state.search.query, src);
        if (gen !== state.searchGen || !state.search || !state.search.sources[name]) return notes;
        const added = appendItems(res.items.filter(acceptItem));
        noteSourcePage(name, res);
        if (added === 0 && !state.search.theme && !state.search.textFilter && res.items.length) src.done = true;
        notes.push(pageNote(name, res, added));
      } catch (err) {
        if (gen !== state.searchGen) return notes;
        notes.push(name + ": fel (" + (err && err.message ? err.message : err) + ")");
        console.error(err);
        if (state.errors.indexOf(name) === -1) state.errors.push(name);
      }
    }
    return notes;
  }

  async function runSearch(evt) {
    if (evt) evt.preventDefault();
    const q = buildQuery();
    if (!q) {
      $("status").textContent = "Skriv en sökfråga eller välj ett tema först.";
      return;
    }
    $("status").textContent = "Söker i öppna API:er efter \u00ab" + q.apiQuery + "\u00bb…";
    $("traffar").innerHTML = "";
    $("sammanfattning").hidden = true;
    $("forfina").hidden = true;
    state.items = [];
    state.errors = [];
    state.loadingMore = false;
    state.searchGen = (state.searchGen || 0) + 1;
    const gen = state.searchGen;
    state.selectedArea = parseAreaInput($("omrade").value);
    const names = includedSources();
    state.search = { query: q.apiQuery, theme: q.theme, textFilter: null, sources: blankCursors(names) };

    let notes = await fetchNextPages(names, gen);
    if (gen !== state.searchGen) return;

    // Om fritext+tema gav noll träffar, prova temat som sökfråga och filtrera på texten.
    if (q.mode === "text+tema" && !state.items.length) {
      $("status").textContent = "Inga träffar på fritext och tema tillsammans. Provar temat som sökfråga och filtrerar på din text…";
      state.search.query = q.theme.query;
      state.search.textFilter = normalize(q.text);
      state.search.sources = blankCursors(names);
      notes = await fetchNextPages(names, gen);
      if (gen !== state.searchGen) return;
    }

    const errText = state.errors.length ? " Fel mot: " + state.errors.join(", ") + "." : "";
    $("status").textContent = "Sökning: " + notes.join(". ") + "." + errText;
    render();
  }

  async function loadMore() {
    if (!state.search || state.loadingMore) return;
    const names = Object.keys(state.search.sources).filter((id) => !state.search.sources[id].done);
    if (!names.length) return;
    const gen = state.searchGen;
    state.loadingMore = true;
    render();
    const notes = await fetchNextPages(names, gen);
    if (gen !== state.searchGen) return;
    state.loadingMore = false;
    if (notes.length) $("status").textContent = "Fler träffar: " + notes.join(". ") + ".";
    render();
  }

  async function refineAll() {
    const pending = state.items.filter((i) => i.source === "scb" && !i.regionCodes);
    if (!pending.length) return;
    $("forfina").disabled = true;
    $("status").textContent = "Hämtar tabellmetadata för " + pending.length + " SCB-tabeller. Stora DeSO-tabeller kan ta lite tid…";
    let done = 0;
    const queue = pending.slice();
    async function worker() {
      while (queue.length) {
        const item = queue.shift();
        try {
          await enrichScb(item);
          applyArea(item);
        } catch (err) {
          console.error(item.tableId, err);
        }
        done += 1;
        if (done % 3 === 0 || !queue.length) {
          $("status").textContent = "Hämtat metadata för " + done + " av " + pending.length + " SCB-tabeller…";
          render();
        }
      }
    }
    await Promise.all([worker(), worker()]);
    $("forfina").disabled = false;
    $("status").textContent = "Geografiska nivåer är uppdaterade från tabellmetadata där det gick.";
    render();
  }

  function mount() {
    $("temar").innerHTML = THEMES.map((t) =>
      '<button type="button" class="tema" data-theme="' + t.id + '" aria-pressed="false">' + escapeHtml(t.label) + "</button>"
    ).join("");
    $("kallor").innerHTML = SOURCES.map((s) =>
      '<label><input type="checkbox" value="' + s.id + '" checked> ' + escapeHtml(s.label) + "</label>"
    ).join("");
    $("nivaer").innerHTML = LEVELS.map((l) =>
      '<label><input type="checkbox" value="' + l.id + '" checked> ' + escapeHtml(l.label) + "</label>"
    ).join("");

    $("temar").addEventListener("click", (ev) => {
      const btn = ev.target.closest("[data-theme]");
      if (!btn) return;
      const id = btn.getAttribute("data-theme");
      const on = state.theme !== id;
      state.theme = on ? id : null;
      document.querySelectorAll("[data-theme]").forEach((b) => b.setAttribute("aria-pressed", b.getAttribute("data-theme") === state.theme ? "true" : "false"));
    });

    $("sokform").addEventListener("submit", runSearch);
    $("kallor").addEventListener("change", render);
    $("nivaer").addEventListener("change", render);
    $("baraOmrade").addEventListener("change", render);
    $("omrade").addEventListener("change", () => {
      state.selectedArea = parseAreaInput($("omrade").value);
      state.items.forEach(applyArea);
      render();
    });
    $("omrade").addEventListener("focus", () => { loadAreas().catch((err) => console.error(err)); });
    $("forfina").addEventListener("click", refineAll);

    state.saved = loadStore();
    updateSavedCount();

    $("tabSok").addEventListener("click", () => showView("sok"));
    $("tabSparade").addEventListener("click", () => showView("sparade"));
    $("nyMapp").addEventListener("click", () => openNameDialog({ type: "create" }));
    $("exportera").addEventListener("click", exportSaved);
    $("importeraKnapp").addEventListener("click", () => {
      $("importera").value = "";
      $("importera").click();
    });
    $("importera").addEventListener("change", () => {
      const file = $("importera").files && $("importera").files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const data = JSON.parse(String(reader.result || ""));
          const res = mergeStore(data);
          $("sparStatus").textContent = mergeMessage(res);
          refreshViews();
        } catch (err) {
          $("sparStatus").textContent = "Kunde inte läsa filen. Välj en JSON-export från den här sidan.";
        }
      };
      reader.readAsText(file);
    });
    $("sparAvbryt").addEventListener("click", () => closeDialog($("sparvaljare")));
    $("namnAvbryt").addEventListener("click", () => closeDialog($("namndialog")));
    $("sparForm").addEventListener("submit", (ev) => {
      ev.preventDefault();
      const name = $("sparNy").value.trim();
      if (!name) {
        $("sparFel").textContent = "Skriv ett namn på den nya mappen, eller välj en mapp ovan.";
        return;
      }
      const folder = createFolder(name);
      if (folder && state.pendingItem) addItemToFolder(folder.id, state.pendingItem);
      closeDialog($("sparvaljare"));
      refreshViews();
    });
    $("namnForm").addEventListener("submit", (ev) => {
      ev.preventDefault();
      const name = $("namnInput").value.trim();
      if (!name || !state.nameAction) return;
      const action = state.nameAction;
      closeDialog($("namndialog"));
      if (action.type === "rename") renameFolder(action.id, name);
      else {
        const folder = createFolder(name);
        if (folder) state.openFolder = folder.id;
      }
      refreshViews();
    });

    document.addEventListener("click", (ev) => {
      if (ev.target.closest("#visaFler")) {
        loadMore();
        return;
      }
      const choose = ev.target.closest("[data-valj-mapp]");
      if (choose && !choose.disabled) {
        addItemToFolder(choose.getAttribute("data-valj-mapp"), state.pendingItem);
        closeDialog($("sparvaljare"));
        refreshViews();
        return;
      }
      const saveBtn = ev.target.closest("[data-save]");
      if (saveBtn) {
        const item = itemForSaveButton(saveBtn);
        if (item) openPicker(item);
        return;
      }
      const openBtn = ev.target.closest("[data-open-folder]");
      if (openBtn) {
        state.openFolder = openBtn.getAttribute("data-open-folder");
        $("sparStatus").textContent = "";
        renderSaved();
        return;
      }
      if (ev.target.closest("[data-back]")) {
        state.openFolder = null;
        renderSaved();
        return;
      }
      const renameBtn = ev.target.closest("[data-rename-folder]");
      if (renameBtn) {
        const id = renameBtn.getAttribute("data-rename-folder");
        const folder = state.saved.folders.find((f) => f.id === id);
        if (folder) openNameDialog({ type: "rename", id: id, name: folder.name });
        return;
      }
      const deleteBtn = ev.target.closest("[data-delete-folder]");
      if (deleteBtn) {
        const id = deleteBtn.getAttribute("data-delete-folder");
        const folder = state.saved.folders.find((f) => f.id === id);
        if (!folder) return;
        if (!window.confirm("Ta bort mappen \u201d" + folder.name + "\u201d och allt som är sparat i den?")) return;
        deleteFolder(id);
        $("sparStatus").textContent = "Mappen är borttagen.";
        refreshViews();
        return;
      }
      const removeBtn = ev.target.closest("[data-remove-item]");
      if (removeBtn) {
        removeItem(removeBtn.getAttribute("data-remove-folder"), removeBtn.getAttribute("data-remove-item"));
        refreshViews();
      }
    });
    document.addEventListener("change", (ev) => {
      const note = ev.target.closest("[data-note-item]");
      if (!note) return;
      setNote(note.getAttribute("data-note-folder"), note.getAttribute("data-note-item"), note.value);
    });

    loadAreas().catch(() => {});
  }

  mount();
})();
