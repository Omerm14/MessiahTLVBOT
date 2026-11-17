const P = require("../chrome-extension/parser.js");
const C = P.DEFAULT_CRITERIA;
const cases = [
  ["דירה בלב העיר, 3.5 חדרים, 2 שירותים, 11,800 ש״ח. מרפסת, מעלית וממ״ד. https://example.com/x?utm_source=a", "match"],
  ["להשכרה בנווה צדק דירת 3 חד' עם שירותי אורחים, 11.5 אלף לחודש, ללא חניה", "match"],
  ["מחפשת דירה 3 חדרים בלב העיר עד 12,000 ₪", "rejected"],
  ["דירה יפות 4 חדרים 2 שירותים 9,000 ₪", "review"],
  ["דירה ביפו 4 חדרים 2 שירותים 9,000 ₪", "rejected"],
  ["רוטשילד 4 חדרים 2 מקלחות שכירות 14,500", "rejected"],
  ["Lovely 3 rooms apartment in Neve Tzedek, 2 bathrooms, 11,000 NIS, balcony, no parking", "match"],
];
let ok = true;
for (const [text, expected] of cases) {
  const l = P.parseListing(text); const r = P.evaluate(l, C);
  const pass = r.status === expected; ok &&= pass;
  console.log(pass ? "PASS" : "FAIL", r.status, JSON.stringify({p:l.price,r:l.rooms,b:l.bathrooms,n:l.neighborhoods,bo:l.bonuses,u:l.url}), r.reasons.join(";"));
}
process.exit(ok ? 0 : 1);
