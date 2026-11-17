-- Per-admin roles (ADR-023). Existing admins become super admins.
ALTER TABLE users ADD COLUMN admin_roles text[] NOT NULL DEFAULT '{}'
  CHECK (admin_roles <@ ARRAY['super_admin', 'compliance', 'finance', 'support', 'operations']::text[]);
UPDATE users SET admin_roles = '{super_admin}' WHERE role = 'admin';

-- One-time links for new staff to set their own password. Only a hash is stored.
CREATE TABLE admin_invites (
  token_hash text PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users(id),
  created_by uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz
);

-- Two-factor recovery codes, hashed, single use.
CREATE TABLE totp_recovery_codes (
  user_id   uuid NOT NULL REFERENCES users(id),
  code_hash text NOT NULL,
  used_at   timestamptz,
  PRIMARY KEY (user_id, code_hash)
);
