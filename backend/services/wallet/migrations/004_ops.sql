-- Phase 3: webhook failure log for ops.
CREATE TABLE webhook_failures (
  id        bigserial PRIMARY KEY,
  route     text NOT NULL,
  reference text,
  status    int NOT NULL,
  error     text NOT NULL,
  at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX webhook_failures_at ON webhook_failures(at DESC);
