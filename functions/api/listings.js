import {rawJson} from "../../server/http.js";

const KEEP_DAYS = 45;

// Everything the board needs in one request. SQLite builds the JSON itself, so the
// worker passes the text through without parsing it (Cloudflare's free plan allows
// ~10 ms of CPU per request). `since` returns only listings changed after it.
export async function onRequestGet({request, env}) {
  const since = Number(new URL(request.url).searchParams.get("since")) || 0;
  const cutoff = Date.now() - KEEP_DAYS * 86400000;
  const row = await env.DB.prepare(`
    SELECT json_object(
      'now', ?3,
      'listings', (
        SELECT json_group_array(json_object(
          'id', l.id, 'text', substr(l.text, 1, 3000), 'url', l.url, 'image', l.image, 'author', l.author,
          'postedLabel', l.posted_label, 'sourceType', l.source_type, 'sourceName', l.source_name, 'source', l.source_url,
          'ai', json(l.ai), 'firstSeen', l.first_seen, 'lastSeen', l.last_seen, 'repostedAt', l.reposted_at,
          'fromBackfill', l.from_backfill = 1,
          'sources', (SELECT json_group_array(json_object('type', s.type, 'name', s.name, 'url', s.url, 'seenAt', s.seen_at))
                      FROM listing_sources s WHERE s.listing_id = l.id)
        ))
        FROM listings l WHERE l.last_seen >= ?1 AND l.updated_at > ?2
      ),
      'marks', (
        SELECT json_group_object(m.listing_id, json_object('saved', m.saved = 1, 'hidden', m.hidden = 1, 'kind', m.kind, 'by', m.by_name, 'at', m.at))
        FROM marks m
      ),
      'status', (SELECT json_group_object(k.key, json(k.value)) FROM kv k WHERE k.key IN ('scan', 'debug', 'ai', 'scanRequest'))
    ) AS body`).bind(cutoff, since, Date.now()).first();
  return rawJson(row.body);
}
