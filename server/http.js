export const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {"content-type": "application/json; charset=utf-8", "cache-control": "no-store"},
});

// For bodies that are already JSON text (built by SQLite), so the worker
// doesn't parse and re-serialize them. Keeps CPU well under the free limit.
export const rawJson = (text, status = 200) => new Response(text, {
  status,
  headers: {"content-type": "application/json; charset=utf-8", "cache-control": "no-store"},
});

export const error = (status, code, message = code) => json({error: code, message}, status);

export async function readJson(request, maxBytes = 200_000) {
  const text = await request.text();
  if (text.length > maxBytes) throw Object.assign(new Error("too large"), {status: 413});
  try {
    return JSON.parse(text || "{}");
  } catch {
    throw Object.assign(new Error("invalid JSON"), {status: 400});
  }
}
