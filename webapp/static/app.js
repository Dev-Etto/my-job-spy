/* JobSpy UI — vanilla JS, no build step. Filtering happens client-side over /api/jobs. */
"use strict";

// ------------------------------------------------------------------ helpers
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const norm = (s) => String(s ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
const terms = (s) => String(s ?? "").split(",").map((t) => norm(t).trim()).filter(Boolean);
const debounce = (fn, ms = 200) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const store = {
  get(k, d) { try { const v = localStorage.getItem("jobspy." + k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem("jobspy." + k, JSON.stringify(v)); } catch { /* private mode */ } },
};

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...opts,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  if (!res.ok) {
    let msg = res.statusText;
    try { msg = (await res.json()).detail || msg; } catch { /* not json */ }
    throw new Error(msg);
  }
  return res.json();
}

let toastTimer;
// action: { label, onClick } renders a button; toasts with an action stay up longer
function toast(msg, action = null) {
  const el = $("#toast");
  el.innerHTML = esc(msg) + (action ? ` <button class="toast-btn">${esc(action.label)}</button>` : "");
  if (action) $(".toast-btn", el).addEventListener("click", () => { el.hidden = true; action.onClick(); });
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), action ? 12000 : 3200);
}

const SITE_LABEL = { linkedin: "LinkedIn", indeed: "Indeed", glassdoor: "Glassdoor", google: "Google Jobs", zip_recruiter: "ZipRecruiter", bayt: "Bayt", naukri: "Naukri", bdjobs: "BDJobs" };
const SITE_NOTE = { zip_recruiter: "EUA/CA", bayt: "Oriente Médio", naukri: "Índia", bdjobs: "Bangladesh", glassdoor: "bloqueia com frequência" };
const SEN = { estagio: "Estágio", junior: "Júnior", pleno: "Pleno", senior: "Sênior", lead: "Lead/Especialista", indefinido: "Não informado" };
const MODE = { remoto: "Remoto", hibrido: "Híbrido", presencial: "Presencial", indefinido: "Não informado" };
const STATUS = { new: "Nova", saved: "Salva", applied: "Aplicada", interview: "Entrevista", offer: "Oferta", rejected: "Recusada", discarded: "Descartada", archived: "Arquivada" };
const PIPELINE = ["saved", "applied", "interview", "offer", "rejected"];
const REGION = { br: "Brasil", intl: "Internacional" };
const LANG = { pt: "Português", en: "Inglês", indefinido: "Sem descrição" };

function daysAgo(d) {
  if (!d) return null;
  const t = Date.parse(String(d).slice(0, 10));
  if (Number.isNaN(t)) return null;
  return Math.floor((Date.now() - t) / 86400000);
}
function agoLabel(d) {
  const n = daysAgo(d);
  if (n === null) return "";
  if (n <= 0) return "hoje";
  if (n === 1) return "ontem";
  return `há ${n} dias`;
}
function money(v, cur) {
  if (v == null) return "";
  try {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: cur || "BRL", maximumFractionDigits: 0 }).format(v);
  } catch { return `${cur || ""} ${Math.round(v)}`; }
}
function salaryLabel(j) {
  if (!j.salary_month_min) return "";
  const a = money(j.salary_month_min, j.salary_currency);
  const b = j.salary_month_max && j.salary_month_max !== j.salary_month_min ? ` – ${money(j.salary_month_max, j.salary_currency)}` : "";
  return `${a}${b}/mês${j.salary_source === "descricao" ? "*" : ""}`;
}
function daysSince(iso) {
  return iso ? Math.floor((Date.now() - Date.parse(iso)) / 86400000) : null;
}
function fmtDateTime(iso) {
  return iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";
}
function scoreColor(s) {
  return s >= 70 ? "var(--good)" : s >= 45 ? "var(--accent)" : s >= 25 ? "var(--warn)" : "var(--bad)";
}

// ------------------------------------------------------------------ state
const DEFAULT_FILTERS = {
  q: "", qTitle: false,
  status: ["new", "saved", "applied", "interview"],
  minScore: 0, region: [], mode: [], seniority: [], site: [], language: [], contract: [], template: [],
  skills: [], skillsMode: "any", avoid: [], avoidScope: "title",
  days: "", maxYears: "", salaryOnly: false, salaryMin: "", currency: [],
  includeAll: "", excludeTitle: "", excludeText: "", excludeCompanies: "",
  hideDup: true, hideFluent: false, directOnly: false, withDesc: false, run: "",
  unseen: false, since: "", newInRun: "",
};
const state = {
  meta: null,
  jobs: [],
  byId: new Map(),
  filtered: [],
  facets: {},
  filters: { ...DEFAULT_FILTERS, ...store.get("filters", {}) },
  sort: store.get("sort", "score"),
  selectedId: null,
  limit: 150,
  runs: [],
  formSites: new Set(["indeed", "linkedin", "google"]),
  selectedTemplates: new Set(),
  loadedTemplateId: null,
  pollTimer: null,
  lastRunsSig: "",
  runStatus: null, // id → status from the previous poll, to notice runs that just finished
  twins: new Map(), // dup_key → jobs with that key (same job on several sites)
  prevVisit: store.get("lastVisit", null),
};

// ------------------------------------------------------------------ boot
async function init() {
  applyTheme(store.get("theme", null));
  state.meta = await api("/api/meta");
  $("#profile-name").textContent = state.meta.profile.headline || "";
  setupTabs();
  setupJobsTab();
  setupSearchTab();
  setupProfileTab();
  setupPipelineTab();
  setupAutoTab();
  await loadJobs();
  await pollRuns();
  store.set("lastVisit", new Date().toISOString());
}

function applyTheme(t) {
  if (t) document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
}
$("#theme-toggle").addEventListener("click", () => {
  const cur = document.documentElement.dataset.theme
    || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  const next = cur === "dark" ? "light" : "dark";
  applyTheme(next);
  store.set("theme", next);
});

function setupTabs() {
  $$("#tabs button").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));
  document.addEventListener("click", (e) => {
    const a = e.target.closest("[data-goto]");
    if (a) { e.preventDefault(); showTab(a.dataset.goto); }
  });
  showTab(location.hash.slice(1) || "jobs");
}
function showTab(tab) {
  if (!$("#tab-" + tab)) tab = "jobs";
  $$("#tabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  $$(".tab-panel").forEach((p) => p.classList.toggle("active", p.id === "tab-" + tab));
  history.replaceState(null, "", "#" + tab);
  if (tab === "stats") renderStats();
  if (tab === "runs") renderRuns();
  if (tab === "pipeline") renderPipeline();
  if (tab === "auto") renderAuto();
}

async function loadJobs() {
  const jobs = await api("/api/jobs");
  for (const j of jobs) {
    j._head = norm(`${j.title} ${j.company}`);
    j._text = norm(`${j.title} ${j.company} ${j.location} ${j.description || ""}`);
    j._company = norm(j.company);
    j._days = daysAgo(j.date_posted);
  }
  state.jobs = jobs;
  state.byId = new Map(jobs.map((j) => [j.id, j]));
  state.twins = new Map();
  for (const j of jobs) {
    if (!j.company) continue; // "title|" alone would merge unrelated jobs
    if (!state.twins.has(j.dup_key)) state.twins.set(j.dup_key, []);
    state.twins.get(j.dup_key).push(j);
  }
  updateCounts();
  refresh();
  if ($("#tab-pipeline").classList.contains("active")) renderPipeline();
}

// other copies of the same job on other sites
function twinsOf(j) {
  return j.company ? (state.twins.get(j.dup_key) || []).filter((t) => t.id !== j.id) : [];
}

function isUnseen(j) { return !j.seen_at && j.status === "new"; }

function followupDue(j) {
  if (j.status !== "applied") return null;
  const since = daysSince([j.followup_at, j.applied_at, j.status_changed].filter(Boolean).sort().pop());
  return since !== null && since >= (state.meta.settings.followup_days || 7) ? since : null;
}

function updateCounts() {
  const unseen = state.jobs.filter(isUnseen).length;
  $("#tab-count-jobs").innerHTML = state.jobs.length ? `(${state.jobs.length}${unseen ? ` · <b>${unseen} novas</b>` : ""})` : "";
  const due = state.jobs.filter(followupDue).length;
  $("#followup-badge").hidden = !due;
  $("#followup-badge").textContent = due;
  $("#followup-badge").title = `${due} candidatura(s) pedindo follow-up`;
  renderBanner();
}

// "N vagas chegaram desde a sua última visita"
function renderBanner() {
  const el = $("#jobs-banner");
  const since = state.prevVisit;
  const n = since ? state.jobs.filter((j) => j.status === "new" && j.first_seen > since.slice(0, 19)).length : 0;
  const dismissed = store.get("bannerDismissed", "") === since;
  if (state.filters.since) {
    el.hidden = false;
    el.innerHTML = `Mostrando só as vagas que chegaram desde ${fmtDateTime(state.filters.since)}. <button class="btn sm ghost" data-banner="clear">Ver todas</button>`;
  } else if (n && !dismissed) {
    el.hidden = false;
    el.innerHTML = `<b>${n} vaga${n > 1 ? "s" : ""} nova${n > 1 ? "s" : ""}</b> desde a sua última visita (${fmtDateTime(since)}). <button class="btn sm primary" data-banner="show">Ver só elas</button> <button class="icon-btn sm" data-banner="dismiss" title="Dispensar">✕</button>`;
  } else el.hidden = true;
}

// ------------------------------------------------------------------ filtering
// Each predicate: [key, isActive(f), test(job, f)]. Facet counts for a chip group
// are computed over jobs that pass every *other* active predicate.
const PREDICATES = [
  ["q", (f) => f.q.trim(), (j, f) => norm(f.q).trim().split(/\s+/).every((w) => (f.qTitle ? j._head : j._text).includes(w))],
  ["status", (f) => f.status.length, (j, f) => f.status.includes(j.status)],
  ["minScore", (f) => +f.minScore > 0, (j, f) => j.score >= +f.minScore],
  ["region", (f) => f.region.length, (j, f) => f.region.includes(j.region)],
  ["mode", (f) => f.mode.length, (j, f) => f.mode.includes(j.work_mode)],
  ["seniority", (f) => f.seniority.length, (j, f) => f.seniority.includes(j.seniority)],
  ["site", (f) => f.site.length, (j, f) => f.site.includes(j.site)],
  ["language", (f) => f.language.length, (j, f) => f.language.includes(j.language)],
  ["contract", (f) => f.contract.length, (j, f) => f.contract.some((c) => (c === "—" ? !j.contract.length : j.contract.includes(c)))],
  ["template", (f) => f.template.length, (j, f) => f.template.some((t) => j.template_ids.includes(t))],
  ["currency", (f) => f.currency.length, (j, f) => f.currency.includes(j.salary_currency || "—")],
  ["skills", (f) => f.skills.length, (j, f) => (f.skillsMode === "all" ? f.skills.every((s) => j.matched_skills.includes(s)) : f.skills.some((s) => j.matched_skills.includes(s)))],
  ["avoid", (f) => f.avoid.length, (j, f) => !f.avoid.some((s) => (f.avoidScope === "title" ? j.avoid_title_hits || [] : j.avoid_hits).includes(s))],
  ["days", (f) => f.days, (j, f) => j._days !== null && j._days <= +f.days],
  ["maxYears", (f) => f.maxYears, (j, f) => !j.years_required || j.years_required <= +f.maxYears],
  ["salaryOnly", (f) => f.salaryOnly, (j) => !!j.salary_month_min],
  ["salaryMin", (f) => +f.salaryMin > 0, (j, f) => (j.salary_month_max || j.salary_month_min || 0) >= +f.salaryMin],
  ["includeAll", (f) => terms(f.includeAll).length, (j, f) => terms(f.includeAll).every((t) => j._text.includes(t))],
  ["excludeTitle", (f) => terms(f.excludeTitle).length, (j, f) => !terms(f.excludeTitle).some((t) => j._head.includes(t))],
  ["excludeText", (f) => terms(f.excludeText).length, (j, f) => !terms(f.excludeText).some((t) => j._text.includes(t))],
  ["excludeCompanies", (f) => terms(f.excludeCompanies).length, (j, f) => !terms(f.excludeCompanies).some((t) => j._company.includes(t))],
  ["hideFluent", (f) => f.hideFluent, (j) => !j.english_fluent],
  ["directOnly", (f) => f.directOnly, (j) => !!j.job_url_direct],
  ["withDesc", (f) => f.withDesc, (j) => !!j.description],
  ["run", (f) => f.run, (j, f) => j.run_ids.includes(+f.run)],
  ["unseen", (f) => f.unseen, (j) => isUnseen(j)],
  ["since", (f) => f.since, (j, f) => j.first_seen > f.since.slice(0, 19)],
  // jobs first found by this run (run_ids is in discovery order)
  ["newInRun", (f) => f.newInRun, (j, f) => j.run_ids[0] === +f.newInRun],
];

const FACET_FIELDS = {
  status: (j) => [j.status], region: (j) => [j.region], mode: (j) => [j.work_mode], seniority: (j) => [j.seniority],
  site: (j) => [j.site], language: (j) => [j.language], contract: (j) => (j.contract.length ? j.contract : ["—"]),
  template: (j) => j.template_ids, currency: (j) => [j.salary_currency || "—"], skills: (j) => j.matched_skills,
  avoid: (j) => (state.filters.avoidScope === "title" ? j.avoid_title_hits || [] : j.avoid_hits),
};

function applyFilters() {
  const f = state.filters;
  const active = PREDICATES.filter(([, on]) => on(f));
  const facets = Object.fromEntries(Object.keys(FACET_FIELDS).map((k) => [k, {}]));
  const bump = (key, j) => { for (const v of FACET_FIELDS[key](j)) facets[key][v] = (facets[key][v] || 0) + 1; };
  let out = [];
  for (const j of state.jobs) {
    let failed = null, fails = 0;
    for (const [key, , test] of active) {
      if (!test(j, f)) { fails++; failed = key; if (fails > 1) break; }
    }
    if (fails === 0) { out.push(j); for (const k in FACET_FIELDS) bump(k, j); }
    else if (fails === 1 && FACET_FIELDS[failed]) bump(failed, j);
  }
  if (f.hideDup) {
    const best = new Map();
    for (const j of out) {
      const cur = best.get(j.dup_key);
      if (!cur || j.score > cur.score || (j.score === cur.score && (j.description || "").length > (cur.description || "").length)) best.set(j.dup_key, j);
    }
    const keep = new Set(best.values());
    state.dupHidden = out.length - keep.size;
    out = out.filter((j) => keep.has(j));
  } else state.dupHidden = 0;
  const sorters = {
    score: (a, b) => b.score - a.score || (a._days ?? 999) - (b._days ?? 999),
    date: (a, b) => (a._days ?? 999) - (b._days ?? 999) || b.score - a.score,
    first_seen: (a, b) => b.first_seen.localeCompare(a.first_seen) || b.score - a.score,
    salary: (a, b) => (b.salary_month_max || b.salary_month_min || 0) - (a.salary_month_max || a.salary_month_min || 0),
    company: (a, b) => a._company.localeCompare(b._company),
  };
  out.sort(sorters[state.sort] || sorters.score);
  state.filtered = out;
  state.facets = facets;
}

function refresh() {
  applyFilters();
  renderFilters();
  renderList();
  store.set("filters", { ...state.filters, since: "" }); // "since last visit" is per session
  store.set("sort", state.sort);
  renderBanner();
  if ($("#tab-stats").classList.contains("active")) renderStats();
}
const refreshSoon = debounce(refresh, 180);

// ------------------------------------------------------------------ filter panel
function chipGroup(key, options, { neg = false } = {}) {
  const f = state.filters;
  const counts = state.facets[key] || {};
  return `<div class="chips">${options.map(([val, label]) => {
    const on = f[key].includes(val);
    const n = counts[val] || 0;
    if (!on && !n && !["status", "skills", "avoid"].includes(key)) return "";
    return `<span class="chip ${on ? "on" : ""} ${neg ? "neg" : ""}" data-chip="${key}" data-val="${esc(val)}">${esc(label)}<span class="n">${n}</span></span>`;
  }).join("")}</div>`;
}
function fgroup(title, body, val = "") {
  return `<div class="fgroup"><div class="ftitle">${title}${val ? `<span class="val">${val}</span>` : ""}</div>${body}</div>`;
}
function seg(key, opts) {
  return `<span class="seg">${opts.map(([v, l]) => `<button type="button" data-seg="${key}" data-val="${v}" class="${state.filters[key] === v ? "on" : ""}">${l}</button>`).join("")}</span>`;
}
function input(key, placeholder, type = "text") {
  return `<input type="${type}" data-input="${key}" value="${esc(state.filters[key])}" placeholder="${esc(placeholder)}">`;
}
function check(key, label) {
  return `<label class="check"><input type="checkbox" data-check="${key}" ${state.filters[key] ? "checked" : ""}> ${label}</label>`;
}
function selectBox(key, opts) {
  return `<select data-select="${key}">${opts.map(([v, l]) => `<option value="${v}" ${String(state.filters[key]) === String(v) ? "selected" : ""}>${l}</option>`).join("")}</select>`;
}

function renderFilters() {
  const f = state.filters, p = state.meta.profile;
  const focused = document.activeElement?.dataset?.input;
  const tplNames = Object.fromEntries(state.meta.templates.map((t) => [t.id, t.name]));
  tplNames["import-csv"] = "Importado do CSV";
  const tplOpts = Object.keys(state.facets.template || {}).concat(f.template).filter((v, i, a) => a.indexOf(v) === i).map((id) => [id, tplNames[id] || id]);
  const currencies = Object.keys(state.facets.currency || {}).concat(f.currency).filter((v, i, a) => a.indexOf(v) === i).map((c) => [c, c === "—" ? "Sem salário" : c]);
  const runOpts = [["", "Todas"]].concat(state.runs.map((r) => [r.id, `#${r.id} · ${r.label}`]));

  $("#filters-body").innerHTML = [
    fgroup("Status", chipGroup("status", Object.entries(STATUS)) + check("unseen", "Somente não vistas")),
    fgroup("Score mínimo", `<input type="range" min="0" max="100" step="5" data-input="minScore" value="${f.minScore}">`, `${f.minScore}+`),
    fgroup("Região", chipGroup("region", Object.entries(REGION))),
    fgroup("Modalidade", chipGroup("mode", Object.entries(MODE))),
    fgroup("Senioridade (pelo título)", chipGroup("seniority", Object.entries(SEN))),
    fgroup(`Stacks do seu CV ${seg("skillsMode", [["any", "alguma"], ["all", "todas"]])}`, chipGroup("skills", p.skills.map((s) => [s.name, s.name]))),
    fgroup(`Excluir stacks fora do CV ${seg("avoidScope", [["title", "título"], ["any", "tudo"]])}`, chipGroup("avoid", p.avoid.map((s) => [s.name, s.name]), { neg: true })),
    fgroup("Publicada", selectBox("days", [["", "Qualquer data"], ["1", "Últimas 24h"], ["3", "3 dias"], ["7", "7 dias"], ["14", "14 dias"], ["30", "30 dias"]])),
    fgroup("Contrato", chipGroup("contract", [["CLT", "CLT"], ["PJ", "PJ"], ["Contractor", "Contractor"], ["—", "Não informado"]])),
    fgroup("Idioma da descrição", chipGroup("language", Object.entries(LANG)) + check("hideFluent", "Ocultar vagas que exigem inglês fluente")),
    fgroup("Experiência exigida", selectBox("maxYears", [["", "Qualquer"], ["2", "até 2 anos"], ["3", "até 3 anos"], ["4", "até 4 anos"], ["5", "até 5 anos"]]) + `<div class="hint" style="margin-top:4px">Vagas sem "X anos" na descrição sempre passam.</div>`),
    fgroup("Salário (mensal)", check("salaryOnly", "Somente com salário") + `<div style="margin-top:6px">${input("salaryMin", "Mínimo por mês (ex.: 7000)", "number")}</div><div style="margin-top:6px">${chipGroup("currency", currencies)}</div><div class="hint">* estimado a partir de "R$" na descrição</div>`),
    fgroup("Sites", chipGroup("site", Object.entries(SITE_LABEL))),
    fgroup("Precisa conter (todos)", input("includeAll", "ex.: typescript, postgres")),
    fgroup("Excluir se o título/empresa contém", input("excludeTitle", "ex.: sênior, lead, estágio, php")),
    fgroup("Excluir se o texto contém", input("excludeText", "ex.: us citizen, green card, security clearance")),
    fgroup("Excluir empresas", input("excludeCompanies", "ex.: empresa x, consultoria y")),
    fgroup("Origem", (tplOpts.length ? chipGroup("template", tplOpts) : '<span class="muted small">—</span>') + `<div style="margin-top:6px">${selectBox("run", runOpts)}</div>`),
    fgroup("Outros", check("hideDup", "Ocultar duplicadas entre sites") + check("directOnly", "Somente com link direto de candidatura") + check("withDesc", "Somente com descrição")),
  ].join("");

  $("#f-q").value = f.q;
  $("#f-q-title").checked = f.qTitle;
  if (focused) {
    const el = $(`[data-input="${focused}"]`);
    if (el) { el.focus(); if (el.type !== "range" && el.type !== "number") el.setSelectionRange(el.value.length, el.value.length); }
  }
  const sub = [];
  if (state.dupHidden) sub.push(`${state.dupHidden} duplicadas ocultas`);
  if (f.newInRun) sub.push(`novas da busca #${f.newInRun}`);
  $("#result-sub").textContent = sub.length ? `· ${sub.join(" · ")}` : "";
  $("#result-count").textContent = state.filtered.length;
  renderSavedViews();
}

function setupJobsTab() {
  const body = $("#filters-body");
  body.addEventListener("click", (e) => {
    const chip = e.target.closest("[data-chip]");
    if (chip) {
      const { chip: key, val } = chip.dataset;
      const arr = state.filters[key];
      state.filters[key] = arr.includes(val) ? arr.filter((v) => v !== val) : [...arr, val];
      refresh();
      return;
    }
    const sb = e.target.closest("[data-seg]");
    if (sb) { state.filters[sb.dataset.seg] = sb.dataset.val; refresh(); }
  });
  body.addEventListener("input", (e) => {
    const k = e.target.dataset.input;
    if (!k) return;
    state.filters[k] = e.target.value;
    if (e.target.type === "range") e.target.closest(".fgroup").querySelector(".val").textContent = `${e.target.value}+`;
    else refreshSoon();
  });
  body.addEventListener("change", (e) => {
    const t = e.target;
    if (t.dataset.check) { state.filters[t.dataset.check] = t.checked; refresh(); }
    if (t.dataset.select) { state.filters[t.dataset.select] = t.value; refresh(); }
    if (t.type === "range") refresh();
  });
  $("#f-q").addEventListener("input", (e) => { state.filters.q = e.target.value; refreshSoon(); });
  $("#f-q-title").addEventListener("change", (e) => { state.filters.qTitle = e.target.checked; refresh(); });
  $("#sort").value = state.sort;
  $("#sort").addEventListener("change", (e) => { state.sort = e.target.value; refresh(); });
  $("#reset-filters").addEventListener("click", () => { state.filters = structuredClone(DEFAULT_FILTERS); refresh(); });
  $("#jobs-banner").addEventListener("click", (e) => {
    const b = e.target.closest("[data-banner]");
    if (!b) return;
    if (b.dataset.banner === "show") state.filters = { ...structuredClone(DEFAULT_FILTERS), since: state.prevVisit, status: ["new"] };
    if (b.dataset.banner === "clear") state.filters.since = "";
    if (b.dataset.banner === "dismiss") store.set("bannerDismissed", state.prevVisit);
    refresh();
  });

  $("#saved-views").addEventListener("change", (e) => {
    const views = store.get("views", {});
    if (views[e.target.value]) { state.filters = { ...DEFAULT_FILTERS, ...views[e.target.value] }; refresh(); toast(`Filtro "${e.target.value}" aplicado`); }
  });
  $("#save-view").addEventListener("click", () => {
    const name = prompt("Nome para este conjunto de filtros:");
    if (!name) return;
    const views = store.get("views", {});
    views[name] = state.filters;
    store.set("views", views);
    renderSavedViews();
    toast("Filtro salvo");
  });

  $("#job-list").addEventListener("click", (e) => {
    const act = e.target.closest("[data-act]");
    const card = e.target.closest(".job");
    if (act && card) { e.stopPropagation(); setStatus([card.dataset.id], act.dataset.act); return; }
    if (e.target.closest("#show-more")) { state.limit += 150; renderList(); return; }
    if (card) select(card.dataset.id);
  });
  $("#export-csv").addEventListener("click", exportCsv);
  $("#bulk-discard").addEventListener("click", () => {
    const ids = state.filtered.filter((j) => j.status === "new").map((j) => j.id);
    if (!ids.length) return toast("Nenhuma vaga 'nova' no filtro atual");
    if (confirm(`Descartar ${ids.length} vagas novas que estão no filtro atual?`)) setStatus(ids, "discarded");
  });
  $("#import-csv").addEventListener("click", async () => {
    try {
      const r = await api("/api/import-csv", { method: "POST", body: { path: "jobs.csv", region: "br" } });
      toast(`${r.new} vagas importadas`);
      await loadJobs();
    } catch (err) { toast(err.message); }
  });
  document.addEventListener("keydown", onKey);
}

function renderSavedViews() {
  const views = store.get("views", {});
  $("#saved-views").innerHTML = `<option value="">Filtros salvos…</option>` + Object.keys(views).map((n) => `<option>${esc(n)}</option>`).join("");
}

// ------------------------------------------------------------------ list
function jobCard(j) {
  const skills = j.matched_skills.map((s) => `<span class="tag skill ${j.matched_title_skills.includes(s) ? "strong" : ""}">${esc(s)}</span>`).join("");
  const avoid = j.avoid_hits.map((s) => `<span class="tag bad">${esc(s)}</span>`).join("");
  const meta = [
    `<span class="tag site">${esc(SITE_LABEL[j.site] || j.site)}</span>`,
    j.seniority !== "indefinido" ? `<span class="tag">${SEN[j.seniority]}</span>` : "",
    j.work_mode !== "indefinido" ? `<span class="tag ${j.work_mode === "remoto" ? "good" : ""}">${MODE[j.work_mode]}</span>` : "",
    j.date_posted ? `<span class="tag">${agoLabel(j.date_posted)}</span>` : "",
    salaryLabel(j) ? `<span class="tag good">${esc(salaryLabel(j))}</span>` : "",
    ...j.contract.map((c) => `<span class="tag">${c}</span>`),
    j.english_fluent ? `<span class="tag warn">inglês fluente</span>` : "",
    j.years_required ? `<span class="tag ${j.years_required > state.meta.profile.max_years_ok ? "warn" : ""}">${j.years_required}+ anos</span>` : "",
  ].join("");
  const st = j.status !== "new" ? `<span class="st">${STATUS[j.status]}</span>` : "";
  const twins = twinsOf(j);
  const also = twins.length ? `<span class="tag" title="A mesma vaga apareceu em outros sites">também no ${[...new Set(twins.map((t) => SITE_LABEL[t.site] || t.site))].join(", ")}</span>` : "";
  return `<div class="job st-${j.status} ${isUnseen(j) ? "unseen" : ""} ${j.id === state.selectedId ? "selected" : ""}" data-id="${j.id}">
    <div class="score" style="--p:${j.score};--c:${scoreColor(j.score)}" title="Compatibilidade com seu CV"><span>${j.score}</span></div>
    <div>
      <div class="title">${esc(j.title)}${st}</div>
      <div class="sub">${esc(j.company || "—")} · ${esc(j.location || REGION[j.region])}</div>
      <div class="meta">${meta}${also}</div>
      <div class="skills">${skills}${avoid}</div>
    </div>
  </div>`;
}

function renderList() {
  const list = $("#job-list");
  const empty = !state.jobs.length;
  $("#jobs-empty").hidden = !empty;
  list.hidden = empty;
  if (empty) return;
  const shown = state.filtered.slice(0, state.limit);
  list.innerHTML = shown.map(jobCard).join("")
    + (state.filtered.length > shown.length ? `<div class="more"><button class="btn sm" id="show-more">Mostrar mais (${state.filtered.length - shown.length})</button></div>` : "")
    + (!state.filtered.length ? `<div class="empty muted">Nenhuma vaga com esses filtros.</div>` : "");
}

function select(id, scroll = false) {
  state.selectedId = id;
  markSeen(id);
  $$(".job").forEach((el) => el.classList.toggle("selected", el.dataset.id === id));
  if (scroll) $(`.job[data-id="${id}"]`)?.scrollIntoView({ block: "nearest" });
  renderDetail();
}

function markSeen(id) {
  const j = state.byId.get(id);
  if (!j || j.seen_at) return;
  const ids = [j, ...twinsOf(j)].filter((x) => !x.seen_at).map((x) => x.id);
  const now = new Date().toISOString();
  for (const x of ids) state.byId.get(x).seen_at = now;
  $(`.job[data-id="${id}"]`)?.classList.remove("unseen");
  updateCounts();
  api("/api/jobs", { method: "PATCH", body: { ids, seen: true } }).catch(() => {});
}

// ------------------------------------------------------------------ detail
function highlightDescription(container, j) {
  const p = state.meta.profile;
  const build = (list) => {
    const parts = list.flatMap((s) => s.patterns || [s.name]).filter((x) => { try { new RegExp(x); return true; } catch { return false; } });
    return parts.length ? new RegExp(`(${parts.join("|")})`, "gi") : null;
  };
  const good = build(p.skills.filter((s) => j.matched_skills.includes(s.name)));
  const bad = build(p.avoid.filter((s) => j.avoid_hits.includes(s.name)));
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) {
    let html = esc(node.nodeValue), changed = false;
    if (good) html = html.replace(good, (m) => { changed = true; return `<mark>${m}</mark>`; });
    if (bad) html = html.replace(bad, (m) => { changed = true; return `<mark class="bad">${m}</mark>`; });
    if (changed) { const span = document.createElement("span"); span.innerHTML = html; node.replaceWith(span); }
  }
}

function renderDescription(j) {
  const raw = j.description || "";
  if (!raw) return `<p class="muted">Sem descrição. No LinkedIn, ative "buscar descrição completa" na busca.</p>`;
  if (window.marked && window.DOMPurify) return DOMPurify.sanitize(marked.parse(raw.replace(/\\([-*_#.!()[\]])/g, "$1")));
  return `<div style="white-space:pre-wrap">${esc(raw)}</div>`;
}

const BREAKDOWN_LABEL = { base: "Base", stack: "Aderência de stack", fora_do_cv: "Stacks fora do CV", senioridade: "Senioridade", modalidade: "Modalidade", localizacao: "Localização preferida", ingles_fluente: "Inglês fluente exigido", anos_exigidos: "Anos exigidos", sem_descricao: "Sem descrição (bônus pelo título)" };

function renderDetail() {
  const el = $("#detail");
  const j = state.byId.get(state.selectedId);
  if (!j) { el.classList.remove("open"); el.innerHTML = `<div class="detail-empty muted"><div>Selecione uma vaga</div></div>`; return; }
  el.classList.add("open");
  const bd = Object.entries(j.score_breakdown).map(([k, v]) => `<span>${BREAKDOWN_LABEL[k] || k}</span><span class="${v >= 0 ? "pos" : "neg"}">${v > 0 ? "+" : ""}${v}</span>`).join("");
  const fact = (label, v) => (v || v === 0 ? `<div><b>${label}</b>${v}</div>` : "");
  const tplNames = Object.fromEntries(state.meta.templates.map((t) => [t.id, t.name]));
  el.innerHTML = `
    <div class="detail-head">
      <div class="row gap" style="justify-content:space-between;align-items:flex-start;flex-wrap:nowrap">
        <div>
          <h1>${esc(j.title)}</h1>
          <div class="sub">${j.company_url ? `<a href="${esc(j.company_url)}" target="_blank" rel="noopener">${esc(j.company || "—")}</a>` : esc(j.company || "—")} · ${esc(j.location || REGION[j.region])}</div>
        </div>
        <div class="row gap" style="flex-wrap:nowrap">
          <div class="score" style="--p:${j.score};--c:${scoreColor(j.score)}"><span>${j.score}</span></div>
          <button class="icon-btn close-detail" id="close-detail" title="Fechar">✕</button>
        </div>
      </div>
      <div class="detail-actions">
        <span class="status-seg">${statusButtons(j).map((k) => `<button data-status="${k}" class="${j.status === k ? "on" : ""}">${STATUS[k]}</button>`).join("")}</span>
        <a class="btn sm primary" href="${esc(j.job_url_direct || j.job_url)}" target="_blank" rel="noopener">Candidatar-se ↗</a>
        ${j.job_url_direct && j.job_url ? `<a class="btn sm" href="${esc(j.job_url)}" target="_blank" rel="noopener">Ver no ${esc(SITE_LABEL[j.site] || j.site)} ↗</a>` : ""}
        <button class="btn sm ghost" id="copy-job">Copiar resumo</button>
      </div>
      ${twinsOf(j).length ? `<div class="small muted" style="margin-top:8px">Também em: ${twinsOf(j).map((t) => `<a href="${esc(t.job_url_direct || t.job_url)}" target="_blank" rel="noopener">${esc(SITE_LABEL[t.site] || t.site)} ↗</a>`).join(" · ")} <span class="hint">— mudar o status aqui muda nas cópias também</span></div>` : ""}
    </div>
    <div class="detail-body">
      <div class="detail-section">
        <h3>Por que esse score</h3>
        <div class="breakdown">${bd}<span class="total">Total</span><span class="total" style="text-align:right">${j.score}</span></div>
      </div>
      <div class="detail-section">
        <h3>Stacks</h3>
        <div class="chips">${j.matched_skills.map((s) => `<span class="tag skill ${j.matched_title_skills.includes(s) ? "strong" : ""}">${esc(s)}</span>`).join("") || '<span class="muted small">nenhuma stack do CV encontrada</span>'}
        ${j.avoid_hits.map((s) => `<span class="tag bad">${esc(s)}</span>`).join("")}</div>
      </div>
      <div class="detail-section">
        <h3>Detalhes</h3>
        <div class="facts">
          ${fact("Publicada", j.date_posted ? `${j.date_posted} (${agoLabel(j.date_posted)})` : "")}
          ${fact("Encontrada em", j.first_seen?.replace("T", " "))}
          ${fact("Aplicou em", j.applied_at?.replace("T", " ").slice(0, 16))}
          ${fact("Senioridade", SEN[j.seniority])}
          ${fact("Modalidade", MODE[j.work_mode])}
          ${fact("Região", REGION[j.region])}
          ${fact("Idioma", LANG[j.language])}
          ${fact("Salário", esc(salaryLabel(j)))}
          ${fact("Contrato", j.contract.join(", "))}
          ${fact("Tipo", esc(j.job_type))}
          ${fact("Experiência", j.years_required ? `${j.years_required}+ anos` : "")}
          ${fact("Nível (LinkedIn)", esc(j.job_level))}
          ${fact("Função", esc(j.job_function))}
          ${fact("Setor", esc(j.company_industry))}
          ${fact("Funcionários", esc(j.company_num_employees))}
          ${fact("E-mails", esc(j.emails))}
          ${fact("Origem", j.template_ids.map((t) => esc(tplNames[t] || t)).join(", "))}
        </div>
      </div>
      <div class="detail-section">
        <h3>Anotações</h3>
        <textarea class="notes" id="notes" placeholder="Contato do recrutador, data da entrevista, salário combinado…">${esc(j.notes)}</textarea>
      </div>
      <div class="detail-section">
        <h3>Descrição</h3>
        <div class="description" id="description">${renderDescription(j)}</div>
      </div>
    </div>`;
  highlightDescription($("#description"), j);
  $$(".status-seg button", el).forEach((b) => b.addEventListener("click", () => setStatus([j.id], b.dataset.status)));
  $("#close-detail").addEventListener("click", () => { state.selectedId = null; renderDetail(); $$(".job.selected").forEach((x) => x.classList.remove("selected")); });
  $("#notes").addEventListener("change", async (e) => {
    j.notes = e.target.value;
    await api("/api/jobs", { method: "PATCH", body: { ids: [j.id], notes: j.notes } });
    toast("Anotação salva");
  });
  $("#copy-job").addEventListener("click", () => {
    const text = `${j.title} — ${j.company}\n${j.location || ""}\n${j.job_url_direct || j.job_url}\nScore: ${j.score} · Stacks: ${j.matched_skills.join(", ")}`;
    navigator.clipboard.writeText(text).then(() => toast("Copiado"));
  });
  el.scrollTop = 0;
}

// Pipeline stages only appear once the job is in the pipeline; archived only when it already is.
function statusButtons(j) {
  const base = ["new", "saved", "applied", "interview", "discarded"];
  if (["applied", "interview", "offer", "rejected"].includes(j.status)) base.splice(4, 0, "offer", "rejected");
  if (j.status === "archived") base.push("archived");
  return base;
}

async function setStatus(ids, status, { quiet = false } = {}) {
  // a single job clicked on its current status toggles back to "new"
  const single = ids.length === 1 && state.byId.get(ids[0]);
  if (single && single.status === status && status !== "new") status = "new";
  const requested = ids.length;
  // the same job on other sites follows along, otherwise its twin pops back into the list
  ids = [...new Set(ids.flatMap((id) => { const j = state.byId.get(id); return j ? [id, ...twinsOf(j).map((t) => t.id)] : [id]; }))];
  const cur = state.selectedId;
  const idx = state.filtered.findIndex((j) => j.id === cur);
  const now = new Date().toISOString();
  for (const id of ids) {
    const j = state.byId.get(id);
    if (!j) continue;
    j.status = status;
    j.status_changed = now;
    if (status === "applied" && !j.applied_at) j.applied_at = now;
  }
  updateCounts();
  refresh();
  if ($("#tab-pipeline").classList.contains("active")) renderPipeline();
  // keep the triage flow: if the selected job left the filter, move to the next one
  if (cur && !state.filtered.some((j) => j.id === cur) && state.filtered.length && $("#tab-jobs").classList.contains("active")) {
    select(state.filtered[Math.min(idx, state.filtered.length - 1)].id, true);
  } else if (cur) renderDetail();
  try {
    await api("/api/jobs", { method: "PATCH", body: { ids, status } });
    if (!quiet) toast(requested > 1 ? `${requested} vagas → ${STATUS[status]}` : STATUS[status]);
  } catch (err) { toast("Erro ao salvar: " + err.message); }
}

function onKey(e) {
  if (!$("#tab-jobs").classList.contains("active")) return;
  if (e.target.matches?.("input, textarea, select")) { if (e.key === "Escape") e.target.blur(); return; }
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const list = state.filtered;
  const idx = list.findIndex((j) => j.id === state.selectedId);
  const keys = {
    j: () => list.length && select(list[Math.min(idx + 1, list.length - 1)].id, true),
    k: () => list.length && select(list[Math.max(idx - 1, 0)].id, true),
    s: () => state.selectedId && setStatus([state.selectedId], "saved"),
    a: () => state.selectedId && setStatus([state.selectedId], "applied"),
    e: () => state.selectedId && setStatus([state.selectedId], "interview"),
    d: () => state.selectedId && setStatus([state.selectedId], "discarded"),
    n: () => state.selectedId && setStatus([state.selectedId], "new"),
    o: () => { const j = state.byId.get(state.selectedId); if (j) window.open(j.job_url_direct || j.job_url, "_blank"); },
    "/": () => $("#f-q").focus(),
  };
  if (keys[e.key]) { e.preventDefault(); keys[e.key](); }
}

function exportCsv() {
  const cols = ["score", "status", "title", "company", "location", "site", "seniority", "work_mode", "region", "date_posted", "salary_month_min", "salary_month_max", "salary_currency", "contract", "matched_skills", "avoid_hits", "english_fluent", "years_required", "job_url", "job_url_direct", "notes"];
  const cell = (v) => { v = Array.isArray(v) ? v.join(", ") : v ?? ""; v = String(v); return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; };
  const csv = [cols.join(",")].concat(state.filtered.map((j) => cols.map((c) => cell(j[c])).join(","))).join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv" }));
  a.download = `vagas-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
}

// ------------------------------------------------------------------ search tab
function setupSearchTab() {
  const m = state.meta;
  $("#form-country").innerHTML = m.countries.map((c) => `<option value="${c}">${c}</option>`).join("");
  $("#form-jobtype").innerHTML += m.job_types.slice(0, 5).map((t) => `<option value="${t}">${t}</option>`).join("");
  renderFormSites();
  renderTemplates();
  const form = $("#search-form");
  form.country_indeed.value = "brazil";
  form.location.value = "Brazil";
  form.is_remote.checked = true;
  form.hours_old.value = "168";
  form.addEventListener("input", validateSoon);
  form.addEventListener("change", validateSoon);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const params = readForm();
    if (!params.sites.length) return toast("Selecione ao menos um site");
    const { run_ids } = await api("/api/runs", { method: "POST", body: { params, template_id: state.loadedTemplateId } });
    toast(`Busca #${run_ids[0]} na fila`);
    startPolling();
    showTab("runs");
  });
  const saveTemplate = async (asNew) => {
    const name = form.tpl_name.value.trim();
    if (!name) { form.tpl_name.focus(); return toast("Dê um nome ao template"); }
    const { overrides, region, ...rest } = readForm();
    const loaded = !asNew && state.meta.templates.find((t) => t.id === state.loadedTemplateId);
    const body = { name, why: form.tpl_why.value.trim() || "Template salvo por você.", region, params: rest, overrides, tags: loaded?.tags || [] };
    if (loaded) Object.assign(body, { id: loaded.id, group: loaded.group, generated: loaded.generated });
    const saved = await api("/api/templates", { method: "POST", body });
    await reloadMeta();
    loadIntoForm(state.meta.templates.find((t) => t.id === saved.id), false);
    toast(loaded ? "Template atualizado" : "Template salvo");
  };
  $("#save-template").addEventListener("click", () => saveTemplate(true));
  $("#update-template").addEventListener("click", () => saveTemplate(false));
  $("#run-selected").addEventListener("click", () => runTemplates([...state.selectedTemplates]));
  $$("[data-run-group]").forEach((b) => b.addEventListener("click", () => {
    const ids = state.meta.templates.filter((t) => t.group === b.dataset.runGroup).map((t) => t.id);
    if (confirm(`Enfileirar ${ids.length} buscas (${b.dataset.runGroup})? Pode levar vários minutos.`)) runTemplates(ids);
  }));
  validateSoon();
}

function renderFormSites() {
  const health = siteHealth();
  const disabled = new Set(state.meta.settings.disabled_sites);
  $("#form-sites").innerHTML = state.meta.sites.map((s) => {
    const sick = health[s]?.sick, off = disabled.has(s);
    const note = off ? "desativado em Automação" : sick ? "vem zerado" : SITE_NOTE[s];
    return `<span class="chip ${state.formSites.has(s) ? "on" : ""} ${sick || off ? "sick" : ""}" data-site="${s}" title="${esc(note || "")}">${sick || off ? "⚠ " : ""}${SITE_LABEL[s] || s}${note ? ` <span class="n">${note}</span>` : ""}</span>`;
  }).join("");
  $$("#form-sites .chip").forEach((c) => c.addEventListener("click", () => {
    const s = c.dataset.site;
    state.formSites.has(s) ? state.formSites.delete(s) : state.formSites.add(s);
    renderFormSites();
    renderOverrides();
    validateSoon();
  }));
  renderOverrides();
}

function renderOverrides(values = null) {
  const current = values || readOverrides();
  $("#form-overrides").innerHTML = [...state.formSites].map((s) => `
    <div class="override" data-site="${s}">
      <span>${SITE_LABEL[s]}</span>
      <input data-k="${s === "google" ? "google_search_term" : "search_term"}" placeholder="${s === "google" ? "termo do Google" : "termo"}" value="${esc(current[s]?.search_term ?? current[s]?.google_search_term ?? "")}">
      <input data-k="location" placeholder="localização" value="${esc(current[s]?.location ?? "")}">
    </div>`).join("");
}
function readOverrides() {
  const out = {};
  $$("#form-overrides .override").forEach((row) => {
    const o = {};
    $$("input", row).forEach((i) => { if (i.value.trim()) o[i.dataset.k] = i.value.trim(); });
    if (Object.keys(o).length) out[row.dataset.site] = o;
  });
  return out;
}

function readForm() {
  const f = $("#search-form");
  const num = (v) => (v === "" ? null : +v);
  const params = {
    sites: [...state.formSites],
    search_term: f.search_term.value.trim() || null,
    google_search_term: f.google_search_term.value.trim() || null,
    location: f.location.value.trim() || null,
    country_indeed: f.country_indeed.value,
    region: f.region.value,
    job_type: f.job_type.value || null,
    hours_old: num(f.hours_old.value),
    results_wanted: num(f.results_wanted.value) || 15,
    distance: num(f.distance.value),
    offset: num(f.offset.value) || 0,
    is_remote: f.is_remote.checked,
    linkedin_fetch_description: f.linkedin_fetch_description.checked,
    easy_apply: f.easy_apply.checked || null,
    enforce_annual_salary: f.enforce_annual_salary.checked,
    proxies: f.proxies.value.split(/[\n,]/).map((s) => s.trim()).filter(Boolean),
    linkedin_company_ids: f.linkedin_company_ids.value.split(",").map((s) => parseInt(s, 10)).filter(Number.isFinite),
    description_format: f.description_format.value,
    overrides: readOverrides(),
  };
  return params;
}

async function reloadMeta() {
  state.meta = await api("/api/meta");
  renderTemplates();
}

function loadIntoForm(t, scroll = true) {
  const f = $("#search-form"), p = t.params;
  state.formSites = new Set(p.sites || []);
  f.search_term.value = p.search_term || "";
  f.google_search_term.value = p.google_search_term || "";
  f.location.value = p.location || "";
  f.country_indeed.value = p.country_indeed || "usa";
  f.region.value = t.region || "br";
  f.job_type.value = p.job_type || "";
  f.hours_old.value = p.hours_old ? String(p.hours_old) : "";
  f.results_wanted.value = p.results_wanted || 15;
  f.distance.value = p.distance ?? 50;
  f.offset.value = p.offset || 0;
  f.is_remote.checked = !!p.is_remote;
  f.linkedin_fetch_description.checked = !!p.linkedin_fetch_description;
  f.easy_apply.checked = !!p.easy_apply;
  f.enforce_annual_salary.checked = !!p.enforce_annual_salary;
  state.loadedTemplateId = t.id;
  const label = $("#form-template-label");
  label.textContent = `carregado: ${t.name}`;
  f.tpl_name.value = t.name;
  f.tpl_why.value = t.why || "";
  $("#update-template").hidden = false;
  // overrides with null values (e.g. Indeed dropping hours_old) aren't editable here; keep text ones
  const ov = {};
  for (const [s, o] of Object.entries(t.overrides || {})) {
    ov[s] = {};
    for (const k of ["search_term", "google_search_term", "location"]) if (o[k]) ov[s][k] = o[k];
  }
  renderFormSites();
  renderOverrides(ov);
  validateSoon();
  if (scroll) $(".search-form").scrollIntoView({ behavior: "smooth", block: "start" });
}

const validateSoon = debounce(async () => {
  try {
    const { warnings } = await api("/api/validate", { method: "POST", body: readForm() });
    $("#form-warnings").innerHTML = warnings.map((w) => `<div class="warning">⚠ ${esc(w)}</div>`).join("");
  } catch { /* server not ready */ }
}, 300);

function renderTemplates() {
  const scheduled = new Set(state.meta.settings.schedules.map((x) => x.template_id));
  const groups = {};
  for (const t of state.meta.templates) (groups[t.group] ||= []).push(t);
  const describe = (t) => {
    const p = t.params;
    const bits = [
      `<code>${esc(p.search_term || p.google_search_term || "")}</code>`,
      p.location ? `📍 ${esc(p.location)}` : "",
      p.is_remote ? "remoto" : "",
      p.hours_old ? `últimos ${Math.round(p.hours_old / 24)}d` : "",
      `${p.results_wanted}/site`,
    ].filter(Boolean);
    return `${(p.sites || []).map((s) => SITE_LABEL[s]).join(" · ")}<br>${bits.join(" · ")}`;
  };
  $("#template-groups").innerHTML = Object.entries(groups).map(([g, list]) => `
    <div class="tpl-group">
      <h3>${{ Brasil: "🇧🇷", Internacional: "🌎", "Do seu CV": "📄" }[g] || "⭐"} ${esc(g)} <span class="muted small">${list.length}</span></h3>
      <div class="tpl-grid">${list.map((t) => `
        <div class="card tpl ${state.selectedTemplates.has(t.id) ? "sel" : ""}" data-id="${t.id}">
          <div class="tpl-top"><input type="checkbox" data-tsel ${state.selectedTemplates.has(t.id) ? "checked" : ""}><div class="tpl-name">${esc(t.name)}${t.edits_builtin ? ' <span class="tag warn">editado</span>' : ""}${scheduled.has(t.id) ? ' <span class="tag good" title="Tem agendamento">⏰</span>' : ""}</div></div>
          <div class="tpl-why">${esc(t.why || "")}</div>
          <div class="tpl-params">${describe(t)}</div>
          <div class="tpl-actions">
            <button class="btn sm primary" data-trun>Executar</button>
            <button class="btn sm" data-tload>Editar</button>
            <button class="btn sm ghost" data-tsched title="Rodar sozinho todo dia">Agendar</button>
            ${t.builtin ? "" : t.edits_builtin ? `<button class="btn sm ghost" data-tdel>Restaurar original</button>` : `<button class="btn sm ghost danger" data-tdel>Excluir</button>`}
          </div>
        </div>`).join("")}</div>
    </div>`).join("");
  $$("#template-groups .tpl").forEach((card) => {
    const t = state.meta.templates.find((x) => x.id === card.dataset.id);
    $("[data-tsel]", card).addEventListener("change", (e) => {
      e.target.checked ? state.selectedTemplates.add(t.id) : state.selectedTemplates.delete(t.id);
      card.classList.toggle("sel", e.target.checked);
      $("#run-selected").disabled = !state.selectedTemplates.size;
      $("#run-selected").textContent = `Executar selecionados${state.selectedTemplates.size ? ` (${state.selectedTemplates.size})` : ""}`;
    });
    $("[data-trun]", card).addEventListener("click", () => runTemplates([t.id]));
    $("[data-tload]", card).addEventListener("click", () => loadIntoForm(t));
    $("[data-tdel]", card)?.addEventListener("click", async () => {
      if (!confirm(t.edits_builtin ? `Desfazer suas alterações em "${t.name}"?` : `Excluir o template "${t.name}"?`)) return;
      await api(`/api/templates/${encodeURIComponent(t.id)}`, { method: "DELETE" });
      await reloadMeta();
    });
    $("[data-tsched]", card).addEventListener("click", () => { addSchedule(t.id); showTab("auto"); });
  });
}

async function runTemplates(ids) {
  if (!ids.length) return;
  const proxies = $("#search-form").proxies.value.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
  const { run_ids } = await api("/api/runs", { method: "POST", body: { template_ids: ids, proxies } });
  toast(`${run_ids.length} busca(s) na fila`);
  state.selectedTemplates.clear();
  renderTemplates();
  $("#run-selected").disabled = true;
  startPolling();
  showTab("runs");
}

// ------------------------------------------------------------------ runs
function startPolling() {
  clearTimeout(state.pollTimer);
  state.pollTimer = setTimeout(pollRuns, 600);
}
async function pollRuns() {
  try { state.runs = await api("/api/runs"); } catch { return; }
  const active = state.runs.filter((r) => r.status === "queued" || r.status === "running");
  const sig = state.runs.map((r) => `${r.id}:${r.status}:${r.total}`).join("|");
  if (state.lastRunsSig && sig !== state.lastRunsSig) await loadJobs(); // stream results in as sites finish
  if (sig !== state.lastRunsSig) renderFormSites(); // site health warnings
  state.lastRunsSig = sig;
  $("#run-dot").hidden = !active.length;
  const ind = $("#run-indicator");
  ind.hidden = !active.length;
  if (active.length) {
    const running = active.find((r) => r.status === "running");
    ind.textContent = `⟳ ${running ? running.label : "na fila"}${active.length > 1 ? ` (+${active.length - 1})` : ""}`;
  }
  notifyFinished();
  if ($("#tab-runs").classList.contains("active")) renderRuns();
  if ($("#tab-auto").classList.contains("active")) renderSiteHealth();
  clearTimeout(state.pollTimer);
  // slow poll when idle so scheduled runs started by the server still show up
  state.pollTimer = setTimeout(pollRuns, active.length ? 2000 : 30000);
}

const FINISHED = ["done", "partial", "error"];
function notifyFinished() {
  const prev = state.runStatus;
  state.runStatus = new Map(state.runs.map((r) => [r.id, r.status]));
  if (!prev) return; // first poll after loading: nothing "just" finished
  const done = state.runs.filter((r) => FINISHED.includes(r.status) && prev.has(r.id) && !FINISHED.includes(prev.get(r.id))
    || FINISHED.includes(r.status) && !prev.has(r.id));
  if (!done.length) return;
  const news = done.reduce((a, r) => a + r.new_count, 0);
  const msg = done.length === 1
    ? `Busca #${done[0].id} terminou: ${done[0].total} vagas, ${done[0].new_count} novas`
    : `${done.length} buscas terminaram: ${news} vagas novas`;
  toast(msg, news ? { label: "Ver novas", onClick: () => viewRunNew(done.length === 1 ? done[0].id : null) } : null);
  if (document.hidden && "Notification" in window && Notification.permission === "granted") {
    const n = new Notification("JobSpy", { body: msg });
    n.onclick = () => { window.focus(); viewRunNew(done.length === 1 ? done[0].id : null); };
  }
}

// jobs a run found for the first time; without a run id, everything not seen yet
function viewRunNew(runId) {
  state.filters = runId
    ? { ...structuredClone(DEFAULT_FILTERS), newInRun: String(runId), status: Object.keys(STATUS) }
    : { ...structuredClone(DEFAULT_FILTERS), unseen: true };
  state.selectedId = null;
  refresh();
  renderDetail();
  showTab("jobs");
}

const RUN_STATUS = { queued: "na fila", running: "rodando", done: "concluída", partial: "parcial", error: "erro", interrupted: "interrompida", cancelled: "cancelada" };
function renderRuns() {
  const openLogs = new Set($$(".run details[open]").map((d) => d.dataset.id));
  $("#run-list").innerHTML = state.runs.length ? state.runs.map((r) => {
    const sites = Object.entries(r.sites || {}).map(([s, v]) => {
      const cls = v.status === "error" ? "bad" : v.status === "skipped" ? "" : v.status === "done" ? (v.count ? "good" : "warn") : "warn";
      const txt = v.status === "running" ? "…" : v.status === "error" ? "erro" : v.status === "skipped" ? "desativado" : `${v.count}${v.new != null ? ` (${v.new} novas)` : ""}`;
      return `<span class="tag ${cls}" title="${esc(v.error || "")}">${SITE_LABEL[s] || s}: ${txt}${v.secs ? ` · ${v.secs}s` : ""}</span>`;
    }).join("");
    const p = r.params;
    return `<div class="card run">
      <div class="run-head">
        <div><span class="run-title">#${r.id} · ${esc(r.label)}</span> <span class="muted small">${r.created_at.replace("T", " ")}</span></div>
        <div class="row gap">
          <span class="status-pill s-${r.status}">${RUN_STATUS[r.status] || r.status}</span>
          ${r.new_count ? `<button class="btn sm primary" data-view-new="${r.id}">Ver ${r.new_count} novas</button>` : ""}
          ${r.total ? `<button class="btn sm" data-view-run="${r.id}">Ver todas (${r.total})</button>` : ""}
          ${r.status === "queued" ? `<button class="btn sm ghost" data-cancel-run="${r.id}">Cancelar</button>` : ""}
          ${r.status !== "queued" && r.status !== "running" ? `<button class="btn sm ghost danger" data-del-run="${r.id}">Excluir</button>` : ""}
        </div>
      </div>
      ${state.confirmDelete === String(r.id) ? deleteConfirm(r.id) : ""}
      <div class="muted small" style="margin-top:4px">${esc(p.search_term || p.google_search_term || "")}${p.location ? ` · ${esc(p.location)}` : ""}${p.is_remote ? " · remoto" : ""}${p.hours_old ? ` · ${p.hours_old}h` : ""} · ${p.results_wanted}/site</div>
      <div class="run-sites">${sites}</div>
      ${r.log ? `<details data-id="${r.id}" ${openLogs.has(String(r.id)) || r.status === "running" ? "open" : ""}><summary class="small muted" style="cursor:pointer;margin-top:6px">Log</summary><div class="run-log">${esc(r.log)}</div></details>` : ""}
    </div>`;
  }).join("") : `<div class="empty muted">Nenhuma busca executada ainda. <a href="#" data-goto="search">Ir para Buscar</a></div>`;
  $$("[data-view-run]").forEach((b) => b.addEventListener("click", () => {
    state.filters = { ...structuredClone(DEFAULT_FILTERS), run: b.dataset.viewRun, status: Object.keys(STATUS) };
    refresh();
    showTab("jobs");
  }));
  $$("[data-view-new]").forEach((b) => b.addEventListener("click", () => viewRunNew(b.dataset.viewNew)));
  $$("[data-cancel-run]").forEach((b) => b.addEventListener("click", async () => {
    await api(`/api/runs/${b.dataset.cancelRun}/cancel`, { method: "POST" });
    pollRuns();
  }));
  const allConfirm = $("#run-all-confirm");
  if (state.confirmDelete === "all" && !allConfirm) $("#run-list").insertAdjacentHTML("afterbegin", `<div id="run-all-confirm">${deleteConfirm("all")}</div>`);
  if (state.confirmDelete !== "all" && allConfirm) allConfirm.remove();
}

// Inline confirmation: delete only the history entry, or also the jobs only that run found.
function deleteConfirm(target) {
  const what = target === "all" ? "todo o histórico de buscas" : `a busca #${target}`;
  return `<div class="card delete-confirm">
    <div>Excluir ${what}?</div>
    <div class="muted small">"Com as vagas" remove só vagas ainda <b>novas</b> que nenhuma outra busca encontrou. Salvas, aplicadas, em entrevista e descartadas são mantidas.</div>
    <div class="row gap" style="margin-top:8px">
      <button class="btn sm" data-del-confirm="${target}" data-jobs="0">Só do histórico</button>
      <button class="btn sm danger" data-del-confirm="${target}" data-jobs="1">Excluir com as vagas</button>
      <button class="btn sm ghost" data-del-cancel>Cancelar</button>
    </div>
  </div>`;
}

document.addEventListener("click", async (e) => {
  const ask = e.target.closest("[data-del-run]");
  if (ask) { state.confirmDelete = ask.dataset.delRun; renderRuns(); return; }
  if (e.target.closest("[data-del-cancel]")) { state.confirmDelete = null; renderRuns(); return; }
  const ok = e.target.closest("[data-del-confirm]");
  if (!ok) return;
  const target = ok.dataset.delConfirm;
  const body = { delete_jobs: ok.dataset.jobs === "1", ...(target === "all" ? { all: true } : { ids: [+target] }) };
  try {
    const r = await api("/api/runs/delete", { method: "POST", body });
    state.confirmDelete = null;
    if (target === "all" || state.filters.run === target) state.filters.run = "";
    toast(`${r.runs_deleted} busca(s) excluída(s)${body.delete_jobs ? ` · ${r.jobs_deleted} vaga(s) removida(s)` : ""}`);
    state.lastRunsSig = "";
    await pollRuns();
    await loadJobs();
  } catch (err) { toast(err.message); }
});

// ------------------------------------------------------------------ stats
function countBy(list, fn) {
  const m = {};
  for (const j of list) for (const v of [].concat(fn(j))) if (v != null && v !== "") m[v] = (m[v] || 0) + 1;
  return Object.entries(m).sort((a, b) => b[1] - a[1]);
}
function bars(title, entries, { labels = {}, filterKey = null, bad = false, limit = 12 } = {}) {
  const max = Math.max(1, ...entries.map((e) => e[1]));
  return `<div class="card stat"><h3>${title}</h3>${entries.slice(0, limit).map(([k, n]) => `
    <div class="bar-row" ${filterKey ? `data-fkey="${filterKey}" data-fval="${esc(k)}"` : ""} title="${esc(labels[k] || k)}">
      <span class="bar-label">${esc(labels[k] || k)}</span>
      <span class="bar-track"><span class="bar-fill ${bad ? "bad" : ""}" style="width:${(n / max) * 100}%;display:block"></span></span>
      <span class="bar-n">${n}</span>
    </div>`).join("") || '<span class="muted small">sem dados</span>'}</div>`;
}
function renderStats() {
  const useFiltered = $("#stats-filtered").checked;
  const list = useFiltered ? state.filtered : state.jobs;
  const by = (s) => state.jobs.filter((j) => j.status === s).length;
  const avg = list.length ? Math.round(list.reduce((a, j) => a + j.score, 0) / list.length) : 0;
  const strong = list.filter((j) => j.score >= 70).length;
  $("#kpis").innerHTML = [
    [list.length, useFiltered ? "vagas no filtro" : "vagas no total"], [strong, "score ≥ 70"], [avg, "score médio"],
    [by("saved"), "salvas"], [by("applied"), "aplicadas"], [by("interview"), "em entrevista"],
    [list.filter((j) => j.salary_month_min).length, "com salário"],
  ].map(([v, l]) => `<div class="card kpi"><div class="v">${v}</div><div class="l">${l}</div></div>`).join("");

  const buckets = countBy(list, (j) => `${Math.min(90, Math.floor(j.score / 10) * 10)}–${Math.min(100, Math.floor(j.score / 10) * 10 + 9)}`).sort((a, b) => parseInt(b[0]) - parseInt(a[0]));
  const perDay = countBy(list.filter((j) => j._days !== null && j._days <= 30), (j) => j.date_posted.slice(0, 10)).sort((a, b) => b[0].localeCompare(a[0]));
  const brlSalaries = list.filter((j) => j.salary_currency === "BRL" && j.salary_month_min).map((j) => j.salary_month_max || j.salary_month_min).sort((a, b) => a - b);
  const median = brlSalaries.length ? brlSalaries[Math.floor(brlSalaries.length / 2)] : null;

  $("#stats-grid").innerHTML = [
    bars("Suas stacks mais pedidas", countBy(list, (j) => j.matched_skills), { filterKey: "skills", limit: 22 }),
    bars("Stacks fora do CV que aparecem", countBy(list, (j) => j.avoid_hits), { filterKey: "avoid", bad: true }),
    bars("Distribuição de score", buckets),
    bars("Senioridade", countBy(list, (j) => j.seniority), { labels: SEN, filterKey: "seniority" }),
    bars("Modalidade", countBy(list, (j) => j.work_mode), { labels: MODE, filterKey: "mode" }),
    bars("Região", countBy(list, (j) => j.region), { labels: REGION, filterKey: "region" }),
    bars("Sites", countBy(list, (j) => j.site), { labels: SITE_LABEL, filterKey: "site" }),
    bars("Contrato", countBy(list, (j) => (j.contract.length ? j.contract : ["—"])), { labels: { "—": "Não informado" }, filterKey: "contract" }),
    bars("Empresas com mais vagas", countBy(list, (j) => j.company), { limit: 15 }),
    bars("Publicadas por dia (30 dias)", perDay, { limit: 30 }),
    `<div class="card stat"><h3>Salários em BRL (mensal)</h3>${brlSalaries.length ? `
      <div class="facts"><div><b>Vagas com salário</b>${brlSalaries.length}</div><div><b>Mediana (teto)</b>${money(median)}</div>
      <div><b>Menor</b>${money(brlSalaries[0])}</div><div><b>Maior</b>${money(brlSalaries[brlSalaries.length - 1])}</div></div>` : '<span class="muted small">sem dados</span>'}</div>`,
  ].join("");
  $$("#stats-grid [data-fkey]").forEach((row) => row.addEventListener("click", () => {
    const k = row.dataset.fkey, v = row.dataset.fval;
    if (k === "avoid") state.filters.avoidScope = "any";
    if (!state.filters[k].includes(v)) state.filters[k] = [...state.filters[k], v];
    refresh();
    showTab("jobs");
  }));
}
$("#stats-filtered").addEventListener("change", renderStats);

// ------------------------------------------------------------------ profile
function setupProfileTab() {
  renderProfile(state.meta.profile);
  setupCvImport();
  $("#profile-save").addEventListener("click", saveProfile);
  $("#profile-reset").addEventListener("click", async () => {
    if (!confirm("Restaurar o perfil padrão extraído do CV?")) return;
    const { profile, reanalyzed } = await api("/api/profile/reset", { method: "POST" });
    state.meta.profile = profile;
    renderProfile(profile);
    await loadJobs();
    toast(`Perfil restaurado · ${reanalyzed} vagas recalculadas`);
  });
}

function skillTable(kind, list) {
  return `<table class="ptable" data-kind="${kind}">
    <thead><tr><th>Nome</th><th>Peso</th><th>Padrões (regex, separados por ;)</th><th></th></tr></thead>
    <tbody>${list.map((s) => skillRow(s)).join("")}</tbody></table>
    <button class="btn sm" data-add="${kind}">+ Adicionar</button>`;
}
function skillRow(s = { name: "", weight: 5, patterns: [] }) {
  return `<tr><td><input data-f="name" value="${esc(s.name)}"></td><td><input data-f="weight" type="number" value="${s.weight}"></td>
    <td><input data-f="patterns" value="${esc((s.patterns || []).join(" ; "))}"></td><td><button class="icon-btn" data-del title="Remover">✕</button></td></tr>`;
}

function renderProfile(p) {
  const kv = (obj, group, labels) => `<div class="kv">${Object.entries(obj).map(([k, v]) => `<label>${labels[k] || k}<input type="number" data-group="${group}" data-key="${k}" value="${v}"></label>`).join("")}</div>`;
  $("#profile-form").innerHTML = `
    <div class="card" style="padding:14px;margin-bottom:16px">
      <label>Resumo exibido no topo<input id="p-headline" value="${esc(p.headline || "")}"></label>
    </div>
    <div class="profile-grid">
      <div class="card"><h3>Suas stacks (somam pontos)</h3><p class="muted small">Peso ×1,5 quando a stack aparece no título.</p>${skillTable("skills", p.skills)}</div>
      <div class="card"><h3>Stacks fora do CV (tiram pontos)</h3><p class="muted small">No título: −peso×4. Só na descrição: −peso×0,4 (geralmente "diferencial").</p>${skillTable("avoid", p.avoid)}</div>
      <div class="card"><h3>Pontos por senioridade</h3>${kv(p.seniority_points, "seniority_points", SEN)}</div>
      <div class="card"><h3>Pontos por modalidade</h3>${kv(p.work_mode_points, "work_mode_points", MODE)}</div>
      <div class="card"><h3>Localização e requisitos</h3>
        <label>Locais preferidos (híbrido/presencial ok) <span class="hint">separados por vírgula</span><input id="p-locs" value="${esc(p.preferred_locations.join(", "))}"></label>
        <div class="kv" style="margin-top:8px">
          <label>Bônus local preferido<input type="number" id="p-locpts" value="${p.preferred_location_points}"></label>
          <label>Penalidade inglês fluente<input type="number" id="p-eng" value="${p.english_fluent_penalty}"></label>
          <label>Anos aceitáveis (máx.)<input type="number" id="p-years" value="${p.max_years_ok}"></label>
          <label>Penalidade por ano extra<input type="number" id="p-yearpen" value="${p.years_penalty_per_year}"></label>
          <label>Saturação de stack<input type="number" id="p-sat" value="${p.skill_saturation}"></label>
        </div>
        <p class="muted small">Saturação: soma de pesos que vale aderência de stack máxima (55 pts).</p>
      </div>
    </div>`;
  $$("[data-add]").forEach((b) => b.addEventListener("click", () => {
    $(`table[data-kind="${b.dataset.add}"] tbody`).insertAdjacentHTML("beforeend", skillRow());
  }));
  $("#profile-form").addEventListener("click", (e) => { if (e.target.closest("[data-del]")) e.target.closest("tr").remove(); });
}

function readSkillTable(kind) {
  return $$(`table[data-kind="${kind}"] tbody tr`).map((tr) => ({
    name: $('[data-f="name"]', tr).value.trim(),
    weight: +$('[data-f="weight"]', tr).value || 0,
    patterns: $('[data-f="patterns"]', tr).value.split(";").map((s) => s.trim()).filter(Boolean),
  })).filter((s) => s.name);
}

async function saveProfile() {
  const p = structuredClone(state.meta.profile);
  p.headline = $("#p-headline").value;
  p.skills = readSkillTable("skills");
  p.avoid = readSkillTable("avoid");
  $$("[data-group]").forEach((i) => { p[i.dataset.group][i.dataset.key] = +i.value; });
  p.preferred_locations = $("#p-locs").value.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  p.preferred_location_points = +$("#p-locpts").value;
  p.english_fluent_penalty = +$("#p-eng").value;
  p.max_years_ok = +$("#p-years").value;
  p.years_penalty_per_year = +$("#p-yearpen").value;
  p.skill_saturation = +$("#p-sat").value || 35;
  for (const s of [...p.skills, ...p.avoid]) for (const pat of s.patterns) {
    try { new RegExp(pat); } catch { return toast(`Regex inválida em "${s.name}": ${pat}`); }
  }
  const { reanalyzed } = await api("/api/profile", { method: "PUT", body: p });
  state.meta.profile = p;
  $("#profile-name").textContent = p.headline;
  await loadJobs();
  toast(`Perfil salvo · ${reanalyzed} vagas recalculadas`);
}

// ------------------------------------------------------------------ candidaturas (kanban)
function setupPipelineTab() {
  const board = $("#pipeline");
  board.addEventListener("dragstart", (e) => {
    const card = e.target.closest(".pcard");
    if (!card) return;
    e.dataTransfer.setData("text/plain", card.dataset.id);
    e.dataTransfer.effectAllowed = "move";
    card.classList.add("dragging");
  });
  board.addEventListener("dragend", () => $$(".pcard.dragging, .pcol.over").forEach((x) => x.classList.remove("dragging", "over")));
  board.addEventListener("dragover", (e) => {
    const col = e.target.closest(".pcol");
    if (!col) return;
    e.preventDefault();
    $$(".pcol.over").forEach((x) => x !== col && x.classList.remove("over"));
    col.classList.add("over");
  });
  board.addEventListener("drop", (e) => {
    const col = e.target.closest(".pcol");
    const id = e.dataTransfer.getData("text/plain");
    if (!col || !id) return;
    e.preventDefault();
    const j = state.byId.get(id);
    if (j && j.status !== col.dataset.status) setStatus([id], col.dataset.status);
  });
  board.addEventListener("change", (e) => {
    const sel = e.target.closest("[data-move]");
    if (sel) setStatus([sel.dataset.move], sel.value);
  });
  board.addEventListener("click", async (e) => {
    const open = e.target.closest("[data-open]");
    if (open) { state.filters.status = [...new Set([...state.filters.status, state.byId.get(open.dataset.open).status])]; refresh(); showTab("jobs"); select(open.dataset.open, true); return; }
    const fu = e.target.closest("[data-followup]");
    if (fu) {
      const j = state.byId.get(fu.dataset.followup);
      j.followup_at = new Date().toISOString();
      updateCounts();
      renderPipeline();
      await api("/api/jobs", { method: "PATCH", body: { ids: [j.id], followup: true } });
      toast("Follow-up registrado — o lembrete volta a contar a partir de hoje");
    }
  });
}

function renderPipeline() {
  $("#followup-days").textContent = state.meta.settings.followup_days;
  const cols = PIPELINE.map((st) => {
    const seen = new Set();
    const jobs = state.jobs.filter((j) => j.status === st)
      .filter((j) => { const k = j.company ? j.dup_key : j.id; if (seen.has(k)) return false; seen.add(k); return true; }) // one card per job across sites
      .sort((a, b) => (followupDue(b) ?? -1) - (followupDue(a) ?? -1) || String(b.status_changed).localeCompare(String(a.status_changed)));
    return `<div class="pcol" data-status="${st}">
      <div class="pcol-head"><span>${STATUS[st]}</span><span class="muted">${jobs.length}</span></div>
      <div class="pcol-body">${jobs.map(pipelineCard).join("") || `<div class="muted small pcol-empty">${st === "saved" ? "Salve vagas na aba Vagas (tecla s)" : "Arraste cartões para cá"}</div>`}</div>
    </div>`;
  });
  $("#pipeline").innerHTML = cols.join("");
}

function pipelineCard(j) {
  const due = followupDue(j);
  const stageDays = daysSince(j.status_changed);
  const applied = j.applied_at ? `aplicou ${agoLabel(j.applied_at)}` : "";
  const stage = stageDays !== null ? `nesta etapa ${stageDays <= 0 ? "desde hoje" : `há ${stageDays} dia${stageDays > 1 ? "s" : ""}`}` : "";
  return `<div class="pcard card ${due !== null ? "due" : ""}" draggable="true" data-id="${j.id}">
    <div class="row gap" style="flex-wrap:nowrap;align-items:flex-start;justify-content:space-between">
      <div style="min-width:0"><div class="title">${esc(j.title)}</div><div class="muted small">${esc(j.company || "—")} · ${esc([j, ...twinsOf(j)].map((x) => SITE_LABEL[x.site] || x.site).filter((v, i, a) => a.indexOf(v) === i).join(", "))}</div></div>
      <div class="score sm" style="--p:${j.score};--c:${scoreColor(j.score)}"><span>${j.score}</span></div>
    </div>
    <div class="muted small" style="margin-top:4px">${[applied, stage].filter(Boolean).join(" · ")}</div>
    ${due !== null ? `<div class="followup">⏰ Sem resposta há ${due} dias <button class="btn sm" data-followup="${j.id}">Fiz follow-up</button></div>` : ""}
    ${j.notes ? `<div class="pnotes small">${esc(j.notes.slice(0, 140))}${j.notes.length > 140 ? "…" : ""}</div>` : ""}
    <div class="row gap" style="margin-top:6px">
      <button class="btn sm ghost" data-open="${j.id}">Abrir</button>
      <a class="btn sm ghost" href="${esc(j.job_url_direct || j.job_url)}" target="_blank" rel="noopener">Vaga ↗</a>
      <select data-move="${j.id}" class="move" title="Mover para">${[...PIPELINE, "discarded"].map((st) => `<option value="${st}" ${st === j.status ? "selected" : ""}>${STATUS[st]}</option>`).join("")}</select>
    </div>
  </div>`;
}

// ------------------------------------------------------------------ automação
const DAYS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];

function setupAutoTab() {
  $("#add-schedule").addEventListener("click", () => addSchedule());
  $("#schedules").addEventListener("change", saveSchedulesSoon);
  $("#schedules").addEventListener("input", (e) => { if (e.target.type === "time") saveSchedulesSoon(); });
  $("#schedules").addEventListener("click", (e) => {
    const day = e.target.closest("[data-day]");
    if (day) { day.classList.toggle("on"); saveSchedulesSoon(); return; }
    const del = e.target.closest("[data-del-schedule]");
    if (del) { del.closest(".schedule").remove(); saveSchedules(); }
  });
  $("#save-cleanup").addEventListener("click", async () => {
    await saveSettings({
      archive_after_days: +$("#s-archive").value || 0,
      runs_keep_days: +$("#s-runs").value || 0,
      followup_days: Math.max(1, +$("#s-followup").value || 7),
    });
    updateCounts();
    previewCleanup();
    toast("Configurações salvas");
  });
  $("#run-cleanup").addEventListener("click", async () => {
    const r = await api("/api/cleanup", { method: "POST", body: {} });
    toast(`${r.archived} vaga(s) arquivada(s) · ${r.runs_deleted} busca(s) antiga(s) removida(s) do histórico`);
    await loadJobs();
    state.lastRunsSig = "";
    await pollRuns();
    previewCleanup();
  });
  $("#site-health").addEventListener("change", async (e) => {
    const cb = e.target.closest("[data-disable-site]");
    if (!cb) return;
    const set = new Set(state.meta.settings.disabled_sites);
    cb.checked ? set.add(cb.dataset.disableSite) : set.delete(cb.dataset.disableSite);
    await saveSettings({ disabled_sites: [...set] });
    renderFormSites();
    toast(cb.checked ? `${SITE_LABEL[cb.dataset.disableSite]} desativado em todas as buscas` : `${SITE_LABEL[cb.dataset.disableSite]} reativado`);
  });
}

async function saveSettings(patch) {
  state.meta.settings = await api("/api/settings", { method: "PUT", body: { ...state.meta.settings, ...patch } });
}

function renderAuto() {
  const st = state.meta.settings;
  $("#s-archive").value = st.archive_after_days;
  $("#s-runs").value = st.runs_keep_days;
  $("#s-followup").value = st.followup_days;
  renderSchedules();
  renderSiteHealth();
  previewCleanup();
}

async function previewCleanup() {
  try {
    const r = await api("/api/cleanup", { method: "POST", body: { dry_run: true } });
    $("#cleanup-preview").textContent = `agora: ${r.archived} vaga(s) para arquivar · ${r.runs_deleted} busca(s) antiga(s)`;
  } catch { /* ignore */ }
}

function scheduleRow(sc) {
  const tplOpts = state.meta.templates.map((t) => `<option value="${esc(t.id)}" ${t.id === sc.template_id ? "selected" : ""}>${esc(t.group)} · ${esc(t.name)}</option>`).join("");
  const last = sc.last_fired ? `última: ${fmtDateTime(sc.last_fired)}` : "ainda não rodou";
  return `<div class="schedule" data-id="${esc(sc.id || "")}" data-last="${esc(sc.last_fired || "")}">
    <label class="check"><input type="checkbox" data-f="enabled" ${sc.enabled !== false ? "checked" : ""}></label>
    <select data-f="template_id">${tplOpts}</select>
    <input type="time" data-f="time" value="${esc(sc.time || "09:00")}">
    <span class="days">${DAYS.map((d, i) => `<button type="button" data-day="${i}" class="${(sc.days || [0, 1, 2, 3, 4]).includes(i) ? "on" : ""}">${d}</button>`).join("")}</span>
    <label class="check small" title="Busca só vagas publicadas desde a execução anterior (mínimo 24h)"><input type="checkbox" data-f="recent_only" ${sc.recent_only !== false ? "checked" : ""}> só vagas novas</label>
    <span class="muted small">${last}</span>
    <button class="icon-btn" data-del-schedule title="Remover">✕</button>
  </div>`;
}

function renderSchedules() {
  const list = state.meta.settings.schedules;
  $("#schedules").innerHTML = list.length ? list.map(scheduleRow).join("")
    : `<div class="muted small" style="padding:8px 0">Nenhum agendamento. Use "+ Agendar template" ou o botão "Agendar" num template da aba Buscar.</div>`;
}

function readSchedules() {
  return $$("#schedules .schedule").map((row) => ({
    ...(row.dataset.id ? { id: row.dataset.id } : {}),
    template_id: $('[data-f="template_id"]', row).value,
    time: $('[data-f="time"]', row).value || "09:00",
    days: $$("[data-day].on", row).map((b) => +b.dataset.day),
    recent_only: $('[data-f="recent_only"]', row).checked,
    enabled: $('[data-f="enabled"]', row).checked,
  }));
}

async function saveSchedules() {
  try {
    await saveSettings({ schedules: readSchedules() });
    renderSchedules();
    renderTemplates();
  } catch (err) { toast(err.message); }
}
const saveSchedulesSoon = debounce(saveSchedules, 500);

async function addSchedule(templateId = null) {
  const tid = templateId || state.meta.templates[0].id;
  await saveSettings({ schedules: [...state.meta.settings.schedules, { template_id: tid, time: "09:00", days: [0, 1, 2, 3, 4], recent_only: true, enabled: true }] });
  renderAuto();
  renderTemplates();
  toast("Agendado para 09:00, de segunda a sexta. Ajuste o horário e os dias abaixo.");
  if ("Notification" in window && Notification.permission === "default") Notification.requestPermission();
}

// A site is "sick" when its last 3 finished attempts all returned 0 jobs or failed.
function siteHealth() {
  const out = {};
  for (const r of state.runs) {
    for (const [site, v] of Object.entries(r.sites || {})) {
      if (!["done", "error"].includes(v.status)) continue;
      const h = (out[site] ||= { runs: 0, zero: 0, errors: 0, jobs: 0, recent: [], last: null });
      h.runs++;
      h.jobs += v.count || 0;
      if (v.status === "error") h.errors++;
      else if (!v.count) h.zero++;
      if (h.recent.length < 3) h.recent.push(v.status === "error" || !v.count);
      h.last ||= r.created_at;
      h.lastError ||= v.error;
    }
  }
  for (const h of Object.values(out)) h.sick = h.recent.length >= 2 && h.recent.every(Boolean);
  return out;
}

function renderSiteHealth() {
  const health = siteHealth();
  const disabled = new Set(state.meta.settings.disabled_sites);
  const sites = state.meta.sites.filter((s) => health[s] || disabled.has(s));
  $("#site-health").innerHTML = sites.length ? `<table class="ptable health">
    <thead><tr><th>Site</th><th>Buscas</th><th>Vagas</th><th>Zeradas</th><th>Erros</th><th>Situação</th><th>Desativar</th></tr></thead>
    <tbody>${sites.map((s) => {
      const h = health[s] || { runs: 0, jobs: 0, zero: 0, errors: 0 };
      const status = disabled.has(s) ? '<span class="tag">desativado</span>'
        : h.sick ? `<span class="tag bad" title="${esc(h.lastError || "")}">zerado nas últimas ${h.recent.length}</span>`
        : '<span class="tag good">ok</span>';
      return `<tr><td>${SITE_LABEL[s] || s}</td><td>${h.runs}</td><td>${h.jobs}</td><td>${h.zero}</td><td>${h.errors}</td><td>${status}</td>
        <td><input type="checkbox" data-disable-site="${s}" ${disabled.has(s) ? "checked" : ""}></td></tr>`;
    }).join("")}</tbody></table>
    <p class="muted small">Desativar pula o site em todas as buscas (manuais e agendadas) sem mexer nos templates. ${Object.entries(health).some(([s, h]) => h.sick && !disabled.has(s)) ? "<b>Sugestão:</b> desative os sites marcados como zerados." : ""}</p>`
    : '<div class="muted small">Rode algumas buscas para ver a saúde de cada site.</div>';
}

// ------------------------------------------------------------------ CV import
function setupCvImport() {
  $("#cv-file").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    $("#cv-preview").innerHTML = '<div class="muted small">Lendo o PDF…</div>';
    try {
      const res = await fetch("/api/cv/parse", { method: "POST", headers: { "Content-Type": "application/pdf" }, body: file });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || res.statusText);
      state.cvDraft = await res.json();
      renderCvPreview(file.name);
    } catch (err) { $("#cv-preview").innerHTML = `<div class="warning">⚠ ${esc(err.message)}</div>`; }
  });
  $("#cv-preview").addEventListener("click", async (e) => {
    if (e.target.closest("[data-cv-cancel]")) { state.cvDraft = null; $("#cv-preview").innerHTML = ""; return; }
    if (!e.target.closest("[data-cv-apply]")) return;
    const d = state.cvDraft;
    const body = {};
    if ($("#cv-use-profile").checked) body.profile = d.profile;
    if ($("#cv-use-templates").checked) body.templates = d.templates.filter((t) => $(`[data-cv-tpl="${t.id}"]`).checked);
    if (!body.profile && !body.templates) return toast("Marque o que aplicar");
    const r = await api("/api/cv/apply", { method: "POST", body });
    await reloadMeta();
    if (body.profile) {
      renderProfile(state.meta.profile);
      $("#profile-name").textContent = state.meta.profile.headline || "";
      await loadJobs();
    }
    state.cvDraft = null;
    $("#cv-preview").innerHTML = "";
    toast([body.profile ? `Perfil aplicado · ${r.reanalyzed} vagas recalculadas` : "", body.templates ? `${r.templates} templates em "Do seu CV"` : ""].filter(Boolean).join(" · "));
  });
}

function renderCvPreview(name) {
  const { summary: s, templates } = state.cvDraft;
  const ENG = { basico: "básico", intermediario: "intermediário", avancado: "avançado", fluente: "fluente" };
  $("#cv-preview").innerHTML = `<div class="cv-result">
    <div class="facts" style="margin:10px 0">
      <div><b>Arquivo</b>${esc(name)}</div>
      <div><b>Cargo</b>${esc(s.role)} · ${esc(s.seniority)}</div>
      <div><b>Experiência</b>${s.years ? `${s.years}+ anos` : "não encontrada"}</div>
      <div><b>Local</b>${esc(s.location || "não encontrado")}</div>
      <div><b>Inglês</b>${esc(ENG[s.english] || "não encontrado")}</div>
    </div>
    <div class="small"><b>Stacks encontradas</b> <span class="muted">(peso · menções)</span></div>
    <div class="chips" style="margin:4px 0 8px">${s.skills.map((k) => `<span class="tag skill">${esc(k.name)} · ${k.weight} · ${k.hits}×</span>`).join("")}</div>
    <div class="small"><b>Vão tirar pontos</b> <span class="muted">(não estão no CV)</span></div>
    <div class="chips" style="margin:4px 0 10px">${s.avoid.map((k) => `<span class="tag bad">${esc(k)}</span>`).join("")}</div>
    <label class="check"><input type="checkbox" id="cv-use-profile" checked> Substituir o perfil do score por este <span class="hint">(você pode ajustar depois aqui embaixo; "Restaurar padrão" volta ao original)</span></label>
    <label class="check"><input type="checkbox" id="cv-use-templates" checked> Criar templates no grupo "Do seu CV" <span class="hint">(substitui os gerados antes; os seus templates continuam)</span></label>
    <div class="cv-tpls">${templates.map((t) => `<label class="check small"><input type="checkbox" data-cv-tpl="${t.id}" checked> ${esc(t.name)} <span class="muted">— <code>${esc(t.params.search_term)}</code>${t.params.location ? ` · ${esc(t.params.location)}` : ""}</span></label>`).join("")}</div>
    <div class="row gap" style="margin-top:10px">
      <button class="btn sm primary" data-cv-apply>Aplicar</button>
      <button class="btn sm ghost" data-cv-cancel>Cancelar</button>
    </div>
  </div>`;
}

init().catch((err) => { console.error(err); toast("Falha ao carregar: " + err.message); });
