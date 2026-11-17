const {parseListing, evaluate, resolveKind, withAiFields, DEFAULT_CRITERIA, NEIGHBORHOOD_NAMES} = window.ApartmentParser;
const SOURCE_TYPES = ["facebook", "yad2", "madlan", "homeless", "komo", "telegram"];
const DEFAULT_SOURCES = {facebook: true, yad2: true, madlan: true, homeless: true, komo: true, telegram: true, telegramChannels: []};
const {t} = window.I18n;
const L = window.I18n;
const $ = (id) => document.getElementById(id);
const BONUS_NAMES = ["חניה", "מרפסת", "ממ״ד", "מעלית", "משופצת", "מרוהטת", "חיות"];
const NEW_WINDOW_MS = 24 * 60 * 60 * 1000;
const REFRESH_MS = 60 * 1000;

const DEFAULT_CONFIG = {
  enabled: false, groupUrls: DEFAULT_GROUP_URLS, intervalMinutes: 15, criteria: DEFAULT_CRITERIA, alertOnReview: false,
};

const state = {
  me: null,             // {email, name, role, telegramLinked}
  loaded: false,
  tab: "match",
  raw: {},              // id -> listing from the server
  listings: {},         // id -> listing with parsed fields and status
  payload: {},          // collector status: scan, debug, ai
  config: DEFAULT_CONFIG,
  marks: {items: {}},   // shared saved / hidden / kind marks
  since: 0,             // last server time seen, for incremental refreshes
  members: [],
  filters: {text: "", price: "", rooms: "", sort: "new", areas: new Set(), bonuses: new Set(), sources: new Set()},
  openTexts: new Set(),
  bannerKey: null,
};

// ---------- helpers ----------

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
}
const safeUrl = (url) => (/^https:\/\//i.test(url || "") ? url : "");
const icon = (name) => `<svg class="ic" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const num = (value) => Number(value).toLocaleString(L.locale());
const isOwner = () => state.me?.role === "owner";

function withDefaults(config) {
  return {
    ...DEFAULT_CONFIG, ...(config || {}),
    criteria: {...DEFAULT_CRITERIA, ...(config?.criteria || {})},
    sources: {...DEFAULT_SOURCES, ...(config?.sources || {})},
  };
}

// Banners are stored as a key + argument so they re-translate when the language changes.
function showBanner(key, arg) {
  state.bannerKey = key ? [key, arg] : null;
  renderBanner();
}
function renderBanner() {
  const banner = $("banner");
  banner.hidden = !state.bannerKey;
  banner.textContent = state.bannerKey ? t(...state.bannerKey) : "";
}

async function copy(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

// ---------- server ----------

class ApiError extends Error {
  constructor(status, code, message) {
    super(message || code);
    this.status = status;
    this.code = code;
  }
}

async function api(path, {method = "GET", body} = {}) {
  const response = await fetch(`/api/${path}`, {
    method,
    credentials: "same-origin",
    headers: body ? {"content-type": "application/json"} : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  // Cloudflare Access sends an expired session to its login page.
  if (response.redirected && !response.url.includes("/api/")) throw new ApiError(401, "not_signed_in");
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new ApiError(response.status, data.error || "error", data.message), {email: data.email});
  return data;
}

function reparse() {
  const criteria = state.config.criteria;
  const listings = {};
  for (const raw of Object.values(state.raw)) {
    const parsed = withAiFields(parseListing(raw.text, raw.url), raw.ai);
    const mark = state.marks.items[raw.id] || {};
    const kindInfo = resolveKind(parsed, raw.ai, mark.kind);
    listings[raw.id] = {
      ...raw, ...parsed, url: raw.url || parsed.url, ...evaluate(parsed, criteria, kindInfo),
      kindBy: kindInfo.by, sourceType: raw.sourceType || "facebook", sources: raw.sources || [],
      saved: !!mark.saved, hidden: !!mark.hidden, markedBy: mark.by || "",
    };
  }
  state.listings = listings;
}

async function refresh() {
  try {
    const [data, config] = await Promise.all([api(`listings?since=${state.since}`), api("settings")]);
    for (const listing of data.listings || []) state.raw[listing.id] = listing;
    const cutoff = Date.now() - 45 * 86400000;
    for (const [id, listing] of Object.entries(state.raw)) if (listing.lastSeen < cutoff) delete state.raw[id];
    state.since = Math.floor(data.now || 0) - 5000;
    state.marks.items = data.marks || {};
    const status = data.status || {};
    state.payload = {scan: status.scan || {}, debug: status.debug || {}, ai: status.ai || {}, updatedAt: status.scan?.updatedAt};
    state.pendingRequest = status.scanRequest || state.pendingRequest;
    state.config = withDefaults(config);
    showBanner(null);
  } catch (error) {
    if (error.status === 401 || error.status === 403) return showGate(error);
    showBanner("errLoad", error.message);
  }
  state.loaded = true;
  reparse();
  render();
}

async function saveMark(id, patch) {
  const previous = state.marks.items[id] || {};
  state.marks.items[id] = {...previous, ...patch, by: state.me?.name || "", at: Date.now()};
  reparse();
  render();
  try {
    const {mark} = await api("marks", {method: "POST", body: {id, ...patch}});
    state.marks.items[id] = mark;
  } catch (error) {
    state.marks.items[id] = previous;
    showBanner("errSave", error.message);
  }
  reparse();
  render();
}

async function requestScan(mode) {
  await api("scan", {method: "POST", body: {mode}});
  state.pendingRequest = {mode, at: Date.now()};
  render();
}

function showGate(error) {
  $("app").hidden = true;
  $("gate").hidden = false;
  const invited = error.code !== "not_invited";
  $("gateText").textContent = invited ? t("gateSignedOut") : t("gateNotInvited", error.email || "");
  $("gateAction").textContent = invited ? t("gateSignIn") : t("gateOtherAccount");
  $("gateAction").href = invited ? location.pathname : "/cdn-cgi/access/logout";
}

// ---------- rendering ----------

function chip(label, pressed, attrs = "") {
  return `<button type="button" class="chip" aria-pressed="${pressed}" ${attrs}>${icon("check")}<span>${esc(label)}</span></button>`;
}

function renderFilterChips() {
  $("fAreas").innerHTML = NEIGHBORHOOD_NAMES.map((name) =>
    chip(L.area(name), state.filters.areas.has(name), `data-area="${esc(name)}"`)).join("");
  $("fSources").innerHTML = SOURCE_TYPES.map((type) =>
    chip(t("source")[type], state.filters.sources.has(type), `data-source="${type}"`)).join("");
  $("fBonuses").innerHTML = BONUS_NAMES.map((name) =>
    chip(L.extra(name), state.filters.bonuses.has(name), `data-bonus="${esc(name)}"`)).join("");
}

function inTab(listing, tab) {
  if (tab === "hidden") return listing.hidden;
  if (listing.hidden) return false;
  if (tab === "saved") return listing.saved;
  if (tab === "all") return listing.status !== "filtered";
  return listing.status === tab;
}

function activeFilterCount() {
  const f = state.filters;
  return (f.text ? 1 : 0) + (f.price ? 1 : 0) + (f.rooms ? 1 : 0) + f.areas.size + f.bonuses.size + f.sources.size;
}

function passesFilters(listing) {
  const f = state.filters;
  if (f.text && !listing.text.toLowerCase().includes(f.text.toLowerCase())) return false;
  if (f.price && listing.price != null && listing.price > Number(f.price)) return false;
  if (f.rooms && listing.rooms != null && listing.rooms < Number(f.rooms)) return false;
  if (f.areas.size && !listing.neighborhoods.some((n) => f.areas.has(n))) return false;
  for (const bonus of f.bonuses) if (!listing.bonuses.includes(bonus)) return false;
  if (f.sources.size && !listing.sources.concat([{type: listing.sourceType}]).some((s) => f.sources.has(s.type))) return false;
  return true;
}

function sortListings(list) {
  const byPrice = (dir) => (a, b) => (a.price ?? (dir > 0 ? 1e9 : -1)) - (b.price ?? (dir > 0 ? 1e9 : -1));
  const sorters = {
    new: (a, b) => b.firstSeen - a.firstSeen,
    priceAsc: byPrice(1),
    priceDesc: (a, b) => byPrice(-1)(b, a),
    bonus: (a, b) => b.bonuses.length - a.bonuses.length || b.firstSeen - a.firstSeen,
  };
  return list.sort(sorters[state.filters.sort] || sorters.new);
}

function card(listing) {
  const image = safeUrl(listing.image);
  const link = safeUrl(listing.url) || safeUrl(listing.source);
  const area = listing.neighborhoods[0] ? L.area(listing.neighborhoods[0]) : t("telAviv");
  const isNew = Date.now() - listing.firstSeen < NEW_WINDOW_MS && !listing.fromBackfill;
  const status = {
    match: ["match", t("statusMatch")], review: ["review", t("statusReview")],
    rejected: ["rejected", t("statusRejected")], filtered: ["filtered", t("statusFiltered")],
  }[listing.status];
  const places = listing.sources.length;
  const reposted = listing.repostedAt && Date.now() - listing.repostedAt < 7 * 86400000;
  const isJunk = listing.status === "filtered";
  const open = state.openTexts.has(listing.id);
  const spec = (value, unit) => value != null
    ? `<span>${esc(num(value))} ${unit}</span>`
    : `<span class="unknown" title="${esc(t("statusReview"))}">? ${unit}</span>`;
  const when = listing.postedLabel || L.timeAgo(listing.firstSeen);
  const areas = listing.neighborhoods.map(L.area).join(" · ") || t("telAviv");
  return `
    <article class="card${listing.hidden ? " is-hidden" : ""}" data-id="${esc(listing.id)}">
      <div class="media">
        ${image ? `<img src="${esc(image)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" data-fallback>` : ""}
        <div class="placeholder" ${image ? "hidden" : ""}>${icon("home")}<span>${esc(area)}</span></div>
        <div class="badges">
          <span class="badge ${status[0]}">${status[1]}</span>
          ${isNew ? `<span class="badge new">${t("isNew")}</span>` : ""}
          ${reposted ? `<span class="badge">${t("reposted")}</span>` : ""}
        </div>
        <button type="button" class="save${listing.saved ? " on" : ""}" data-action="save" aria-pressed="${listing.saved}"
          aria-label="${esc(listing.saved ? t("unsave") : t("save_"))}">${icon("heart")}</button>
      </div>
      <div class="body">
        <p class="price">${listing.price != null
          ? `<bdi>${L.lang === "en" ? `₪${esc(num(listing.price))}` : `${esc(num(listing.price))} ₪`}</bdi> <small>${t("perMonth")}</small>`
          : `<span class="no-price">${t("noPrice")}</span>`}</p>
        <p class="specs">${spec(listing.rooms, t("rooms"))}<span class="sep" aria-hidden="true">·</span>${spec(listing.bathrooms, t("baths"))}</p>
        <p class="where"><span class="area">${esc(areas)}</span><span class="sep" aria-hidden="true">·</span><span>${esc(when)}</span></p>
        ${listing.bonuses.length ? `<ul class="tags">${listing.bonuses.map((b) => `<li>${esc(L.extra(b))}</li>`).join("")}</ul>` : ""}
        ${listing.status !== "match" ? `<p class="reasons ${status[0]}">${esc(listing.reasons.map(L.reason).join(" · "))}</p>` : ""}
        ${listing.saved && listing.markedBy ? `<p class="marked">${icon("heart")}${esc(t("savedBy", listing.markedBy))}</p>` : ""}
        ${listing.kindBy === "person" ? `<p class="kind-note">${esc(t("kindMarkedBy", listing.markedBy || ""))}</p>` : ""}
        ${listing.ai?.by === "ai" && listing.kindBy === "ai" && !isJunk ? `<p class="kind-note">${esc(t("checkedByAi"))}</p>` : ""}
        ${places > 1 ? `<details class="places"><summary>${esc(t("postedIn", places))}</summary><ul>${listing.sources.map((src) =>
          `<li><a href="${esc(safeUrl(src.url) || "#")}" target="_blank" rel="noopener noreferrer" dir="auto">${esc(t("source")[src.type] || src.type)} · ${esc(src.name || "")}</a></li>`).join("")}</ul></details>` : ""}
        <p class="excerpt${open ? " open" : ""}" dir="auto">${esc(listing.text)}</p>
        <button type="button" class="link-btn more" data-action="toggle-text" aria-expanded="${open}">${open ? t("readLess") : t("readMore")}</button>
      </div>
      <div class="foot">
        <span class="source" title="${esc(listing.sourceName)}" dir="auto"><b>${esc(t("source")[listing.sourceType] || "")}</b> ${esc(listing.sourceType === "facebook" || listing.sourceType === "telegram" ? listing.sourceName || "" : "")}</span>
        <span class="actions">
          <button type="button" class="link-btn kind-btn" data-action="${isJunk ? "kind-rental" : "kind-other"}">${isJunk ? t("isApartment") : t("notApartment")}</button>
          <button type="button" class="icon-btn" data-action="hide" aria-label="${esc(listing.hidden ? t("unhide") : t("hide"))}"
            title="${esc(listing.hidden ? t("unhide") : t("hide"))}">${icon(listing.hidden ? "undo" : "hide")}</button>
          ${link ? `<a class="btn small open" href="${esc(link)}" target="_blank" rel="noopener noreferrer">${t("openPost")}${icon("ext")}</a>` : ""}
        </span>
      </div>
    </article>`;
}

function skeletons(count = 6) {
  return Array.from({length: count}, () => `
    <div class="card skeleton" aria-hidden="true">
      <div class="media"></div>
      <div class="body"><span class="bone w40 tall"></span><span class="bone w60"></span><span class="bone w80"></span></div>
    </div>`).join("");
}

function renderStatus() {
  const scan = state.payload.scan || {};
  const el = $("scanStatus");
  const pending = state.pendingRequest && state.pendingRequest.at > (scan.startedAt || 0) && Date.now() - state.pendingRequest.at < 5 * 60000;
  $("stopScan").hidden = !scan.running;
  $("scanNow").hidden = !!scan.running;
  $("scanNow").disabled = !!pending;
  $("progress").hidden = !scan.running;
  const synced = state.payload.updatedAt ? ` · ${t("updated", L.timeAgo(state.payload.updatedAt))}` : "";
  let dot = "";
  let text;
  if (!state.loaded) {
    text = t("loading");
  } else if (pending && !scan.running) {
    dot = "live";
    text = state.pendingRequest.mode === "stop" ? t("stopping") : t("waitingForComputer");
  } else if (scan.running) {
    dot = "live";
    const label = scan.mode === "backfill" ? t("scanningBack") : t("scanning");
    const index = Math.min((scan.groupIndex || 0) + 1, scan.total || 1);
    text = `${label} · ${t("groupOf", index, scan.total || "?")}${synced}`;
    $("progressBar").style.transform = `scaleX(${Math.min(1, (scan.groupIndex || 0) / Math.max(scan.total || 1, 1))})`;
  } else if (scan.lastError) {
    dot = "err";
    text = `${scan.lastError}${synced}`;
  } else if (scan.lastRun) {
    dot = state.config.enabled ? "ok" : "";
    text = t("lastScan", L.timeAgo(scan.lastRun), scan.lastCounts?.new ?? 0) + (state.config.enabled ? "" : ` · ${t("monitoringOff")}`);
  } else {
    text = state.config.enabled ? t("firstScanSoon") : t("offOpenSettings");
  }
  el.innerHTML = `<span class="dot ${dot}"></span><span>${esc(text)}</span>`;
}

function renderEmpty(visibleCount, allCount) {
  const filtered = activeFilterCount() > 0;
  let title, text, action = null;
  if (!allCount && state.payload.scan?.running) {
    title = t("emptyScanningTitle"); text = t("emptyScanning");
  } else if (!allCount) {
    title = t("emptyNoDataTitle"); text = t("emptyNoData");
    if (!state.config.enabled) action = ["settings", t("openSettings")];
  } else if (filtered) {
    title = t("emptyFilteredTitle"); text = t("emptyFiltered"); action = ["clear", t("clearFilters")];
  } else {
    title = t("emptyTabTitle")[state.tab]; text = t("emptyTab")[state.tab];
  }
  $("empty").hidden = visibleCount > 0 || !state.loaded;
  $("emptyTitle").textContent = title;
  $("emptyText").textContent = text;
  $("emptyText").hidden = !text;
  $("emptyAction").hidden = !action;
  if (action) {
    $("emptyAction").textContent = action[1];
    $("emptyAction").dataset.do = action[0];
  }
}

function render() {
  const all = Object.values(state.listings);
  for (const tab of ["match", "review", "all", "saved", "filtered", "hidden"]) {
    $(`count-${tab}`).textContent = num(all.filter((l) => inTab(l, tab)).length);
  }
  document.querySelectorAll(".tabs [data-tab]").forEach((b) => {
    const active = b.dataset.tab === state.tab;
    b.classList.toggle("active", active);
    b.setAttribute("aria-selected", String(active));
  });
  const visible = sortListings(all.filter((l) => inTab(l, state.tab) && passesFilters(l)));
  const grid = $("grid");
  grid.innerHTML = state.loaded ? visible.slice(0, 400).map(card).join("") : skeletons();
  grid.setAttribute("aria-busy", String(!state.loaded));
  grid.querySelectorAll("img[data-fallback]").forEach((img) => {
    img.addEventListener("error", () => { img.nextElementSibling?.removeAttribute("hidden"); img.remove(); }, {once: true});
    img.addEventListener("load", () => img.classList.add("loaded"), {once: true});
    if (img.complete && img.naturalWidth) img.classList.add("loaded");
  });
  const filters = activeFilterCount();
  $("resultLine").textContent = state.loaded && visible.length ? t("results", visible.length) : "";
  $("clearFilters").hidden = !filters;
  $("filtersCount").hidden = !filters;
  $("filtersCount").textContent = filters;
  renderEmpty(visible.length, all.length);
  const c = state.config;
  $("onboarding").hidden = !state.loaded || !isOwner() || c.enabled;
  $("stepOn").classList.toggle("done", c.enabled);
  renderStatus();
  renderBanner();
}

function clearFilters() {
  state.filters = {...state.filters, text: "", price: "", rooms: "", areas: new Set(), bonuses: new Set(), sources: new Set()};
  $("fText").value = "";
  $("fPrice").value = "";
  $("fRooms").value = "";
  renderFilterChips();
  render();
}

// ---------- settings ----------

function debugReport() {
  const p = state.payload;
  const scan = p.scan || {};
  const lines = [`collector · listings ${Object.keys(state.raw).length} · updated ${p.updatedAt ? new Date(p.updatedAt).toISOString() : "never"}`,
    `scan: ${scan.running ? "running" : "idle"} ${scan.mode || ""} · error: ${scan.lastError || "none"}`];
  const all = Object.values(state.listings);
  const filtered = all.filter((l) => l.status === "filtered").length;
  lines.push(`filtered ${filtered}/${all.length} · merged places ${all.reduce((n, l) => n + Math.max(0, l.sources.length - 1), 0)} · AI ${p.ai?.usage?.calls || 0} calls${p.ai?.error ? ` · ${p.ai.error}` : ""}`);
  for (const [url, d] of Object.entries(p.debug || {})) {
    lines.push("", `[${d.source || "facebook"}] ${(d.title || "").slice(0, 40)} ${url.replace("https://www.facebook.com/groups/", "g/")}${d.blocked ? " · BLOCKED" : ""}`);
    lines.push(`  posts ${d.posts ?? "?"} · unique ${d.unique ?? "?"} · new ${d.fresh ?? "?"} · merged ${d.merged ?? "?"} · filtered ${d.filtered ?? "?"}${d.error ? ` · ${d.error}` : ""}`);
    (d.samples || []).forEach((sample) => lines.push(`  > ${sample.replace(/\s+/g, " ").slice(0, 120)}`));
  }
  if (!Object.keys(p.debug || {}).length) lines.push("", t("noScanYet"));
  return lines.join("\n");
}

function renderMembers() {
  $("members").innerHTML = state.members.length ? state.members.map((m) => `
    <div class="member">
      <div class="member-head"><b>${esc(m.name)}</b><span class="hint" dir="ltr">${esc(m.email)}</span>
        ${m.role === "owner" ? `<span class="hint">${t("ownerLabel")}</span>` : ""}</div>
      ${m.role === "owner" ? "" : `<div class="member-actions">
        <button type="button" class="btn ghost small danger" data-member-remove="${esc(m.email)}">${t("remove")}</button></div>`}
    </div>`).join("") : `<p class="hint">${t("noMembers")}</p>`;
}

async function loadMembers() {
  if (!isOwner()) return;
  try {
    state.members = await api("members");
  } catch {
    state.members = [];
  }
  renderMembers();
}

function fillSettings() {
  const c = state.config;
  const owner = isOwner();
  document.querySelectorAll("[data-owner-only]").forEach((el) => { el.hidden = !owner; });
  $("ownerFields").disabled = !owner;
  $("memberNote").hidden = owner;
  $("sAlertReview").checked = c.alertOnReview;
  $("sMaxPrice").value = c.criteria.maxPrice;
  $("sMinRooms").value = c.criteria.minRooms;
  $("sMinBaths").value = c.criteria.minBathrooms;
  $("sRoommates").checked = !!c.criteria.includeRoommates;
  $("sSublets").checked = !!c.criteria.includeSublets;
  $("sAreas").innerHTML = NEIGHBORHOOD_NAMES.map((name) =>
    chip(L.area(name), c.criteria.neighborhoods.includes(name), `data-setting-area="${esc(name)}"`)).join("");
  $("sSources").innerHTML = SOURCE_TYPES.map((type) => `
    <label class="switch-row"><span><b>${esc(t("source")[type])}</b><small>${esc(t("sourceHint")[type])}</small></span>
      <input type="checkbox" role="switch" class="switch" data-source="${type}" ${c.sources[type] !== false ? "checked" : ""}></label>`).join("");
  $("sChannels").value = (c.sources.telegramChannels || []).join("\n");
  $("sGroups").value = c.groupUrls.join("\n");
  $("sEnabled").checked = c.enabled;
  $("appUrl").textContent = `${location.origin}/`;
  const ai = state.payload.ai || {};
  $("aiStatus").textContent = ai.error ? ai.error
    : ai.usage?.calls ? t("aiUsage", ai.usage.calls, Math.round(((ai.usage.input || 0) * 0.1 + (ai.usage.output || 0) * 0.5) / 1e4) / 100)
    : "";
  setSettingsStatus("");
  $("debugView").textContent = debugReport();
  loadMembers();
}

let lastFocus = null;
function openSettings() {
  fillSettings();
  lastFocus = document.activeElement;
  document.body.classList.add("drawer-open");
  $("settings").inert = false;
  $("app").inert = true;
  $("closeSettings").focus({preventScroll: true});
}

function closeSettings({instant = false} = {}) {
  if (!document.body.classList.contains("drawer-open")) return;
  if (instant) {
    $("settings").classList.add("instant");
    $("scrim").classList.add("instant");
    requestAnimationFrame(() => requestAnimationFrame(() => {
      $("settings").classList.remove("instant");
      $("scrim").classList.remove("instant");
    }));
  }
  document.body.classList.remove("drawer-open");
  $("settings").inert = true;
  $("app").inert = false;
  lastFocus?.focus?.({preventScroll: true});
}

function setSettingsStatus(text, isError = false) {
  $("settingsStatus").textContent = text;
  $("settingsStatus").classList.toggle("err", isError);
}

function readSettings() {
  const groupUrls = $("sGroups").value.split("\n").map((s) => s.trim()).filter(Boolean);
  const bad = groupUrls.find((url) => !/^https:\/\/(www\.)?facebook\.com\/groups\//i.test(url));
  if (bad) throw new Error(t("badGroupUrl", bad));
  const areas = [...$("sAreas").querySelectorAll('[aria-pressed="true"]')].map((b) => b.dataset.settingArea);
  return {
    ...state.config,
    alertOnReview: $("sAlertReview").checked,
    criteria: {
      maxPrice: Number($("sMaxPrice").value) || DEFAULT_CRITERIA.maxPrice,
      minRooms: Number($("sMinRooms").value) || 0,
      minBathrooms: Number($("sMinBaths").value) || 0,
      neighborhoods: areas,
      includeRoommates: $("sRoommates").checked,
      includeSublets: $("sSublets").checked,
    },
    sources: {
      ...Object.fromEntries([...$("sSources").querySelectorAll("input[data-source]")].map((el) => [el.dataset.source, el.checked])),
      telegramChannels: $("sChannels").value.split(/[\n,]+/).map((c) => c.trim()).filter(Boolean).slice(0, 30),
    },
    groupUrls: groupUrls.slice(0, 60),
    enabled: $("sEnabled").checked,
  };
}

async function saveSettings(event) {
  event?.preventDefault();
  if (!isOwner()) return false;
  let config;
  try {
    config = readSettings();
  } catch (error) {
    setSettingsStatus(error.message, true);
    return false;
  }
  setSettingsStatus(t("saving"));
  const submit = $("settingsForm").querySelector('[type="submit"]');
  submit.disabled = true;
  try {
    state.config = withDefaults(await api("settings", {method: "PUT", body: config}));
  } catch (error) {
    setSettingsStatus(t("errSave", error.message), true);
    return false;
  } finally {
    submit.disabled = false;
  }
  reparse();
  render();
  setSettingsStatus(config.enabled ? t("savedOn") : t("savedOff"));
  return true;
}

// ---------- sharing (owner only) ----------

function setShareStatus(text, isError = false) {
  $("shareStatus").textContent = text;
  $("shareStatus").classList.toggle("err", isError);
}

async function addMember() {
  const name = $("mName").value.trim().slice(0, 30);
  const email = $("mEmail").value.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return setShareStatus(t("badEmail"), true);
  try {
    await api("members", {method: "POST", body: {name, email}});
  } catch (error) {
    return setShareStatus(t("errSave", error.message), true);
  }
  $("mName").value = "";
  $("mEmail").value = "";
  setShareStatus(t("memberInvited", name || email, `${location.origin}/`));
  loadMembers();
}

async function removeMember(target) {
  const email = target.dataset.memberRemove;
  // Removing needs a second click on the same button instead of a browser dialog.
  if (target.dataset.confirming !== "1") {
    target.dataset.confirming = "1";
    target.textContent = t("confirmRemove", email);
    setTimeout(() => {
      if (!target.isConnected) return;
      target.dataset.confirming = "";
      target.textContent = t("remove");
    }, 4000);
    return;
  }
  try {
    await api(`members?email=${encodeURIComponent(email)}`, {method: "DELETE"});
  } catch (error) {
    return setShareStatus(t("errSave", error.message), true);
  }
  setShareStatus(t("memberRemoved", email));
  loadMembers();
}

// ---------- events ----------

document.addEventListener("click", async (event) => {
  const target = event.target.closest("button, a");
  if (!target) return;
  if (target.matches("[data-lang-toggle]")) {
    L.setLang(L.lang === "he" ? "en" : "he");
    renderFilterChips();
    if (document.body.classList.contains("drawer-open")) fillSettings();
    return render();
  }
  if (target.matches("[data-open-settings]")) return openSettings();
  if (target.dataset.memberRemove) return removeMember(target);
  if (target.dataset.tab) { state.tab = target.dataset.tab; return render(); }
  if (target.dataset.area || target.dataset.bonus || target.dataset.source) {
    const set = target.dataset.area ? state.filters.areas : target.dataset.bonus ? state.filters.bonuses : state.filters.sources;
    const value = target.dataset.area || target.dataset.bonus || target.dataset.source;
    set.has(value) ? set.delete(value) : set.add(value);
    target.setAttribute("aria-pressed", String(set.has(value)));
    return render();
  }
  if (target.dataset.settingArea) {
    target.setAttribute("aria-pressed", target.getAttribute("aria-pressed") === "true" ? "false" : "true");
    return;
  }
  const action = target.dataset.action;
  const id = target.closest(".card")?.dataset.id;
  if (!action || !id) return;
  if (action === "toggle-text") {
    state.openTexts.has(id) ? state.openTexts.delete(id) : state.openTexts.add(id);
    return render();
  }
  const previous = state.marks.items[id] || {};
  if (action === "kind-rental" || action === "kind-other") {
    // A person's call on whether this is an apartment. The AI learns from these.
    const kind = action === "kind-rental" ? "rental" : "other";
    return saveMark(id, {kind: previous.kind === kind ? "" : kind});
  }
  const field = action === "save" ? "saved" : "hidden";
  return saveMark(id, {[field]: !previous[field]});
});

$("openSettings").addEventListener("click", openSettings);
$("closeSettings").addEventListener("click", () => closeSettings());
$("scrim").addEventListener("click", () => closeSettings());
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeSettings({instant: true}); });
$("settingsForm").addEventListener("submit", saveSettings);
$("scanNow").addEventListener("click", () => requestScan("quick").catch((e) => showBanner("errSave", e.message)));
$("stopScan").addEventListener("click", () => requestScan("stop").catch((e) => showBanner("errSave", e.message)));
$("clearFilters").addEventListener("click", clearFilters);
$("emptyAction").addEventListener("click", (e) => (e.currentTarget.dataset.do === "clear" ? clearFilters() : openSettings()));
$("filtersToggle").addEventListener("click", (e) => {
  const open = document.body.classList.toggle("filters-open");
  e.currentTarget.setAttribute("aria-expanded", String(open));
});
$("backfill").addEventListener("click", async () => {
  if (!(await saveSettings())) return;
  await requestScan("backfill");
  setSettingsStatus(t("backfillRequested"));
});
$("addMember").addEventListener("click", addMember);
$("copyLink").addEventListener("click", async () => {
  await copy(`${location.origin}/`);
  setSettingsStatus(t("linkCopied"));
});
$("extensionKey").addEventListener("click", async () => {
  try {
    const {key} = await api("extension-key", {method: "POST"});
    $("extensionKeyValue").textContent = key;
    $("extensionKeyValue").hidden = false;
    await copy(key);
    setSettingsStatus(t("extensionKeyCopied"));
  } catch (error) {
    setSettingsStatus(t("errSave", error.message), true);
  }
});
$("copyDebug").addEventListener("click", async () => {
  const text = debugReport();
  $("debugView").textContent = text;
  await copy(text);
  setSettingsStatus(t("reportCopied"));
});
$("installTipClose").addEventListener("click", () => {
  $("installTip").hidden = true;
  try { localStorage.setItem("hunter-install-tip", "1"); } catch {}
});

const debounce = (fn, ms = 200) => { let timer; return (...a) => { clearTimeout(timer); timer = setTimeout(() => fn(...a), ms); }; };
$("fText").addEventListener("input", debounce((e) => { state.filters.text = e.target.value.trim(); render(); }));
$("fPrice").addEventListener("change", (e) => { state.filters.price = e.target.value; render(); });
$("fRooms").addEventListener("change", (e) => { state.filters.rooms = e.target.value; render(); });
$("fSort").addEventListener("change", (e) => { state.filters.sort = e.target.value; render(); });

// ---------- start ----------

async function start() {
  L.apply();
  try {
    state.me = await api("me");
  } catch (error) {
    return showGate(error);
  }
  $("app").hidden = false;
  // Show the add-to-home-screen tip in iPhone Safari (not yet installed), once.
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  let tipSeen = false;
  try { tipSeen = localStorage.getItem("hunter-install-tip") === "1"; } catch {}
  $("installTip").hidden = !(ios && !navigator.standalone && !tipSeen);
  renderFilterChips();
  render();
  refresh();
  setInterval(() => { if (!document.hidden) refresh(); }, REFRESH_MS);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
}
start();
