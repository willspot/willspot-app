CREATE TABLE pairs (
  asset           text PRIMARY KEY,                    -- BTC, ETH, USDT; quoted in NGN
  name            text NOT NULL,
  enabled         boolean NOT NULL DEFAULT true,
  buy_spread_bps  int NOT NULL DEFAULT 150 CHECK (buy_spread_bps BETWEEN 0 AND 2000),
  sell_spread_bps int NOT NULL DEFAULT 150 CHECK (sell_spread_bps BETWEEN 0 AND 2000),
  min_ngn         bigint NOT NULL DEFAULT 100000,      -- kobo (1,000.00)
  max_ngn         bigint NOT NULL DEFAULT 500000000,   -- kobo (5,000,000.00)
  updated_at      timestamptz NOT NULL DEFAULT now()
);

INSERT INTO pairs(asset, name) VALUES ('BTC', 'Bitcoin'), ('ETH', 'Ethereum'), ('USDT', 'Tether USD');

CREATE TABLE settings (
  key        text PRIMARY KEY,
  value      text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO settings(key, value) VALUES ('usd_ngn', '1550.00');

CREATE TABLE quotes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL,
  asset       text NOT NULL,
  side        text NOT NULL CHECK (side IN ('buy', 'sell')),
  price       bigint NOT NULL,          -- NGN kobo per 1 whole unit of asset
  ngn_amount  bigint NOT NULL CHECK (ngn_amount > 0),
  asset_amount bigint NOT NULL CHECK (asset_amount > 0),
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX quotes_user ON quotes(user_id, created_at DESC);

CREATE TABLE orders (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id    uuid NOT NULL UNIQUE REFERENCES quotes(id),
  user_id     uuid NOT NULL,
  asset       text NOT NULL,
  side        text NOT NULL,
  price       bigint NOT NULL,
  ngn_amount  bigint NOT NULL,
  asset_amount bigint NOT NULL,
  status      text NOT NULL CHECK (status IN ('completed', 'failed')),
  journal_id  uuid,
  failure     text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX orders_user ON orders(user_id, created_at DESC);

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
