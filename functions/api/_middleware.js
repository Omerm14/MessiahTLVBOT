import {signedInEmail} from "../../server/auth.js";
import {error} from "../../server/http.js";

// Endpoints with their own authentication (ingest token, Telegram secret).
const OPEN = ["/api/ingest", "/api/telegram"];

export async function onRequest(context) {
  const {request, env, next, data} = context;
  const path = new URL(request.url).pathname;
  try {
    if (OPEN.some((p) => path === p || path.startsWith(`${p}/`))) return await next();

    const email = await signedInEmail(request, env);
    if (!email) return error(401, "not_signed_in", "Sign in again.");

    let user = await env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(email).first();
    const isOwner = email === String(env.OWNER_EMAIL || "").toLowerCase();
    if (!user && isOwner) {
      await env.DB.prepare("INSERT INTO users (email, name, role, created_at) VALUES (?, ?, 'owner', ?)")
        .bind(email, email.split("@")[0], Date.now()).run();
      user = await env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(email).first();
    }
    if (!user) {
      return new Response(JSON.stringify({error: "not_invited", email, message: "This email hasn't been invited to the board."}),
        {status: 403, headers: {"content-type": "application/json; charset=utf-8"}});
    }
    data.user = user;

    // Writes must come from the app itself, not from another site.
    if (request.method !== "GET") {
      const origin = request.headers.get("origin");
      if (origin && new URL(origin).host !== new URL(request.url).host) return error(403, "bad_origin");
    }
    return await next();
  } catch (err) {
    return error(err.status || 500, "server_error", String(err.message || err));
  }
}
