import {error, json, readJson} from "../../server/http.js";

// The owner invites people by email. Cloudflare Access handles the actual sign-in
// (Google or a one-time email code); this list decides who gets in.
export async function onRequestGet({env, data}) {
  if (data.user.role !== "owner") return error(403, "owner_only");
  const {results} = await env.DB.prepare(
    "SELECT email, name, role, telegram_chat_id IS NOT NULL AS telegram, created_at FROM users ORDER BY created_at").all();
  return json(results.map((r) => ({email: r.email, name: r.name, role: r.role, telegram: !!r.telegram, createdAt: r.created_at})));
}

export async function onRequestPost({request, env, data}) {
  if (data.user.role !== "owner") return error(403, "owner_only");
  const body = await readJson(request, 2000);
  const email = String(body.email || "").trim().toLowerCase();
  const name = String(body.name || "").trim().slice(0, 30) || email.split("@")[0];
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 120) return error(400, "bad_email", "That isn't an email address.");
  await env.DB.prepare(`INSERT INTO users (email, name, role, created_at) VALUES (?1, ?2, 'member', ?3)
    ON CONFLICT (email) DO UPDATE SET name = ?2`).bind(email, name, Date.now()).run();
  return json({ok: true, email, name});
}

export async function onRequestDelete({request, env, data}) {
  if (data.user.role !== "owner") return error(403, "owner_only");
  const email = String(new URL(request.url).searchParams.get("email") || "").toLowerCase();
  if (!email || email === data.user.email) return error(400, "bad_email", "You can't remove yourself.");
  await env.DB.prepare("DELETE FROM users WHERE email = ? AND role = 'member'").bind(email).run();
  return json({ok: true});
}
