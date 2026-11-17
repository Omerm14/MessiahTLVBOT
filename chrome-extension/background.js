importScripts("default-groups.js", "parser.js", "sync.js", "sources.js");

const {parseListing, evaluate, resolveKind, withAiFields, isDuplicate, wordPairs, similarity, CONFIDENT, KINDS, DEFAULT_CRITERIA} = self.ApartmentParser;
const Sources = self.HunterSources;
const Sync = self.HunterSync;

// Settings are edited in the web app and synced from the repository.
const DEFAULT_CONFIG = {
  enabled: false,
  groupUrls: DEFAULT_GROUP_URLS,
  intervalMinutes: 20,
  telegramChatId: "", // one or more chat IDs, comma-separated
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
  return {
    ...DEFAULT_CONFIG, ...(config || {}),
    criteria: {...DEFAULT_CRITERIA, ...(config?.criteria || {})},
    sources: {...Sources.DEFAULT_SOURCES, ...(config?.sources || {})},
  };
}

async function getMeta() {
  const {meta} = await local("meta");
  return {backfillDone: false, lastScanRequestAt: 0, configSha: "", secretsSha: "", listingsSha: "", ...(meta || {})};
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
  // Owner-only secrets (the Telegram bot token), unlocked by the owner key.
  const secretsFile = await Sync.readFile(pairing.githubToken, Sync.FILES.secrets).catch(() => null);
  if (secretsFile && secretsFile.sha !== (await getMeta()).secretsSha) {
    const secrets = await Sync.decryptJson(pairing.ownerKey, secretsFile.text).catch(() => null);
    if (secrets) {
      await chrome.storage.local.set({secrets});
      await setMeta({secretsSha: secretsFile.sha});
    }
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
  const {listings = {}, debug = {}, scan = {}, aiUsage = null, aiError = ""} = await local(["listings", "debug", "scan", "aiUsage", "aiError"]);
  const cutoff = Date.now() - KEEP_DAYS * 86400000;
  const kept = Object.values(listings).filter((l) => (l.lastSeen || l.firstSeen) >= cutoff);
  const {pendingAlerts, tabId, windowId, ...scanStatus} = scan;
  const payload = {
    updatedAt: Date.now(),
    version: chrome.runtime.getManifest().version,
    scan: scanStatus,
    debug,
    ai: {usage: aiUsage, error: aiError},
    listings: kept.map((l) => ({
      id: l.id, text: l.text.slice(0, 3000), url: l.url, author: l.author, image: l.image,
      postedLabel: l.postedLabel, source: l.source, sourceName: l.sourceName,
      firstSeen: l.firstSeen, lastSeen: l.lastSeen, fromBackfill: l.fromBackfill,
      sourceType: l.sourceType || "facebook", sources: l.sources || [], ai: l.ai || null, repostedAt: l.repostedAt || 0,
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

async function telegram(config, text, buttons = null) {
  const {secrets} = await local("secrets");
  const chats = String(config.telegramChatId || "").split(/[,\s]+/).filter((id) => /^-?\d+$/.test(id));
  if (!secrets?.telegramToken || !chats.length) return false;
  let lastError = null;
  for (const chat of chats) {
    const response = await fetch(`https://api.telegram.org/bot${secrets.telegramToken}/sendMessage`, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({
        chat_id: chat, text, parse_mode: "HTML", disable_web_page_preview: true,
        ...(buttons ? {reply_markup: {inline_keyboard: [await personalizeButtons(buttons, chat, secrets)]}} : {}),
      }),
    });
    const result = await response.json().catch(() => ({}));
    if (!result.ok) lastError = new Error(result.description || `Telegram error ${response.status}`);
  }
  if (lastError) throw lastError;
  return true;
}

const escHtml = (value) => String(value ?? "").replace(/[&<>]/g, (c) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;"}[c]));

// Price first, then rooms and area: the same order as the cards in the web app.
// Unknown fields say so instead of disappearing.
function formatAlert(listing, title) {
  const price = listing.price != null ? `${listing.price.toLocaleString("he-IL")} ₪ לחודש` : "מחיר לא צוין";
  const rooms = listing.rooms != null ? `${listing.rooms} חדרים` : "? חדרים";
  const baths = listing.bathrooms != null ? `${listing.bathrooms} שירותים` : "? שירותים";
  const lines = [
    `<b>${escHtml(title)}</b>`,
    "",
    `<b>${escHtml(price)}</b>`,
    `${escHtml(rooms)} · ${escHtml(baths)}`,
    `${escHtml(listing.neighborhoods.join(" · ") || "אזור לא זוהה")}`,
  ];
  if (listing.bonuses.length) lines.push(escHtml(listing.bonuses.join(" · ")));
  if (listing.status === "review" && listing.reasons?.length) lines.push(`<i>${escHtml(listing.reasons.join(" · "))}</i>`);
  const excerpt = listing.text.replace(/\s+/g, " ").trim();
  lines.push("", `<blockquote>${escHtml(excerpt.slice(0, 280))}${excerpt.length > 280 ? "…" : ""}</blockquote>`);
  if (listing.sourceName) lines.push(`<i>${escHtml(listing.sourceName)}</i>`);
  return lines.join("\n");
}

const BOARD = "__board__";

function alertButtons(listing) {
  const post = /^https:\/\//.test(listing.url || "") ? listing.url : listing.source;
  return [{text: "פתח את הפוסט", url: post}, {text: "פתח את הלוח", url: BOARD}];
}

// The "open the board" button carries each chat's own personal link, so tapping any
// alert opens the app signed in. Chats we can't match get the plain address.
async function personalizeButtons(buttons, chat, secrets) {
  const pairing = await getPairing();
  const member = (secrets.members || []).find((m) => m.chatId && String(m.chatId) === String(chat));
  const link = pairing && secrets.ownerChatId && String(secrets.ownerChatId) === String(chat)
    ? ownerLink(pairing)
    : member?.link || Sync.APP_URL;
  return buttons.map((button) => (button.url === BOARD ? {...button, url: link} : button));
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
  const SPONSORED = rules.skipSponsored ? re(rules.skipSponsored) : null;
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
    // Ads in the feed, and loose text with no link and no numbers, are never listings.
    if (SPONSORED && [...unit.querySelectorAll("a, span")].some((el) => SPONSORED.test((el.innerText || "").trim()))) continue;
    if (!permalink && !/\d{3,}/.test(text)) continue;
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

// Non-Facebook sources: open the page, read it a few times while scrolling.
async function scanPage(target, mode, rules) {
  const siteRules = rules.sources?.[target.type];
  if (!siteRules) throw new Error(`no rules for ${target.type}`);
  const scan = await getScan();
  const tabId = await ensureWindow(scan);
  await chrome.tabs.update(tabId, {url: target.url});
  await waitForLoad(tabId);
  const collect = target.type === "telegram" ? Sources.collectTelegram : Sources.collectListingPage;
  const found = new Map();
  let groupName = "";
  let lastDebug = null;
  const rounds = siteRules.rounds?.[mode] || 1;
  for (let round = 0; round < rounds; round++) {
    if (!(await getScan()).running) throw new Error("STOPPED");
    const [result] = await chrome.scripting.executeScript({target: {tabId}, func: collect, args: [siteRules]});
    const data = result?.result || {posts: []};
    if (data.blocked) {
      lastDebug = {title: target.type, round, blocked: true, posts: 0, samples: []};
      break;
    }
    groupName = data.groupName || groupName;
    for (const post of data.posts) if (!found.has(post.externalId || post.text)) found.set(post.externalId || post.text, post);
    lastDebug = {title: groupName, round, ...(data.stats || {}), posts: data.posts.length, samples: data.samples || []};
    await setScan({heartbeat: Date.now(), round: round + 1});
    await sleep(2500 + Math.random() * 1500);
  }
  const {debug = {}} = await local("debug");
  debug[target.url] = {...lastDebug, source: target.type, unique: found.size, at: Date.now()};
  await chrome.storage.local.set({debug});
  const names = {yad2: "יד2", madlan: "מדלן", homeless: "הומלס", komo: "קומו"};
  return {posts: [...found.values()], groupName: names[target.type] || groupName || target.type};
}

// ---------- Storing, merging duplicates, classifying ----------

const MERGE_WINDOW_MS = 30 * 86400000;
const REPOST_AFTER_MS = 3 * 86400000;

function sourceEntry(target, groupName, post) {
  return {type: target.type, name: groupName || target.type, url: post.url || target.url, seenAt: Date.now()};
}

function addSource(listing, entry) {
  listing.sources = listing.sources || [];
  if (!listing.sources.some((s) => s.url === entry.url)) listing.sources.push(entry);
}

// Finds an earlier listing for the same apartment: same source item, same text, or a
// near-duplicate (same phone and details, or 80%+ of the wording) from the last 30 days.
function findExisting(listings, index, post, parsed, id) {
  if (listings[id]) return listings[id];
  if (post.externalKey && index.byExternal.has(post.externalKey)) return listings[index.byExternal.get(post.externalKey)];
  const pairs = wordPairs(post.text);
  const candidate = {...parsed, text: post.text};
  for (const other of index.recent) {
    if (other.phones.some((phone) => parsed.phones.includes(phone)) || similarity(pairs, other.pairs) >= 0.5) {
      if (isDuplicate(other.listing, candidate)) return other.listing;
    }
  }
  return null;
}

function buildIndex(listings) {
  const byExternal = new Map();
  const recent = [];
  const cutoff = Date.now() - MERGE_WINDOW_MS;
  for (const listing of Object.values(listings)) {
    if (listing.externalKey) byExternal.set(listing.externalKey, listing.id);
    if ((listing.lastSeen || listing.firstSeen) < cutoff) continue;
    const parsed = parseListing(listing.text, listing.url);
    recent.push({listing: {...parsed, text: listing.text, street: listing.ai?.street || ""}, id: listing.id, phones: parsed.phones, pairs: wordPairs(listing.text)});
  }
  for (const entry of recent) entry.listing = Object.assign(entry.listing, {id: entry.id});
  return {byExternal, recent};
}

function evaluateStored(listing, config) {
  const parsed = withAiFields(parseListing(listing.text, listing.url), listing.ai);
  const kindInfo = resolveKind(parsed, listing.ai, null);
  return {...listing, ...parsed, url: listing.url || parsed.url, ...evaluate(parsed, config.criteria, kindInfo)};
}

async function storePosts(posts, target, groupName, mode, config) {
  const {listings = {}} = await local("listings");
  const index = buildIndex(listings);
  const fresh = [];
  let merged = 0;
  for (const post of posts) {
    const parsed = parseListing(post.text, post.url);
    if (parsed.textKey.length < 20) continue;
    post.externalKey = post.externalId ? `${target.type}:${post.externalId}` : "";
    const id = idFor(parsed.textKey);
    const existing = findExisting(listings, index, post, parsed, id);
    if (existing) {
      const stored = listings[existing.id];
      if (!stored) continue;
      if (!stored.url && parsed.url) stored.url = parsed.url;
      if (Date.now() - (stored.lastSeen || stored.firstSeen) > REPOST_AFTER_MS) stored.repostedAt = Date.now();
      stored.lastSeen = Date.now();
      addSource(stored, sourceEntry(target, groupName, post));
      merged++;
      continue;
    }
    const listing = {
      id, text: post.text, url: parsed.url, author: post.author, image: post.image,
      postedLabel: post.postedLabel, source: target.url, sourceName: groupName, sourceType: target.type,
      externalKey: post.externalKey, sources: [sourceEntry(target, groupName, post)],
      firstSeen: Date.now(), lastSeen: Date.now(), fromBackfill: mode === "backfill",
      // Listing sites only carry rentals; no need to classify them.
      ai: target.trusted && parsed.kind !== "sale" ? {kind: "rental", by: "source"} : null,
    };
    listings[id] = listing;
    index.recent.push({listing: {...parsed, text: post.text, id}, id, phones: parsed.phones, pairs: wordPairs(post.text)});
    if (post.externalKey) index.byExternal.set(post.externalKey, id);
    fresh.push(listing);
  }
  await chrome.storage.local.set({listings});
  await classifyUnsure(fresh.map((l) => l.id), config);
  const {listings: latest = {}} = await local("listings");
  return {fresh: fresh.map((l) => evaluateStored(latest[l.id] || l, config)), merged};
}

// One-time pass that merges duplicates collected before merging existed.
async function mergeStoredDuplicates() {
  const meta = await getMeta();
  if (meta.mergedV1) return;
  const {listings = {}} = await local("listings");
  const kept = {};
  const index = {byExternal: new Map(), recent: []};
  for (const listing of Object.values(listings).sort((a, b) => a.firstSeen - b.firstSeen)) {
    const parsed = parseListing(listing.text, listing.url);
    const existing = findExisting(kept, index, listing, parsed, listing.id);
    if (existing && kept[existing.id]) {
      addSource(kept[existing.id], {type: listing.sourceType || "facebook", name: listing.sourceName, url: listing.url || listing.source, seenAt: listing.firstSeen});
      kept[existing.id].lastSeen = Math.max(kept[existing.id].lastSeen || 0, listing.lastSeen || 0);
      continue;
    }
    listing.sources = listing.sources?.length ? listing.sources
      : [{type: listing.sourceType || "facebook", name: listing.sourceName, url: listing.url || listing.source, seenAt: listing.firstSeen}];
    kept[listing.id] = listing;
    index.recent.push({listing: {...parsed, text: listing.text, id: listing.id}, id: listing.id, phones: parsed.phones, pairs: wordPairs(listing.text)});
  }
  await chrome.storage.local.set({listings: kept});
  await setMeta({mergedV1: true, mergedRemoved: Object.keys(listings).length - Object.keys(kept).length});
}

// ---------- AI check for unclear posts (Claude Haiku) ----------

const AI_MODEL = "claude-haiku-5-5";
const AI_BATCH = 10;
const AI_SYSTEM = [
  "You sort posts collected from Tel Aviv apartment groups, channels and listing sites.",
  "For each post decide what it is:",
  "- rental: someone offers a whole apartment for long-term rent (owner, tenant leaving, or agent).",
  "- roommate: a room in a shared apartment, or a search for a roommate.",
  "- sublet: short-term rent, a few weeks or months.",
  "- seeking: someone is looking for an apartment (often with a budget).",
  "- sale: an apartment or an item for sale or giveaway.",
  "- service: an ad for a service, project, course, or business.",
  "- other: questions, group rules, commercial space, parking, anything else.",
  "Posts are mostly in Hebrew. Judge by meaning, not keywords: a landlord 'looking for tenants' is a rental.",
  "Also extract, when the post states them: the street name with number (empty string if unknown), the monthly rent in shekels (0 if unknown), and the number of rooms in the Israeli count (0 if unknown).",
  "confidence is your certainty from 0 to 1.",
].join("\n");

const AI_SCHEMA = {
  type: "object",
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: {type: "string"},
          kind: {type: "string", enum: ["rental", "roommate", "sublet", "seeking", "sale", "service", "other"]},
          confidence: {type: "number"},
          street: {type: "string"},
          price: {type: "integer"},
          rooms: {type: "number"},
        },
        required: ["id", "kind", "confidence", "street", "price", "rooms"],
        additionalProperties: false,
      },
    },
  },
  required: ["results"],
  additionalProperties: false,
};

// The person's latest corrections ("not an apartment" / "this is an apartment"),
// read from the shared marks file, become examples for the model.
async function correctionExamples(listings) {
  const pairing = await getPairing();
  if (!pairing) return [];
  try {
    const file = await Sync.readFile(pairing.githubToken, Sync.FILES.state);
    if (!file) return [];
    const marks = await Sync.decryptJson(pairing.key, file.text);
    return Object.entries(marks.items || {})
      .filter(([id, mark]) => mark.kind && listings[id])
      .sort((a, b) => (b[1].at || 0) - (a[1].at || 0))
      .slice(0, 20)
      .map(([id, mark]) => ({text: listings[id].text.replace(/\s+/g, " ").slice(0, 400), kind: mark.kind}));
  } catch {
    return [];
  }
}

async function aiClassify(items, apiKey, examples) {
  const exampleText = examples.length
    ? `Corrections made by the user (follow these judgments):\n${examples.map((e) => `- [${e.kind}] ${e.text}`).join("\n")}\n\n`
    : "";
  const posts = items.map((l) => ({id: l.id, text: l.text.replace(/\s+/g, " ").slice(0, 1500)}));
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: AI_MODEL,
      max_tokens: 4096,
      system: [{type: "text", text: AI_SYSTEM, cache_control: {type: "ephemeral"}}],
      output_config: {effort: "low", format: {type: "json_schema", schema: AI_SCHEMA}},
      messages: [{role: "user", content: `${exampleText}Posts:\n${JSON.stringify(posts)}`}],
    }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error?.message || `Anthropic API error ${response.status}`);
  if (result.stop_reason === "refusal") throw new Error("the model declined this batch");
  const text = (result.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
  const parsed = JSON.parse(text);
  const usage = result.usage || {};
  const {aiUsage = {input: 0, output: 0, calls: 0}} = await local("aiUsage");
  await chrome.storage.local.set({aiUsage: {
    input: aiUsage.input + (usage.input_tokens || 0) + (usage.cache_read_input_tokens || 0) + (usage.cache_creation_input_tokens || 0),
    output: aiUsage.output + (usage.output_tokens || 0),
    calls: aiUsage.calls + 1,
  }});
  return parsed.results || [];
}

// Runs the AI on posts the rules weren't sure about. Without a key, they stay
// unsure and land in "To review" instead of "Matches".
async function classifyUnsure(ids, config) {
  const {secrets, listings = {}} = await local(["secrets", "listings"]);
  if (!secrets?.anthropicKey) return 0;
  const unsure = ids.map((id) => listings[id]).filter((l) => {
    if (!l || l.ai) return false;
    return parseListing(l.text, l.url).kindConfidence < CONFIDENT;
  });
  if (!unsure.length) return 0;
  const examples = await correctionExamples(listings);
  let done = 0;
  for (let i = 0; i < unsure.length; i += AI_BATCH) {
    const batch = unsure.slice(i, i + AI_BATCH);
    try {
      const results = await aiClassify(batch, secrets.anthropicKey, examples);
      for (const r of results) {
        if (!listings[r.id] || !KINDS.includes(r.kind)) continue;
        listings[r.id].ai = {kind: r.kind, confidence: r.confidence, street: r.street || "", price: r.price || 0, rooms: r.rooms || 0, by: "ai", at: Date.now()};
        done++;
      }
      await chrome.storage.local.set({listings, aiError: ""});
    } catch (error) {
      await chrome.storage.local.set({aiError: `AI: ${error.message}`});
      break;
    }
  }
  return done;
}

// Older posts the rules weren't sure about get checked a few at a time while idle.
async function classifyBacklog(config) {
  const {listings = {}} = await local("listings");
  const ids = Object.values(listings)
    .filter((l) => !l.ai && parseListing(l.text, l.url).kindConfidence < CONFIDENT)
    .sort((a, b) => b.firstSeen - a.firstSeen)
    .slice(0, AI_BATCH * 2)
    .map((l) => l.id);
  if (ids.length && await classifyUnsure(ids, config)) pushListings();
}

async function runScan(mode, resume = false) {
  const config = await getConfig();
  let scan = await getScan();
  if (scan.running && !resume) return;
  const rules = await getRules();
  const targets = Sources.targetsFor(config, rules);
  if (!resume) {
    scan = await setScan({
      running: true, mode, groupIndex: 0, total: targets.length, startedAt: Date.now(),
      heartbeat: Date.now(), counts: {posts: 0, new: 0, matches: 0}, pendingAlerts: [], lastError: "", currentGroup: "",
    });
    pushListings();
  }
  try {
    for (let index = scan.groupIndex; index < targets.length; index++) {
      const target = targets[index];
      await setScan({groupIndex: index, currentGroup: target.url, currentSource: target.type, heartbeat: Date.now(), round: 0});
      let fresh = [];
      try {
        const {posts, groupName} = target.type === "facebook"
          ? await scanGroup(target.url, scan.mode, rules)
          : await scanPage(target, scan.mode, rules);
        const stored = await storePosts(posts, target, groupName, scan.mode, config);
        fresh = stored.fresh;
        const state = await getScan();
        const counts = {...state.counts};
        counts.posts += posts.length;
        counts.new += fresh.length;
        counts.merged = (counts.merged || 0) + stored.merged;
        counts.filtered = (counts.filtered || 0) + fresh.filter((l) => l.status === "filtered").length;
        counts.matches += fresh.filter((l) => l.status === "match").length;
        await setScan({counts});
        const {debug = {}} = await local("debug");
        if (debug[target.url]) {
          debug[target.url] = {...debug[target.url], source: target.type, fresh: fresh.length, merged: stored.merged,
            filtered: fresh.filter((l) => l.status === "filtered").length};
          await chrome.storage.local.set({debug});
        }
      } catch (error) {
        // Facebook being logged out only stops the Facebook part of the scan.
        if (String(error.message) === "STOPPED") throw error;
        if (String(error.message) === "NOT_LOGGED_IN") await setScan({lastError: "Chrome לא מחובר לפייסבוק. התחבר לפייסבוק כדי לסרוק את הקבוצות."});
        console.warn("Could not scan", target.url, error);
      }
      const alertable = fresh.filter((l) => l.status === "match" || (config.alertOnReview && l.status === "review"));
      if (scan.mode === "backfill") {
        const state = await getScan();
        await setScan({pendingAlerts: [...(state.pendingAlerts || []), ...alertable.map((l) => l.id)]});
      } else {
        for (const listing of alertable) {
          await telegram(config, formatAlert(listing, listing.status === "match" ? "🏠 דירה חדשה שמתאימה לך" : "🔎 דירה חדשה לבדיקה"), alertButtons(listing))
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
    `<b>✅ הסריקה הראשונה הסתיימה</b>\nנבדקו ${state.counts.posts} פוסטים מ־${state.total} מקורות.\n` +
    `נמצאו ${matches.length} דירות מתאימות.`, [{text: "פתח את הלוח", url: BOARD}]).catch(() => {});
  for (const listing of matches.slice(0, MAX_ALERTS_FROM_BACKFILL)) {
    await telegram(config, formatAlert(listing, "🏠 מהשבועיים האחרונים"), alertButtons(listing)).catch(() => {});
    await sleep(400);
  }
}

async function startScan(requested) {
  const config = await getConfig();
  if (!Sources.targetsFor(config, await getRules()).length) return;
  const meta = await getMeta();
  const mode = requested || (meta.backfillDone ? "quick" : "backfill");
  runScan(mode).catch(console.error);
}

// ---------- Events ----------

function ownerLink(pairing) {
  return Sync.appLink(pairing.githubToken, pairing.key, {ownerKey: pairing.ownerKey, name: pairing.name});
}

async function openApp() {
  const pairing = await getPairing();
  chrome.tabs.create({url: pairing ? ownerLink(pairing) : chrome.runtime.getURL("pair.html")});
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
  } else if (!scan.running) {
    // Idle: merge duplicates stored before merging existed, then check unclear posts.
    if (!meta.mergedV1) {
      await mergeStoredDuplicates();
      pushListings();
    }
    await classifyBacklog(config);
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
      const ownerKey = existing?.ownerKey || await Sync.newKey();
      const name = String(message.name || existing?.name || "").trim().slice(0, 30);
      let configFile = null;
      try {
        configFile = await Sync.readEncrypted(token, key, Sync.FILES.config);
      } catch {}
      if (!configFile) {
        await Sync.writeEncrypted(token, key, Sync.FILES.config, DEFAULT_CONFIG, "create settings [skip ci]");
      }
      const pairing = {githubToken: token, key, ownerKey, name};
      await chrome.storage.local.set({pairing, meta: {}});
      await pullConfig();
      await pushListings();
      return {ok: true, link: ownerLink(pairing), pages};
    }
    if (message?.type === "open-app") {
      await openApp();
      return {ok: true};
    }
    if (message?.type === "scan-now") {
      const scan = await getScan();
      if (!scan.running) await startScan("quick");
      return {ok: true};
    }
    if (message?.type === "stop-scan") {
      await setScan({running: false});
      return {ok: true};
    }
    if (message?.type === "status") {
      const {pairing, scan, syncError} = await local(["pairing", "scan", "syncError"]);
      return {ok: true, paired: !!pairing, link: pairing ? ownerLink(pairing) : "", scan, syncError};
    }
    return {ok: false};
  })().then(sendResponse, (error) => sendResponse({ok: false, error: String(error.message || error)}));
  return true;
});

schedule();
