CREATE TABLE brands (
  id            text PRIMARY KEY,
  name          text NOT NULL,
  currency      text NOT NULL DEFAULT 'USD',
  sell_rate     bigint NOT NULL CHECK (sell_rate > 0),   -- kobo paid to the user per 1 unit of card value
  buy_rate      bigint NOT NULL CHECK (buy_rate > 0),    -- kobo charged to the user per 1 unit when buying
  min_value     int NOT NULL DEFAULT 10,
  max_value     int NOT NULL DEFAULT 500,
  sell_enabled  boolean NOT NULL DEFAULT true,
  buy_enabled   boolean NOT NULL DEFAULT true,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (min_value > 0 AND min_value < max_value)
);

-- Sandbox catalogue. Rates are placeholders for testing, set real ones in the admin dashboard.
INSERT INTO brands(id, name, sell_rate, buy_rate, min_value, max_value) VALUES
  ('amazon_us', 'Amazon (US)', 120000, 165000, 10, 500),
  ('apple_us', 'Apple (US)', 115000, 165000, 10, 500),
  ('steam', 'Steam', 110000, 165000, 10, 200),
  ('google_play_us', 'Google Play (US)', 100000, 165000, 10, 200);

CREATE TABLE sell_trades (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL,
  brand_id        text NOT NULL REFERENCES brands(id),
  value           int NOT NULL CHECK (value > 0),      -- card face value in whole units of brand currency
  currency        text NOT NULL,
  code_enc        text,                                -- AES-256-GCM, readable only by reviewers
  code_hash       text UNIQUE,                         -- one submission per card, ever
  code_last4      text,
  image           bytea,
  image_type      text,
  rate            bigint NOT NULL,                     -- sell_rate at submission time
  payout          bigint NOT NULL,                     -- kobo, estimate until approved
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reason          text,
  reviewed_by     uuid,
  reviewed_at     timestamptz,
  journal_id      uuid,
  idempotency_key text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, idempotency_key),
  CHECK (code_enc IS NOT NULL OR image IS NOT NULL)
);
CREATE INDEX sell_trades_status ON sell_trades(status, created_at);
CREATE INDEX sell_trades_user ON sell_trades(user_id, created_at DESC);

CREATE TABLE buy_orders (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL,
  brand_id        text NOT NULL REFERENCES brands(id),
  value           int NOT NULL CHECK (value > 0),
  cost            bigint NOT NULL CHECK (cost > 0),    -- kobo
  code_enc        text,
  status          text NOT NULL CHECK (status IN ('completed', 'failed')),
  failure         text,
  journal_id      uuid,
  idempotency_key text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, idempotency_key)
);
CREATE INDEX buy_orders_user ON buy_orders(user_id, created_at DESC);

CREATE TABLE used_step_up (
  jti     text PRIMARY KEY,
  used_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_log (
  id       bigserial PRIMARY KEY,
  actor_id uuid,
  action   text NOT NULL,
  target   text,
  meta     jsonb NOT NULL DEFAULT '{}',
  at       timestamptz NOT NULL DEFAULT now()
);
