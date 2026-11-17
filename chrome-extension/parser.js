// Turns a free-text apartment post into structured fields.
// Shared by the background worker (importScripts) and the dashboard (<script>).
(function (root) {
  const NEIGHBORHOODS = {
    "לב העיר": ["לב העיר", "לב תל אביב", "lev hair", "lev ha'ir", "lev ha’ir"],
    "נווה צדק": ["נווה צדק", "נוה צדק", "neve tzedek", "neve tsedek"],
    "כרם התימנים": ["כרם התימנים", "הכרם", "kerem hateimanim", "kerem hateymanim"],
    "רוטשילד": ["רוטשילד", "rothschild"],
    "פלורנטין": ["פלורנטין", "florentin"],
    "הצפון הישן": ["הצפון הישן", "צפון ישן", "old north"],
    "הצפון החדש": ["הצפון החדש", "צפון חדש", "new north"],
    "יפו": ["יפו", "jaffa", "yafo"],
    "מונטיפיורי": ["מונטיפיורי", "montefiore"],
    "שבזי / נגה": ["שבזי", "נגה", "המושבה האמריקאית"],
    "בבלי": ["בבלי", "bavli"],
    "רמת אביב": ["רמת אביב", "ramat aviv"],
  };

  const BONUSES = {
    "חניה": ["חניה", "חנייה", "parking"],
    "מרפסת": ["מרפסת", "מרפסות", "balcony"],
    "ממ״ד": ["ממ״ד", 'ממ"ד', "ממד", "safe room", "shelter room"],
    "מעלית": ["מעלית", "elevator", "lift"],
    "משופצת": ["משופצת", "שופצה", "renovated"],
    "מרוהטת": ["מרוהטת", "furnished"],
    "חיות": ["חיות מחמד", "בעלי חיים", "pets allowed", "pet friendly"],
  };

  const NUM = "(\\d{1,2}(?:[,.]\\d{3})+|\\d{4,5})";
  const PRICE_PATTERNS = [
    new RegExp(`(?:₪|ש["״']?ח|מחיר|שכ["״']?ד|שכירות|rent|nis)\\s*[:\\-]?\\s*${NUM}`, "i"),
    new RegExp(`${NUM}\\s*(?:₪|ש["״']?ח|nis|ils|שקל)`, "i"),
  ];
  const PRICE_THOUSANDS = /(\d{1,2}(?:[.,]\d)?)\s*(?:אלף|k\b)/i;
  const ROOMS_RE = /(\d+(?:[.,]5)?)\s*(?:חדרים?|חד[׳'](?!\s*שינה)|ח[׳']|rooms?)(?!\s*שינה)/i;
  const ROOMS_PREFIX_RE = /(?:דירת|דירה של)\s*(\d+(?:[.,]5)?)\s*(?:חד|ח[׳'])?/i;
  const BATH_PATTERNS = [
    /(\d+)\s*(?:חדרי?\s*)?(?:שירותים|שרותים|אסלות|חדרי?\s*רחצה|מקלחות|bathrooms?|baths?|toilets?|wc)/i,
    /(?:שירותים|שרותים|bathrooms?|toilets?|wc)\s*[:\-]?\s*(\d+)/i,
  ];
  const GUEST_TOILET = /(שירותי|שרותי)\s*אורחים|guest\s*(toilet|bathroom|wc)|שירותים\s*נוספים/i;
  const SEEKING = /(מחפש|מחפשת|מחפשים|מחפשות|looking for|searching for|wanted)[^.\n]{0,25}(דירה|דירת|חדר|apartment|room|flat)/i;
  const SALE = /(למכירה|for sale|נמכרת)/i;
  const URL_RE = /https?:\/\/[^\s<>\]\[()]+/i;

  function toNumber(raw) {
    return Number(String(raw).replace(/[,.]/g, ""));
  }

  function findPrice(text) {
    for (const pattern of PRICE_PATTERNS) {
      const match = text.match(pattern);
      if (match) {
        const value = toNumber(match[1]);
        if (value >= 1500 && value <= 60000) return value;
      }
    }
    const thousands = text.match(PRICE_THOUSANDS);
    if (thousands) {
      const value = Math.round(Number(thousands[1].replace(",", ".")) * 1000);
      if (value >= 1500 && value <= 60000) return value;
    }
    return null;
  }

  // Facebook rental listings say "3 beds · 2 baths"; Israeli room count = bedrooms + living room.
  const BEDS_RE = /(\d)\s*(?:beds?|bedrooms?|חדרי שינה|חד[׳']?\s*שינה)/i;

  function findRooms(text) {
    const match = text.match(ROOMS_RE) || text.match(ROOMS_PREFIX_RE);
    if (!match) {
      const beds = text.match(BEDS_RE);
      return beds ? Number(beds[1]) + 1 : null;
    }
    const value = Number(match[1].replace(",", "."));
    return value >= 1 && value <= 10 ? value : null;
  }

  function findBathrooms(text) {
    for (const pattern of BATH_PATTERNS) {
      const match = text.match(pattern);
      if (match) {
        const value = Number(match[1]);
        if (value >= 1 && value <= 6) return value;
      }
    }
    return GUEST_TOILET.test(text) ? 2 : null;
  }

  function escapeRe(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  // Whole-word match that allows Hebrew prefixes such as ב/ל/ה/ו ("בנווה צדק").
  function hasWord(text, alias) {
    return new RegExp(`(?:^|[^\\p{L}])[ובלהמש]{0,2}${escapeRe(alias.toLowerCase())}(?=$|[^\\p{L}])`, "u").test(text);
  }

  function hasPositive(text, aliases) {
    return aliases.some((alias) => {
      const value = escapeRe(alias.toLowerCase());
      if (!hasWord(text, alias)) return false;
      return !new RegExp(`(?:ללא|בלי|אין|no|without)\\s+(?:\\S+\\s+){0,2}${value}`).test(text);
    });
  }

  function cleanUrl(url) {
    try {
      const parsed = new URL(url.replace(/[.,;:!?"']+$/, ""));
      [...parsed.searchParams.keys()].forEach((key) => {
        if (/^(utm_|fbclid|gclid|__cft__|__tn__|mibextid|rdid|share_url)/i.test(key)) parsed.searchParams.delete(key);
      });
      parsed.hash = "";
      return parsed.toString().replace(/\/$/, "");
    } catch {
      return "";
    }
  }

  function normalizeForFingerprint(text) {
    return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "").slice(0, 600);
  }

  function parseListing(rawText, url) {
    const text = rawText.replace(/\s+/g, " ").trim();
    const lowered = text.toLowerCase();
    const neighborhoods = Object.entries(NEIGHBORHOODS)
      .filter(([, aliases]) => aliases.some((alias) => hasWord(lowered, alias)))
      .map(([name]) => name);
    const linkInText = text.match(URL_RE);
    return {
      price: findPrice(text),
      rooms: findRooms(text),
      bathrooms: findBathrooms(text),
      neighborhoods,
      bonuses: Object.entries(BONUSES).filter(([, aliases]) => hasPositive(lowered, aliases)).map(([name]) => name),
      seeking: SEEKING.test(text),
      forSale: SALE.test(text),
      url: cleanUrl(url || (linkInText ? linkInText[0] : "")),
      textKey: normalizeForFingerprint(text),
    };
  }

  // Decide how a parsed listing relates to the user's criteria.
  function evaluate(listing, criteria) {
    if (listing.seeking) return {status: "rejected", reasons: ["פוסט של מחפש/ת דירה"]};
    if (listing.forSale) return {status: "rejected", reasons: ["דירה למכירה"]};
    const rejected = [];
    if (listing.price != null && listing.price > criteria.maxPrice) rejected.push(`מחיר מעל ${criteria.maxPrice.toLocaleString("he-IL")} ₪`);
    if (listing.rooms != null && listing.rooms < criteria.minRooms) rejected.push(`פחות מ־${criteria.minRooms} חדרים`);
    if (listing.bathrooms != null && listing.bathrooms < criteria.minBathrooms) rejected.push(`פחות מ־${criteria.minBathrooms} שירותים`);
    const wanted = criteria.neighborhoods || [];
    const inArea = !wanted.length || listing.neighborhoods.some((name) => wanted.includes(name));
    if (listing.neighborhoods.length && !inArea) rejected.push("מחוץ לאזורים שבחרת");
    if (rejected.length) return {status: "rejected", reasons: rejected};
    const missing = [];
    if (listing.price == null) missing.push("מחיר");
    if (listing.rooms == null) missing.push("חדרים");
    if (criteria.minBathrooms > 1 && listing.bathrooms == null) missing.push("שירותים");
    if (!listing.neighborhoods.length) missing.push("אזור");
    if (missing.length) return {status: "review", reasons: missing.map((field) => `חסר: ${field}`)};
    return {status: "match", reasons: ["עומדת בכל התנאים"]};
  }

  const DEFAULT_CRITERIA = {
    maxPrice: 12000,
    minRooms: 3,
    minBathrooms: 2,
    neighborhoods: ["לב העיר", "נווה צדק", "כרם התימנים", "רוטשילד"],
  };

  const api = {parseListing, evaluate, DEFAULT_CRITERIA, NEIGHBORHOOD_NAMES: Object.keys(NEIGHBORHOODS)};
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ApartmentParser = api;
})(typeof self !== "undefined" ? self : this);
