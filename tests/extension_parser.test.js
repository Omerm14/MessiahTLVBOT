const P = require("../docs/parser.js");
const FIXTURES = require("./fixtures/posts.json");
const C = P.DEFAULT_CRITERIA;
let ok = true;
const check = (pass, label, detail = "") => {
  ok &&= pass;
  console.log(pass ? "PASS" : "FAIL", label, detail);
};

// Status against the default criteria.
const cases = [
  ["דירה בלב העיר, 3.5 חדרים, 2 שירותים, 11,800 ש״ח. מרפסת, מעלית וממ״ד. https://example.com/x?utm_source=a", "match"],
  ["להשכרה בנווה צדק דירת 3 חד' עם שירותי אורחים, 11.5 אלף לחודש, ללא חניה", "match"],
  ["מחפשת דירה 3 חדרים בלב העיר עד 12,000 ₪", "filtered"],
  ["דירה יפות 4 חדרים 2 שירותים 9,000 ₪", "review"],
  ["דירה ביפו 4 חדרים 2 שירותים 9,000 ₪", "rejected"],
  ["רוטשילד 4 חדרים 2 מקלחות שכירות 14,500", "rejected"],
  ["Lovely 3 rooms apartment in Neve Tzedek, 2 bathrooms, 11,000 NIS, balcony, no parking", "match"],
  ["חדר להשכרה בדירת 3 חדרים ברוטשילד, 4500 ₪", "filtered"],
];
for (const [text, expected] of cases) {
  const l = P.parseListing(text);
  const r = P.evaluate(l, C);
  check(r.status === expected, `status ${r.status}`, `${text.slice(0, 50)} · ${r.reasons.join(";")}`);
}

// Roommate rooms show up when the setting allows them.
{
  const l = P.parseListing("חדר להשכרה בדירת 3 חדרים ברוטשילד, 2 שירותים, 4500 ₪");
  const r = P.evaluate(l, {...C, includeRoommates: true});
  check(r.status !== "filtered", "roommates allowed by setting", r.status);
}

// A person's correction and the AI result beat the rules.
{
  const l = P.parseListing("מה דעתכם על השכונה?");
  check(P.resolveKind(l, {kind: "rental"}, null).kind === "rental", "AI beats rules");
  check(P.resolveKind(l, {kind: "rental"}, "service").kind === "service", "person beats AI");
}

// Unsure rental guesses never reach Matches.
{
  const l = {...P.parseListing("לב העיר 3 חדרים 2 שירותים 11,000"), kindConfidence: 0.6, kind: "rental"};
  check(P.evaluate(l, C).status !== "match", "unsure rental goes to review", P.evaluate(l, C).status);
}

// Labelled examples: every junk kind must be recognised.
let correct = 0;
let junkAsRental = 0;
let rentalAsJunk = 0;
for (const f of FIXTURES) {
  const l = P.parseListing(f.text);
  if (l.kind === f.kind) correct++;
  else console.log("  miss", f.kind, "→", l.kind, l.kindConfidence, f.text.slice(0, 60));
  if (f.kind !== "rental" && l.kind === "rental" && l.kindConfidence >= P.CONFIDENT) junkAsRental++;
  if (f.kind === "rental" && l.kind !== "rental") rentalAsJunk++;
}
const accuracy = correct / FIXTURES.length;
check(accuracy >= 0.95, `classifier accuracy ${(accuracy * 100).toFixed(1)}% on ${FIXTURES.length} examples`);
check(junkAsRental === 0, "no junk confidently marked as rental", String(junkAsRental));
check(rentalAsJunk === 0, "no real rental marked as junk", String(rentalAsJunk));

// Duplicates.
const a = "להשכרה בלב העיר! דירת 3 חדרים משופצת ברחוב שינקין 12, קומה 2 עם מעלית, 2 שירותים, מרפסת שמש. 11,500 ₪ לחודש. כניסה מיידית. 052-1234567";
const edited = "להשכרה בלב העיר!! דירת 3 חדרים משופצת ברחוב שינקין 12, קומה 2 עם מעלית, 2 שירותים, מרפסת שמש גדולה. 11,500 ₪ לחודש. כניסה מיידית. 052-1234567";
const rewritten = "דירה מהממת בשינקין, לב העיר, 3 חד׳ 2 שירותים, 11,400 ש״ח. טלפון 0521234567";
const other = "להשכרה בנווה צדק דירת 3 חד' עם 2 שירותים, 11,500 לחודש, 052-1234567";
const withText = (t) => ({...P.parseListing(t), text: t});
check(P.isDuplicate(withText(a), withText(edited)), "small edit is a duplicate");
check(P.isDuplicate(withText(a), withText(rewritten)), "same phone, price and rooms is a duplicate");
check(!P.isDuplicate(withText(a), withText(other)), "different area is not a duplicate");
check(P.extractPhones("tel +972-52-123-4567 or 0521234567").length === 1, "phones normalised");

process.exit(ok ? 0 : 1);
