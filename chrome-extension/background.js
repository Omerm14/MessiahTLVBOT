importScripts("default-groups.js", "parser.js");

const {parseListing, evaluate, DEFAULT_CRITERIA} = self.ApartmentParser;

const DEFAULT_CONFIG = {
  enabled: false,
  groupUrls: DEFAULT_GROUP_URLS,
  intervalMinutes: 20,
  telegramToken: "",
  telegramChatId: "",
  criteria: DEFAULT_CRITERIA,
  alertOnReview: false,
  backfillDone: false,
};

const ROUNDS = {quick: 5, backfill: 45};
const MAX_ALERTS_FROM_BACKFILL = 15;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function getConfig() {
  const {config} = await chrome.storage.local.get("config");
  return {...DEFAULT_CONFIG, ...(config || {}), criteria: {...DEFAULT_CRITERIA, ...(config?.criteria || {})}};
}

async function getScan() {
  const {scan} = await chrome.storage.local.get("scan");
  return scan || {running: false};
}

async function setScan(patch) {
  const scan = {...(await getScan()), ...patch};
  await chrome.storage.local.set({scan});
  return scan;
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
  return lines.join("\n");
}

// ---------- Facebook page script (runs inside the group tab) ----------

function collectFromPage() {
  if (document.querySelector('input[name="email"], form[action*="login"]')) return {loggedOut: true, posts: []};
  const seeMore = /^(see more|ראה עוד|הצג עוד|עוד)$/i;
  document.querySelectorAll('[role="article"] [role="button"]').forEach((button) => {
    if (seeMore.test((button.innerText || "").trim())) button.click();
  });
  const posts = [];
  for (const article of document.querySelectorAll('[role="article"]')) {
    if (article.parentElement?.closest('[role="article"]')) continue; // skip comments
    const message = article.querySelector('[data-ad-preview="message"], [data-ad-comet-preview="message"]');
    const text = (message?.innerText || article.innerText || "").trim();
    if (text.length < 30) continue;
    const links = [...article.querySelectorAll("a[href]")];
    const permalink = links.find((a) =>
      /facebook\.com\/(?:groups\/[^/]+\/(?:posts|permalink)\/|permalink\.php|story\.php)/i.test(a.href));
    const author = article.querySelector("h2 a, h3 a, strong a, h2, h3")?.innerText?.trim() || "";
    const image = [...article.querySelectorAll("img")].find((img) =>
      /scontent|fbcdn/.test(img.src) && (img.naturalWidth || img.width) >= 160);
    posts.push({
      text: text.slice(0, 6000),
      url: permalink ? permalink.href : "",
      postedLabel: permalink ? (permalink.innerText || permalink.getAttribute("aria-label") || "").trim().slice(0, 40) : "",
      author: author.slice(0, 80),
      image: image ? image.src : "",
    });
  }
  window.scrollBy(0, Math.max(900, window.innerHeight * 0.9));
  const groupName = (document.querySelector("h1")?.innerText || document.title || "").trim().slice(0, 100);
  return {loggedOut: false, posts, groupName};
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

async function scanGroup(groupUrl, mode) {
  const scan = await getScan();
  const tabId = await ensureWindow(scan);
  const url = new URL(groupUrl);
  url.searchParams.set("sorting_setting", "CHRONOLOGICAL");
  await chrome.tabs.update(tabId, {url: url.toString()});
  await waitForLoad(tabId);

  const found = new Map();
  let groupName = "";
  let idleRounds = 0;
  for (let round = 0; round < ROUNDS[mode]; round++) {
    if (!(await getScan()).running) throw new Error("STOPPED");
    const [result] = await chrome.scripting.executeScript({target: {tabId}, func: collectFromPage});
    const data = result?.result || {posts: []};
    if (data.loggedOut) throw new Error("NOT_LOGGED_IN");
    groupName = data.groupName || groupName;
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
  return {posts: [...found.values()], groupName};
}

async function storePosts(posts, groupUrl, groupName, mode, config) {
  const {listings = {}} = await chrome.storage.local.get("listings");
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
    const {status, reasons} = evaluate(parsed, config.criteria);
    const listing = {
      id, ...parsed, text: post.text, author: post.author, image: post.image,
      postedLabel: post.postedLabel, source: groupUrl, sourceName: groupName,
      firstSeen: Date.now(), lastSeen: Date.now(), fromBackfill: mode === "backfill",
      status, reasons, saved: false, hidden: false,
    };
    delete listing.textKey;
    listings[id] = listing;
    fresh.push(listing);
  }
  await chrome.storage.local.set({listings});
  return fresh;
}

async function runScan(mode, resume = false) {
  const config = await getConfig();
  let scan = await getScan();
  if (scan.running && !resume) return;
  if (!resume) {
    scan = await setScan({
      running: true, mode, groupIndex: 0, total: config.groupUrls.length, startedAt: Date.now(),
      heartbeat: Date.now(), counts: {posts: 0, new: 0, matches: 0}, pendingAlerts: [], lastError: "",
    });
  }
  try {
    for (let index = scan.groupIndex; index < config.groupUrls.length; index++) {
      const groupUrl = config.groupUrls[index];
      await setScan({groupIndex: index, currentGroup: groupUrl, heartbeat: Date.now(), round: 0});
      let fresh = [];
      try {
        const {posts, groupName} = await scanGroup(groupUrl, scan.mode);
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
        await setScan({pendingAlerts: [...state.pendingAlerts, ...alertable.map((l) => l.id)]});
      } else {
        for (const listing of alertable) {
          await telegram(config, formatAlert(listing, listing.status === "match" ? "🚨 דירה חדשה שמתאימה לך!" : "🟡 דירה חדשה לבדיקה"))
            .catch((error) => setScan({lastError: `Telegram: ${error.message}`}));
        }
      }
      await setScan({groupIndex: index + 1});
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
  }
}

async function finishBackfill(config, state) {
  const {listings = {}} = await chrome.storage.local.get("listings");
  const matches = state.pendingAlerts.map((id) => listings[id]).filter(Boolean);
  await chrome.storage.local.set({config: {...config, backfillDone: true}});
  await telegram(config,
    `✅ הסריקה הראשונה הסתיימה\nנבדקו ${state.counts.posts} פוסטים מ־${state.total} קבוצות.\n` +
    `נמצאו ${matches.length} דירות מתאימות. כל הדירות מחכות לך בלוח הדירות של התוסף.`).catch(() => {});
  for (const listing of matches.slice(0, MAX_ALERTS_FROM_BACKFILL)) {
    await telegram(config, formatAlert(listing, "🏠 נמצאה בסריקת השבועיים האחרונים")).catch(() => {});
    await sleep(400);
  }
}

async function startScan(requested) {
  const config = await getConfig();
  const mode = requested || (config.backfillDone ? "quick" : "backfill");
  runScan(mode).catch(console.error);
}

// ---------- Events ----------

chrome.runtime.onInstalled.addListener(async () => {
  await schedule();
  chrome.tabs.create({url: chrome.runtime.getURL("dashboard.html")});
});
chrome.runtime.onStartup.addListener(schedule);
chrome.action.onClicked.addListener(() => chrome.tabs.create({url: chrome.runtime.getURL("dashboard.html")}));

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "scan") {
    const config = await getConfig();
    if (config.enabled) startScan();
  } else if (alarm.name === "watchdog") {
    // Chrome may stop the worker mid-scan; pick up where it left off.
    const scan = await getScan();
    if (scan.running && Date.now() - (scan.heartbeat || 0) > 120000) {
      await setScan({heartbeat: Date.now()});
      runScan(scan.mode, true).catch(console.error);
    }
  }
});

chrome.storage.onChanged.addListener((changes) => {
  if (changes.config) {
    const before = changes.config.oldValue || {};
    const after = changes.config.newValue || {};
    if (before.enabled !== after.enabled || before.intervalMinutes !== after.intervalMinutes) schedule();
    if (!before.enabled && after.enabled && !after.backfillDone) startScan("backfill");
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    if (message?.type === "scan") {
      await startScan(message.mode);
      return {ok: true};
    }
    if (message?.type === "stop") {
      await setScan({running: false, lastError: "הסריקה נעצרה"});
      await closeWindow();
      return {ok: true};
    }
    if (message?.type === "test-telegram") {
      const config = await getConfig();
      await telegram(config, "✅ החיבור עובד! כאן יגיעו התראות על דירות חדשות.");
      return {ok: true};
    }
    if (message?.type === "reevaluate") {
      const config = await getConfig();
      const {listings = {}} = await chrome.storage.local.get("listings");
      Object.values(listings).forEach((listing) => Object.assign(listing, evaluate(listing, config.criteria)));
      await chrome.storage.local.set({listings});
      return {ok: true};
    }
    return {ok: false};
  })().then(sendResponse, (error) => sendResponse({ok: false, error: String(error.message || error)}));
  return true;
});

schedule();
