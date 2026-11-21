-- Lost fights kept for the ?losses page (see src/index.js). Apply with:
--   npx wrangler d1 execute crypt-skirmish-losses --remote --file=schema.sql
CREATE TABLE IF NOT EXISTS losses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,          -- when it arrived, in ms since 1970
  room TEXT NOT NULL,
  difficulty TEXT NOT NULL,
  tier INTEGER NOT NULL,
  mode TEXT NOT NULL,           -- campaign, daily or weekly
  rounds INTEGER NOT NULL,
  code TEXT NOT NULL            -- the fight, as a #watch= link carries it
);
CREATE INDEX IF NOT EXISTS losses_at ON losses (at);
CREATE INDEX IF NOT EXISTS losses_room ON losses (room, id);

-- Play-stats events counted per day (POST /event): one row per day, event, property and value.
-- prop '' is the event's own count; event '' the day's total (for the daily cap).
CREATE TABLE IF NOT EXISTS tallies (
  day TEXT NOT NULL,            -- YYYY-MM-DD, UTC
  event TEXT NOT NULL,
  prop TEXT NOT NULL,
  value TEXT NOT NULL,
  n INTEGER NOT NULL,
  PRIMARY KEY (day, event, prop, value)
);
