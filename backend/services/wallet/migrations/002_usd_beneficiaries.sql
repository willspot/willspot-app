-- Phase 2: USD receiving accounts, multi-currency deposits, saved beneficiaries.
CREATE TABLE usd_accounts (
  user_id        uuid PRIMARY KEY,
  account_number text NOT NULL UNIQUE,
  routing_number text NOT NULL,
  account_name   text NOT NULL,
  bank_name      text NOT NULL,
  provider       text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE deposits ADD COLUMN currency text NOT NULL DEFAULT 'NGN' CHECK (currency IN ('NGN', 'USD'));

CREATE TABLE beneficiaries (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL,
  bank_code      text NOT NULL,
  account_number text NOT NULL,
  account_name   text NOT NULL,
  nickname       text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, bank_code, account_number)
);
