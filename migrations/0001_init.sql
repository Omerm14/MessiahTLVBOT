-- Messiah database (Cloudflare D1, SQLite).

-- People who may use the board. The owner is created on first sign-in
-- (OWNER_EMAIL); everyone else is invited by the owner.
CREATE TABLE users (
  email TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
  telegram_chat_id TEXT,
  link_code TEXT,
  ingest_token TEXT,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX users_ingest_token ON users (ingest_token);
CREATE UNIQUE INDEX users_link_code ON users (link_code);

-- One row per apartment. Several posts of the same apartment share a row and
-- list their places in listing_sources.
CREATE TABLE listings (
  id TEXT PRIMARY KEY,
  text TEXT NOT NULL,
  url TEXT NOT NULL DEFAULT '',
  image TEXT NOT NULL DEFAULT '',
  author TEXT NOT NULL DEFAULT '',
  posted_label TEXT NOT NULL DEFAULT '',
  source_type TEXT NOT NULL DEFAULT 'facebook',
  source_name TEXT NOT NULL DEFAULT '',
  source_url TEXT NOT NULL DEFAULT '',
  external_key TEXT,
  ai TEXT,                      -- JSON from the AI step, or {"kind":"rental","by":"source"}
  first_seen INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  reposted_at INTEGER NOT NULL DEFAULT 0,
  from_backfill INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
CREATE INDEX listings_updated ON listings (updated_at);
CREATE INDEX listings_last_seen ON listings (last_seen);
CREATE UNIQUE INDEX listings_external ON listings (external_key);

CREATE TABLE listing_sources (
  listing_id TEXT NOT NULL REFERENCES listings (id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL,
  seen_at INTEGER NOT NULL,
  PRIMARY KEY (listing_id, url)
);

-- Shared saved / hidden / "is this an apartment" marks (newest change wins).
CREATE TABLE marks (
  listing_id TEXT PRIMARY KEY,
  saved INTEGER NOT NULL DEFAULT 0,
  hidden INTEGER NOT NULL DEFAULT 0,
  kind TEXT NOT NULL DEFAULT '',
  by_name TEXT NOT NULL DEFAULT '',
  at INTEGER NOT NULL
);

-- Key/value: "config" (search criteria, sources, groups), "scan" (collector
-- status), "debug" (per-source report), "ai" (usage), "scanRequest".
CREATE TABLE kv (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Raw posts sent by the Facebook extension, processed by the collector.
CREATE TABLE inbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_type TEXT NOT NULL,
  source_name TEXT NOT NULL DEFAULT '',
  source_url TEXT NOT NULL DEFAULT '',
  payload TEXT NOT NULL,
  received_by TEXT NOT NULL DEFAULT '',
  received_at INTEGER NOT NULL,
  processed_at INTEGER
);
CREATE INDEX inbox_pending ON inbox (processed_at);

-- Telegram alerts already sent, so nobody gets the same apartment twice.
CREATE TABLE alerts (
  listing_id TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  sent_at INTEGER NOT NULL,
  PRIMARY KEY (listing_id, chat_id)
);
