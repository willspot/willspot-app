CREATE TABLE users (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email            text NOT NULL UNIQUE,
  phone            text NOT NULL UNIQUE,
  first_name       text NOT NULL,
  last_name        text NOT NULL,
  password_hash    text NOT NULL,
  pin_hash         text,
  role             text NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  status           text NOT NULL DEFAULT 'pending_otp' CHECK (status IN ('pending_otp', 'active', 'suspended', 'deleted')),
  kyc_tier         int  NOT NULL DEFAULT 0 CHECK (kyc_tier BETWEEN 0 AND 2),
  failed_logins    int  NOT NULL DEFAULT 0,
  locked_until     timestamptz,
  pin_failures     int  NOT NULL DEFAULT 0,
  pin_locked_until timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  deleted_at       timestamptz
);

CREATE TABLE otps (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id),
  purpose     text NOT NULL,
  code_hash   text NOT NULL,
  attempts    int  NOT NULL DEFAULT 0,
  expires_at  timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX otps_user ON otps(user_id, created_at DESC);

CREATE TABLE sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id),
  refresh_hash  text NOT NULL UNIQUE,
  previous_hash text,
  device_id     text,
  user_agent    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  revoked_at    timestamptz
);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE INDEX sessions_previous ON sessions(previous_hash);

CREATE TABLE kyc_submissions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id),
  level         int  NOT NULL CHECK (level IN (1, 2)),
  status        text NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
  -- Only the last 4 digits and a hash of identifiers are stored (data minimisation, NDPA).
  id_type       text,
  id_last4      text,
  id_hash       text,
  selfie_ref    text,
  provider      text,
  provider_ref  text,
  reason        text,
  reviewed_by   uuid,
  reviewed_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX kyc_status ON kyc_submissions(status, created_at);

CREATE TABLE audit_log (
  id       bigserial PRIMARY KEY,
  actor_id uuid,
  action   text NOT NULL,
  target   text,
  meta     jsonb NOT NULL DEFAULT '{}',
  at       timestamptz NOT NULL DEFAULT now()
);
