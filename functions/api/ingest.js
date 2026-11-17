import {error, json, readJson} from "../../server/http.js";

// The Facebook extension posts raw posts here with the person's ingest token.
// Nothing is parsed here; the collector picks them up from the inbox.
export async function onRequestPost({request, env}) {
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (token.length < 20) return error(401, "no_token");
  const user = await env.DB.prepare("SELECT email FROM users WHERE ingest_token = ?").bind(token).first();
  if (!user) return error(401, "bad_token", "This extension key is no longer valid. Copy a new one from Settings.");
  const body = await readJson(request, 1_000_000);
  const posts = Array.isArray(body.posts) ? body.posts.slice(0, 300) : [];
  const source = body.source || {};
  const now = Date.now();
  const insert = env.DB.prepare(`INSERT INTO inbox (source_type, source_name, source_url, payload, received_by, received_at)
    VALUES (?, ?, ?, ?, ?, ?)`);
  const statements = posts
    .filter((p) => typeof p?.text === "string" && p.text.trim().length >= 20)
    .map((p) => insert.bind(
      String(source.type || "facebook").slice(0, 20), String(source.name || "").slice(0, 120), String(source.url || "").slice(0, 300),
      JSON.stringify({
        text: p.text.slice(0, 6000), url: String(p.url || "").slice(0, 500), image: String(p.image || "").slice(0, 800),
        author: String(p.author || "").slice(0, 80), postedLabel: String(p.postedLabel || "").slice(0, 40),
        externalId: String(p.externalId || "").slice(0, 80),
      }),
      user.email, now));
  if (statements.length) await env.DB.batch(statements);
  return json({ok: true, received: statements.length});
}

