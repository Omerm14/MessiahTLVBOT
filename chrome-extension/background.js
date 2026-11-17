const DEFAULTS = {
  groupUrls: [],
  intervalMinutes: 15,
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
  for (const groupUrl of cfg.groupUrls.slice(0, 25)) {
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

chrome.runtime.onInstalled.addListener(() => chrome.runtime.openOptionsPage());
chrome.runtime.onStartup.addListener(schedule);
chrome.storage.onChanged.addListener(schedule);
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "scan-facebook-groups") scanAll().catch(console.error);
});
chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());

schedule();
