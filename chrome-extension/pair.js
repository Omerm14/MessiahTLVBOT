const $ = (id) => document.getElementById(id);

$("connect").addEventListener("click", async () => {
  const token = $("token").value.trim();
  if (!/^(github_pat_|ghp_)[A-Za-z0-9_]{20,}$/.test(token)) {
    $("status").textContent = "זה לא נראה כמו מפתח GitHub. הוא מתחיל ב־github_pat_";
    $("status").className = "err";
    return;
  }
  $("connect").disabled = true;
  $("status").className = "";
  $("status").textContent = "מתחבר ל־GitHub…";
  const result = await chrome.runtime.sendMessage({type: "pair", token, name: $("name").value.trim()});
  $("connect").disabled = false;
  if (!result?.ok) {
    const reason = /Bad credentials|401/.test(result?.error || "") ? "המפתח לא תקין או שפג תוקפו."
      : /403|הרשאת כתיבה|Resource not accessible/.test(result?.error || "") ? "למפתח אין הרשאה ל־MessiahTLVBOT. ודא שבחרת את ה־repository ו־Contents: Read and write."
      : result?.error || "שגיאה לא ידועה";
    $("status").textContent = `לא הצלחתי להתחבר: ${reason}`;
    $("status").className = "err";
    return;
  }
  if (result.pages === "failed") {
    $("status").innerHTML = 'מחובר! עוד צעד אחד: ב־<a href="https://github.com/Omerm14/MessiahTLVBOT/settings/pages" target="_blank" rel="noopener">הגדרות Pages</a> בחר Branch <b>claude/cool-gauss-xkatqc</b> ותיקייה <b>/docs</b> ולחץ Save. אחר כך לחץ שוב "חבר".';
    return;
  }
  // GitHub needs about a minute to publish the app the first time.
  $("status").textContent = "מחובר! מכין את האפליקציה (בפעם הראשונה זה לוקח כדקה)…";
  const appUrl = result.link.split("#")[0];
  for (let attempt = 0; attempt < 60; attempt++) {
    const ok = await fetch(`${appUrl}?t=${Date.now()}`, {cache: "no-store"}).then((r) => r.ok, () => false);
    if (ok) break;
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  location.href = result.link;
});
