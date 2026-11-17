// Who is calling? Cloudflare Access signs every request that passes its login
// with a JWT in the Cf-Access-Jwt-Assertion header. We verify that token (so the
// app can't be reached around Access, e.g. via the *.pages.dev address), then
// check the email against the users table.

let certsCache = {at: 0, keys: []};

function b64urlToBytes(text) {
  const b64 = text.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(text.length / 4) * 4, "=");
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function accessKeys(teamDomain) {
  if (Date.now() - certsCache.at < 3600_000 && certsCache.keys.length) return certsCache.keys;
  const res = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error(`Access certs ${res.status}`);
  const {keys = []} = await res.json();
  certsCache = {at: Date.now(), keys};
  return keys;
}

export async function verifyAccessJwt(token, env) {
  const [headerB64, payloadB64, signatureB64] = String(token || "").split(".");
  if (!headerB64 || !payloadB64 || !signatureB64) return null;
  const header = JSON.parse(new TextDecoder().decode(b64urlToBytes(headerB64)));
  const payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(payloadB64)));
  const jwk = (await accessKeys(env.ACCESS_TEAM_DOMAIN)).find((key) => key.kid === header.kid);
  if (!jwk) return null;
  const key = await crypto.subtle.importKey("jwk", jwk, {name: "RSASSA-PKCS1-v1_5", hash: "SHA-256"}, false, ["verify"]);
  const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64urlToBytes(signatureB64),
    new TextEncoder().encode(`${headerB64}.${payloadB64}`));
  if (!valid) return null;
  const audiences = [].concat(payload.aud || []);
  if (!audiences.includes(env.ACCESS_AUD)) return null;
  if (payload.exp && payload.exp * 1000 < Date.now()) return null;
  if (payload.iss && payload.iss !== `https://${env.ACCESS_TEAM_DOMAIN}`) return null;
  return String(payload.email || "").toLowerCase() || null;
}

// The signed-in email, or null. DEV_EMAIL is only for `wrangler pages dev`.
export async function signedInEmail(request, env) {
  if (env.DEV_EMAIL && ["localhost", "127.0.0.1"].includes(new URL(request.url).hostname)) {
    return (request.headers.get("x-dev-email") || env.DEV_EMAIL).toLowerCase();
  }
  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) return null;
  try {
    return await verifyAccessJwt(request.headers.get("Cf-Access-Jwt-Assertion"), env);
  } catch {
    return null;
  }
}

export function randomToken(bytes = 24) {
  const raw = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...raw)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
