import {randomToken} from "../../server/auth.js";
import {json} from "../../server/http.js";

// Creates (or replaces) the key the Facebook extension uses to send posts.
export async function onRequestPost({env, data}) {
  const token = randomToken(24);
  await env.DB.prepare("UPDATE users SET ingest_token = ? WHERE email = ?").bind(token, data.user.email).run();
  return json({key: token});
}
