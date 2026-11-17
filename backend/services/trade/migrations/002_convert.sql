-- Phase 2: convert between any two of NGN, USD, BTC, ETH, USDT.
INSERT INTO settings(key, value) VALUES ('usd_fx_spread_bps', '100') ON CONFLICT DO NOTHING;

CREATE TABLE convert_quotes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL,
  from_asset   text NOT NULL,
  to_asset     text NOT NULL,
  from_amount  bigint NOT NULL CHECK (from_amount > 0),
  to_amount    bigint NOT NULL CHECK (to_amount > 0),
  rate         text NOT NULL,              -- display only: units of `to` per 1 `from`
  expires_at   timestamptz NOT NULL,
  used_at      timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (from_asset <> to_asset)
);
CREATE INDEX convert_quotes_user ON convert_quotes(user_id, created_at DESC);

CREATE TABLE conversions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id    uuid NOT NULL UNIQUE REFERENCES convert_quotes(id),
  user_id     uuid NOT NULL,
  from_asset  text NOT NULL,
  to_asset    text NOT NULL,
  from_amount bigint NOT NULL,
  to_amount   bigint NOT NULL,
  rate        text NOT NULL,
  -- pending_settlement: the ledger call failed in transit; the retrier finishes it.
  status      text NOT NULL CHECK (status IN ('completed', 'failed', 'pending_settlement')),
  journal_id  uuid,
  failure     text,
  attempts    int NOT NULL DEFAULT 1,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX conversions_user ON conversions(user_id, created_at DESC);
CREATE INDEX conversions_pending ON conversions(status) WHERE status = 'pending_settlement';

-- Same retry treatment for crypto buy/sell orders.
ALTER TABLE orders DROP CONSTRAINT orders_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_status_check CHECK (status IN ('completed', 'failed', 'pending_settlement'));
ALTER TABLE orders ADD COLUMN attempts int NOT NULL DEFAULT 1;
ALTER TABLE orders ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX orders_pending ON orders(status) WHERE status = 'pending_settlement';
