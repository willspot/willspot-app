-- Referral rewards (ADR-028). One reward per referred person, ever (primary key), paid
-- from the marketing system account when they make a qualifying first deposit.
CREATE TABLE referral_rewards (
  referee_id  uuid PRIMARY KEY,
  referrer_id uuid NOT NULL,
  deposit_id  uuid NOT NULL,
  amount      bigint NOT NULL CHECK (amount > 0),
  journal_id  uuid NOT NULL REFERENCES journals(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX referral_rewards_referrer ON referral_rewards(referrer_id, created_at DESC);

CREATE FUNCTION referral_events() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO outbox(type, user_id, payload) VALUES ('wallet.referral_reward', NEW.referrer_id,
    jsonb_build_object('amountMinor', NEW.amount::text, 'currency', 'NGN'));
  RETURN NEW;
END $$;
CREATE TRIGGER referral_rewards_events AFTER INSERT ON referral_rewards FOR EACH ROW EXECUTE FUNCTION referral_events();
