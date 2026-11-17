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

-- Orders and conversions are inserted as completed, or as pending_settlement and updated later.
CREATE FUNCTION trade_events() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status <> 'completed' OR (TG_OP = 'UPDATE' AND OLD.status = 'completed') THEN
    RETURN NEW;
  END IF;
  IF TG_TABLE_NAME = 'orders' THEN
    INSERT INTO outbox(type, user_id, payload) VALUES ('trade.order_completed', NEW.user_id,
      jsonb_build_object('orderId', NEW.id, 'asset', NEW.asset, 'side', NEW.side, 'ngnMinor', NEW.ngn_amount::text, 'assetMinor', NEW.asset_amount::text));
  ELSE
    INSERT INTO outbox(type, user_id, payload) VALUES ('trade.convert_completed', NEW.user_id,
      jsonb_build_object('conversionId', NEW.id, 'from', NEW.from_asset, 'to', NEW.to_asset, 'fromMinor', NEW.from_amount::text, 'toMinor', NEW.to_amount::text));
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER orders_events AFTER INSERT OR UPDATE OF status ON orders FOR EACH ROW EXECUTE FUNCTION trade_events();
CREATE TRIGGER conversions_events AFTER INSERT OR UPDATE OF status ON conversions FOR EACH ROW EXECUTE FUNCTION trade_events();
