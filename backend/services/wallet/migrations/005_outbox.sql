-- Transactional outbox (ADR-021). Rows are written in the same transaction as the
-- change they describe and published to the event bus by the relay.
CREATE TABLE outbox (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type         text NOT NULL,
  user_id      uuid,
  payload      jsonb NOT NULL DEFAULT '{}',
  created_at   timestamptz NOT NULL DEFAULT clock_timestamp(),
  published_at timestamptz,
  attempts     int NOT NULL DEFAULT 0,
  last_error   text
);
CREATE INDEX outbox_unpublished ON outbox(created_at, id) WHERE published_at IS NULL;

CREATE FUNCTION wallet_events() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'deposits' THEN
    INSERT INTO outbox(type, user_id, payload) VALUES ('wallet.deposit_received', NEW.user_id,
      jsonb_build_object('depositId', NEW.id, 'amountMinor', NEW.amount::text, 'currency', NEW.currency, 'senderName', NEW.sender_name));
  ELSIF NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('completed', 'failed') THEN
    INSERT INTO outbox(type, user_id, payload) VALUES ('wallet.withdrawal_' || NEW.status, NEW.user_id,
      jsonb_build_object('withdrawalId', NEW.id, 'amountMinor', NEW.amount::text, 'currency', 'NGN',
        'accountName', NEW.account_name, 'accountLast4', right(NEW.account_number, 4), 'reason', NEW.failure_reason));
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER deposits_events AFTER INSERT ON deposits FOR EACH ROW EXECUTE FUNCTION wallet_events();
CREATE TRIGGER withdrawals_events AFTER UPDATE OF status ON withdrawals FOR EACH ROW EXECUTE FUNCTION wallet_events();
