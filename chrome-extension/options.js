const $ = (id) => document.getElementById(id);

async function load() {
  const data = await chrome.storage.local.get({
    groupUrls: [], intervalMinutes: 15, sharedSecret: "", enabled: false,
    lastRun: "", lastResult: null,
  });
  $("groupUrls").value = data.groupUrls.join("\n");
  $("intervalMinutes").value = data.intervalMinutes;
  $("sharedSecret").value = data.sharedSecret;
  $("enabled").checked = data.enabled;
  if (data.lastRun) $("status").textContent = `בדיקה אחרונה: ${data.lastRun}\n${JSON.stringify(data.lastResult)}`;
}

$("save").addEventListener("click", async () => {
  const groupUrls = $("groupUrls").value.split("\n").map((s) => s.trim()).filter(Boolean);
  const invalid = groupUrls.find((url) => !/^https:\/\/(www\.)?facebook\.com\/groups\//i.test(url));
  if (invalid) {
    $("status").textContent = `קישור לא תקין: ${invalid}`;
    return;
  }
  await chrome.storage.local.set({
    groupUrls: groupUrls.slice(0, 40),
    intervalMinutes: Math.max(10, Number($("intervalMinutes").value) || 15),
    sharedSecret: $("sharedSecret").value.trim(),
    enabled: $("enabled").checked,
  });
  $("status").textContent = "נשמר. הבדיקה הראשונה תתחיל בתוך כדקה.";
});

$("discover").addEventListener("click", async () => {
  $("discover").disabled = true;
  $("status").textContent = "עובר על רשימת הקבוצות שלך. הפעולה עשויה להימשך כחצי דקה…";
  try {
    const startedAt = Date.now();
    const result = await chrome.runtime.sendMessage({type: "discover-groups"});
    if (!result?.ok) throw new Error("הסריקה לא התחילה");
    let data = null;
    for (let attempt = 0; attempt < 70; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      data = await chrome.storage.local.get({
        discoveredGroups: [], discoveryFinishedAt: 0, discoveryError: "",
      });
      if (data.discoveryFinishedAt >= startedAt) break;
    }
    if (!data || data.discoveryFinishedAt < startedAt) throw new Error("הסריקה לא הסתיימה בזמן");
    if (data.discoveryError) throw new Error(data.discoveryError);
    $("groupUrls").value = data.discoveredGroups.map((group) => group.url).join("\n");
    if (data.discoveredGroups.length > 20) $("intervalMinutes").value = 30;
    $("status").textContent = `נמצאו ${data.discoveredGroups.length} קבוצות רלוונטיות. בדוק את הרשימה ולחץ שמור.`;
  } catch (error) {
    $("status").textContent = `לא הצלחתי לאסוף את הקבוצות: ${error.message}`;
  } finally {
    $("discover").disabled = false;
  }
});

load();
