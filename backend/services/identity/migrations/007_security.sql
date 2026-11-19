-- Security review fixes (ADR-035).
-- Idle timeout: refresh is refused when a session hasn't been used for SESSION_IDLE_DAYS.
ALTER TABLE sessions ADD COLUMN last_used_at timestamptz NOT NULL DEFAULT now();

-- Password reset. A row is created for every request, even for unknown accounts, so the
-- response never reveals whether an email/phone is registered (user_id is then NULL).
CREATE TABLE password_resets (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid REFERENCES users(id),
  code_hash   text,
  attempts    int NOT NULL DEFAULT 0,
  expires_at  timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX password_resets_user ON password_resets(user_id, created_at DESC);
