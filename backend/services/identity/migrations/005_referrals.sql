-- Referral codes (8 characters, no look-alikes) and who referred whom. Rewards are paid
-- by the wallet service; identity only records the relationship, set once at sign-up.
CREATE FUNCTION referral_code() RETURNS text LANGUAGE sql VOLATILE AS $$
  SELECT string_agg(substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', (get_byte(decode(md5(gen_random_uuid()::text), 'hex'), i) % 31) + 1, 1), '' ORDER BY i)
  FROM generate_series(0, 7) AS i
$$;
ALTER TABLE users ADD COLUMN referral_code text;
UPDATE users SET referral_code = referral_code();
ALTER TABLE users ALTER COLUMN referral_code SET NOT NULL, ALTER COLUMN referral_code SET DEFAULT referral_code();
CREATE UNIQUE INDEX users_referral_code ON users(referral_code);
ALTER TABLE users ADD COLUMN referred_by uuid REFERENCES users(id);
CREATE INDEX users_referred_by ON users(referred_by) WHERE referred_by IS NOT NULL;
