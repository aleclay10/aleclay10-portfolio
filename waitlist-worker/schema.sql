-- Early-access waitlist for the AI Gaming Assistant.
--
-- Applied with:
--   npx wrangler d1 execute aleclay10-waitlist --remote --file=schema.sql
--
-- Several columns exist for a mailing pipeline that is NOT built yet. They are here
-- so that adding one is additive rather than a migration over a list of real people:
--
--   unsubscribe_token  minted at insert, so every row is unsubscribable before a
--                      single email is ever sent. Backfilling this later is the
--                      retrofit worth avoiding.
--   status             defaults to 'pending' — nothing is mailable until something
--                      explicitly confirms it. The right default for a list built
--                      before opt-in exists.
--   confirmed_at /     the audit trail a compliance question asks for.
--   unsubscribed_at
--   country            request.cf.country, not an IP. Enough signal to spot abuse
--                      without storing a PII-grade identifier for every visitor.

CREATE TABLE IF NOT EXISTS waitlist (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  email             TEXT NOT NULL UNIQUE,          -- stored lowercased + trimmed
  first_name        TEXT NOT NULL,
  last_name         TEXT NOT NULL,
  notes             TEXT,
  status            TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','confirmed','unsubscribed','bounced')),
  unsubscribe_token TEXT NOT NULL UNIQUE,
  source            TEXT NOT NULL DEFAULT 'gaming-assistant',
  country           TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  confirmed_at      TEXT,
  unsubscribed_at   TEXT,
  last_emailed_at   TEXT
);

CREATE INDEX IF NOT EXISTS idx_waitlist_status  ON waitlist(status);
CREATE INDEX IF NOT EXISTS idx_waitlist_created ON waitlist(created_at);

-- Site feedback, left through the Kowalski mascot or the /feedback page.
--
-- One row per submission, no upsert: two tips from one person are two tips.
-- `page` is the site-relative path the visitor was on when they wrote it
-- (validated by the Worker to be exactly that, never a full URL). `country`
-- follows the waitlist's rule: request.cf.country, never the IP.
CREATE TABLE IF NOT EXISTS feedback (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  email       TEXT NOT NULL,                     -- stored lowercased + trimmed
  rating      INTEGER CHECK (rating BETWEEN 1 AND 5),
  message     TEXT NOT NULL,
  page        TEXT,
  country     TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  read_at     TEXT                               -- set by the nightly digest
);

CREATE INDEX IF NOT EXISTS idx_feedback_created ON feedback(created_at);
