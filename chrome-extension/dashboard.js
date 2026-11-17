const {DEFAULT_CRITERIA, NEIGHBORHOOD_NAMES} = window.ApartmentParser;
const $ = (id) => document.getElementById(id);
const BONUS_NAMES = ["חניה", "מרפסת", "ממ״ד", "מעלית", "משופצת", "מרוהטת", "חיות"];
const NEW_WINDOW_MS = 24 * 60 * 60 * 1000;

const state = {
  tab: "match",
  listings: {},
  config: null,
  scan: {},
  filters: {text: "", price: "", rooms: "", sort: "new", areas: new Set(), bonuses: new Set()},
  openTexts: new Set(),
};

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
}

function safeUrl(url) {
  return /^https:\/\//i.test(url || "") ? url : "";
}

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
  return {
    enabled: false, groupUrls: DEFAULT_GROUP_URLS, intervalMinutes: 20, telegramToken: "",
    telegramChatId: "", alertOnReview: false, backfillDone: false,
    ...(config || {}), criteria: {...DEFAULT_CRITERIA, ...(config?.criteria || {})},
  };
}

async function load() {
  const data = await chrome.storage.local.get(["listings", "config", "scan"]);
  state.listings = data.listings || {};
  state.config = withDefaults(data.config);
  state.scan = data.scan || {};
  render();
}

// ---------- Rendering ----------

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
          <button data-action="save" class="${listing.saved ? "saved" : ""}" title="שמור">${listing.saved ? "★" : "☆"}</button>
          <button data-action="hide" title="${listing.hidden ? "החזר" : "הסתר"}">${listing.hidden ? "↺" : "✕"}</button>
          ${link ? `<a class="open" href="${esc(link)}" target="_blank" rel="noopener noreferrer">לפוסט ↗</a>` : ""}
        </span>
      </div>
    </article>`;
}

function renderStatus() {
  const scan = state.scan;
  const el = $("scanStatus");
  const bar = $("progress");
  $("stopScan").hidden = !scan.running;
  $("scanNow").disabled = !!scan.running;
  if (scan.running) {
    const label = scan.mode === "backfill" ? "סורק שבועיים אחורה" : "סורק";
    el.innerHTML = `<span class="dot live"></span>${label} · קבוצה ${Math.min((scan.groupIndex || 0) + 1, scan.total || 1)} מתוך ${scan.total || "?"} · נמצאו ${scan.counts?.new || 0} חדשות`;
    bar.hidden = false;
    $("progressBar").style.width = `${Math.round(((scan.groupIndex || 0) / Math.max(scan.total || 1, 1)) * 100)}%`;
  } else {
    bar.hidden = true;
    if (scan.lastError) {
      el.innerHTML = `<span class="dot err"></span>${esc(scan.lastError)}`;
    } else if (scan.lastRun) {
      const next = state.config.enabled ? ` · הבאה בעוד כ־${state.config.intervalMinutes} דק׳` : " · הניטור כבוי";
      el.innerHTML = `<span class="dot"></span>סריקה אחרונה ${esc(timeAgo(scan.lastRun))} · ${scan.lastCounts?.new ?? 0} חדשות${next}`;
    } else {
      el.innerHTML = `<span class="dot"></span>${state.config.enabled ? "הסריקה הראשונה תתחיל בקרוב" : "הניטור כבוי — פתח הגדרות כדי להתחיל"}`;
    }
  }
}

function renderOnboarding() {
  const c = state.config;
  const tgDone = !!(c.telegramToken && c.telegramChatId);
  $("onboarding").hidden = tgDone && c.enabled;
  $("stepTg").classList.toggle("done", tgDone);
  $("stepOn").classList.toggle("done", c.enabled);
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
    img.addEventListener("error", () => { img.remove(); img.nextElementSibling?.removeAttribute("hidden"); }, {once: true});
  });
  $("resultLine").textContent = visible.length ? `${visible.length} דירות` : "";
  $("empty").hidden = visible.length > 0;
  $("emptyText").textContent = all.length
    ? "אין דירות שמתאימות לסינון הזה."
    : state.scan.running ? "הסריקה רצה — הדירות יופיעו כאן תוך כמה דקות." : "עדיין אין כאן דירות. הפעל ניטור בהגדרות.";
  renderStatus();
  renderOnboarding();
}

// ---------- Settings ----------

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
}

async function debugReport() {
  const {debug = {}, scan = {}} = await chrome.storage.local.get(["debug", "scan"]);
  const lines = [`version ${chrome.runtime.getManifest().version} · listings ${Object.keys(state.listings).length}`,
    `scan: ${scan.running ? "running" : "idle"} ${scan.mode || ""} · error: ${scan.lastError || "none"}`];
  for (const [url, d] of Object.entries(debug)) {
    lines.push("", `${(d.title || "").slice(0, 40)} ${url.replace("https://www.facebook.com/groups/", "g/")}`);
    lines.push(`  units ${d.units ?? "?"} · message-nodes ${d.withMessageNode ?? "?"} · links ${d.withPermalink ?? "?"} · posts ${d.posts ?? "?"} · unique ${d.unique ?? "?"}`);
    (d.samples || []).forEach((sample) => lines.push(`  > ${sample.replace(/\s+/g, " ").slice(0, 120)}`));
  }
  if (!Object.keys(debug).length) lines.push("", "עדיין לא רצה סריקה.");
  return lines.join("\n");
}

async function openSettings() {
  $("debugView").textContent = await debugReport();
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
  if (token && !/^\d+:[\w-]{20,}$/.test(token)) throw new Error("הטוקן לא נראה תקין");
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
  const criteriaChanged = JSON.stringify(config.criteria) !== JSON.stringify(state.config.criteria);
  await chrome.storage.local.set({config});
  state.config = config;
  if (criteriaChanged) await chrome.runtime.sendMessage({type: "reevaluate"});
  const firstRun = config.enabled && !config.backfillDone;
  setSettingsStatus(firstRun ? "נשמר! הסריקה הראשונה (שבועיים אחורה) מתחילה עכשיו." : "נשמר.");
  return true;
}

// ---------- Events ----------

document.addEventListener("click", async (event) => {
  const target = event.target.closest("button, a");
  if (!target) return;
  if (target.matches("[data-open-settings]")) return openSettings();
  if (target.dataset.tab) { state.tab = target.dataset.tab; return render(); }
  if (target.dataset.area) {
    const set = state.filters.areas;
    set.has(target.dataset.area) ? set.delete(target.dataset.area) : set.add(target.dataset.area);
    renderFilterChips();
    return render();
  }
  if (target.dataset.bonus) {
    const set = state.filters.bonuses;
    set.has(target.dataset.bonus) ? set.delete(target.dataset.bonus) : set.add(target.dataset.bonus);
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
  const listing = state.listings[id];
  if (action === "save") listing.saved = !listing.saved;
  if (action === "hide") listing.hidden = !listing.hidden;
  await chrome.storage.local.set({listings: state.listings});
});

$("openSettings").addEventListener("click", openSettings);
$("closeSettings").addEventListener("click", closeSettings);
$("scrim").addEventListener("click", closeSettings);
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeSettings(); });
$("settingsForm").addEventListener("submit", saveSettings);
$("scanNow").addEventListener("click", () => chrome.runtime.sendMessage({type: "scan"}));
$("stopScan").addEventListener("click", () => chrome.runtime.sendMessage({type: "stop"}));
$("backfill").addEventListener("click", async () => {
  if (await saveSettings()) {
    await chrome.runtime.sendMessage({type: "scan", mode: "backfill"});
    setSettingsStatus("סריקת שבועיים התחילה. אפשר לסגור את ההגדרות.");
  }
});
$("copyDebug").addEventListener("click", async () => {
  const text = await debugReport();
  $("debugView").textContent = text;
  await navigator.clipboard.writeText(text).catch(() => {});
  setSettingsStatus("הדוח הועתק — הדבק אותו בצ׳אט.");
});
$("testTelegram").addEventListener("click", async () => {
  if (!(await saveSettings())) return;
  setSettingsStatus("שולח…");
  const result = await chrome.runtime.sendMessage({type: "test-telegram"});
  setSettingsStatus(result?.ok ? "נשלחה הודעה — בדוק בטלגרם ✓" : `טלגרם החזיר שגיאה: ${result?.error || "לא ידוע"}`, !result?.ok);
});

const debounce = (fn, ms = 200) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
$("fText").addEventListener("input", debounce((e) => { state.filters.text = e.target.value.trim(); render(); }));
$("fPrice").addEventListener("input", debounce((e) => { state.filters.price = e.target.value; render(); }));
$("fRooms").addEventListener("change", (e) => { state.filters.rooms = e.target.value; render(); });
$("fSort").addEventListener("change", (e) => { state.filters.sort = e.target.value; render(); });

chrome.storage.onChanged.addListener((changes) => {
  if (changes.listings) state.listings = changes.listings.newValue || {};
  if (changes.config) state.config = withDefaults(changes.config.newValue);
  if (changes.scan) state.scan = changes.scan.newValue || {};
  render();
});
setInterval(renderStatus, 30000);

renderFilterChips();
load();
