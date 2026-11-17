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

CREATE FUNCTION bill_events() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IN ('completed', 'failed') AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
    INSERT INTO outbox(type, user_id, payload) VALUES ('bills.payment_' || NEW.status, NEW.user_id,
      jsonb_build_object('paymentId', NEW.id, 'billerId', NEW.biller_id, 'amountMinor', NEW.amount::text, 'customerId', NEW.customer_id, 'token', NEW.token, 'reason', NEW.failure));
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER payments_events AFTER INSERT OR UPDATE OF status ON payments FOR EACH ROW EXECUTE FUNCTION bill_events();
