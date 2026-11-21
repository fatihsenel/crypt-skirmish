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
