CREATE TABLE config_docs (
  key        text PRIMARY KEY CHECK (key IN ('brand', 'flags')),
  value      jsonb NOT NULL,
  version    int NOT NULL DEFAULT 1,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE config_history (
  id         bigserial PRIMARY KEY,
  key        text NOT NULL,
  value      jsonb NOT NULL,
  version    int NOT NULL,
  updated_by uuid,
  at         timestamptz NOT NULL DEFAULT now()
);
