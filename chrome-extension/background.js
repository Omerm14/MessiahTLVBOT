importScripts("default-groups.js");

const DEFAULTS = {
  groupUrls: DEFAULT_GROUP_URLS,
  intervalMinutes: 30,
  collectorUrl: "http://127.0.0.1:8765/ingest",
  sharedSecret: "",
  enabled: false,
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function settings() {
  return {...DEFAULTS, ...(await chrome.storage.local.get(DEFAULTS))};
}

async function schedule() {
  const cfg = await settings();
  await chrome.alarms.clear("scan-facebook-groups");
  if (cfg.enabled && cfg.groupUrls.length) {
    chrome.alarms.create("scan-facebook-groups", {
      delayInMinutes: 1,
      periodInMinutes: Math.max(10, Number(cfg.intervalMinutes) || 15),
    });
  }
}

function extractPosts(sourceUrl) {
  const articles = [...document.querySelectorAll('[role="article"]')];
  return articles.slice(0, 25).map((article) => {
    const text = (article.innerText || "").trim();
    const links = [...article.querySelectorAll("a[href]")].map((a) => a.href);
    const permalink = links.find((href) =>
      /facebook\.com\/(?:groups\/[^/]+\/(?:posts|permalink)\/|permalink\.php|story\.php)/i.test(href)
    );
    return {text, url: permalink || "", source: sourceUrl};
  }).filter((post) => post.text.length >= 30);
}

async function scanGroup(groupUrl) {
  const tab = await chrome.tabs.create({url: groupUrl, active: false});
  try {
    await sleep(9000);
    const results = await chrome.scripting.executeScript({
      target: {tabId: tab.id},
      func: extractPosts,
      args: [groupUrl],
    });
    return results[0]?.result || [];
  } finally {
    if (tab.id) await chrome.tabs.remove(tab.id).catch(() => {});
  }
}

async function scanAll() {
  const cfg = await settings();
  if (!cfg.enabled || !cfg.sharedSecret || !cfg.groupUrls.length) return;
  const allPosts = [];
  for (const groupUrl of cfg.groupUrls.slice(0, 40)) {
    try {
      allPosts.push(...await scanGroup(groupUrl));
    } catch (error) {
      console.warn("Apartment Hunter could not scan", groupUrl, error);
    }
    await sleep(5000 + Math.floor(Math.random() * 5000));
  }
  if (!allPosts.length) return;
  const response = await fetch(cfg.collectorUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Collector-Secret": cfg.sharedSecret,
    },
    body: JSON.stringify({posts: allPosts}),
  });
  if (!response.ok) throw new Error(`Collector returned ${response.status}`);
  const result = await response.json();
  await chrome.storage.local.set({lastRun: new Date().toISOString(), lastResult: result});
}

async function discoverRelevantGroups() {
  const tab = await chrome.tabs.create({url: "https://www.facebook.com/groups/joins/", active: false});
  try {
    await sleep(7000);
    const results = await chrome.scripting.executeScript({
      target: {tabId: tab.id},
      func: async () => {
        const groups = new Map();
        const relevant = /(דיר(?:ה|ות)|השכרה|סאבלט|סבלט|תל[ -]?אביב|יפו|נווה צדק|נוה צדק|כרם התימנים|רוטשילד|פלורנטין|לב העיר|apartment|rent|sublet|tel aviv|jaffa)/i;
        const exclude = /(חני(?:ה|ות)|parking|נדל[״"]?ן בחו[״"]?ל|תאילנד|קופנגן|ניו יורק|new york|rome|הרצליה|גני תקווה|בקעת אונו|יהוד|רשפון)/i;
        for (let round = 0; round < 32; round++) {
          for (const anchor of document.querySelectorAll('a[href*="facebook.com/groups/"]')) {
            const name = (anchor.innerText || anchor.getAttribute("aria-label") || "").trim();
            const match = anchor.href.match(/^https:\/\/(?:www\.)?facebook\.com\/groups\/([^/?#]+)/i);
            if (!match || !name || !relevant.test(name) || exclude.test(name)) continue;
            if (["feed", "discover", "joins"].includes(match[1].toLowerCase())) continue;
            const url = `https://www.facebook.com/groups/${match[1]}/`;
            groups.set(url, name.replace(/\s+Last active.*$/i, "").trim());
          }
          window.scrollBy(0, Math.max(700, window.innerHeight * 0.85));
          await new Promise((resolve) => setTimeout(resolve, 800));
        }
        return [...groups.entries()].map(([url, name]) => ({url, name}));
      },
    });
    const groups = results[0]?.result || [];
    groups.sort((a, b) => a.name.localeCompare(b.name, "he"));
    return groups.slice(0, 40);
  } finally {
    if (tab.id) await chrome.tabs.remove(tab.id).catch(() => {});
  }
}

chrome.runtime.onInstalled.addListener(() => chrome.runtime.openOptionsPage());
chrome.runtime.onStartup.addListener(schedule);
chrome.storage.onChanged.addListener(schedule);
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "scan-facebook-groups") scanAll().catch(console.error);
});
chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "discover-groups") return false;
  discoverRelevantGroups()
    .then((groups) => chrome.storage.local.set({
      discoveredGroups: groups,
      discoveryFinishedAt: Date.now(),
      discoveryError: "",
    }))
    .catch((error) => chrome.storage.local.set({
      discoveryFinishedAt: Date.now(),
      discoveryError: String(error),
    }));
  sendResponse({ok: true, started: true});
  return false;
});

schedule();
