// Shared by the web app (docs/) and the Chrome extension (a copy lives in
// chrome-extension/sync.js; CI checks they are identical).
// Data lives on the "data" branch of the repository, encrypted with AES-GCM.
// The key never leaves the user's devices: it travels only in the URL fragment.
(function (root) {
  const REPO = "Omerm14/MessiahTLVBOT";
  const DATA_BRANCH = "data";
  const API = "https://api.github.com";
  const APP_URL = "https://omerm14.github.io/MessiahTLVBOT/";

  // ---------- encoding ----------
  function bytesToB64(bytes) {
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(binary);
  }
  function b64ToBytes(b64) {
    const binary = atob(b64.replace(/-/g, "+").replace(/_/g, "/").replace(/\s/g, ""));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }
  const toUrlSafe = (b64) => b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  async function pipe(bytes, stream) {
    const out = new Blob([bytes]).stream().pipeThrough(stream);
    return new Uint8Array(await new Response(out).arrayBuffer());
  }

  // ---------- crypto ----------
  async function newKey() {
    return toUrlSafe(bytesToB64(crypto.getRandomValues(new Uint8Array(32))));
  }
  async function importKey(keyText) {
    return crypto.subtle.importKey("raw", b64ToBytes(keyText), "AES-GCM", false, ["encrypt", "decrypt"]);
  }
  async function encryptJson(keyText, value) {
    const key = await importKey(keyText);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const packed = await pipe(new TextEncoder().encode(JSON.stringify(value)), new CompressionStream("gzip"));
    const ct = new Uint8Array(await crypto.subtle.encrypt({name: "AES-GCM", iv}, key, packed));
    return JSON.stringify({v: 1, iv: bytesToB64(iv), ct: bytesToB64(ct)});
  }
  async function decryptJson(keyText, text) {
    const envelope = JSON.parse(text);
    const key = await importKey(keyText);
    const packed = await crypto.subtle.decrypt({name: "AES-GCM", iv: b64ToBytes(envelope.iv)}, key, b64ToBytes(envelope.ct));
    const plain = await pipe(new Uint8Array(packed), new DecompressionStream("gzip"));
    return JSON.parse(new TextDecoder().decode(plain));
  }

  // ---------- GitHub ----------
  class GitHubError extends Error {
    constructor(status, message) {
      super(message);
      this.status = status;
    }
  }

  async function gh(token, path, options = {}) {
    const response = await fetch(`${API}${path}`, {
      ...options,
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(options.headers || {}),
      },
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new GitHubError(response.status, body.message || `GitHub error ${response.status}`);
    }
    return response;
  }

  async function checkToken(token) {
    const repo = await (await gh(token, `/repos/${REPO}`)).json();
    if (!repo.permissions?.push) throw new GitHubError(403, "למפתח אין הרשאת כתיבה ל־repository");
    return repo;
  }

  async function ensureDataBranch(token) {
    try {
      await gh(token, `/repos/${REPO}/git/ref/heads/${DATA_BRANCH}`);
      return;
    } catch (error) {
      if (error.status !== 404) throw error;
    }
    const repo = await (await gh(token, `/repos/${REPO}`)).json();
    const base = await (await gh(token, `/repos/${REPO}/git/ref/heads/${repo.default_branch}`)).json();
    await gh(token, `/repos/${REPO}/git/refs`, {
      method: "POST",
      body: JSON.stringify({ref: `refs/heads/${DATA_BRANCH}`, sha: base.object.sha}),
    });
  }

  async function readFile(token, path) {
    let meta;
    try {
      meta = await (await gh(token, `/repos/${REPO}/contents/${path}?ref=${DATA_BRANCH}`)).json();
    } catch (error) {
      if (error.status === 404) return null;
      throw error;
    }
    let text;
    if (meta.content && meta.encoding === "base64") {
      text = new TextDecoder().decode(b64ToBytes(meta.content));
    } else {
      const raw = await gh(token, `/repos/${REPO}/contents/${path}?ref=${DATA_BRANCH}`, {
        headers: {Accept: "application/vnd.github.raw+json"},
      });
      text = await raw.text();
    }
    return {text, sha: meta.sha};
  }

  async function writeFile(token, path, text, message, sha) {
    const send = (currentSha) => gh(token, `/repos/${REPO}/contents/${path}`, {
      method: "PUT",
      body: JSON.stringify({
        message, branch: DATA_BRANCH, content: bytesToB64(new TextEncoder().encode(text)),
        ...(currentSha ? {sha: currentSha} : {}),
      }),
    });
    try {
      return (await (await send(sha)).json()).content.sha;
    } catch (error) {
      if (![409, 422].includes(error.status)) throw error;
      const current = await readFile(token, path);
      return (await (await send(current?.sha)).json()).content.sha;
    }
  }

  async function readEncrypted(token, keyText, path) {
    const file = await readFile(token, path);
    if (!file) return null;
    return {value: await decryptJson(keyText, file.text), sha: file.sha};
  }

  async function writeEncrypted(token, keyText, path, value, message, sha) {
    return writeFile(token, path, await encryptJson(keyText, value), message, sha);
  }

  async function enablePages(token) {
    try {
      await gh(token, `/repos/${REPO}/pages`);
      return "exists";
    } catch (error) {
      if (error.status !== 404) return "unknown";
    }
    try {
      await gh(token, `/repos/${REPO}/pages`, {
        method: "POST",
        body: JSON.stringify({source: {branch: "claude/cool-gauss-xkatqc", path: "/docs"}}),
      });
      return "created";
    } catch {
      return "failed";
    }
  }

  // Personal link. ownerKey (only in the owner's link) unlocks owner-only secrets
  // such as the Telegram bot token; name labels who saved/hid what.
  function appLink(token, keyText, {ownerKey = "", name = ""} = {}) {
    const params = new URLSearchParams({t: token, k: keyText});
    if (ownerKey) params.set("o", ownerKey);
    if (name) params.set("n", name);
    return `${APP_URL}#${params.toString()}`;
  }

  // Shared saved/hidden marks: {items: {id: {saved, hidden, by, at}}}.
  // Merging keeps the newest change per apartment, so two people can edit at once.
  function mergeMarks(a, b) {
    const items = {...(a?.items || {})};
    for (const [id, mark] of Object.entries(b?.items || {})) {
      if (!items[id] || (mark.at || 0) > (items[id].at || 0)) items[id] = mark;
    }
    return {items};
  }

  const FILES = {
    config: "data/config.enc", listings: "data/listings.enc", state: "data/state.enc", secrets: "data/secrets.enc",
  };

  const api = {
    REPO, DATA_BRANCH, APP_URL, FILES, GitHubError,
    newKey, encryptJson, decryptJson, checkToken, ensureDataBranch,
    readFile, writeFile, readEncrypted, writeEncrypted, enablePages, appLink, mergeMarks,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.HunterSync = api;
})(typeof self !== "undefined" ? self : this);
