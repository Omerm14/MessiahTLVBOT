import {error, json, readJson} from "../../server/http.js";

// "Scan now" / "Stop": the collector checks this request every minute.
export async function onRequestPost({request, env}) {
  const body = await readJson(request, 1000);
  const mode = ["quick", "backfill", "stop"].includes(body.mode) ? body.mode : null;
  if (!mode) return error(400, "bad_mode");
  const value = JSON.stringify({mode, at: Date.now()});
  await env.DB.prepare(`INSERT INTO kv (key, value, updated_at) VALUES ('scanRequest', ?1, ?2)
    ON CONFLICT (key) DO UPDATE SET value = ?1, updated_at = ?2`).bind(value, Date.now()).run();
  return json({ok: true, mode});
}
