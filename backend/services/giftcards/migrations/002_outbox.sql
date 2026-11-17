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

CREATE FUNCTION giftcard_events() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'sell_trades' THEN
    IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('approved', 'rejected') THEN
      INSERT INTO outbox(type, user_id, payload) VALUES ('giftcards.sell_' || NEW.status, NEW.user_id,
        jsonb_build_object('tradeId', NEW.id, 'brandId', NEW.brand_id, 'value', NEW.value, 'currency', NEW.currency, 'payoutMinor', NEW.payout::text, 'reason', NEW.reason));
    END IF;
  -- Buy orders are inserted as 'failed' and updated to 'completed' once the ledger posts.
  ELSIF NEW.status = 'completed' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
    INSERT INTO outbox(type, user_id, payload) VALUES ('giftcards.buy_completed', NEW.user_id,
      jsonb_build_object('orderId', NEW.id, 'brandId', NEW.brand_id, 'value', NEW.value));
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER sell_trades_events AFTER UPDATE OF status ON sell_trades FOR EACH ROW EXECUTE FUNCTION giftcard_events();
CREATE TRIGGER buy_orders_events AFTER INSERT OR UPDATE OF status ON buy_orders FOR EACH ROW EXECUTE FUNCTION giftcard_events();
