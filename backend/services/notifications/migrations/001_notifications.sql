-- Push devices and the in-app inbox (ADR-022).
CREATE TABLE devices (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL,
  token        text NOT NULL UNIQUE,          -- FCM registration token
  platform     text NOT NULL CHECK (platform IN ('android', 'ios', 'web')),
  app_version  text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX devices_user ON devices(user_id);

CREATE TABLE notifications (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL,
  event_id   uuid NOT NULL UNIQUE,            -- dedupes at-least-once delivery
  type       text NOT NULL,
  category   text NOT NULL CHECK (category IN ('money', 'security', 'account')),
  title      text NOT NULL,
  body       text NOT NULL,
  data       jsonb NOT NULL DEFAULT '{}',
  push_sent  int NOT NULL DEFAULT 0,
  push_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at    timestamptz
);
CREATE INDEX notifications_user ON notifications(user_id, created_at DESC);
CREATE INDEX notifications_unread ON notifications(user_id) WHERE read_at IS NULL;

-- Per-user switches. Security notices cannot be turned off.
CREATE TABLE preferences (
  user_id    uuid PRIMARY KEY,
  push_money boolean NOT NULL DEFAULT true,
  push_account boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);
