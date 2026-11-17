-- Phase 2: TOTP second factor (required for admins in production).
ALTER TABLE users ADD COLUMN totp_secret_enc text;
ALTER TABLE users ADD COLUMN totp_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN totp_last_step bigint;
ALTER TABLE sessions ADD COLUMN mfa boolean NOT NULL DEFAULT false;
