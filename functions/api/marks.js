import {error, json, readJson} from "../../server/http.js";

const KINDS = ["", "rental", "roommate", "sublet", "seeking", "sale", "service", "other"];

// Save / hide / "is this an apartment". Shared by everyone on the board.
export async function onRequestPost({request, env, data}) {
  const body = await readJson(request, 5000);
  const id = String(body.id || "");
  if (!id || id.length > 80) return error(400, "bad_id");
  if (body.kind !== undefined && !KINDS.includes(body.kind)) return error(400, "bad_kind");
  const current = await env.DB.prepare("SELECT * FROM marks WHERE listing_id = ?").bind(id).first() || {};
  const next = {
    saved: body.saved !== undefined ? (body.saved ? 1 : 0) : current.saved || 0,
    hidden: body.hidden !== undefined ? (body.hidden ? 1 : 0) : current.hidden || 0,
    kind: body.kind !== undefined ? body.kind : current.kind || "",
  };
  const at = Date.now();
  await env.DB.prepare(`
    INSERT INTO marks (listing_id, saved, hidden, kind, by_name, at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
    ON CONFLICT (listing_id) DO UPDATE SET saved = ?2, hidden = ?3, kind = ?4, by_name = ?5, at = ?6`)
    .bind(id, next.saved, next.hidden, next.kind, data.user.name || data.user.email, at).run();
  // Touch the listing so other devices pick up the change on their next refresh.
  await env.DB.prepare("UPDATE listings SET updated_at = ? WHERE id = ?").bind(at, id).run();
  return json({ok: true, mark: {...next, saved: !!next.saved, hidden: !!next.hidden, by: data.user.name || data.user.email, at}});
}
