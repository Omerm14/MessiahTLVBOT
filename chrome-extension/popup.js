const {parseListing, evaluate, DEFAULT_CRITERIA} = self.ApartmentParser;
const $ = (id) => document.getElementById(id);
const DAY = 24 * 60 * 60 * 1000;
const AREAS_EN = {
  "לב העיר": "Lev Ha'ir", "נווה צדק": "Neve Tzedek", "כרם התימנים": "Kerem HaTeimanim", "רוטשילד": "Rothschild",
  "פלורנטין": "Florentin", "הצפון הישן": "Old North", "הצפון החדש": "New North", "יפו": "Jaffa",
  "מונטיפיורי": "Montefiore", "שבזי / נגה": "Shabazi / Noga", "בבלי": "Bavli", "רמת אביב": "Ramat Aviv",
};
const areaName = (name) => (lang === "en" ? AREAS_EN[name] || name : name);

const STRINGS = {
  he: {
    appName: "Messiah TLV APT Hunter", newMatches: "התאמות היום", today: "פוסטים היום", groups: "קבוצות",
    latestMatch: "ההתאמה האחרונה", openBoard: "פתח את הלוח", scanNow: "סרוק עכשיו", stop: "עצור",
    notPaired: "התוסף עוד לא מחובר. חיבור חד־פעמי לוקח דקה.", connect: "חבר את התוסף", lang: "EN",
    scanning: (i, n) => `סורק · קבוצה ${i} מתוך ${n}`, last: (ago) => `סריקה אחרונה ${ago}`,
    off: "הניטור כבוי", never: "עוד לא רצה סריקה", rooms: "חד׳", perMonth: "לחודש",
    ago: (m) => m < 1 ? "עכשיו" : m < 60 ? `לפני ${m} דק׳` : m < 1440 ? `לפני ${Math.round(m / 60)} שע׳` : `לפני ${Math.round(m / 1440)} ימים`,
  },
  en: {
    appName: "Messiah TLV APT Hunter", newMatches: "Matches today", today: "Posts today", groups: "Groups",
    latestMatch: "Latest match", openBoard: "Open board", scanNow: "Scan now", stop: "Stop",
    notPaired: "The extension isn't connected yet. The one-time setup takes a minute.", connect: "Connect", lang: "עב",
    scanning: (i, n) => `Scanning · group ${i} of ${n}`, last: (ago) => `Last scan ${ago}`,
    off: "Monitoring is off", never: "No scan yet", rooms: "rooms", perMonth: "/ month",
    ago: (m) => m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`,
  },
};
let lang = "he";
const t = (key, ...args) => {
  const value = STRINGS[lang][key];
  return typeof value === "function" ? value(...args) : value;
};
const ago = (ms) => t("ago", Math.round((Date.now() - ms) / 60000));

function applyLang() {
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === "he" ? "rtl" : "ltr";
  document.querySelectorAll("[data-t]").forEach((el) => { el.textContent = t(el.dataset.t); });
  $("lang").textContent = t("lang");
  $("lang").setAttribute("aria-label", lang === "he" ? "Switch to English" : "עבור לעברית");
}

function setStatus(dot, text) {
  const el = $("status");
  el.firstElementChild.className = `dot ${dot}`;
  el.lastElementChild.textContent = text;
}

async function render() {
  const status = await chrome.runtime.sendMessage({type: "status"}).catch(() => null);
  const {listings = {}, config = {}} = await chrome.storage.local.get(["listings", "config"]);
  applyLang();
  $("paired").hidden = !status?.paired;
  $("unpaired").hidden = !!status?.paired;
  if (!status?.paired) return setStatus("", t("never"));

  const scan = status.scan || {};
  const criteria = {...DEFAULT_CRITERIA, ...(config.criteria || {})};
  const today = Object.values(listings).filter((l) => Date.now() - l.firstSeen < DAY && !l.fromBackfill);
  const matches = today
    .map((l) => ({...l, ...parseListing(l.text, l.url)}))
    .map((l) => ({...l, ...evaluate(l, criteria)}))
    .filter((l) => l.status === "match")
    .sort((a, b) => b.firstSeen - a.firstSeen);
  const fmt = (n) => n.toLocaleString(lang === "en" ? "en-US" : "he-IL");
  $("sMatches").textContent = fmt(matches.length);
  $("sToday").textContent = fmt(today.length);
  $("sGroups").textContent = fmt((config.groupUrls || []).length);

  const latest = matches[0];
  $("latest").hidden = !latest;
  if (latest) {
    const price = latest.price != null ? (lang === "en" ? `₪${fmt(latest.price)}` : `${fmt(latest.price)} ₪`) : "";
    $("latestPrice").textContent = `${price} ${price ? t("perMonth") : ""}`.trim();
    $("latestMeta").textContent = [latest.rooms != null ? `${latest.rooms} ${t("rooms")}` : "", areaName(latest.neighborhoods[0] || ""), ago(latest.firstSeen)]
      .filter(Boolean).join(" · ");
    $("latest").href = /^https:\/\//.test(latest.url || "") ? latest.url : latest.source;
  }

  $("scan").hidden = !!scan.running;
  $("stop").hidden = !scan.running;
  $("progress").hidden = !scan.running;
  $("error").hidden = !(scan.lastError || status.syncError) || scan.running;
  $("error").textContent = scan.lastError || status.syncError || "";
  if (scan.running) {
    setStatus("live", t("scanning", Math.min((scan.groupIndex || 0) + 1, scan.total || 1), scan.total || "?"));
    $("bar").style.transform = `scaleX(${Math.min(1, (scan.groupIndex || 0) / Math.max(scan.total || 1, 1))})`;
  } else if (scan.lastError) {
    setStatus("err", scan.lastRun ? t("last", ago(scan.lastRun)) : t("never"));
  } else if (scan.lastRun) {
    setStatus(config.enabled ? "ok" : "", t("last", ago(scan.lastRun)) + (config.enabled ? "" : ` · ${t("off")}`));
  } else {
    setStatus("", config.enabled ? t("never") : t("off"));
  }
}

$("open").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({type: "open-app"});
  window.close();
});
$("pair").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({type: "open-app"});
  window.close();
});
$("scan").addEventListener("click", async () => {
  $("scan").disabled = true;
  await chrome.runtime.sendMessage({type: "scan-now"});
  setTimeout(() => { $("scan").disabled = false; render(); }, 800);
});
$("stop").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({type: "stop-scan"});
  render();
});
$("lang").addEventListener("click", async () => {
  lang = lang === "he" ? "en" : "he";
  await chrome.storage.local.set({uiLang: lang});
  render();
});

chrome.storage.local.get("uiLang").then(({uiLang}) => {
  lang = uiLang === "en" ? "en" : "he";
  render();
});
chrome.storage.onChanged.addListener((changes) => { if (changes.scan || changes.listings) render(); });
