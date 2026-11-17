// Phase 0 probe: what does each source return to a server (GitHub Actions)?
// For every source it tries a plain HTTP fetch and then a real headless browser,
// and prints a short report: status, bot checks, embedded data, and the most common
// link patterns (to find each site's listing URL format). Full pages are saved to
// probe-out/ for the workflow artifact.
import fs from "node:fs";

const OUT = "probe-out";
fs.mkdirSync(OUT, {recursive: true});

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const TARGETS = [
  {id: "yad2-page", url: "https://www.yad2.co.il/realestate/rent?city=5000"},
  {id: "yad2-api-legacy", url: "https://gw.yad2.co.il/feed-search-legacy/realestate/rent?city=5000&page=1", json: true},
  {id: "yad2-api-feed", url: "https://gw.yad2.co.il/realestate-feed/rent/feed?city=5000", json: true},
  {id: "madlan-page", url: "https://www.madlan.co.il/for-rent/%D7%AA%D7%9C-%D7%90%D7%91%D7%99%D7%91-%D7%99%D7%A4%D7%95-%D7%99%D7%A9%D7%A8%D7%90%D7%9C"},
  {id: "homeless", url: "https://www.homeless.co.il/rent/"},
  {id: "komo", url: "https://www.komo.co.il/code/nadlan/apartments-for-rent.asp"},
  {id: "telegram", url: "https://t.me/s/telegram"},
];
const BOT = /(captcha|are you for real|shieldsquare|perimeterx|px-captcha|cf-chl|access denied|attention required|אנא אשרו|robot)/i;

function linkPatterns(html, base) {
  const counts = new Map();
  const examples = new Map();
  for (const m of html.matchAll(/href=["']([^"'#]+)["']/gi)) {
    let url;
    try { url = new URL(m[1], base); } catch { continue; }
    const pattern = `${url.hostname}${url.pathname.replace(/\d{3,}/g, "{n}").replace(/[A-Za-z0-9]{8,}(?=\/|$)/g, "{id}")}`;
    counts.set(pattern, (counts.get(pattern) || 0) + 1);
    if (!examples.has(pattern)) examples.set(pattern, url.href.slice(0, 140));
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)
    .map(([pattern, n]) => `${n}× ${pattern}  e.g. ${examples.get(pattern)}`);
}

function summarize(id, how, status, body, base) {
  const text = body.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  const report = {
    id, how, status, bytes: body.length,
    title: (body.match(/<title[^>]*>([^<]*)/i) || [])[1]?.trim().slice(0, 80) || "",
    botCheck: BOT.test(body.slice(0, 20000)) ? (body.match(BOT) || [])[0] : "",
    nextData: /__NEXT_DATA__/.test(body),
    jsonLd: (body.match(/application\/ld\+json/g) || []).length,
    shekels: (text.match(/₪|ש"ח|ש״ח/g) || []).length,
    roomsWords: (text.match(/חדרים|חד'/g) || []).length,
    sampleText: text.slice(0, 300),
    links: base ? linkPatterns(body, base) : [],
  };
  fs.writeFileSync(`${OUT}/${id}-${how}.html`, body);
  return report;
}

async function plain(target) {
  try {
    const res = await fetch(target.url, {
      headers: {"user-agent": UA, "accept-language": "he-IL,he;q=0.9,en;q=0.8", accept: target.json ? "application/json" : "text/html"},
      redirect: "follow", signal: AbortSignal.timeout(25000),
    });
    const body = await res.text();
    const report = summarize(target.id, "fetch", res.status, body, target.json ? null : target.url);
    if (target.json) {
      try {
        const data = JSON.parse(body);
        report.jsonKeys = Object.keys(data).slice(0, 15);
        report.jsonSample = JSON.stringify(data).slice(0, 600);
      } catch { report.jsonKeys = "not JSON"; }
    }
    return report;
  } catch (error) {
    return {id: target.id, how: "fetch", error: String(error.message || error)};
  }
}

async function browser(page, target) {
  try {
    const res = await page.goto(target.url, {waitUntil: "domcontentloaded", timeout: 45000});
    await page.waitForTimeout(6000);
    for (let i = 0; i < 3; i++) { await page.mouse.wheel(0, 1500); await page.waitForTimeout(1500); }
    const body = await page.content();
    const report = summarize(target.id, "browser", res?.status() ?? 0, body, page.url());
    report.finalUrl = page.url();
    report.renderedText = (await page.evaluate(() => document.body?.innerText || "")).replace(/\s+/g, " ").slice(0, 400);
    await page.screenshot({path: `${OUT}/${target.id}.png`, fullPage: false}).catch(() => {});
    return report;
  } catch (error) {
    return {id: target.id, how: "browser", error: String(error.message || error)};
  }
}

const results = [];
for (const target of TARGETS) results.push(await plain(target));

try {
  const {chromium} = await import("playwright");
  const b = await chromium.launch();
  const context = await b.newContext({userAgent: UA, locale: "he-IL", viewport: {width: 1280, height: 900}});
  const page = await context.newPage();
  for (const target of TARGETS.filter((t) => !t.json)) results.push(await browser(page, target));
  await b.close();
} catch (error) {
  results.push({id: "browser", error: `Playwright unavailable: ${error.message}`});
}

fs.writeFileSync(`${OUT}/report.json`, JSON.stringify(results, null, 2));
for (const r of results) {
  console.log(`\n===== ${r.id} [${r.how || ""}] =====`);
  console.log(JSON.stringify({...r, links: undefined, sampleText: undefined, renderedText: undefined}));
  if (r.renderedText) console.log("rendered:", r.renderedText);
  else if (r.sampleText) console.log("text:", r.sampleText);
  for (const line of r.links || []) console.log("  link", line);
}
