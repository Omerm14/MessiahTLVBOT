const {parseListing, evaluate, DEFAULT_CRITERIA, NEIGHBORHOOD_NAMES} = window.ApartmentParser;
const Sync = window.HunterSync;
const {t} = window.I18n;
const L = window.I18n;
const $ = (id) => document.getElementById(id);
const BONUS_NAMES = ["חניה", "מרפסת", "ממ״ד", "מעלית", "משופצת", "מרוהטת", "חיות"];
const NEW_WINDOW_MS = 24 * 60 * 60 * 1000;
const REFRESH_MS = 60 * 1000;

const DEFAULT_CONFIG = {
  enabled: false, groupUrls: DEFAULT_GROUP_URLS, intervalMinutes: 20,
  telegramChatId: "", criteria: DEFAULT_CRITERIA, alertOnReview: false, scanRequest: null,
};

const state = {
  secrets: null,
  loaded: false,
  tab: "match",
  raw: [],            // listings as uploaded by the extension
  listings: {},       // id -> parsed listing
  payload: {},        // listings file: scan status, debug, version
  config: DEFAULT_CONFIG,
  configSha: "",
  listingsSha: "",
  marks: {items: {}},   // shared saved/hidden marks
  marksSha: "",
  secretsFile: {telegramToken: "", members: []}, // owner only
  secretsSha: "",
  filters: {text: "", price: "", rooms: "", sort: "new", areas: new Set(), bonuses: new Set()},
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

function withDefaults(config) {
  return {...DEFAULT_CONFIG, ...(config || {}), criteria: {...DEFAULT_CRITERIA, ...(config?.criteria || {})}};
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

// ---------- secrets ----------

function readSecrets() {
  const hash = new URLSearchParams(location.hash.slice(1));
  if (hash.get("t") && hash.get("k")) {
    const secrets = {token: hash.get("t"), key: hash.get("k"), ownerKey: hash.get("o") || "", name: hash.get("n") || ""};
    try { localStorage.setItem("hunter-secrets", JSON.stringify(secrets)); } catch {}
    history.replaceState(null, "", location.pathname);
    return secrets;
  }
  try {
    const saved = JSON.parse(localStorage.getItem("hunter-secrets") || "null");
    if (saved?.token && saved?.key) return saved;
  } catch {}
  return null;
}

// ---------- data ----------

function reparse() {
  const criteria = state.config.criteria;
  const listings = {};
  for (const raw of state.raw) {
    const parsed = parseListing(raw.text, raw.url);
    listings[raw.id] = {
      ...raw, ...parsed, url: raw.url || parsed.url, ...evaluate(parsed, criteria),
      saved: !!state.marks.items[raw.id]?.saved, hidden: !!state.marks.items[raw.id]?.hidden,
      markedBy: state.marks.items[raw.id]?.by || "",
    };
  }
  state.listings = listings;
}

async function refresh() {
  const {token, key} = state.secrets;
  try {
    const [configFile, listingsFile, marksFile, secretsFile] = await Promise.all([
      Sync.readFile(token, Sync.FILES.config),
      Sync.readFile(token, Sync.FILES.listings),
      Sync.readFile(token, Sync.FILES.state),
      isOwner() ? Sync.readFile(token, Sync.FILES.secrets) : null,
    ]);
    if (configFile && configFile.sha !== state.configSha) {
      state.config = withDefaults(await Sync.decryptJson(key, configFile.text));
      state.configSha = configFile.sha;
    }
    if (listingsFile && listingsFile.sha !== state.listingsSha) {
      state.payload = await Sync.decryptJson(key, listingsFile.text);
      state.raw = state.payload.listings || [];
      state.listingsSha = listingsFile.sha;
    }
    if (marksFile && marksFile.sha !== state.marksSha) {
      state.marks = Sync.mergeMarks(state.marks, await Sync.decryptJson(key, marksFile.text));
      state.marksSha = marksFile.sha;
    }
    if (secretsFile && secretsFile.sha !== state.secretsSha) {
      state.secretsFile = {telegramToken: "", members: [], ...(await Sync.decryptJson(state.secrets.ownerKey, secretsFile.text))};
      state.secretsSha = secretsFile.sha;
    }
    showBanner(null);
  } catch (error) {
    if (error.status === 401) showBanner("errKey");
    else if (error.name === "OperationError") showBanner("errOldLink");
    else showBanner("errLoad", error.message);
  }
  state.loaded = true;
  reparse();
  render();
}

const isOwner = () => !!state.secrets?.ownerKey;

// Save/hide marks are shared: read the latest copy, merge, write; retry on conflicts.
let marksTimer = null;
function saveMarksSoon() {
  clearTimeout(marksTimer);
  marksTimer = setTimeout(async () => {
    const {token, key} = state.secrets;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const latest = await Sync.readFile(token, Sync.FILES.state);
        if (latest) state.marks = Sync.mergeMarks(await Sync.decryptJson(key, latest.text), state.marks);
        state.marksSha = await Sync.writeFile(token, Sync.FILES.state, await Sync.encryptJson(key, state.marks),
          "update saved/hidden [skip ci]", latest?.sha);
        break;
      } catch (error) {
        if (attempt === 3) showBanner("errSave", error.message);
      }
    }
    reparse();
    render();
  }, 800);
}

async function writeSecrets(patch) {
  const next = {...state.secretsFile, ...patch};
  state.secretsSha = await Sync.writeEncrypted(state.secrets.token, state.secrets.ownerKey, Sync.FILES.secrets,
    next, "update private settings [skip ci]", state.secretsSha || undefined);
  state.secretsFile = next;
}

async function writeConfig(config) {
  state.configSha = await Sync.writeEncrypted(state.secrets.token, state.secrets.key, Sync.FILES.config,
    config, "update settings [skip ci]", state.configSha || undefined);
  state.config = withDefaults(config);
}

async function requestScan(mode) {
  await writeConfig({...state.config, scanRequest: {mode, at: Date.now()}});
  state.pendingRequest = {mode, at: Date.now()};
  render();
}

// ---------- rendering ----------

function chip(label, pressed, attrs = "") {
  return `<button type="button" class="chip" aria-pressed="${pressed}" ${attrs}>${icon("check")}<span>${esc(label)}</span></button>`;
}

function renderFilterChips() {
  $("fAreas").innerHTML = NEIGHBORHOOD_NAMES.map((name) =>
    chip(L.area(name), state.filters.areas.has(name), `data-area="${esc(name)}"`)).join("");
  $("fBonuses").innerHTML = BONUS_NAMES.map((name) =>
    chip(L.extra(name), state.filters.bonuses.has(name), `data-bonus="${esc(name)}"`)).join("");
}

function inTab(listing, tab) {
  if (tab === "hidden") return listing.hidden;
  if (listing.hidden) return false;
  if (tab === "saved") return listing.saved;
  if (tab === "all") return !listing.seeking;
  return listing.status === tab;
}

function activeFilterCount() {
  const f = state.filters;
  return (f.text ? 1 : 0) + (f.price ? 1 : 0) + (f.rooms ? 1 : 0) + f.areas.size + f.bonuses.size;
}

function passesFilters(listing) {
  const f = state.filters;
  if (f.text && !listing.text.toLowerCase().includes(f.text.toLowerCase())) return false;
  if (f.price && listing.price != null && listing.price > Number(f.price)) return false;
  if (f.rooms && listing.rooms != null && listing.rooms < Number(f.rooms)) return false;
  if (f.areas.size && !listing.neighborhoods.some((n) => f.areas.has(n))) return false;
  for (const bonus of f.bonuses) if (!listing.bonuses.includes(bonus)) return false;
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
  const status = {match: ["match", t("statusMatch")], review: ["review", t("statusReview")], rejected: ["rejected", t("statusRejected")]}[listing.status];
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
        <p class="excerpt${open ? " open" : ""}" dir="auto">${esc(listing.text)}</p>
        <button type="button" class="link-btn more" data-action="toggle-text" aria-expanded="${open}">${open ? t("readLess") : t("readMore")}</button>
      </div>
      <div class="foot">
        <span class="source" title="${esc(listing.sourceName)}" dir="auto">${esc(listing.sourceName || t("facebook"))}</span>
        <span class="actions">
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
  for (const tab of ["match", "review", "all", "saved", "hidden"]) {
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
  const tgDone = !isOwner() || !!(state.secretsFile.telegramToken && c.telegramChatId);
  $("onboarding").hidden = !state.loaded || (tgDone && c.enabled);
  $("stepTg").classList.toggle("done", tgDone);
  $("stepOn").classList.toggle("done", c.enabled);
  renderStatus();
  renderBanner();
}

function clearFilters() {
  state.filters = {...state.filters, text: "", price: "", rooms: "", areas: new Set(), bonuses: new Set()};
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
  const lines = [`extension ${p.version || "?"} · listings ${state.raw.length} · synced ${p.updatedAt ? new Date(p.updatedAt).toISOString() : "never"}`,
    `scan: ${scan.running ? "running" : "idle"} ${scan.mode || ""} · error: ${scan.lastError || "none"}`];
  for (const [url, d] of Object.entries(p.debug || {})) {
    lines.push("", `${(d.title || "").slice(0, 40)} ${url.replace("https://www.facebook.com/groups/", "g/")}`);
    lines.push(`  units ${d.units ?? "?"} · message-nodes ${d.withMessageNode ?? "?"} · links ${d.withPermalink ?? "?"} · posts ${d.posts ?? "?"} · unique ${d.unique ?? "?"}`);
    (d.samples || []).forEach((sample) => lines.push(`  > ${sample.replace(/\s+/g, " ").slice(0, 120)}`));
  }
  if (!Object.keys(p.debug || {}).length) lines.push("", t("noScanYet"));
  return lines.join("\n");
}

function personalLink() {
  const {token, key, ownerKey, name} = state.secrets;
  return Sync.appLink(token, key, {ownerKey, name});
}

function qrSvg(text) {
  if (!window.qrcode) return "";
  const qr = window.qrcode(0, "M");
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({cellSize: 4, margin: 3, scalable: true});
}

function renderMembers() {
  const members = state.secretsFile.members || [];
  $("members").innerHTML = members.length ? members.map((m, i) => `
    <div class="member">
      <div class="member-head"><b>${esc(m.name)}</b><span class="hint">${esc(t("memberAdded", L.timeAgo(m.at)))}</span></div>
      <div class="member-actions">
        <button type="button" class="btn ghost small" data-member-copy="${i}">${t("copyMemberLink")}</button>
        <button type="button" class="btn ghost small" data-member-qr="${i}">${t("showQr")}</button>
        <button type="button" class="btn ghost small danger" data-member-remove="${i}">${t("remove")}</button>
      </div>
      <div class="qr" id="memberQr${i}" hidden></div>
    </div>`).join("") : `<p class="hint">${t("noMembers")}</p>`;
}

function fillSettings() {
  const c = state.config;
  $("sToken").value = state.secretsFile.telegramToken || "";
  document.querySelectorAll("[data-owner-only]").forEach((el) => { el.hidden = !isOwner(); });
  renderMembers();
  $("sChat").value = c.telegramChatId;
  $("sAlertReview").checked = c.alertOnReview;
  $("sMaxPrice").value = c.criteria.maxPrice;
  $("sMinRooms").value = c.criteria.minRooms;
  $("sMinBaths").value = c.criteria.minBathrooms;
  $("sAreas").innerHTML = NEIGHBORHOOD_NAMES.map((name) =>
    chip(L.area(name), c.criteria.neighborhoods.includes(name), `data-setting-area="${esc(name)}"`)).join("");
  $("sGroups").value = c.groupUrls.join("\n");
  $("sInterval").value = c.intervalMinutes;
  $("sEnabled").checked = c.enabled;
  setSettingsStatus("");
  $("debugView").textContent = debugReport();
  const svg = qrSvg(personalLink());
  if (svg) $("qr").innerHTML = svg;
  else $("qr").textContent = t("qrFailed");
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
  const token = $("sToken").value.trim();
  if (token && !/^\d+:[\w-]{20,}$/.test(token)) throw new Error(t("badToken"));
  const chat = $("sChat").value.split(/[,\s]+/).filter(Boolean).join(", ");
  if (chat && !chat.split(", ").every((id) => /^-?\d+$/.test(id))) throw new Error(t("badChat"));
  const areas = [...$("sAreas").querySelectorAll('[aria-pressed="true"]')].map((b) => b.dataset.settingArea);
  return {
    ...state.config,
    telegramToken: token, // removed before saving; stored in the owner-only file
    telegramChatId: chat,
    alertOnReview: $("sAlertReview").checked,
    criteria: {
      maxPrice: Number($("sMaxPrice").value) || DEFAULT_CRITERIA.maxPrice,
      minRooms: Number($("sMinRooms").value) || 0,
      minBathrooms: Number($("sMinBaths").value) || 0,
      neighborhoods: areas,
    },
    groupUrls: groupUrls.slice(0, 60),
    intervalMinutes: Math.max(10, Number($("sInterval").value) || 20),
    enabled: $("sEnabled").checked,
  };
}

async function saveSettings(event) {
  event?.preventDefault();
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
  const {telegramToken, ...publicConfig} = config;
  try {
    await writeConfig(publicConfig);
    if (isOwner() && telegramToken !== (state.secretsFile.telegramToken || "")) await writeSecrets({telegramToken});
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

function tokenLinkFor(name) {
  const params = new URLSearchParams({
    name: `Apartment Hunter - ${name}`.slice(0, 40), description: "Shared apartment board",
    target_name: "Omerm14", expires_in: "none", contents: "write",
  });
  return `https://github.com/settings/personal-access-tokens/new?${params}`;
}

function setShareStatus(text, isError = false) {
  $("shareStatus").textContent = text;
  $("shareStatus").classList.toggle("err", isError);
}

async function addMember() {
  const name = $("mName").value.trim().slice(0, 30);
  const token = $("mToken").value.trim();
  if (!name) return setShareStatus(t("writeName"), true);
  if (!/^(github_pat_|ghp_)[A-Za-z0-9_]{20,}$/.test(token)) return setShareStatus(t("notGithubKey"), true);
  setShareStatus(t("checkingKey"));
  try {
    await Sync.checkToken(token);
  } catch (error) {
    return setShareStatus(error.status === 401 ? t("keyInvalid") : t("keyNoAccess", error.message), true);
  }
  const link = Sync.appLink(token, state.secrets.key, {name});
  const members = [...(state.secretsFile.members || []), {name, link, at: Date.now()}];
  try {
    await writeSecrets({members});
  } catch (error) {
    return setShareStatus(t("errSave", error.message), true);
  }
  $("mName").value = "";
  $("mToken").value = "";
  renderMembers();
  const index = members.length - 1;
  $(`memberQr${index}`).innerHTML = qrSvg(link);
  $(`memberQr${index}`).hidden = false;
  await copy(link);
  setShareStatus(t("memberReady", name));
}

async function memberAction(target) {
  const members = state.secretsFile.members || [];
  const index = Number(target.dataset.memberCopy ?? target.dataset.memberQr ?? target.dataset.memberRemove);
  const member = members[index];
  if (!member) return;
  if (target.dataset.memberCopy != null) {
    await copy(member.link);
    return setShareStatus(t("memberCopied", member.name));
  }
  if (target.dataset.memberQr != null) {
    const box = $(`memberQr${index}`);
    box.innerHTML = qrSvg(member.link);
    box.hidden = !box.hidden;
    return;
  }
  // Removing needs a second click on the same button instead of a browser dialog.
  if (target.dataset.confirming !== "1") {
    target.dataset.confirming = "1";
    target.textContent = t("confirmRemove", member.name);
    setTimeout(() => {
      if (!target.isConnected) return;
      target.dataset.confirming = "";
      target.textContent = t("remove");
    }, 4000);
    return;
  }
  try {
    await writeSecrets({members: members.filter((_, i) => i !== index)});
  } catch (error) {
    return setShareStatus(t("errSave", error.message), true);
  }
  renderMembers();
  setShareStatus(t("memberRemoved", member.name));
  window.open("https://github.com/settings/personal-access-tokens", "_blank", "noopener");
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
  if (target.dataset.memberCopy || target.dataset.memberQr || target.dataset.memberRemove) return memberAction(target);
  if (target.dataset.tab) { state.tab = target.dataset.tab; return render(); }
  if (target.dataset.area || target.dataset.bonus) {
    const set = target.dataset.area ? state.filters.areas : state.filters.bonuses;
    const value = target.dataset.area || target.dataset.bonus;
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
  const field = action === "save" ? "saved" : "hidden";
  state.marks.items[id] = {...previous, [field]: !previous[field], by: state.secrets.name || "", at: Date.now()};
  reparse();
  render();
  saveMarksSoon();
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
$("testTelegram").addEventListener("click", async () => {
  const token = $("sToken").value.trim();
  const chats = $("sChat").value.split(/[,\s]+/).filter(Boolean);
  if (!token || !chats.length) return setSettingsStatus(t("fillTelegramFirst"), true);
  setSettingsStatus(t("sending"));
  try {
    for (const chat of chats) {
      const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({chat_id: chat, text: `✅ ${t("telegramTestText")}`}),
      });
      const result = await response.json();
      if (!result.ok) throw new Error(`${chat}: ${result.description}`);
    }
    setSettingsStatus(t("telegramSent", chats.length));
  } catch (error) {
    setSettingsStatus(t("telegramError", error.message), true);
  }
});
$("addMember").addEventListener("click", addMember);
$("mName").addEventListener("input", () => {
  $("mTokenLink").href = tokenLinkFor($("mName").value.trim() || "partner");
});
$("copyLink").addEventListener("click", async () => {
  await copy(personalLink());
  setSettingsStatus(t("linkCopied"));
});
$("copyDebug").addEventListener("click", async () => {
  const text = debugReport();
  $("debugView").textContent = text;
  await copy(text);
  setSettingsStatus(t("reportCopied"));
});
$("logout").addEventListener("click", () => {
  try { localStorage.removeItem("hunter-secrets"); } catch {}
  location.reload();
});

const debounce = (fn, ms = 200) => { let timer; return (...a) => { clearTimeout(timer); timer = setTimeout(() => fn(...a), ms); }; };
$("fText").addEventListener("input", debounce((e) => { state.filters.text = e.target.value.trim(); render(); }));
$("fPrice").addEventListener("change", (e) => { state.filters.price = e.target.value; render(); });
$("fRooms").addEventListener("change", (e) => { state.filters.rooms = e.target.value; render(); });
$("fSort").addEventListener("change", (e) => { state.filters.sort = e.target.value; render(); });

// ---------- start ----------

L.apply();
state.secrets = readSecrets();
if (!state.secrets) {
  $("gate").hidden = false;
} else {
  $("app").hidden = false;
  renderFilterChips();
  render();
  refresh();
  setInterval(() => { if (!document.hidden) refresh(); }, REFRESH_MS);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
}
