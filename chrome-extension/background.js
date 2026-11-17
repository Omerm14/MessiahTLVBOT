importScripts("default-groups.js", "parser.js", "sync.js");

const {parseListing, evaluate, DEFAULT_CRITERIA} = self.ApartmentParser;
const Sync = self.HunterSync;

// Settings are edited in the web app and synced from the repository.
const DEFAULT_CONFIG = {
  enabled: false,
  groupUrls: DEFAULT_GROUP_URLS,
  intervalMinutes: 20,
  telegramToken: "",
  telegramChatId: "",
  criteria: DEFAULT_CRITERIA,
  alertOnReview: false,
  scanRequest: null,
};
const MAX_ALERTS_FROM_BACKFILL = 15;
const KEEP_DAYS = 45;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------- local state ----------

async function local(keys) {
  return chrome.storage.local.get(keys);
}

async function getConfig() {
  const {config} = await local("config");
  return {...DEFAULT_CONFIG, ...(config || {}), criteria: {...DEFAULT_CRITERIA, ...(config?.criteria || {})}};
}

async function getMeta() {
  const {meta} = await local("meta");
  return {backfillDone: false, lastScanRequestAt: 0, configSha: "", listingsSha: "", ...(meta || {})};
}

async function setMeta(patch) {
  await chrome.storage.local.set({meta: {...(await getMeta()), ...patch}});
}

async function getScan() {
  const {scan} = await local("scan");
  return scan || {running: false};
}

async function setScan(patch) {
  const scan = {...(await getScan()), ...patch};
  await chrome.storage.local.set({scan});
  return scan;
}

async function getPairing() {
  const {pairing} = await local("pairing");
  return pairing || null;
}

// Scanning rules come from the web app so Facebook layout changes can be fixed
// without reinstalling. The packaged copy is the fallback.
async function getRules() {
  try {
    const response = await fetch(`${Sync.APP_URL}rules.json?t=${Date.now()}`, {cache: "no-store"});
    if (response.ok) {
      const rules = await response.json();
      await chrome.storage.local.set({rules});
      return rules;
    }
  } catch {}
  const {rules} = await local("rules");
  if (rules) return rules;
  return (await fetch(chrome.runtime.getURL("rules.json"))).json();
}

// ---------- sync with the web app ----------

async function pullConfig() {
  const pairing = await getPairing();
  if (!pairing) return null;
  const file = await Sync.readFile(pairing.githubToken, Sync.FILES.config);
  if (!file) return null;
  const meta = await getMeta();
  if (file.sha !== meta.configSha) {
    const config = await Sync.decryptJson(pairing.key, file.text);
    await chrome.storage.local.set({config});
    await setMeta({configSha: file.sha});
    await schedule();
  }
  return getConfig();
}

let pushing = Promise.resolve();
function pushListings() {
  pushing = pushing.then(doPushListings, doPushListings);
  return pushing;
}

async function doPushListings() {
  const pairing = await getPairing();
  if (!pairing) return;
  const {listings = {}, debug = {}, scan = {}} = await local(["listings", "debug", "scan"]);
  const cutoff = Date.now() - KEEP_DAYS * 86400000;
  const kept = Object.values(listings).filter((l) => (l.lastSeen || l.firstSeen) >= cutoff);
  const {pendingAlerts, tabId, windowId, ...scanStatus} = scan;
  const payload = {
    updatedAt: Date.now(),
    version: chrome.runtime.getManifest().version,
    scan: scanStatus,
    debug,
    listings: kept.map((l) => ({
      id: l.id, text: l.text.slice(0, 3000), url: l.url, author: l.author, image: l.image,
      postedLabel: l.postedLabel, source: l.source, sourceName: l.sourceName,
      firstSeen: l.firstSeen, lastSeen: l.lastSeen, fromBackfill: l.fromBackfill,
    })),
  };
  const meta = await getMeta();
  try {
    const sha = await Sync.writeEncrypted(pairing.githubToken, pairing.key, Sync.FILES.listings, payload,
      `update listings (${kept.length}) [skip ci]`, meta.listingsSha || undefined);
    await setMeta({listingsSha: sha});
    await chrome.storage.local.set({syncError: ""});
  } catch (error) {
    await chrome.storage.local.set({syncError: `GitHub: ${error.message}`});
  }
}

async function schedule() {
  const config = await getConfig();
  await chrome.alarms.clear("scan");
  if (config.enabled) {
    chrome.alarms.create("scan", {delayInMinutes: 1, periodInMinutes: Math.max(10, Number(config.intervalMinutes) || 20)});
  }
  chrome.alarms.create("watchdog", {periodInMinutes: 1});
}

// ---------- Telegram ----------

async function telegram(config, text) {
  if (!config.telegramToken || !config.telegramChatId) return false;
  const response = await fetch(`https://api.telegram.org/bot${config.telegramToken}/sendMessage`, {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({chat_id: config.telegramChatId, text, disable_web_page_preview: true}),
  });
  const result = await response.json().catch(() => ({}));
  if (!result.ok) throw new Error(result.description || `Telegram error ${response.status}`);
  return true;
}

function formatAlert(listing, title) {
  const lines = [title, ""];
  lines.push(listing.price ? `💰 ${listing.price.toLocaleString("he-IL")} ₪` : "💰 מחיר לא צוין");
  lines.push(`🛏 ${listing.rooms ?? "?"} חדרים · 🚿 ${listing.bathrooms ?? "?"} שירותים`);
  lines.push(`📍 ${listing.neighborhoods.join(", ") || "אזור לא זוהה"}`);
  if (listing.bonuses.length) lines.push(`✨ ${listing.bonuses.join(", ")}`);
  lines.push("", listing.text.slice(0, 350) + (listing.text.length > 350 ? "…" : ""));
  lines.push("", `🔗 ${listing.url || listing.source}`);
  lines.push(`📋 כל הדירות: ${Sync.APP_URL}`);
  return lines.join("\n");
}

// ---------- Facebook page script (runs inside the group tab) ----------
// Every selector and pattern comes from rules.json (see getRules).
async function collectFromPage(rules) {
  const re = (source) => new RegExp(source, "i");
  if (document.querySelector(rules.loginSelector) && !document.querySelector(rules.feedSelector)) {
    return {loggedOut: true, posts: []};
  }
  const COMMENT_LABEL = re(rules.commentLabel);
  const isComment = (el) => {
    const art = el.closest(rules.articleSelector);
    return !!art && COMMENT_LABEL.test(art.getAttribute("aria-label") || "");
  };
  const UI_LINE = re(rules.uiLine);
  const seeMore = re(rules.seeMore);
  document.querySelectorAll('[role="button"]').forEach((button) => {
    if (seeMore.test((button.innerText || "").trim()) && !isComment(button)) button.click();
  });

  const units = new Set();
  document.querySelectorAll(rules.unitSelector).forEach((el) => units.add(el));
  document.querySelectorAll(rules.articleSelector).forEach((el) => {
    if (!COMMENT_LABEL.test(el.getAttribute("aria-label") || "") && !el.parentElement?.closest(rules.articleSelector)) units.add(el);
  });
  const list = [...units].filter((el) => ![...units].some((other) => other !== el && other.contains(el)));

  for (const unit of list) {
    unit.querySelectorAll(rules.hoverLinks).forEach((a, i) => {
      if (i > 12 || isComment(a)) return;
      for (const type of ["mouseover", "mouseenter", "focus", "focusin"]) a.dispatchEvent(new Event(type, {bubbles: true}));
    });
  }
  await new Promise((resolve) => setTimeout(resolve, 400));

  const PERMALINK = re(rules.permalink);
  const DETAIL = re(rules.detailLine);
  const IMAGE = re(rules.imageSrc);
  const posts = [];
  const stats = {units: list.length, withMessageNode: 0, withPermalink: 0};
  for (const unit of list) {
    const messageNodes = [...unit.querySelectorAll(rules.messageSelector)].filter((el) => !isComment(el));
    let text = "";
    if (messageNodes.length) {
      stats.withMessageNode++;
      text = messageNodes.map((el) => el.innerText.trim()).filter(Boolean).join("\n");
    }
    // Attachments (e.g. "for rent" listings) keep price/rooms outside the message.
    const clone = unit.cloneNode(true);
    clone.querySelectorAll(rules.removeInCopy).forEach((el) => {
      if (el.matches(rules.articleSelector) && !COMMENT_LABEL.test(el.getAttribute("aria-label") || "")) return;
      el.remove();
    });
    // innerText needs layout to keep line breaks, so render the copy off-screen briefly.
    const holder = document.createElement("div");
    holder.style.cssText = "position:fixed;left:-20000px;top:0;width:800px;pointer-events:none";
    holder.append(clone);
    document.body.append(holder);
    const rendered = clone.innerText || clone.textContent || "";
    holder.remove();
    const fullText = rendered
      .split("\n").map((line) => line.trim())
      .filter((line) => line.length > 1 && !UI_LINE.test(line))
      .filter((line, i, arr) => arr.indexOf(line) === i)
      .join("\n");
    if (!text) text = fullText;
    else if (fullText.length > text.length) {
      const extra = fullText.split("\n").filter((line) => !text.includes(line) && DETAIL.test(line));
      if (extra.length) text += "\n" + extra.join("\n");
    }
    text = text.trim();
    if (text.length < rules.minTextLength) continue;

    const anchors = [...unit.querySelectorAll("a[href]")].filter((a) => !isComment(a));
    const permalink = anchors.find((a) => PERMALINK.test(a.href));
    if (permalink) stats.withPermalink++;
    const author = (unit.querySelector(rules.authorSelector)?.innerText || "").split("\n")[0].trim();
    const image = [...unit.querySelectorAll("img")].find((img) =>
      !isComment(img) && IMAGE.test(img.src) && (img.naturalWidth || img.width) >= rules.minImageWidth);
    const timeLabel = permalink ? (permalink.innerText || permalink.getAttribute("aria-label") || "").trim() : "";
    posts.push({
      text: text.slice(0, 6000),
      url: permalink ? permalink.href : "",
      postedLabel: timeLabel.length <= 40 ? timeLabel : "",
      author: author.slice(0, 80),
      image: image ? image.src : "",
    });
  }
  window.scrollBy(0, Math.max(900, window.innerHeight * 0.9));
  const groupName = (document.querySelector("h1")?.innerText || document.title || "").trim().slice(0, 100);
  return {loggedOut: false, posts, groupName, stats, samples: posts.slice(0, 3).map((p) => p.text.slice(0, 160))};
}

// ---------- Scanning ----------

async function ensureWindow(scan) {
  if (scan.tabId) {
    try {
      await chrome.tabs.get(scan.tabId);
      return scan.tabId;
    } catch {}
  }
  // A real (unfocused) window: Facebook doesn't load more posts in hidden tabs.
  const win = await chrome.windows.create({url: "about:blank", focused: false, width: 1000, height: 800})
    .catch(() => chrome.windows.create({url: "about:blank", focused: false}));
  const tabId = win.tabs[0].id;
  await setScan({tabId, windowId: win.id});
  return tabId;
}

async function closeWindow() {
  const scan = await getScan();
  if (scan.windowId) await chrome.windows.remove(scan.windowId).catch(() => {});
  await setScan({tabId: null, windowId: null});
}

async function waitForLoad(tabId) {
  for (let i = 0; i < 40; i++) {
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === "complete") break;
    await sleep(500);
  }
  await sleep(4000);
}

function idFor(textKey) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < textKey.length; i++) {
    hash ^= textKey.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `p${hash.toString(36)}${textKey.length.toString(36)}`;
}

async function scanGroup(groupUrl, mode, rules) {
  const scan = await getScan();
  const tabId = await ensureWindow(scan);
  const url = new URL(groupUrl);
  if (rules.chronologicalParam) url.searchParams.set(...rules.chronologicalParam);
  await chrome.tabs.update(tabId, {url: url.toString()});
  await waitForLoad(tabId);

  const found = new Map();
  let groupName = "";
  let lastDebug = null;
  let idleRounds = 0;
  const rounds = rules.rounds?.[mode] || (mode === "backfill" ? 45 : 5);
  for (let round = 0; round < rounds; round++) {
    if (!(await getScan()).running) throw new Error("STOPPED");
    const [result] = await chrome.scripting.executeScript({target: {tabId}, func: collectFromPage, args: [rules]});
    const data = result?.result || {posts: []};
    if (data.loggedOut) throw new Error("NOT_LOGGED_IN");
    groupName = data.groupName || groupName;
    if (round === 0 || data.posts.length) {
      lastDebug = {title: groupName, round, ...(data.stats || {}), posts: data.posts.length, samples: data.samples || []};
    }
    const before = found.size;
    for (const post of data.posts) {
      const key = post.text.slice(0, 200);
      if (!found.has(key) || (!found.get(key).url && post.url)) found.set(key, post);
    }
    idleRounds = found.size === before ? idleRounds + 1 : 0;
    if (idleRounds >= 4) break;
    await setScan({heartbeat: Date.now(), round: round + 1});
    await sleep(1800 + Math.random() * 1200);
  }
  const {debug = {}} = await local("debug");
  debug[groupUrl] = {...lastDebug, unique: found.size, at: Date.now()};
  await chrome.storage.local.set({debug});
  return {posts: [...found.values()], groupName};
}

async function storePosts(posts, groupUrl, groupName, mode, config) {
  const {listings = {}} = await local("listings");
  const fresh = [];
  for (const post of posts) {
    const parsed = parseListing(post.text, post.url);
    if (parsed.textKey.length < 20) continue;
    const id = idFor(parsed.textKey);
    if (listings[id]) {
      if (!listings[id].url && parsed.url) listings[id].url = parsed.url;
      listings[id].lastSeen = Date.now();
      continue;
    }
    const listing = {
      id, text: post.text, url: parsed.url, author: post.author, image: post.image,
      postedLabel: post.postedLabel, source: groupUrl, sourceName: groupName,
      firstSeen: Date.now(), lastSeen: Date.now(), fromBackfill: mode === "backfill",
    };
    listings[id] = listing;
    fresh.push({...listing, ...parsed, ...evaluate(parsed, config.criteria)});
  }
  await chrome.storage.local.set({listings});
  return fresh;
}

async function runScan(mode, resume = false) {
  const config = await getConfig();
  let scan = await getScan();
  if (scan.running && !resume) return;
  const rules = await getRules();
  if (!resume) {
    scan = await setScan({
      running: true, mode, groupIndex: 0, total: config.groupUrls.length, startedAt: Date.now(),
      heartbeat: Date.now(), counts: {posts: 0, new: 0, matches: 0}, pendingAlerts: [], lastError: "", currentGroup: "",
    });
    pushListings();
  }
  try {
    for (let index = scan.groupIndex; index < config.groupUrls.length; index++) {
      const groupUrl = config.groupUrls[index];
      await setScan({groupIndex: index, currentGroup: groupUrl, heartbeat: Date.now(), round: 0});
      let fresh = [];
      try {
        const {posts, groupName} = await scanGroup(groupUrl, scan.mode, rules);
        fresh = await storePosts(posts, groupUrl, groupName, scan.mode, config);
        const state = await getScan();
        const counts = {...state.counts};
        counts.posts += posts.length;
        counts.new += fresh.length;
        counts.matches += fresh.filter((l) => l.status === "match").length;
        await setScan({counts});
      } catch (error) {
        if (["NOT_LOGGED_IN", "STOPPED"].includes(String(error.message))) throw error;
        console.warn("Could not scan", groupUrl, error);
      }
      const alertable = fresh.filter((l) => l.status === "match" || (config.alertOnReview && l.status === "review"));
      if (scan.mode === "backfill") {
        const state = await getScan();
        await setScan({pendingAlerts: [...(state.pendingAlerts || []), ...alertable.map((l) => l.id)]});
      } else {
        for (const listing of alertable) {
          await telegram(config, formatAlert(listing, listing.status === "match" ? "🚨 דירה חדשה שמתאימה לך!" : "🟡 דירה חדשה לבדיקה"))
            .catch((error) => setScan({lastError: `Telegram: ${error.message}`}));
        }
      }
      await setScan({groupIndex: index + 1});
      if ((index + 1) % 5 === 0) pushListings();
      await sleep(3000 + Math.random() * 3000);
    }
    const state = await getScan();
    if (state.mode === "backfill") await finishBackfill(config, state);
    await setScan({running: false, lastRun: Date.now(), lastMode: state.mode, lastCounts: state.counts, currentGroup: ""});
  } catch (error) {
    const messages = {
      NOT_LOGGED_IN: "Chrome לא מחובר לפייסבוק. התחבר לפייסבוק ונסה שוב.",
      STOPPED: "הסריקה נעצרה",
    };
    const message = messages[String(error.message)] || String(error.message || error);
    await setScan({running: false, lastError: message, lastRun: Date.now()});
  } finally {
    await closeWindow();
    await pushListings();
  }
}

async function finishBackfill(config, state) {
  const {listings = {}} = await local("listings");
  await setMeta({backfillDone: true});
  const matches = (state.pendingAlerts || []).map((id) => listings[id]).filter(Boolean)
    .map((l) => ({...l, ...parseListing(l.text, l.url)}));
  await telegram(config,
    `✅ הסריקה הראשונה הסתיימה\nנבדקו ${state.counts.posts} פוסטים מ־${state.total} קבוצות.\n` +
    `נמצאו ${matches.length} דירות מתאימות.\n📋 כל הדירות: ${Sync.APP_URL}`).catch(() => {});
  for (const listing of matches.slice(0, MAX_ALERTS_FROM_BACKFILL)) {
    await telegram(config, formatAlert(listing, "🏠 נמצאה בסריקת השבועיים האחרונים")).catch(() => {});
    await sleep(400);
  }
}

async function startScan(requested) {
  const config = await getConfig();
  if (!config.groupUrls.length) return;
  const meta = await getMeta();
  const mode = requested || (meta.backfillDone ? "quick" : "backfill");
  runScan(mode).catch(console.error);
}

// ---------- Events ----------

async function openApp() {
  const pairing = await getPairing();
  chrome.tabs.create({url: pairing ? Sync.appLink(pairing.githubToken, pairing.key) : chrome.runtime.getURL("pair.html")});
}

async function watchdog() {
  const scan = await getScan();
  if (scan.running && Date.now() - (scan.heartbeat || 0) > 120000) {
    // Chrome may stop the worker mid-scan; pick up where it left off.
    await setScan({heartbeat: Date.now()});
    runScan(scan.mode, true).catch(console.error);
    return;
  }
  // Pick up settings changes and "scan now" requests from the web app.
  const config = await pullConfig().catch(() => null);
  if (!config) return;
  const meta = await getMeta();
  if (config.scanRequest?.at > meta.lastScanRequestAt) {
    await setMeta({lastScanRequestAt: config.scanRequest.at});
    if (config.scanRequest.mode === "stop") {
      await setScan({running: false});
    } else if (!scan.running) {
      startScan(config.scanRequest.mode);
    }
  } else if (config.enabled && !meta.backfillDone && !scan.running && !scan.lastRun) {
    startScan("backfill");
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  await schedule();
  openApp();
});
chrome.runtime.onStartup.addListener(schedule);
chrome.action.onClicked.addListener(openApp);

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "scan") {
    const config = await getConfig();
    if (config.enabled) startScan();
  } else if (alarm.name === "watchdog") {
    watchdog().catch(console.error);
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    if (message?.type === "pair") {
      const token = String(message.token || "").trim();
      await Sync.checkToken(token);
      await Sync.ensureDataBranch(token);
      const pages = await Sync.enablePages(token);
      const existing = await getPairing();
      const key = existing?.key || await Sync.newKey();
      let configFile = null;
      try {
        configFile = await Sync.readEncrypted(token, key, Sync.FILES.config);
      } catch {}
      if (!configFile) {
        await Sync.writeEncrypted(token, key, Sync.FILES.config, DEFAULT_CONFIG, "create settings [skip ci]");
      }
      await chrome.storage.local.set({pairing: {githubToken: token, key}, meta: {}});
      await pullConfig();
      await pushListings();
      return {ok: true, link: Sync.appLink(token, key), pages};
    }
    if (message?.type === "status") {
      const {pairing, scan, syncError} = await local(["pairing", "scan", "syncError"]);
      return {ok: true, paired: !!pairing, link: pairing ? Sync.appLink(pairing.githubToken, pairing.key) : "", scan, syncError};
    }
    return {ok: false};
  })().then(sendResponse, (error) => sendResponse({ok: false, error: String(error.message || error)}));
  return true;
});

schedule();
