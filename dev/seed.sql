-- Demo data for local development only: npx wrangler d1 execute messiah --local --file dev/seed.sql
-- All listings are made up.
DELETE FROM listing_sources; DELETE FROM listings; DELETE FROM marks; DELETE FROM kv WHERE key IN ('scan', 'debug', 'ai', 'config');

INSERT INTO kv (key, value, updated_at) VALUES
 ('config', '{"enabled":true,"alertOnReview":false,"intervalMinutes":15,"groupUrls":["https://www.facebook.com/groups/telavivrentals"],"criteria":{"maxPrice":12000,"minRooms":3,"minBathrooms":2,"neighborhoods":["לב העיר","נווה צדק","כרם התימנים","רוטשילד"],"includeRoommates":false,"includeSublets":false},"sources":{"facebook":true,"yad2":true,"madlan":true,"homeless":true,"komo":true,"telegram":true,"telegramChannels":["@tlvrent"]}}', unixepoch() * 1000),
 ('scan', json_object('running', 0, 'lastRun', unixepoch() * 1000 - 240000, 'lastCounts', json_object('new', 2), 'updatedAt', unixepoch() * 1000 - 120000), unixepoch() * 1000),
 ('ai', '{"usage":{"calls":14,"input":52000,"output":6100},"error":""}', unixepoch() * 1000),
 ('debug', '{"https://www.yad2.co.il/realestate/rent":{"source":"yad2","title":"יד2","posts":20,"unique":20,"fresh":3,"merged":1,"filtered":0}}', unixepoch() * 1000);

INSERT INTO listings (id, text, url, source_type, source_name, source_url, external_key, ai, first_seen, last_seen, reposted_at, updated_at) VALUES
 ('a1', 'דירת 3 חדרים משופצת בשינקין, לב העיר. 2 שירותים, מרפסת שמש לרחוב, מעלית. 11,500 ₪ לחודש. כניסה מיידית.', 'https://www.facebook.com/groups/1/posts/1', 'facebook', 'דירות להשכרה בתל אביב', 'https://www.facebook.com/groups/1', NULL, NULL, unixepoch()*1000 - 360000, unixepoch()*1000, 0, unixepoch()*1000),
 ('a2', 'נווה צדק, 3.5 חדרים בבית לשימור, חניה בטאבו, ממ״ד. 10,800 ש״ח. גמישות בתאריך כניסה.', 'https://www.facebook.com/groups/1/posts/2', 'facebook', 'Tel Aviv Rentals', 'https://www.facebook.com/groups/1', NULL, NULL, unixepoch()*1000 - 2400000, unixepoch()*1000, 0, unixepoch()*1000),
 ('a3', 'כרם התימנים - דירת 3 חדרים עם 2 שירותים, משופצת לגמרי, חיות מחמד מותרות. 9,700 ₪', 'https://www.facebook.com/groups/1/posts/3', 'facebook', 'דירות במרכז תל אביב', 'https://www.facebook.com/groups/1', NULL, NULL, unixepoch()*1000 - 7800000, unixepoch()*1000, 0, unixepoch()*1000),
 ('a7', 'מחפשת דירה 3 חדרים בלב העיר עד 12,000 ₪, זוג עם חתול', 'https://www.facebook.com/groups/1/posts/7', 'facebook', 'דירות להשכרה בתל אביב', 'https://www.facebook.com/groups/1', NULL, NULL, unixepoch()*1000 - 900000, unixepoch()*1000, 0, unixepoch()*1000),
 ('a9', 'הובלות במחיר הוגן! הנחה לחברי הקבוצה, 050-1234567', 'https://www.facebook.com/groups/1/posts/9', 'facebook', 'דירות במרכז תל אביב', 'https://www.facebook.com/groups/1', NULL, NULL, unixepoch()*1000 - 4200000, unixepoch()*1000, 0, unixepoch()*1000),
 ('b1', 'להשכרה (יד2): דירה, שינקין 20, לב העיר
3 חדרים · קומה 2 · 2 שירותים
₪ 11,800', 'https://www.yad2.co.il/realestate/item/abc123', 'yad2', 'יד2', 'https://www.yad2.co.il/realestate/rent', 'yad2:abc123', '{"kind":"rental","by":"source"}', unixepoch()*1000 - 2100000, unixepoch()*1000, unixepoch()*1000 - 3600000, unixepoch()*1000);

INSERT INTO listing_sources (listing_id, type, name, url, seen_at) VALUES
 ('a1', 'facebook', 'דירות להשכרה בתל אביב', 'https://www.facebook.com/groups/1/posts/1', unixepoch()*1000),
 ('b1', 'yad2', 'יד2', 'https://www.yad2.co.il/realestate/item/abc123', unixepoch()*1000),
 ('b1', 'facebook', 'דירות להשכרה בתל אביב', 'https://www.facebook.com/groups/1/posts/11', unixepoch()*1000),
 ('b1', 'telegram', 'TLV Rentals', 'https://t.me/tlvrent/55', unixepoch()*1000);

INSERT INTO marks (listing_id, saved, hidden, kind, by_name, at) VALUES ('a3', 1, 0, '', 'נועה', unixepoch()*1000);
