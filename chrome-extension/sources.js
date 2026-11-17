// Page readers for the non-Facebook sources. Each function runs inside the source's
// tab via chrome.scripting.executeScript({func, args: [rules]}), so it must be fully
// self-contained. Everything site-specific (URLs, link patterns, selectors) lives in
// rules.json under "sources", so a site change can be fixed without reinstalling.
(function (root) {
  // Listing sites (Yad2, Madlan, Homeless, Komo): find links to listing pages, then
  // climb to the card that holds the price and details.
  function collectListingPage(rules) {
    const itemLink = new RegExp(rules.itemLink, "i");
    const imageSrc = rules.imageSrc ? new RegExp(rules.imageSrc, "i") : null;
    const blocked = rules.blockedText ? new RegExp(rules.blockedText, "i") : null;
    if (blocked && blocked.test(document.body?.innerText?.slice(0, 3000) || "")) return {blocked: true, posts: []};
    const seen = new Map();
    for (const a of document.querySelectorAll("a[href]")) {
      const match = a.href.match(itemLink);
      if (!match) continue;
      const externalId = match[1] || match[0];
      if (seen.has(externalId)) continue;
      let card = rules.cardSelector ? a.closest(rules.cardSelector) : null;
      if (!card) {
        card = a;
        for (let i = 0; i < (rules.maxClimb || 6) && card.parentElement; i++) {
          if (/₪|ש["״]ח|\d{1,2},\d{3}/.test(card.innerText || "") && (card.innerText || "").length > 30) break;
          card = card.parentElement;
        }
      }
      const text = (card.innerText || "").split("\n").map((s) => s.trim()).filter(Boolean)
        .filter((line, i, all) => all.indexOf(line) === i).join("\n");
      if (text.length < (rules.minTextLength || 20)) continue;
      const img = [...card.querySelectorAll("img")].find((el) => el.src && (!imageSrc || imageSrc.test(el.src)));
      seen.set(externalId, {
        text: `${rules.prefix || ""}${text}`.slice(0, 3000),
        url: a.href.split("#")[0],
        externalId: String(externalId),
        image: img ? img.src : "",
        postedLabel: "",
        author: "",
      });
    }
    window.scrollBy(0, Math.max(900, window.innerHeight * 0.9));
    return {
      blocked: false,
      posts: [...seen.values()],
      groupName: (document.title || "").trim().slice(0, 100),
      stats: {units: seen.size},
      samples: [...seen.values()].slice(0, 3).map((p) => p.text.slice(0, 160)),
    };
  }

  // Public Telegram channels via the web preview at t.me/s/<channel>.
  function collectTelegram(rules) {
    const posts = [];
    for (const message of document.querySelectorAll(rules.messageSelector)) {
      const text = (message.querySelector(rules.textSelector)?.innerText || "").trim();
      if (text.length < (rules.minTextLength || 25)) continue;
      const postId = message.getAttribute("data-post") || "";
      const photo = message.querySelector(rules.photoSelector);
      const image = photo ? ((photo.getAttribute("style") || "").match(/url\(['"]?([^'")]+)/) || [])[1] || "" : "";
      const time = message.querySelector("time[datetime]")?.getAttribute("datetime") || "";
      posts.push({
        text: text.slice(0, 6000),
        url: postId ? `https://t.me/${postId}` : "",
        externalId: postId,
        image,
        postedLabel: time ? new Date(time).toLocaleDateString("he-IL") : "",
        author: "",
      });
    }
    window.scrollTo(0, 0); // older messages load when scrolling up
    return {
      blocked: false,
      posts,
      groupName: (document.querySelector(rules.titleSelector)?.innerText || document.title || "").trim().slice(0, 100),
      stats: {units: posts.length},
      samples: posts.slice(0, 3).map((p) => p.text.slice(0, 160)),
    };
  }

  const LISTING_SITES = ["yad2", "madlan", "homeless", "komo"];

  // Which pages a scan visits, built from the settings and the search criteria.
  function targetsFor(config, rules) {
    const sources = {...DEFAULT_SOURCES, ...(config.sources || {})};
    const criteria = config.criteria || {};
    const fill = (template) => template
      .replace("{maxPrice}", String(criteria.maxPrice || 12000))
      .replace("{minRooms}", String(criteria.minRooms || 1));
    const targets = [];
    if (sources.facebook !== false) {
      for (const url of config.groupUrls || []) targets.push({type: "facebook", url});
    }
    for (const type of LISTING_SITES) {
      const site = rules.sources?.[type];
      if (sources[type] && site?.url) targets.push({type, url: fill(site.url), trusted: true});
    }
    if (sources.telegram && rules.sources?.telegram) {
      for (const raw of sources.telegramChannels || []) {
        const channel = String(raw).trim().replace(/^@/, "").replace(/^https?:\/\/t\.me\/(s\/)?/, "").split(/[/?#]/)[0];
        if (/^[A-Za-z0-9_]{4,64}$/.test(channel)) targets.push({type: "telegram", url: `https://t.me/s/${channel}`});
      }
    }
    return targets;
  }

  const DEFAULT_SOURCES = {
    facebook: true, yad2: true, madlan: true, homeless: true, komo: true, telegram: true, telegramChannels: [],
  };

  root.HunterSources = {collectListingPage, collectTelegram, targetsFor, LISTING_SITES, DEFAULT_SOURCES};
})(typeof self !== "undefined" ? self : this);
