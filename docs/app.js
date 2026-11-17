const {parseListing, evaluate, DEFAULT_CRITERIA, NEIGHBORHOOD_NAMES} = window.ApartmentParser;
const Sync = window.HunterSync;
const $ = (id) => document.getElementById(id);
const BONUS_NAMES = ["חניה", "מרפסת", "ממ״ד", "מעלית", "משופצת", "מרוהטת", "חיות"];
const NEW_WINDOW_MS = 24 * 60 * 60 * 1000;
const REFRESH_MS = 60 * 1000;

const DEFAULT_CONFIG = {
  enabled: false, groupUrls: DEFAULT_GROUP_URLS, intervalMinutes: 20, telegramToken: "",
  telegramChatId: "", criteria: DEFAULT_CRITERIA, alertOnReview: false, scanRequest: null,
};

const state = {
  secrets: null,
  tab: "match",
  raw: [],            // listings as uploaded by the extension
  listings: {},       // id -> parsed listing
  payload: {},        // listings file: scan status, debug, version
  config: DEFAULT_CONFIG,
  configSha: "",
  listingsSha: "",
  user: {saved: {}, hidden: {}},
  userSha: "",
  filters: {text: "", price: "", rooms: "", sort: "new", areas: new Set(), bonuses: new Set()},
  openTexts: new Set(),
};

// ---------- helpers ----------

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
}
const safeUrl = (url) => (/^https:\/\//i.test(url || "") ? url : "");

function timeAgo(ms) {
  if (!ms) return "";
  const minutes = Math.round((Date.now() - ms) / 60000);
  if (minutes < 1) return "עכשיו";
  if (minutes < 60) return `לפני ${minutes} דק׳`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `לפני ${hours} שע׳`;
  const days = Math.round(hours / 24);
  return days === 1 ? "אתמול" : `לפני ${days} ימים`;
}

function withDefaults(config) {
  return {...DEFAULT_CONFIG, ...(config || {}), criteria: {...DEFAULT_CRITERIA, ...(config?.criteria || {})}};
}

function showBanner(text, isError = true) {
  $("banner").textContent = text;
  $("banner").classList.toggle("ok", !isError);
  $("banner").hidden = !text;
}

// ---------- secrets ----------

function readSecrets() {
  const hash = new URLSearchParams(location.hash.slice(1));
  if (hash.get("t") && hash.get("k")) {
    const secrets = {token: hash.get("t"), key: hash.get("k")};
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
      saved: !!state.user.saved[raw.id], hidden: !!state.user.hidden[raw.id],
    };
  }
  state.listings = listings;
}

async function refresh() {
  const {token, key} = state.secrets;
  try {
    const [configFile, listingsFile, userFile] = await Promise.all([
      Sync.readFile(token, Sync.FILES.config),
      Sync.readFile(token, Sync.FILES.listings),
      Sync.readFile(token, Sync.FILES.state),
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
    if (userFile && userFile.sha !== state.userSha && !userWriteTimer) {
      state.user = {saved: {}, hidden: {}, ...(await Sync.decryptJson(key, userFile.text))};
      state.userSha = userFile.sha;
    }
    showBanner("");
  } catch (error) {
    if (error.status === 401) showBanner("המפתח של GitHub לא תקף יותר. צור מפתח חדש ולחץ על אייקון התוסף במחשב.");
    else if (error.name === "OperationError") showBanner("הקישור הזה שייך להתקנה ישנה. פתח את האפליקציה מאייקון התוסף במחשב.");
    else showBanner(`לא הצלחתי לטעון נתונים: ${error.message}`);
  }
  reparse();
  render();
}

let userWriteTimer = null;
function saveUserSoon() {
  clearTimeout(userWriteTimer);
  userWriteTimer = setTimeout(async () => {
    try {
      state.userSha = await Sync.writeEncrypted(state.secrets.token, state.secrets.key, Sync.FILES.state,
        state.user, "update saved/hidden [skip ci]", state.userSha || undefined);
    } catch (error) {
      showBanner(`השמירה נכשלה: ${error.message}`);
    }
    userWriteTimer = null;
  }, 1200);
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
  return `<button type="button" class="chip" aria-pressed="${pressed}" ${attrs}>${esc(label)}</button>`;
}

function renderFilterChips() {
  $("fAreas").innerHTML = NEIGHBORHOOD_NAMES.map((name) =>
    chip(name, state.filters.areas.has(name), `data-area="${esc(name)}"`)).join("");
  $("fBonuses").innerHTML = BONUS_NAMES.map((name) =>
    chip(`✓ ${name}`, state.filters.bonuses.has(name), `data-bonus="${esc(name)}"`)).join("");
}

function inTab(listing, tab) {
  if (tab === "hidden") return listing.hidden;
  if (listing.hidden) return false;
  if (tab === "saved") return listing.saved;
  if (tab === "all") return !listing.seeking;
  return listing.status === tab;
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
  const area = listing.neighborhoods[0] || "תל אביב";
  const isNew = Date.now() - listing.firstSeen < NEW_WINDOW_MS && !listing.fromBackfill;
  const statusBadge = {match: ["match", "מתאימה"], review: ["review", "חסרים פרטים"], rejected: ["", "לא מתאימה"]}[listing.status];
  const open = state.openTexts.has(listing.id);
  const spec = (value, unit) => value != null
    ? `<span>${esc(value)} ${unit}</span>` : `<span class="unknown">? ${unit}</span>`;
  return `
    <article class="card" data-id="${esc(listing.id)}">
      <div class="media">
        ${image ? `<img src="${esc(image)}" alt="" loading="lazy" referrerpolicy="no-referrer" data-fallback>` : ""}
        <div class="placeholder" ${image ? "hidden" : ""}>${esc(area)}</div>
        <span class="badge ${statusBadge[0]}">${statusBadge[1]}</span>
        ${isNew ? `<span class="badge new">חדש</span>` : ""}
      </div>
      <div class="body">
        <div class="price">${listing.price != null ? `${listing.price.toLocaleString("he-IL")} ₪ <small>לחודש</small>` : `<small>מחיר לא צוין</small>`}</div>
        <div class="specs">${spec(listing.rooms, "חדרים")}${spec(listing.bathrooms, "שירותים")}</div>
        <div class="tags">
          ${listing.neighborhoods.map((n) => `<span class="tag area">${esc(n)}</span>`).join("")}
          ${listing.bonuses.map((b) => `<span class="tag">${esc(b)}</span>`).join("")}
        </div>
        <p class="excerpt ${open ? "open" : ""}">${esc(listing.text)}</p>
        <button class="more" data-action="toggle-text">${open ? "הצג פחות" : "קרא עוד"}</button>
        ${listing.status !== "match" ? `<p class="reasons">${esc(listing.reasons.join(" · "))}</p>` : ""}
      </div>
      <div class="foot">
        <span class="source" title="${esc(listing.sourceName)}">${esc(listing.sourceName || "פייסבוק")} · ${esc(listing.postedLabel || timeAgo(listing.firstSeen))}</span>
        <span class="actions">
          <button data-action="save" class="${listing.saved ? "saved" : ""}" title="שמור" aria-label="שמור">${listing.saved ? "★" : "☆"}</button>
          <button data-action="hide" title="${listing.hidden ? "החזר" : "הסתר"}" aria-label="${listing.hidden ? "החזר" : "הסתר"}">${listing.hidden ? "↺" : "✕"}</button>
          ${link ? `<a class="open" href="${esc(link)}" target="_blank" rel="noopener noreferrer">לפוסט ↗</a>` : ""}
        </span>
      </div>
    </article>`;
}

function renderStatus() {
  const scan = state.payload.scan || {};
  const el = $("scanStatus");
  const pending = state.pendingRequest && state.pendingRequest.at > (scan.startedAt || 0) && Date.now() - state.pendingRequest.at < 5 * 60000;
  $("stopScan").hidden = !scan.running;
  $("scanNow").disabled = !!scan.running || !!pending;
  $("progress").hidden = !scan.running;
  const synced = state.payload.updatedAt ? ` · עודכן ${timeAgo(state.payload.updatedAt)}` : "";
  if (pending && !scan.running) {
    el.innerHTML = `<span class="dot live"></span>${state.pendingRequest.mode === "stop" ? "עוצר…" : "ממתין שהמחשב יתחיל לסרוק (עד דקה)…"}`;
  } else if (scan.running) {
    const label = scan.mode === "backfill" ? "סורק שבועיים אחורה" : "סורק";
    el.innerHTML = `<span class="dot live"></span>${label} · קבוצה ${Math.min((scan.groupIndex || 0) + 1, scan.total || 1)} מתוך ${scan.total || "?"}${synced}`;
    $("progressBar").style.width = `${Math.round(((scan.groupIndex || 0) / Math.max(scan.total || 1, 1)) * 100)}%`;
  } else if (scan.lastError) {
    el.innerHTML = `<span class="dot err"></span>${esc(scan.lastError)}${synced}`;
  } else if (scan.lastRun) {
    const next = state.config.enabled ? "" : " · הניטור כבוי";
    el.innerHTML = `<span class="dot"></span>סריקה אחרונה ${esc(timeAgo(scan.lastRun))} · ${scan.lastCounts?.new ?? 0} חדשות${next}`;
  } else {
    el.innerHTML = `<span class="dot"></span>${state.config.enabled ? "הסריקה הראשונה תתחיל כשהמחשב יהיה ער ו־Chrome פתוח" : "הניטור כבוי — פתח הגדרות כדי להתחיל"}`;
  }
}

function render() {
  const all = Object.values(state.listings);
  for (const tab of ["match", "review", "all", "saved", "hidden"]) {
    $(`count-${tab}`).textContent = all.filter((l) => inTab(l, tab)).length;
  }
  document.querySelectorAll(".tabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === state.tab));
  const visible = sortListings(all.filter((l) => inTab(l, state.tab) && passesFilters(l)));
  $("grid").innerHTML = visible.slice(0, 400).map(card).join("");
  $("grid").querySelectorAll("img[data-fallback]").forEach((img) => {
    img.addEventListener("error", () => { img.nextElementSibling?.removeAttribute("hidden"); img.remove(); }, {once: true});
  });
  $("resultLine").textContent = visible.length ? `${visible.length} דירות` : "";
  $("empty").hidden = visible.length > 0;
  $("emptyText").textContent = all.length
    ? "אין דירות שמתאימות לסינון הזה."
    : state.payload.scan?.running ? "הסריקה רצה — הדירות יופיעו כאן בהמשך." : "עדיין אין כאן דירות.";
  const c = state.config;
  const tgDone = !!(c.telegramToken && c.telegramChatId);
  $("onboarding").hidden = tgDone && c.enabled;
  $("stepTg").classList.toggle("done", tgDone);
  $("stepOn").classList.toggle("done", c.enabled);
  renderStatus();
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
  if (!Object.keys(p.debug || {}).length) lines.push("", "עדיין לא רצה סריקה.");
  return lines.join("\n");
}

function personalLink() {
  return Sync.appLink(state.secrets.token, state.secrets.key);
}

function fillSettings() {
  const c = state.config;
  $("sToken").value = c.telegramToken;
  $("sChat").value = c.telegramChatId;
  $("sAlertReview").checked = c.alertOnReview;
  $("sMaxPrice").value = c.criteria.maxPrice;
  $("sMinRooms").value = c.criteria.minRooms;
  $("sMinBaths").value = c.criteria.minBathrooms;
  $("sAreas").innerHTML = NEIGHBORHOOD_NAMES.map((name) =>
    chip(name, c.criteria.neighborhoods.includes(name), `data-setting-area="${esc(name)}"`)).join("");
  $("sGroups").value = c.groupUrls.join("\n");
  $("sInterval").value = c.intervalMinutes;
  $("sEnabled").checked = c.enabled;
  $("settingsStatus").textContent = "";
  $("debugView").textContent = debugReport();
  if (window.qrcode) {
    const qr = window.qrcode(0, "M");
    qr.addData(personalLink());
    qr.make();
    $("qr").innerHTML = qr.createSvgTag({cellSize: 4, margin: 3, scalable: true});
  } else {
    $("qr").textContent = "לא הצלחתי לטעון את הברקוד — השתמש ב״העתק קישור אישי״.";
  }
}

function openSettings() {
  fillSettings();
  $("settings").hidden = false;
  $("scrim").hidden = false;
}

function closeSettings() {
  $("settings").hidden = true;
  $("scrim").hidden = true;
}

function setSettingsStatus(text, isError = false) {
  $("settingsStatus").textContent = text;
  $("settingsStatus").classList.toggle("err", isError);
}

function readSettings() {
  const groupUrls = $("sGroups").value.split("\n").map((s) => s.trim()).filter(Boolean);
  const bad = groupUrls.find((url) => !/^https:\/\/(www\.)?facebook\.com\/groups\//i.test(url));
  if (bad) throw new Error(`קישור לא תקין: ${bad}`);
  const token = $("sToken").value.trim();
  if (token && !/^\d+:[\w-]{20,}$/.test(token)) throw new Error("הטוקן של הבוט לא נראה תקין");
  const chat = $("sChat").value.trim();
  if (chat && !/^-?\d+$/.test(chat)) throw new Error("מזהה הצ׳אט צריך להיות מספר");
  const areas = [...$("sAreas").querySelectorAll('[aria-pressed="true"]')].map((b) => b.dataset.settingArea);
  return {
    ...state.config,
    telegramToken: token,
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
  setSettingsStatus("שומר…");
  try {
    await writeConfig(config);
  } catch (error) {
    setSettingsStatus(`השמירה נכשלה: ${error.message}`, true);
    return false;
  }
  reparse();
  render();
  setSettingsStatus(config.enabled
    ? "נשמר ✓ המחשב יקבל את ההגדרות תוך כדקה."
    : "נשמר ✓ הניטור כבוי.");
  return true;
}

// ---------- events ----------

document.addEventListener("click", async (event) => {
  const target = event.target.closest("button, a");
  if (!target) return;
  if (target.matches("[data-open-settings]")) return openSettings();
  if (target.dataset.tab) { state.tab = target.dataset.tab; return render(); }
  if (target.dataset.area || target.dataset.bonus) {
    const set = target.dataset.area ? state.filters.areas : state.filters.bonuses;
    const value = target.dataset.area || target.dataset.bonus;
    set.has(value) ? set.delete(value) : set.add(value);
    renderFilterChips();
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
  const bucket = action === "save" ? state.user.saved : state.user.hidden;
  if (bucket[id]) delete bucket[id];
  else bucket[id] = Date.now();
  reparse();
  render();
  saveUserSoon();
});

$("openSettings").addEventListener("click", openSettings);
$("closeSettings").addEventListener("click", closeSettings);
$("scrim").addEventListener("click", closeSettings);
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeSettings(); });
$("settingsForm").addEventListener("submit", saveSettings);
$("scanNow").addEventListener("click", () => requestScan("quick").catch((e) => showBanner(e.message)));
$("stopScan").addEventListener("click", () => requestScan("stop").catch((e) => showBanner(e.message)));
$("backfill").addEventListener("click", async () => {
  if (!(await saveSettings())) return;
  await requestScan("backfill");
  setSettingsStatus("ביקשתי סריקה של שבועיים אחורה. המחשב יתחיל תוך כדקה.");
});
$("testTelegram").addEventListener("click", async () => {
  const token = $("sToken").value.trim();
  const chat = $("sChat").value.trim();
  if (!token || !chat) return setSettingsStatus("מלא קודם טוקן ומזהה צ׳אט", true);
  setSettingsStatus("שולח…");
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({chat_id: chat, text: "✅ החיבור עובד! כאן יגיעו התראות על דירות חדשות."}),
    });
    const result = await response.json();
    if (!result.ok) throw new Error(result.description);
    setSettingsStatus("נשלחה הודעה — בדוק בטלגרם ✓ (אל תשכח ללחוץ שמור)");
  } catch (error) {
    setSettingsStatus(`טלגרם החזיר שגיאה: ${error.message}`, true);
  }
});
$("copyLink").addEventListener("click", async () => {
  await navigator.clipboard.writeText(personalLink()).catch(() => {});
  setSettingsStatus("הקישור הועתק.");
});
$("copyDebug").addEventListener("click", async () => {
  const text = debugReport();
  $("debugView").textContent = text;
  await navigator.clipboard.writeText(text).catch(() => {});
  setSettingsStatus("הדוח הועתק — הדבק אותו בצ׳אט.");
});
$("logout").addEventListener("click", () => {
  try { localStorage.removeItem("hunter-secrets"); } catch {}
  location.reload();
});

const debounce = (fn, ms = 200) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
$("fText").addEventListener("input", debounce((e) => { state.filters.text = e.target.value.trim(); render(); }));
$("fPrice").addEventListener("input", debounce((e) => { state.filters.price = e.target.value; render(); }));
$("fRooms").addEventListener("change", (e) => { state.filters.rooms = e.target.value; render(); });
$("fSort").addEventListener("change", (e) => { state.filters.sort = e.target.value; render(); });

// ---------- start ----------

state.secrets = readSecrets();
if (!state.secrets) {
  $("gate").hidden = false;
} else {
  $("app").hidden = false;
  if (matchMedia("(max-width: 640px)").matches) $("filtersWrap").open = false;
  renderFilterChips();
  render();
  refresh();
  setInterval(() => { if (!document.hidden) refresh(); }, REFRESH_MS);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
}
