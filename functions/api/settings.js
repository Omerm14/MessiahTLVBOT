import {error, json, rawJson, readJson} from "../../server/http.js";

// Search criteria, sources and Facebook groups. Everyone can read; the owner edits.
export async function onRequestGet({env}) {
  const row = await env.DB.prepare("SELECT value FROM kv WHERE key = 'config'").first();
  return rawJson(row?.value || "{}");
}

const clean = (value, max) => String(value ?? "").trim().slice(0, max);

export async function onRequestPut({request, env, data}) {
  if (data.user.role !== "owner") return error(403, "owner_only", "Only the owner can change settings.");
  const body = await readJson(request, 50_000);
  const criteria = body.criteria || {};
  const sources = body.sources || {};
  const config = {
    enabled: !!body.enabled,
    alertOnReview: !!body.alertOnReview,
    intervalMinutes: Math.min(180, Math.max(10, Number(body.intervalMinutes) || 15)),
    groupUrls: (Array.isArray(body.groupUrls) ? body.groupUrls : [])
      .map((u) => clean(u, 300)).filter((u) => /^https:\/\/(www\.)?facebook\.com\/groups\//i.test(u)).slice(0, 60),
    criteria: {
      maxPrice: Math.max(0, Number(criteria.maxPrice) || 12000),
      minRooms: Math.max(0, Number(criteria.minRooms) || 0),
      minBathrooms: Math.max(0, Number(criteria.minBathrooms) || 0),
      neighborhoods: (Array.isArray(criteria.neighborhoods) ? criteria.neighborhoods : []).map((n) => clean(n, 40)).slice(0, 30),
      includeRoommates: !!criteria.includeRoommates,
      includeSublets: !!criteria.includeSublets,
    },
    sources: {
      ...Object.fromEntries(["facebook", "yad2", "madlan", "homeless", "komo", "telegram"].map((k) => [k, sources[k] !== false])),
      telegramChannels: (Array.isArray(sources.telegramChannels) ? sources.telegramChannels : [])
        .map((c) => clean(c, 80)).filter(Boolean).slice(0, 30),
    },
  };
  await env.DB.prepare(`INSERT INTO kv (key, value, updated_at) VALUES ('config', ?1, ?2)
    ON CONFLICT (key) DO UPDATE SET value = ?1, updated_at = ?2`).bind(JSON.stringify(config), Date.now()).run();
  return json(config);
}
