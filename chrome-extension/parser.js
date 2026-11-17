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

  // ---------- is this an apartment for rent? ----------
  // Rules decide the clear cases; anything below CONFIDENT goes to the AI step
  // (in the extension) or to "To review" when there is no AI.
  const CONFIDENT = 0.75;
  const KINDS = ["rental", "roommate", "sublet", "seeking", "sale", "service", "other"];
  const RENT_WORDS = /(להשכרה|להשכיר|משכיר|משכירה|משכירים|for rent|for lease|כניסה מיידית|כניסה ב|כניסה מ|שכירות|שכ["״']?ד|חוזה ל?שנה|ללא תיווך|בלי תיווך|דמי תיווך)/i;
  const FLOOR = /(קומה|קומת)\s*(\d|קרקע|ראשונה|שנייה|שניה|שלישית|רביעית|אחרונה)|\d+(st|nd|rd|th)\s+floor|floor\s*\d/i;
  const STREET = /(רחוב|רח['׳]|ברחוב|street|st\.)\s*[\p{L}"״' -]{2,25}\s*\d{1,3}\b/iu;
  const PHONE_RE = /(?:\+?972[-\s]?|0)(5\d)[-\s]?(\d{3})[-\s]?(\d{4})\b/g;
  const SEEKING_WIDE = /(מחפש|מחפשת|מחפשים|מחפשות|looking for|searching for|in search of|wanted|דרוש|דרושה|דרושים)\s+(?!(?:שוכר|שוכרת|שוכרים|דייר|דיירת|דיירים|מחליף|מחליפה|מחליפים|מישהו|מישהי|tenant|tenants|someone|a tenant))[^.\n]{0,40}(דירה|דירת|חדר|יחידת|סטודיו|apartment|room|flat|studio|place)/i;
  const KNOWS_OF = /(מישהו מכיר|מישהי מכירה|מכירים|מכירות|יודע(?:ים|ת)? על|anyone know)[^.\n]{0,30}(דירה|דירת|חדר|apartment|flat)/i;
  const BUDGET = /(תקציב|budget|עד\s+\d[\d,.]*\s*(?:₪|ש["״']?ח|אלף))/i;
  const ROOMMATE = /(שותף|שותפה|שותפים|שותפות|roommate|room ?mate|flatmate|חדר\s+(?:פנוי\s+)?(?:בדירת|בדירה)|חדר\s+להשכרה|room for rent|room available)/i;
  const WHOLE_APT = /(דירה שלמה|כל הדירה|ללא שותפים|בלי שותפים|לא לשותפים|entire (?:apartment|flat))/i;
  const SUBLET = /(סאבלט|סבלט|sub-?let|לתקופה קצרה|לטווח קצר|short[- ]term|לחודש בלבד|לחודשיים|לכמה חודשים|airbnb)/i;
  const SALE_WIDE = /(למכירה|for sale|נמכרת|מוכר(?:ת|ים)?\s+(?!דירה להשכרה)|למסירה|יד שנייה|יד שניה|ספה|מקרר|מכונת כביסה|ארון)/i;
  const SERVICE = /(הובלות|הובלה|מובילים|ניקיון|ניקיונות|שיפוצים|שיפוצניק|אינסטלטור|חשמלאי|משכנתא|משכנתאות|עו["״']?ד|עורך דין|עורכת דין|ביטוח|ייעוץ|יועץ|קורס|סדנה|הרצאה|וובינר|webinar|מכירה מוקדמת|פרויקט חדש|יזם|השקעה|תשואה)/i;
  const ADMIN = /(חוקי הקבוצה|ברוכים הבאים|ברוכות הבאות|מנהל(?:ת|י)? הקבוצה|הקבוצה מיועדת|פרסום בקבוצה|group rules|welcome to the group|admin)/i;
  const NON_HOME = /(חנות|משרד|קליניקה|מחסן|חניה|חנייה|parking spot|office|storage)\s*(להשכרה|for rent)/i;

  function countMatches(re, text) {
    return (text.match(new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g")) || []).length;
  }

  function classify(text, parsed) {
    const head = text.slice(0, 160);
    const reasons = [];
    let rentalScore = 0;
    if (parsed.price != null) { rentalScore += 2; reasons.push("price"); }
    if (parsed.rooms != null) { rentalScore += 2; reasons.push("rooms"); }
    if (parsed.bathrooms != null) rentalScore += 1;
    if (parsed.neighborhoods.length) rentalScore += 1;
    if (RENT_WORDS.test(text)) { rentalScore += 2; reasons.push("rent words"); }
    if (FLOOR.test(text)) rentalScore += 1;
    if (STREET.test(text)) rentalScore += 1;
    if (countMatches(PHONE_RE, text)) rentalScore += 1;

    const decide = (kind, confidence, why) => ({kind, confidence, reasons: [why, ...reasons]});
    if (ADMIN.test(head) && rentalScore < 5) return decide("other", 0.9, "group admin post");
    if (/(שותף|שותפה|שותפים|שותפות|roommate|room ?mate|flatmate)/i.test(head) && !WHOLE_APT.test(text)) {
      return decide("roommate", 0.9, "looking for a roommate");
    }
    if (SEEKING_WIDE.test(head) || KNOWS_OF.test(head)) {
      return decide("seeking", BUDGET.test(text) || rentalScore < 5 ? 0.9 : 0.7, "looking for an apartment");
    }
    if (ROOMMATE.test(text) && !WHOLE_APT.test(text)) return decide("roommate", 0.85, "room in a shared apartment");
    if (SUBLET.test(text)) return decide("sublet", rentalScore >= 4 ? 0.8 : 0.7, "short-term or sublet");
    if (SALE.test(text) && !RENT_WORDS.test(text)) return decide("sale", 0.9, "for sale");
    if (NON_HOME.test(text) && parsed.rooms == null) return decide("other", 0.85, "not a home");
    if (SERVICE.test(text) && rentalScore < 5) return decide("service", 0.8, "service or ad");
    if (SALE_WIDE.test(text) && rentalScore < 4) return decide("sale", 0.75, "item for sale or giveaway");
    if (text.length < 70 && parsed.price == null && parsed.rooms == null) return decide("other", 0.85, "too short to be a listing");
    if (/[?？]/.test(text) && parsed.price == null && parsed.rooms == null && text.length < 400) return decide("other", 0.8, "a question");
    if (rentalScore >= 5) return decide("rental", 0.9, "rental details");
    if (rentalScore >= 3) return decide("rental", 0.6, "some rental details");
    return decide("other", 0.55, "no rental details");
  }

  // Final kind: a person's correction beats the AI, the AI beats the rules.
  function resolveKind(parsed, ai, override) {
    if (override && KINDS.includes(override)) return {kind: override, confident: true, by: "person"};
    if (ai && KINDS.includes(ai.kind)) return {kind: ai.kind, confident: true, by: "ai"};
    return {kind: parsed.kind, confident: parsed.kindConfidence >= CONFIDENT, by: "rules"};
  }

  // Fill fields the regex missed with what the AI read from the post.
  function withAiFields(parsed, ai) {
    if (!ai || ai.by !== "ai") return parsed;
    return {
      ...parsed,
      price: parsed.price ?? (ai.price >= 1500 && ai.price <= 60000 ? ai.price : null),
      rooms: parsed.rooms ?? (ai.rooms >= 1 && ai.rooms <= 10 ? ai.rooms : null),
      street: ai.street || parsed.street || "",
    };
  }

  // ---------- duplicates ----------
  function extractPhones(text) {
    const phones = new Set();
    for (const m of String(text).matchAll(PHONE_RE)) phones.add(`0${m[1]}${m[2]}${m[3]}`);
    return [...phones];
  }

  function wordPairs(text) {
    const words = String(text).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((w) => w.length > 1);
    const pairs = new Set();
    for (let i = 0; i < words.length - 1; i++) pairs.add(`${words[i]} ${words[i + 1]}`);
    return pairs;
  }

  // Share of word pairs in common, 0..1 (Jaccard over 2-word shingles).
  function similarity(a, b) {
    const x = a instanceof Set ? a : wordPairs(a);
    const y = b instanceof Set ? b : wordPairs(b);
    if (!x.size || !y.size) return 0;
    let shared = 0;
    for (const pair of x) if (y.has(pair)) shared++;
    return shared / (x.size + y.size - shared);
  }

  function sameApartment(a, b) {
    if (a.price == null || b.price == null || a.rooms == null || b.rooms == null) return false;
    if (a.rooms !== b.rooms) return false;
    if (Math.abs(a.price - b.price) > Math.max(a.price, b.price) * 0.03) return false;
    if (a.street && b.street) return a.street.replace(/\s+/g, "") === b.street.replace(/\s+/g, "");
    const areasA = a.neighborhoods || [];
    const areasB = b.neighborhoods || [];
    return !areasA.length || !areasB.length || areasA.some((n) => areasB.includes(n));
  }

  // Is post b the same apartment as listing a?
  function isDuplicate(a, b) {
    const phonesA = a.phones || extractPhones(a.text);
    const phonesB = b.phones || extractPhones(b.text);
    const samePhone = phonesA.some((phone) => phonesB.includes(phone));
    if (samePhone && sameApartment(a, b)) return true;
    return similarity(a.text, b.text) >= 0.8;
  }
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

  function parseFields(rawText, url) {
    const text = rawText;
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
      phones: extractPhones(text),
    };
  }

  function parseListing(rawText, url) {
    const text = String(rawText || "").replace(/\s+/g, " ").trim();
    const parsed = parseFields(text, url);
    const kind = classify(text, parsed);
    return {...parsed, kind: kind.kind, kindConfidence: kind.confidence, kindReasons: kind.reasons};
  }

  const KIND_REASONS = {
    roommate: "חדר בדירת שותפים", sublet: "סאבלט או לתקופה קצרה", seeking: "מחפש/ת דירה",
    sale: "מכירה או מסירה", service: "פרסומת או שירות", other: "לא מודעה על דירה",
  };

  // Decide how a parsed listing relates to the user's criteria.
  // `kindInfo` comes from resolveKind(); without it the rules' own guess is used.
  function evaluate(listing, criteria, kindInfo = null) {
    const info = kindInfo || resolveKind(listing, null, null);
    const allowed = info.kind === "rental"
      || (info.kind === "roommate" && criteria.includeRoommates)
      || (info.kind === "sublet" && criteria.includeSublets);
    if (!allowed) return {status: "filtered", kind: info.kind, reasons: [KIND_REASONS[info.kind] || KIND_REASONS.other]};
    if (listing.forSale) return {status: "filtered", kind: "sale", reasons: [KIND_REASONS.sale]};
    const rejected = [];
    if (listing.price != null && listing.price > criteria.maxPrice) rejected.push(`מחיר מעל ${criteria.maxPrice.toLocaleString("he-IL")} ₪`);
    if (listing.rooms != null && listing.rooms < criteria.minRooms) rejected.push(`פחות מ־${criteria.minRooms} חדרים`);
    if (listing.bathrooms != null && listing.bathrooms < criteria.minBathrooms) rejected.push(`פחות מ־${criteria.minBathrooms} שירותים`);
    const wanted = criteria.neighborhoods || [];
    const inArea = !wanted.length || listing.neighborhoods.some((name) => wanted.includes(name));
    if (listing.neighborhoods.length && !inArea) rejected.push("מחוץ לאזורים שבחרת");
    if (rejected.length) return {status: "rejected", kind: info.kind, reasons: rejected};
    const missing = [];
    if (listing.price == null) missing.push("מחיר");
    if (listing.rooms == null) missing.push("חדרים");
    if (criteria.minBathrooms > 1 && listing.bathrooms == null) missing.push("שירותים");
    if (!listing.neighborhoods.length) missing.push("אזור");
    if (missing.length) return {status: "review", kind: info.kind, reasons: missing.map((field) => `חסר: ${field}`)};
    if (!info.confident) return {status: "review", kind: info.kind, reasons: ["לא בטוח שזו דירה להשכרה"]};
    return {status: "match", kind: info.kind, reasons: ["עומדת בכל התנאים"]};
  }

  const DEFAULT_CRITERIA = {
    maxPrice: 12000,
    minRooms: 3,
    minBathrooms: 2,
    neighborhoods: ["לב העיר", "נווה צדק", "כרם התימנים", "רוטשילד"],
    includeRoommates: false,
    includeSublets: false,
  };

  const api = {
    parseListing, evaluate, classify, resolveKind, withAiFields, extractPhones, similarity, wordPairs, sameApartment, isDuplicate,
    DEFAULT_CRITERIA, NEIGHBORHOOD_NAMES: Object.keys(NEIGHBORHOODS), KINDS, KIND_REASONS, CONFIDENT,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ApartmentParser = api;
})(typeof self !== "undefined" ? self : this);
