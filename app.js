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

  const state = {
    theme: null,
    items: [],
    areas: [],
    selectedArea: null,
    errors: []
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

  async function searchScb(query) {
    const url = SCB_TABLES + "?lang=sv&pageNumber=1&pageSize=40&query=" + encodeURIComponent(query);
    const data = await fetchJson(url);
    const tables = data.tables || [];
    const total = (data.page && data.page.totalElements) || tables.length;
    return {
      total,
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

  async function searchKolada(query) {
    const url = KOLADA_KPI + "?page=1&per_page=80&title=" + encodeURIComponent(query);
    const data = await fetchJson(url);
    const values = data.values || [];
    const total = data.next_url ? values.length + "+" : (data.count != null && data.count > values.length ? data.count : values.length);
    return {
      total,
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

  async function searchDataportal(query) {
    const solr = "title.sv:" + query + " AND rdfType:http\\://www.w3.org/ns/dcat#Dataset AND public:true";
    const url = DP_SEARCH + "?type=solr&limit=20&offset=0&sort=" + encodeURIComponent("modified desc") + "&query=" + encodeURIComponent(solr);
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
    return { total: data.results != null ? data.results : items.length, items: items };
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

  function render() {
    const items = visibleItems();
    const sum = $("sammanfattning");
    const by = { scb: 0, kolada: 0, dataportal: 0 };
    state.items.forEach((i) => { if (by[i.source] != null) by[i.source] += 1; });
    sum.hidden = !state.items.length;
    sum.innerHTML = [
      '<span class="pill">SCB: ' + by.scb + '</span>',
      '<span class="pill">Kolada: ' + by.kolada + '</span>',
      '<span class="pill">Dataportal: ' + by.dataportal + '</span>',
      '<span class="pill">Visar ' + items.length + ' av ' + state.items.length + '</span>'
    ].join("");
    $("forfina").hidden = !state.items.some((i) => i.source === "scb" && !i.regionCodes);
    const root = $("traffar");
    if (!items.length) {
      root.innerHTML = state.items.length ? "<p>Inga träffar med nuvarande filter.</p>" : "";
      return;
    }
    root.innerHTML = items.map(renderCard).join("");
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

  function renderCard(item) {
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
    const enrich = item.source === "scb" && !item.regionCodes
      ? '<button type="button" class="secondary" data-enrich="' + escapeHtml(item.id) + '">Hämta fullständig tabellmetadata</button>'
      : "";
    const area = badgeForArea(item.areaStatus);
    const sourceBadge = '<span class="badge">' + escapeHtml(item.sourceName) + "</span>";
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
        '<div class="meta-rad">' + sourceBadge + area + "</div>" +
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
      "</article>"
    );
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
    state.selectedArea = parseAreaInput($("omrade").value);

    const jobs = [];
    if (sourceEnabled("scb")) jobs.push(["scb", searchScb(q.apiQuery)]);
    if (sourceEnabled("kolada")) jobs.push(["kolada", searchKolada(q.apiQuery)]);
    if (sourceEnabled("dataportal")) jobs.push(["dataportal", searchDataportal(q.apiQuery)]);

    const gathered = [];
    const notes = [];
    for (const [name, promise] of jobs) {
      try {
        const res = await promise;
        let items = res.items;
        if (q.theme) {
          const before = items.length;
          items = items.filter((it) => matchesTheme(it, q.theme));
          notes.push(name + ": " + items.length + " efter temafilter (av " + before + ", källan angav " + res.total + ")");
        } else {
          notes.push(name + ": " + items.length + " visade (källan angav " + res.total + ")");
        }
        gathered.push.apply(gathered, items);
      } catch (err) {
        state.errors.push(name);
        notes.push(name + ": fel (" + (err && err.message ? err.message : err) + ")");
        console.error(err);
      }
    }

    // Om fritext+tema gav noll i en källa, prova temat som sökfråga och filtrera på texten.
    if (q.mode === "text+tema" && !gathered.length) {
      $("status").textContent = "Inga träffar på fritext och tema tillsammans. Provar temat som sökfråga och filtrerar på din text…";
      const retry = [];
      if (sourceEnabled("scb")) retry.push(searchScb(q.theme.query));
      if (sourceEnabled("kolada")) retry.push(searchKolada(q.theme.query));
      if (sourceEnabled("dataportal")) retry.push(searchDataportal(q.theme.query));
      const textLow = normalize(q.text);
      for (const promise of retry) {
        try {
          const res = await promise;
          const items = res.items.filter((it) => matchesTheme(it, q.theme) && normalize(it.title + " " + (it.description || "")).includes(textLow));
          gathered.push.apply(gathered, items);
        } catch (err) {
          console.error(err);
        }
      }
    }

    gathered.forEach(applyArea);
    state.items = gathered;
    const errText = state.errors.length ? " Fel mot: " + state.errors.join(", ") + "." : "";
    $("status").textContent = "Sökning: " + notes.join(". ") + "." + errText;
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
    loadAreas().catch(() => {});
  }

  mount();
})();
