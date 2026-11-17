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
    groupUrls: groupUrls.slice(0, 25),
    intervalMinutes: Math.max(10, Number($("intervalMinutes").value) || 15),
    sharedSecret: $("sharedSecret").value.trim(),
    enabled: $("enabled").checked,
  });
  $("status").textContent = "נשמר. הבדיקה הראשונה תתחיל בתוך כדקה.";
});

load();
