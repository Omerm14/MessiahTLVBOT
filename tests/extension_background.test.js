// Runs chrome-extension/background.js against an in-memory fake of the Chrome APIs
// to check duplicate merging, the AI step and the per-chat sign-in links.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const dir = path.join(__dirname, "..", "chrome-extension");
let ok = true;
const check = (pass, label, detail = "") => {
  ok &&= pass;
  console.log(pass ? "PASS" : "FAIL", label, detail);
};

function makeWorld({anthropicKey = "", aiReply = null} = {}) {
  const store = {
    pairing: {githubToken: "github_pat_x", key: "k", ownerKey: "o", name: "Omer"},
    secrets: {telegramToken: "1:abc", anthropicKey, ownerChatId: "111", members: [{name: "Noa", chatId: "222", link: "https://app/#noa"}]},
    meta: {mergedV1: true},
  };
  const calls = {anthropic: [], telegram: []};
  const noop = () => {};
  const listener = {addListener: noop};
  const chrome = {
    storage: {local: {
      get: async (keys) => {
        const out = {};
        for (const key of [].concat(keys)) if (key in store) out[key] = JSON.parse(JSON.stringify(store[key]));
        return out;
      },
      set: async (obj) => { Object.assign(store, JSON.parse(JSON.stringify(obj))); },
    }, onChanged: listener},
    alarms: {create: noop, clear: async () => {}, onAlarm: listener},
    runtime: {onInstalled: listener, onStartup: listener, onMessage: listener, getManifest: () => ({version: "test"}), getURL: (p) => p},
    action: {onClicked: listener},
    tabs: {create: noop},
  };
  const fetch = async (url, init = {}) => {
    if (url.startsWith("https://api.anthropic.com")) {
      const body = JSON.parse(init.body);
      calls.anthropic.push(body);
      const posts = JSON.parse(body.messages[0].content.split("Posts:\n")[1]);
      const results = posts.map((p) => ({id: p.id, street: "", price: 0, rooms: 0, ...(aiReply ? aiReply(p) : {kind: "rental", confidence: 0.9})}));
      return {ok: true, json: async () => ({stop_reason: "end_turn", content: [{type: "text", text: JSON.stringify({results})}], usage: {input_tokens: 100, output_tokens: 20}})};
    }
    if (url.startsWith("https://api.telegram.org")) {
      calls.telegram.push(JSON.parse(init.body));
      return {ok: true, json: async () => ({ok: true})};
    }
    return {ok: false, status: 404, json: async () => ({}), text: async () => ""};
  };
  const context = {
    console, setTimeout, clearTimeout, URL, URLSearchParams, TextEncoder, TextDecoder, Blob, Response,
    CompressionStream, DecompressionStream, crypto, btoa, atob, fetch, chrome,
  };
  context.self = context;
  context.importScripts = (...files) => {
    for (const file of files) vm.runInContext(fs.readFileSync(path.join(dir, file), "utf8"), context, {filename: file});
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(dir, "background.js"), "utf8"), context, {filename: "background.js"});
  // The marks file read for AI examples needs GitHub; skip it in tests.
  context.correctionExamples = async () => [];
  vm.runInContext("correctionExamples = self.correctionExamples;", context);
  return {context, store, calls};
}

const config = {criteria: {maxPrice: 12000, minRooms: 3, minBathrooms: 2, neighborhoods: ["לב העיר", "נווה צדק"]}};
const target = {type: "facebook", url: "https://www.facebook.com/groups/1"};
const post = (text, url) => ({text, url, image: "", postedLabel: "", author: ""});

(async () => {
  // Duplicates: the same apartment posted twice, once rewritten, plus a different one.
  {
    const {context, store} = makeWorld();
    const first = await context.storePosts([
      post("להשכרה בלב העיר! דירת 3 חדרים משופצת ברחוב שינקין 12, קומה 2, 2 שירותים. 11,500 ₪ לחודש. 052-1234567", "https://www.facebook.com/groups/1/posts/1"),
    ], target, "קבוצה א", "quick", config);
    const second = await context.storePosts([
      post("דירה מהממת בשינקין, לב העיר, 3 חד׳ 2 שירותים, 11,400 ש״ח. טלפון 0521234567", "https://www.facebook.com/groups/2/posts/9"),
      post("להשכרה בנווה צדק דירת 3 חד' עם 2 שירותים, 11,000 לחודש, 054-0000000", "https://www.facebook.com/groups/2/posts/10"),
    ], {...target, url: "https://www.facebook.com/groups/2"}, "קבוצה ב", "quick", config);
    const listings = Object.values(store.listings);
    check(first.fresh.length === 1 && second.fresh.length === 1 && second.merged === 1, "rewritten repost merged, new apartment kept",
      `fresh ${first.fresh.length}+${second.fresh.length}, merged ${second.merged}`);
    const merged = listings.find((l) => l.sources.length === 2);
    check(listings.length === 2 && !!merged, "merged listing lists both groups", merged?.sources.map((s) => s.name).join(", "));
  }

  // Junk is filtered and never alerted; unsure posts go to review without an AI key.
  {
    const {context} = makeWorld();
    const {fresh} = await context.storePosts([
      post("מחפשת דירה 3 חדרים בלב העיר עד 12,000 ₪", "https://www.facebook.com/groups/1/posts/2"),
      post("לב העיר 3 חדרים 2 שירותים", "https://www.facebook.com/groups/1/posts/3"),
    ], target, "קבוצה א", "quick", config);
    const byText = (t) => fresh.find((l) => l.text.startsWith(t));
    check(byText("מחפשת").status === "filtered", "person searching is filtered", byText("מחפשת").status);
    check(byText("לב העיר").status === "review", "unsure post without AI goes to review", `${byText("לב העיר").status} ${byText("לב העיר").reasons}`);
  }

  // With a key, unsure posts are sent to the AI and its answer is used.
  {
    const {context, calls} = makeWorld({anthropicKey: "sk-ant-test", aiReply: (p) => ({kind: "rental", confidence: 0.95, price: 11000})});
    const {fresh} = await context.storePosts([
      post("לב העיר 3 חדרים 2 שירותים 11,000", "https://www.facebook.com/groups/1/posts/4"),
      post("להשכרה בלב העיר! דירת 3 חדרים ברחוב שינקין 12, קומה 2, 2 שירותים. 11,500 ₪ לחודש. 052-1234567", "https://www.facebook.com/groups/1/posts/5"),
    ], target, "קבוצה א", "quick", config);
    const request = calls.anthropic[0];
    check(calls.anthropic.length === 1, "one AI request for the unsure post only", `${calls.anthropic.length} requests`);
    check(request?.model === "claude-haiku-5-5" && request?.output_config?.format?.type === "json_schema", "AI request uses Haiku with a JSON schema");
    const sent = request ? JSON.parse(request.messages[0].content.split("Posts:\n")[1]) : [];
    check(sent.length === 1, "confident post not sent to AI", `${sent.length} sent`);
    const confirmed = fresh.find((l) => l.text.startsWith("לב העיר"));
    check(confirmed.status === "match" && confirmed.price === 11000, "AI-confirmed rental becomes a match, with the price it read", `${confirmed.status} ${confirmed.price}`);
  }

  // The AI can also overrule the rules toward junk.
  {
    const {context} = makeWorld({anthropicKey: "sk-ant-test", aiReply: () => ({kind: "service", confidence: 0.9})});
    const {fresh} = await context.storePosts([post("לב העיר 3 חדרים 2 שירותים 11,000", "https://www.facebook.com/groups/1/posts/6")], target, "א", "quick", config);
    check(fresh[0].status === "filtered", "AI-flagged ad is filtered", fresh[0].status);
  }

  // Listing sites are trusted as rentals and never sent to the AI.
  {
    const {context, calls} = makeWorld({anthropicKey: "sk-ant-test"});
    const {fresh} = await context.storePosts([{...post("להשכרה (יד2): דירה, שינקין 20, לב העיר 3 חדרים 2 שירותים ₪ 11,800", "https://www.yad2.co.il/realestate/item/abc"), externalId: "abc"}],
      {type: "yad2", url: "https://www.yad2.co.il/realestate/rent", trusted: true}, "יד2", "quick", config);
    check(calls.anthropic.length === 0 && fresh[0].status === "match", "Yad2 listing is a match without AI", fresh[0].status);
  }

  // Alerts: each chat's "open the board" button carries that person's own link.
  {
    const {context, calls} = makeWorld();
    const listing = {...context.ApartmentParser.parseListing("לב העיר 3 חדרים 11,000"), text: "x", url: "https://www.facebook.com/p/1", source: ""};
    await context.telegram({telegramChatId: "111, 222, 333"}, "hi", context.alertButtons(listing));
    const boardLink = (chat) => calls.telegram.find((c) => c.chat_id === chat).reply_markup.inline_keyboard[0][1].url;
    check(boardLink("111").includes("#t=github_pat_x"), "owner's alert signs the owner in");
    check(boardLink("222") === "https://app/#noa", "member's alert uses the member's link");
    check(!boardLink("333").includes("#"), "unknown chat gets the plain address", boardLink("333"));
  }

  process.exit(ok ? 0 : 1);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
