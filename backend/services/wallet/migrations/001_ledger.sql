-- Double-entry ledger. Postings are append-only; every journal must balance per asset;
-- balances can never go negative unless the account is a system account.

CREATE TABLE ledger_accounts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code           text NOT NULL UNIQUE,            -- e.g. user:<uuid>:NGN, sys:bank:NGN
  owner_id       uuid,
  asset          text NOT NULL,
  allow_negative boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ledger_accounts_owner ON ledger_accounts(owner_id);

CREATE TABLE balances (
  account_id     uuid PRIMARY KEY REFERENCES ledger_accounts(id),
  balance        bigint NOT NULL DEFAULT 0,
  allow_negative boolean NOT NULL,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT no_overdraft CHECK (allow_negative OR balance >= 0)
);

CREATE TABLE journals (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key text NOT NULL UNIQUE,
  type            text NOT NULL,
  user_id         uuid,
  description     text NOT NULL DEFAULT '',
  meta            jsonb NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX journals_user ON journals(user_id, created_at DESC);

CREATE TABLE postings (
  id         bigserial PRIMARY KEY,
  journal_id uuid NOT NULL REFERENCES journals(id),
  account_id uuid NOT NULL REFERENCES ledger_accounts(id),
  amount     bigint NOT NULL CHECK (amount <> 0)
);
CREATE INDEX postings_journal ON postings(journal_id);
CREATE INDEX postings_account ON postings(account_id);

CREATE FUNCTION check_journal_balanced() RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM postings p JOIN ledger_accounts a ON a.id = p.account_id
    WHERE p.journal_id = NEW.journal_id
    GROUP BY a.asset HAVING sum(p.amount) <> 0
  ) THEN
    RAISE EXCEPTION 'journal % is unbalanced', NEW.journal_id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER postings_balanced
  AFTER INSERT ON postings DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_journal_balanced();

CREATE FUNCTION forbid_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER postings_append_only BEFORE UPDATE OR DELETE ON postings FOR EACH ROW EXECUTE FUNCTION forbid_change();
CREATE TRIGGER journals_append_only BEFORE UPDATE OR DELETE ON journals FOR EACH ROW EXECUTE FUNCTION forbid_change();

CREATE TABLE virtual_accounts (
  user_id        uuid PRIMARY KEY,
  account_number text NOT NULL UNIQUE,
  account_name   text NOT NULL,
  bank_name      text NOT NULL,
  provider       text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE deposits (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_ref  text NOT NULL UNIQUE,
  user_id       uuid NOT NULL,
  amount        bigint NOT NULL CHECK (amount > 0),
  sender_name   text,
  journal_id    uuid REFERENCES journals(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE withdrawals (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL,
  amount         bigint NOT NULL CHECK (amount > 0),
  fee            bigint NOT NULL CHECK (fee >= 0),
  bank_code      text NOT NULL,
  account_number text NOT NULL,
  account_name   text NOT NULL,
  status         text NOT NULL CHECK (status IN ('processing', 'completed', 'failed')),
  provider_ref   text,
  failure_reason text,
  journal_id     uuid NOT NULL REFERENCES journals(id),
  reversal_id    uuid REFERENCES journals(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX withdrawals_user ON withdrawals(user_id, created_at DESC);
CREATE INDEX withdrawals_status ON withdrawals(status, created_at);

CREATE TABLE used_step_up (
  jti     text PRIMARY KEY,
  used_at timestamptz NOT NULL DEFAULT now()
);
