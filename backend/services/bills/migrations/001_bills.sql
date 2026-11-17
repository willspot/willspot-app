CREATE TABLE payments (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL,
  biller_id           text NOT NULL,
  product_id          text,
  customer_id         text NOT NULL,
  customer_name       text,
  amount              bigint NOT NULL CHECK (amount > 0),      -- kobo
  status              text NOT NULL CHECK (status IN ('processing', 'completed', 'failed')),
  token               text,                                     -- electricity token, if any
  provider_ref        text,
  failure             text,
  journal_id          uuid,
  reversal_journal_id uuid,
  idempotency_key     text NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, idempotency_key)
);
CREATE INDEX payments_user ON payments(user_id, created_at DESC);

CREATE TABLE used_step_up (
  jti     text PRIMARY KEY,
  used_at timestamptz NOT NULL DEFAULT now()
);
