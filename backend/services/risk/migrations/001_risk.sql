-- AML / fraud monitoring. Every money movement is screened here before it happens.
CREATE TABLE events (
  id          bigserial PRIMARY KEY,
  user_id     uuid NOT NULL,
  kind        text NOT NULL,               -- deposit | withdrawal | trade | convert | giftcard_sell | giftcard_buy | bill
  direction   text NOT NULL CHECK (direction IN ('in', 'out', 'neutral')),
  amount_ngn  bigint NOT NULL CHECK (amount_ngn >= 0), -- kobo, NGN equivalent
  decision    text NOT NULL CHECK (decision IN ('allow', 'review', 'block')),
  device      jsonb NOT NULL DEFAULT '{}',
  meta        jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX events_user_time ON events(user_id, created_at DESC);
CREATE INDEX events_amount ON events(amount_ngn, created_at);

CREATE TABLE rules (
  id          text PRIMARY KEY,
  description text NOT NULL,
  enabled     boolean NOT NULL DEFAULT true,
  action      text NOT NULL CHECK (action IN ('review', 'block', 'hold')),
  severity    text NOT NULL CHECK (severity IN ('low', 'medium', 'high')),
  params      jsonb NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

INSERT INTO rules(id, description, action, severity, params) VALUES
  ('large_amount', 'Single transaction at or above the threshold', 'review', 'medium', '{"thresholdNgn": 1000000}'),
  ('velocity_count', 'Too many money movements in a short window', 'review', 'medium', '{"maxCount": 10, "windowMinutes": 60}'),
  ('daily_outflow', 'Total money out in 24h at or above the limit', 'review', 'high', '{"limitNgn": 2000000}'),
  ('structuring', 'Several transactions just under the large-amount threshold in 24h', 'review', 'high', '{"count": 3, "lowerPct": 90}'),
  ('rapid_in_out', 'Money out soon after an incoming deposit of similar size', 'review', 'high', '{"windowMinutes": 30, "pctOfDeposit": 80}'),
  ('new_account_outflow', 'Large money out from an account first seen recently', 'hold', 'high', '{"accountAgeHours": 24, "thresholdNgn": 100000}'),
  ('giftcard_burst', 'Many gift cards sold in a short window', 'review', 'medium', '{"count": 3, "windowMinutes": 60}'),
  ('risky_device', 'Money out from a rooted, jailbroken or emulated device', 'review', 'medium', '{}'),
  ('ctr_threshold', 'Currency transaction report threshold (UNVERIFIED: confirm with counsel)', 'review', 'low', '{"individualNgn": 5000000}');

CREATE TABLE cases (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL,
  title       text NOT NULL,
  status      text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'investigating', 'reported', 'closed')),
  assignee    uuid,
  str_reference text,          -- reference given by the regulator's portal after filing
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE alerts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL,
  rule_id     text NOT NULL REFERENCES rules(id),
  severity    text NOT NULL,
  event_id    bigint REFERENCES events(id),
  details     jsonb NOT NULL DEFAULT '{}',
  status      text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'dismissed', 'escalated')),
  case_id     uuid REFERENCES cases(id),
  reviewed_by uuid,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX alerts_status ON alerts(status, created_at DESC);
CREATE INDEX alerts_user ON alerts(user_id);

CREATE TABLE case_notes (
  id      bigserial PRIMARY KEY,
  case_id uuid NOT NULL REFERENCES cases(id),
  author  uuid NOT NULL,
  note    text NOT NULL,
  at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE holds (
  user_id    uuid PRIMARY KEY,
  reason     text NOT NULL,
  placed_by  text NOT NULL,     -- 'rule:<id>' or admin uuid
  case_id    uuid REFERENCES cases(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_log (
  id       bigserial PRIMARY KEY,
  actor_id uuid,
  action   text NOT NULL,
  target   text,
  meta     jsonb NOT NULL DEFAULT '{}',
  at       timestamptz NOT NULL DEFAULT now()
);
