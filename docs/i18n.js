// Hebrew is the default; English is a full alternative. Static markup uses data-i18n
// (text), data-i18n-html (trusted strings from this file only), data-i18n-placeholder
// and data-i18n-aria. Parser output (areas, extras, reasons) stays Hebrew in the data
// and is translated only for display.
(function (root) {
  const STRINGS = {
    he: {
      appName: "Messiah",
      loading: "טוען…",
      gateLead: "כדי לפתוח את הלוח צריך קישור אישי.",
      gateDesktop: "<b>במחשב:</b> לחץ על אייקון Messiah בסרגל של Chrome.",
      gatePhone: "<b>בטלפון:</b> פתח את הלוח במחשב, עבור אל <b>הגדרות ← פתיחה בטלפון</b> וסרוק את הברקוד.",
      gateTelegram: "<b>מטלגרם:</b> לחץ על ״פתח את הלוח״ בכל התראה על דירה.",
      pasteLabel: "או הדבק כאן את הקישור האישי", pasteOpen: "פתח",
      pasteBad: "זה לא קישור אישי של Messiah. הוא נראה כמו …/MessiahTLVBOT/#t=…",
      ownerChat: "מזהה הצ׳אט שלך (כפתור ״פתח את הלוח״ בהתראות שלך יכניס אותך מחובר)",
      memberChat: "4. מזהה הצ׳אט שלו בטלגרם (לא חובה: ההתראות שלו יכניסו אותו מחובר)",
      phoneInstall: "באייפון: אחרי שהלוח נפתח ב־Safari, הוסף אותו למסך הבית <b>מאותו עמוד</b>. כך האייקון ייפתח תמיד מחובר.",
      installTip: "כדי שהלוח יישאר מחובר באייפון: לחץ <b>שיתוף ← הוסף למסך הבית</b> עכשיו, מהעמוד הזה.",
      tabFiltered: "סוננו", statusFiltered: "לא דירה", reposted: "פורסם שוב",
      sources: "מקורות", sourcesTitle: "מקורות",
      sourcesLead: "כל המקורות נקראים מה־Chrome במחשב שלך, כמו פייסבוק. יד2, מדלן, הומלס וקומו נסרקים לפי המחיר והחדרים שבחרת.",
      telegramChannels: "ערוצי טלגרם ציבוריים, אחד בכל שורה (למשל ‎@telavivrent)",
      source: {facebook: "פייסבוק", yad2: "יד2", madlan: "מדלן", homeless: "הומלס", komo: "קומו", telegram: "טלגרם"},
      sourceHint: {facebook: "הקבוצות שברשימה למטה", yad2: "מודעות השכרה בתל אביב", madlan: "מודעות השכרה בתל אביב",
        homeless: "מודעות השכרה, הרבה בעלי דירות", komo: "מודעות השכרה, הרבה בעלי דירות", telegram: "הערוצים שברשימה למטה"},
      includeRoommates: "הצג גם חדרים בדירת שותפים", includeSublets: "הצג גם סאבלטים ודירות לתקופה קצרה",
      aiTitle: "סינון חכם (AI)",
      aiLead: "פוסטים שהכללים לא בטוחים לגביהם נבדקים ב־Claude Haiku: האם זו באמת דירה להשכרה. בלי מפתח הם עוברים ל״לבדיקה״. עלות משוערת: כמה סנטים בחודש.",
      aiKey: "מפתח Anthropic API (רק אתה רואה אותו)", badAiKey: "מפתח Anthropic מתחיל ב־sk-ant-",
      aiUsage: (calls, dollars) => `נבדקו ${calls} קבוצות פוסטים · עלות עד כה כ־${dollars}$`,
      kindMarkedBy: (name) => name ? `סומן ידנית ע״י ${name}` : "סומן ידנית",
      checkedByAi: "נבדק ב־AI",
      postedIn: (n) => `פורסם ב־${n} מקומות`,
      isApartment: "זו כן דירה", notApartment: "לא דירה",
      settings: "הגדרות", stop: "עצור", scanNow: "סרוק עכשיו", close: "סגור", save: "שמור",
      onbTitle: "עוד שני צעדים והלוח מתחיל להתמלא",
      onbTelegram: "בהגדרות: הדבק את טוקן הבוט ואת מזהה הצ׳אט. שלח <bdi dir=\"ltr\">/start</bdi> לבוט בטלגרם כדי לקבל את המזהה.",
      onbEnable: "סמן <b>ניטור פעיל</b> ושמור. הסריקה הראשונה מביאה את השבועיים האחרונים (20 עד 30 דקות), כל עוד המחשב ער ו־Chrome פתוח.",
      openSettings: "פתח הגדרות",
      filtersLabel: "סינון ומיון", viewsLabel: "תצוגות",
      searchLabel: "חיפוש חופשי", searchPlaceholder: "רחוב, מילה מהמודעה…",
      filters: "סינון", priceUpTo: "מחיר עד", roomsFrom: "חדרים", sortBy: "מיון", any: "הכל",
      sortNew: "החדשות ביותר", sortPriceAsc: "מחיר: מהנמוך", sortPriceDesc: "מחיר: מהגבוה", sortBonus: "הכי הרבה תוספות",
      areas: "אזורים", extras: "תוספות",
      tabMatch: "מתאימות", tabReview: "לבדיקה", tabAll: "כל הדירות", tabSaved: "שמורות", tabHidden: "מוסתרות",
      clearFilters: "נקה סינון",
      results: (n) => n === 1 ? "דירה אחת" : `${n.toLocaleString("he-IL")} דירות`,
      // card
      perMonth: "לחודש", noPrice: "מחיר לא צוין", rooms: "חדרים", baths: "שירותים",
      statusMatch: "מתאימה", statusReview: "חסרים פרטים", statusRejected: "לא מתאימה", isNew: "חדש",
      telAviv: "תל אביב", facebook: "פייסבוק",
      readMore: "קרא עוד", readLess: "הצג פחות",
      save_: "שמור", unsave: "הסר מהשמורות", hide: "הסתר", unhide: "החזר", openPost: "לפוסט",
      savedBy: (name) => `נשמרה ע״י ${name}`,
      // status line
      waitingForComputer: "ממתין שהמחשב יתחיל לסרוק (עד דקה)…", stopping: "עוצר…",
      scanning: "סורק", scanningBack: "סורק שבועיים אחורה",
      groupOf: (i, n) => `קבוצה ${i} מתוך ${n}`,
      updated: (ago) => `עודכן ${ago}`,
      lastScan: (ago, n) => `סריקה אחרונה ${ago} · ${n === 1 ? "חדשה אחת" : `${n} חדשות`}`,
      monitoringOff: "הניטור כבוי",
      firstScanSoon: "הסריקה הראשונה תתחיל כשהמחשב יהיה ער ו־Chrome פתוח",
      offOpenSettings: "הניטור כבוי. פתח הגדרות כדי להתחיל.",
      // empty states
      emptyNoDataTitle: "עדיין אין כאן דירות",
      emptyNoData: "כשהסריקה תרוץ, הדירות מקבוצות הפייסבוק שלך יופיעו כאן.",
      emptyScanningTitle: "הסריקה רצה",
      emptyScanning: "הדירות הראשונות יופיעו כאן בעוד כמה דקות.",
      emptyFilteredTitle: "אין דירות שמתאימות לסינון",
      emptyFiltered: "נסה להרחיב את המחיר או להוריד אזור.",
      emptyTabTitle: { match: "עדיין אין דירות מתאימות", review: "אין דירות לבדיקה", all: "אין דירות", saved: "עוד לא שמרת דירות", hidden: "אין דירות מוסתרות", filtered: "לא סוננו פוסטים" },
      emptyTab: { match: "דירות שעומדות בכל התנאים שלך יופיעו כאן, ותקבל עליהן התראה בטלגרם.", review: "כאן יופיעו פוסטים שהפרסר לא הצליח לקרוא בהם מחיר, חדרים או אזור.", all: "", saved: "לחץ על הלב בכרטיס כדי לשמור דירה.", hidden: "דירות שהסתרת יופיעו כאן, ואפשר להחזיר אותן.", filtered: "פוסטים שאינם דירה להשכרה (מחפשים דירה, שותפים, פרסומות) יופיעו כאן. אם משהו סונן בטעות, לחץ ״זו כן דירה״." },
      // errors
      errKey: "המפתח של GitHub כבר לא תקף. צור מפתח חדש ולחץ על אייקון התוסף במחשב.",
      errOldLink: "הקישור הזה שייך להתקנה ישנה. פתח את הלוח מאייקון התוסף במחשב.",
      errLoad: (m) => `לא הצלחתי לטעון נתונים: ${m}`,
      errSave: (m) => `השמירה נכשלה: ${m}`,
      // settings
      whatImLookingFor: "מה אני מחפש", maxPrice: "מחיר מקסימלי (₪)", minRooms: "חדרים לפחות", minBaths: "שירותים לפחות",
      telegram: "התראות בטלגרם", botToken: "טוקן הבוט מ־BotFather (רק אתה רואה אותו)",
      chatIds: "מזהי צ׳אט, מופרדים בפסיק. כל אחד שולח <bdi dir=\"ltr\">/start</bdi> לבוט ומקבל את המספר שלו",
      alertReview: "שלח התראה גם על דירות שחסרים בהן פרטים", testTelegram: "שלח הודעת בדיקה",
      groupsAndScan: "קבוצות וסריקה", monitoring: "ניטור פעיל", monitoringHint: "סורק אוטומטית כל עוד המחשב ער ו־Chrome פתוח",
      interval: "לסרוק כל (דקות, לפחות 10)", groupUrls: "קבוצות פייסבוק, קישור אחד בכל שורה", backfill: "סרוק שוב שבועיים אחורה",
      shareTitle: "שיתוף הלוח",
      shareLead: "מי שתשתף יראה את אותן דירות, ומה שאחד מכם שומר או מסתיר יופיע אצל כולם. הוא לא יראה את טוקן הבוט. לכל אחד מפתח GitHub משלו, כך שאפשר לבטל גישה בכל רגע.",
      memberName: "1. השם של מי שמצטרף", memberNamePlaceholder: "למשל: נועה", memberStep2: "2.",
      memberCreateKey: "צור עבורו מפתח GitHub",
      memberKeyHow: "בחשבון שלך: Only select repositories ← MessiahTLVBOT, ההרשאה Contents כבר מסומנת, Generate token.",
      memberPaste: "3. הדבק את המפתח", memberCreate: "צור קישור אישי",
      noMembers: "עדיין לא שיתפת את הלוח.", memberAdded: (ago) => `נוסף ${ago}`,
      copyMemberLink: "העתק קישור", showQr: "ברקוד", remove: "הסר",
      confirmRemove: (n) => `להסיר את ${n}? לחץ שוב כדי לאשר`,
      phoneTitle: "פתיחה בטלפון שלך",
      phoneLead: "סרוק עם מצלמת הטלפון. כשהלוח נפתח: שיתוף ← <b>הוסף למסך הבית</b>. הקישור אישי, אל תשתף אותו.",
      copyLink: "העתק קישור אישי", qrFailed: "הברקוד לא נטען. השתמש בהעתקת הקישור.",
      diagnostics: "אבחון", diagLead: "מה הסריקה האחרונה מצאה בכל קבוצה. אם משהו לא עובד, העתק את הדוח ושלח אותו.",
      copyDebug: "העתק דוח אבחון", noScanYet: "עדיין לא רצה סריקה.",
      privacy: "הסריקה רצה בתוסף Chrome במחשב שלך. התוסף רק קורא פוסטים בקבוצות שאתה חבר בהן: לא מגיב, לא מפרסם ולא שולח הודעות. הנתונים נשמרים ב־GitHub מוצפנים, והמפתח קיים רק במכשירים שלך.",
      logout: "התנתק במכשיר הזה",
      // settings messages
      badGroupUrl: (u) => `הקישור הזה הוא לא קבוצת פייסבוק: ${u}`,
      badToken: "הטוקן של הבוט לא נראה תקין. הוא בנוי כמו 123456:ABC…",
      badChat: "מזהי צ׳אט הם מספרים, מופרדים בפסיק.",
      saving: "שומר…", savedOn: "נשמר. המחשב יקבל את ההגדרות תוך כדקה.", savedOff: "נשמר. הניטור כבוי.",
      backfillRequested: "ביקשתי סריקה של שבועיים אחורה. המחשב יתחיל תוך כדקה.",
      fillTelegramFirst: "מלא קודם טוקן ומזהה צ׳אט.", sending: "שולח…",
      telegramTestText: "החיבור עובד. כאן יגיעו התראות על דירות חדשות.",
      telegramSent: (n) => `נשלחה הודעה ל־${n} צ׳אטים. בדוק בטלגרם, ואל תשכח לשמור.`,
      telegramError: (m) => `טלגרם החזיר שגיאה: ${m}`,
      linkCopied: "הקישור הועתק.", reportCopied: "הדוח הועתק. הדבק אותו בצ׳אט.",
      writeName: "כתוב שם.", notGithubKey: "זה לא נראה כמו מפתח GitHub. הוא מתחיל ב־github_pat_",
      checkingKey: "בודק את המפתח…", keyInvalid: "המפתח לא תקין.", keyNoAccess: (m) => `למפתח אין הרשאה: ${m}`,
      memberReady: (n) => `הקישור של ${n} מוכן והועתק. שלח לו אותו או תן לו לסרוק את הברקוד.`,
      memberCopied: (n) => `הקישור של ${n} הועתק.`,
      memberRemoved: (n) => `${n} הוסר מהרשימה. כדי לחסום את הגישה לגמרי, מחק את המפתח "Apartment Hunter - ${n}" בדף שנפתח.`,
      langButton: "EN", langAria: "Switch to English", langGate: "English",
    },
    en: {
      appName: "Messiah",
      loading: "Loading…",
      gateLead: "You need your personal link to open the board.",
      gateDesktop: "<b>On your computer:</b> click the Messiah icon in the Chrome toolbar.",
      gatePhone: "<b>On your phone:</b> open the board on your computer, go to <b>Settings → Open on your phone</b> and scan the QR code.",
      gateTelegram: "<b>From Telegram:</b> tap “Open the board” in any apartment alert.",
      pasteLabel: "Or paste your personal link here", pasteOpen: "Open",
      pasteBad: "That isn't a Messiah personal link. It looks like …/MessiahTLVBOT/#t=…",
      ownerChat: "Your chat ID (the “Open the board” button in your alerts signs you in)",
      memberChat: "4. Their Telegram chat ID (optional: their alerts will sign them in)",
      phoneInstall: "On iPhone: once the board opens in Safari, add it to the Home Screen <b>from that same page</b>. The icon then always opens signed in.",
      installTip: "To stay signed in on iPhone: tap <b>Share → Add to Home Screen</b> now, from this page.",
      tabFiltered: "Filtered", statusFiltered: "Not an apartment", reposted: "Posted again",
      sources: "Sources", sourcesTitle: "Sources",
      sourcesLead: "Every source is read from Chrome on your computer, like Facebook. Yad2, Madlan, Homeless and Komo are searched with your price and rooms.",
      telegramChannels: "Public Telegram channels, one per line (e.g. @telavivrent)",
      source: {facebook: "Facebook", yad2: "Yad2", madlan: "Madlan", homeless: "Homeless", komo: "Komo", telegram: "Telegram"},
      sourceHint: {facebook: "The groups listed below", yad2: "Tel Aviv rental listings", madlan: "Tel Aviv rental listings",
        homeless: "Rental listings, many private landlords", komo: "Rental listings, many private landlords", telegram: "The channels listed below"},
      includeRoommates: "Also show rooms in shared apartments", includeSublets: "Also show sublets and short-term rentals",
      aiTitle: "Smart filter (AI)",
      aiLead: "Posts the rules aren't sure about are checked by Claude Haiku: is this really an apartment for rent? Without a key they go to “To review”. Expected cost: a few cents a month.",
      aiKey: "Anthropic API key (only you can see it)", badAiKey: "An Anthropic key starts with sk-ant-",
      aiUsage: (calls, dollars) => `${calls} batches checked · about ${dollars} USD so far`,
      kindMarkedBy: (name) => name ? `Marked by ${name}` : "Marked by hand",
      checkedByAi: "Checked by AI",
      postedIn: (n) => `Posted in ${n} places`,
      isApartment: "It is an apartment", notApartment: "Not an apartment",
      settings: "Settings", stop: "Stop", scanNow: "Scan now", close: "Close", save: "Save",
      onbTitle: "Two more steps and the board starts filling up",
      onbTelegram: "In Settings, paste the bot token and your chat ID. Send <bdi dir=\"ltr\">/start</bdi> to the bot in Telegram to get the ID.",
      onbEnable: "Turn on <b>Monitoring</b> and save. The first scan pulls the last two weeks (20 to 30 minutes) while the computer is awake and Chrome is open.",
      openSettings: "Open settings",
      filtersLabel: "Filter and sort", viewsLabel: "Views",
      searchLabel: "Search", searchPlaceholder: "Street, a word from the post…",
      filters: "Filters", priceUpTo: "Max price", roomsFrom: "Rooms", sortBy: "Sort", any: "Any",
      sortNew: "Newest", sortPriceAsc: "Price: low to high", sortPriceDesc: "Price: high to low", sortBonus: "Most extras",
      areas: "Areas", extras: "Extras",
      tabMatch: "Matches", tabReview: "To review", tabAll: "All", tabSaved: "Saved", tabHidden: "Hidden",
      clearFilters: "Clear filters",
      results: (n) => n === 1 ? "1 apartment" : `${n.toLocaleString("en-US")} apartments`,
      perMonth: "/ month", noPrice: "Price not listed", rooms: "rooms", baths: "baths",
      statusMatch: "Match", statusReview: "Missing details", statusRejected: "Not a match", isNew: "New",
      telAviv: "Tel Aviv", facebook: "Facebook",
      readMore: "Read more", readLess: "Show less",
      save_: "Save", unsave: "Remove from saved", hide: "Hide", unhide: "Restore", openPost: "View post",
      savedBy: (name) => `Saved by ${name}`,
      waitingForComputer: "Waiting for the computer to start scanning (up to a minute)…", stopping: "Stopping…",
      scanning: "Scanning", scanningBack: "Scanning the last two weeks",
      groupOf: (i, n) => `group ${i} of ${n}`,
      updated: (ago) => `updated ${ago}`,
      lastScan: (ago, n) => `Last scan ${ago} · ${n} new`,
      monitoringOff: "monitoring is off",
      firstScanSoon: "The first scan starts when the computer is awake and Chrome is open",
      offOpenSettings: "Monitoring is off. Open settings to start.",
      emptyNoDataTitle: "No apartments yet",
      emptyNoData: "When a scan runs, apartments from your Facebook groups show up here.",
      emptyScanningTitle: "Scan in progress",
      emptyScanning: "The first apartments will appear here in a few minutes.",
      emptyFilteredTitle: "Nothing matches these filters",
      emptyFiltered: "Try a higher price or fewer areas.",
      emptyTabTitle: { match: "No matches yet", review: "Nothing to review", all: "No apartments", saved: "No saved apartments yet", hidden: "No hidden apartments", filtered: "Nothing filtered" },
      emptyTab: { match: "Apartments that meet all your criteria show up here, and you get a Telegram alert for each.", review: "Posts where the price, rooms or area couldn't be read show up here.", all: "", saved: "Tap the heart on a card to save an apartment.", hidden: "Apartments you hide show up here, and you can restore them.", filtered: "Posts that aren't apartments for rent (people searching, roommates, ads) show up here. If something was filtered by mistake, tap “It is an apartment”." },
      errKey: "Your GitHub key is no longer valid. Create a new one and click the extension icon on your computer.",
      errOldLink: "This link belongs to an old install. Open the board from the extension icon on your computer.",
      errLoad: (m) => `Couldn't load data: ${m}`,
      errSave: (m) => `Couldn't save: ${m}`,
      whatImLookingFor: "What I'm looking for", maxPrice: "Max price (₪)", minRooms: "Min rooms", minBaths: "Min bathrooms",
      telegram: "Telegram alerts", botToken: "Bot token from BotFather (only you can see it)",
      chatIds: "Chat IDs, comma-separated. Each person sends <bdi dir=\"ltr\">/start</bdi> to the bot to get theirs",
      alertReview: "Also alert me about apartments with missing details", testTelegram: "Send a test message",
      groupsAndScan: "Groups and scanning", monitoring: "Monitoring", monitoringHint: "Scans automatically while the computer is awake and Chrome is open",
      interval: "Scan every (minutes, at least 10)", groupUrls: "Facebook groups, one link per line", backfill: "Rescan the last two weeks",
      shareTitle: "Share the board",
      shareLead: "People you share with see the same apartments, and anything one of you saves or hides shows up for everyone. They can't see the bot token. Each person gets their own GitHub key, so you can revoke access at any time.",
      memberName: "1. Their name", memberNamePlaceholder: "e.g. Noa", memberStep2: "2.",
      memberCreateKey: "Create a GitHub key for them",
      memberKeyHow: "in your account: Only select repositories → MessiahTLVBOT. Contents is already selected. Click Generate token.",
      memberPaste: "3. Paste the key", memberCreate: "Create personal link",
      noMembers: "You haven't shared the board yet.", memberAdded: (ago) => `added ${ago}`,
      copyMemberLink: "Copy link", showQr: "QR code", remove: "Remove",
      confirmRemove: (n) => `Remove ${n}? Click again to confirm`,
      phoneTitle: "Open on your phone",
      phoneLead: "Scan with your phone camera. When the board opens: Share → <b>Add to Home Screen</b>. The link is personal, don't share it.",
      copyLink: "Copy personal link", qrFailed: "The QR code didn't load. Copy the link instead.",
      diagnostics: "Diagnostics", diagLead: "What the last scan found in each group. If something isn't working, copy the report and send it.",
      copyDebug: "Copy diagnostics report", noScanYet: "No scan has run yet.",
      privacy: "Scanning runs in the Chrome extension on your computer. It only reads posts in groups you're a member of: it never comments, posts or sends messages. Data is stored encrypted on GitHub, and the key exists only on your devices.",
      logout: "Sign out on this device",
      badGroupUrl: (u) => `This link isn't a Facebook group: ${u}`,
      badToken: "That bot token doesn't look right. It looks like 123456:ABC…",
      badChat: "Chat IDs are numbers, separated by commas.",
      saving: "Saving…", savedOn: "Saved. Your computer picks up the settings within a minute.", savedOff: "Saved. Monitoring is off.",
      backfillRequested: "Requested a two-week rescan. Your computer starts within a minute.",
      fillTelegramFirst: "Fill in the bot token and a chat ID first.", sending: "Sending…",
      telegramTestText: "It works. New apartment alerts will arrive here.",
      telegramSent: (n) => `Sent to ${n} chat${n === 1 ? "" : "s"}. Check Telegram, and remember to save.`,
      telegramError: (m) => `Telegram returned an error: ${m}`,
      linkCopied: "Link copied.", reportCopied: "Report copied. Paste it in the chat.",
      writeName: "Enter a name.", notGithubKey: "That doesn't look like a GitHub key. It starts with github_pat_",
      checkingKey: "Checking the key…", keyInvalid: "The key is invalid.", keyNoAccess: (m) => `The key doesn't have access: ${m}`,
      memberReady: (n) => `${n}'s link is ready and copied. Send it to them or let them scan the QR code.`,
      memberCopied: (n) => `${n}'s link copied.`,
      memberRemoved: (n) => `${n} was removed. To block access completely, delete the key "Apartment Hunter - ${n}" on the page that opened.`,
      langButton: "עב", langAria: "עבור לעברית", langGate: "עברית",
    },
  };

  // Server version (Cloudflare): sign-in by email, collector on the server.
  Object.assign(STRINGS.he, {
    gateSignedOut: "צריך להתחבר כדי לראות את הלוח.",
    gateSignIn: "התחבר",
    gateNotInvited: (email) => `האימייל ${email || "הזה"} לא הוזמן ללוח. בקש מבעל הלוח להזמין אותך, או התחבר עם אימייל אחר.`,
    gateOtherAccount: "התחבר עם אימייל אחר",
    onbTitle: "עוד צעד אחד והלוח מתחיל להתמלא",
    onbEnable: "בהגדרות: סמן <b>ניטור פעיל</b> ושמור. השרת יסרוק את המקורות כל כמה דקות, גם כשהמחשב כבוי.",
    waitingForComputer: "ממתין לסורק (עד דקה)…",
    firstScanSoon: "הסריקה הראשונה תתחיל בדקות הקרובות",
    monitoringHint: "סורק אוטומטית ושולח התראות",
    sourcesLead: "השרת סורק את המקורות כל כמה דקות, גם כשהמחשב כבוי. פייסבוק נסרק דרך התוסף ל־Chrome.",
    memberNote: "רק בעל הלוח יכול לשנות את הגדרות החיפוש.",
    shareTitle: "מי משתמש בלוח",
    shareLead: "הזמן אנשים לפי אימייל. הם נכנסים עם Google או עם קוד חד־פעמי למייל, ורואים את אותן דירות. מה שאחד שומר או מסתיר מופיע אצל כולם.",
    memberName: "שם", memberEmail: "אימייל", memberInvite: "הזמן", ownerLabel: "בעל הלוח",
    badEmail: "זו לא כתובת אימייל.",
    memberInvited: (name, url) => `${name} הוזמן. שלח לו את הכתובת ${url} והוא יתחבר עם האימייל שלו.`,
    noMembers: "עדיין לא הזמנת אף אחד.",
    confirmRemove: (email) => `להסיר את ${email}? לחץ שוב לאישור`,
    memberRemoved: (email) => `${email} הוסר ולא יוכל להיכנס יותר.`,
    phoneTitle: "בטלפון",
    phoneLead: "פתח את הכתובת הזו בטלפון והתחבר עם אותו אימייל. באייפון: שיתוף ← <b>הוסף למסך הבית</b>.",
    copyLink: "העתק כתובת", linkCopied: "הכתובת הועתקה.",
    extensionTitle: "תוסף פייסבוק ל־Chrome",
    extensionLead: "התוסף קורא את קבוצות הפייסבוק שלך ושולח את הפוסטים לשרת. צור מפתח והדבק אותו בתוסף. יצירת מפתח חדש מבטלת את הקודם.",
    extensionKey: "צור מפתח לתוסף", extensionKeyCopied: "המפתח נוצר והועתק. הדבק אותו בהגדרות התוסף.",
    diagLead: "מה הסריקה האחרונה מצאה בכל מקור. אם משהו לא עובד, העתק את הדוח ושלח אותו.",
    privacy: "הנתונים נשמרים בשרת פרטי (Cloudflare) ורק אנשים שהוזמנו יכולים להיכנס. התוסף רק קורא פוסטים בקבוצות שאתה חבר בהן: לא מגיב, לא מפרסם ולא שולח הודעות.",
    logout: "התנתק",
    installTip: "כדי לפתוח את הלוח כמו אפליקציה: לחץ <b>שיתוף ← הוסף למסך הבית</b>.",
  });
  Object.assign(STRINGS.en, {
    gateSignedOut: "Sign in to see the board.",
    gateSignIn: "Sign in",
    gateNotInvited: (email) => `${email || "This email"} hasn't been invited to the board. Ask the owner to invite you, or sign in with another email.`,
    gateOtherAccount: "Sign in with another email",
    onbTitle: "One more step and the board starts filling up",
    onbEnable: "In Settings, turn on <b>Monitoring</b> and save. The server scans the sources every few minutes, even when your computer is off.",
    waitingForComputer: "Waiting for the collector (up to a minute)…",
    firstScanSoon: "The first scan starts in the next few minutes",
    monitoringHint: "Scans automatically and sends alerts",
    sourcesLead: "The server scans the sources every few minutes, even when your computer is off. Facebook is read through the Chrome extension.",
    memberNote: "Only the board owner can change the search settings.",
    shareTitle: "Who uses the board",
    shareLead: "Invite people by email. They sign in with Google or a one-time email code and see the same apartments. Anything one of you saves or hides shows up for everyone.",
    memberName: "Name", memberEmail: "Email", memberInvite: "Invite", ownerLabel: "Owner",
    badEmail: "That isn't an email address.",
    memberInvited: (name, url) => `${name} is invited. Send them ${url} and they sign in with their email.`,
    noMembers: "You haven't invited anyone yet.",
    confirmRemove: (email) => `Remove ${email}? Click again to confirm`,
    memberRemoved: (email) => `${email} was removed and can no longer sign in.`,
    phoneTitle: "On your phone",
    phoneLead: "Open this address on your phone and sign in with the same email. On iPhone: Share → <b>Add to Home Screen</b>.",
    copyLink: "Copy address", linkCopied: "Address copied.",
    extensionTitle: "Facebook extension for Chrome",
    extensionLead: "The extension reads your Facebook groups and sends the posts to the server. Create a key and paste it into the extension. A new key replaces the old one.",
    extensionKey: "Create extension key", extensionKeyCopied: "Key created and copied. Paste it into the extension's settings.",
    diagLead: "What the last scan found in each source. If something isn't working, copy the report and send it.",
    privacy: "Data is stored on a private server (Cloudflare) and only invited people can sign in. The extension only reads posts in groups you're a member of: it never comments, posts or sends messages.",
    logout: "Sign out",
    installTip: "To open the board like an app: tap <b>Share → Add to Home Screen</b>.",
  });

  const AREAS_EN = {
    "לב העיר": "Lev Ha'ir", "נווה צדק": "Neve Tzedek", "כרם התימנים": "Kerem HaTeimanim", "רוטשילד": "Rothschild",
    "פלורנטין": "Florentin", "הצפון הישן": "Old North", "הצפון החדש": "New North", "יפו": "Jaffa",
    "מונטיפיורי": "Montefiore", "שבזי / נגה": "Shabazi / Noga", "בבלי": "Bavli", "רמת אביב": "Ramat Aviv",
  };
  const EXTRAS_EN = {
    "חניה": "Parking", "מרפסת": "Balcony", "ממ״ד": "Safe room", "מעלית": "Elevator",
    "משופצת": "Renovated", "מרוהטת": "Furnished", "חיות": "Pets OK",
  };
  const FIELDS_EN = {"מחיר": "price", "חדרים": "rooms", "שירותים": "bathrooms", "אזור": "area"};

  let lang = "he";
  try { lang = localStorage.getItem("hunter-lang") === "en" ? "en" : "he"; } catch {}

  function t(key, ...args) {
    const value = STRINGS[lang][key] ?? STRINGS.he[key] ?? key;
    return typeof value === "function" ? value(...args) : value;
  }

  const area = (name) => (lang === "en" ? AREAS_EN[name] || name : name);
  const extra = (name) => (lang === "en" ? EXTRAS_EN[name] || name : name);

  function reason(text) {
    if (lang !== "en") return text;
    let m;
    if (text === "פוסט של מחפש/ת דירה") return "Someone looking for an apartment";
    if (text === "דירה למכירה") return "For sale, not rent";
    if (text === "מחוץ לאזורים שבחרת") return "Outside your areas";
    if (text === "עומדת בכל התנאים") return "Meets all criteria";
    if (text === "לא בטוח שזו דירה להשכרה") return "Not sure this is an apartment for rent";
    if (text === "חדר בדירת שותפים") return "Room in a shared apartment";
    if (text === "סאבלט או לתקופה קצרה") return "Sublet or short-term";
    if (text === "מחפש/ת דירה") return "Someone looking for an apartment";
    if (text === "מכירה או מסירה") return "For sale or giveaway";
    if (text === "פרסומת או שירות") return "Ad or service";
    if (text === "לא מודעה על דירה") return "Not an apartment listing";
    if ((m = text.match(/^מחיר מעל (.+) ₪$/))) return `Over ₪${m[1]}`;
    if ((m = text.match(/^פחות מ־(.+) חדרים$/))) return `Fewer than ${m[1]} rooms`;
    if ((m = text.match(/^פחות מ־(.+) שירותים$/))) return `Fewer than ${m[1]} bathrooms`;
    if ((m = text.match(/^חסר: (.+)$/))) return `No ${FIELDS_EN[m[1]] || m[1]} found`;
    return text;
  }

  function timeAgo(ms) {
    if (!ms) return "";
    const minutes = Math.round((Date.now() - ms) / 60000);
    const hours = Math.round(minutes / 60);
    const days = Math.round(hours / 24);
    if (lang === "en") {
      if (minutes < 1) return "just now";
      if (minutes < 60) return `${minutes} min ago`;
      if (hours < 24) return `${hours} h ago`;
      return days === 1 ? "yesterday" : `${days} days ago`;
    }
    if (minutes < 1) return "עכשיו";
    if (minutes < 60) return `לפני ${minutes} דק׳`;
    if (hours < 24) return `לפני ${hours} שע׳`;
    return days === 1 ? "אתמול" : `לפני ${days} ימים`;
  }

  function apply(scope = document) {
    const html = document.documentElement;
    html.lang = lang;
    html.dir = lang === "he" ? "rtl" : "ltr";
    document.title = t("appName");
    scope.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n); });
    scope.querySelectorAll("[data-i18n-html]").forEach((el) => { el.innerHTML = t(el.dataset.i18nHtml); });
    scope.querySelectorAll("[data-i18n-placeholder]").forEach((el) => { el.placeholder = t(el.dataset.i18nPlaceholder); });
    scope.querySelectorAll("[data-i18n-aria]").forEach((el) => { el.setAttribute("aria-label", t(el.dataset.i18nAria)); });
    scope.querySelectorAll("[data-lang-toggle]").forEach((el) => {
      el.textContent = el.closest(".gate") ? t("langGate") : t("langButton");
      el.setAttribute("aria-label", t("langAria"));
      el.lang = lang === "he" ? "en" : "he";
    });
  }

  function setLang(next) {
    lang = next === "en" ? "en" : "he";
    try { localStorage.setItem("hunter-lang", lang); } catch {}
    apply();
  }

  root.I18n = {
    t, area, extra, reason, timeAgo, apply, setLang,
    get lang() { return lang; },
    locale: () => (lang === "en" ? "en-US" : "he-IL"),
  };
})(window);
