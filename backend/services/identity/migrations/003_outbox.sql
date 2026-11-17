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

-- Security and verification events come from the audit log, which every such action already writes.
CREATE FUNCTION identity_events() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE uid uuid;
BEGIN
  IF NEW.action NOT IN ('kyc.approved', 'kyc.rejected', 'totp.enabled', 'totp.disabled', 'totp.reset', 'pin.changed', 'login.new_device', 'password.changed', 'user.suspended')
     OR NEW.target !~ '^[0-9a-f-]{36}$' THEN
    RETURN NEW;
  END IF;
  uid := NEW.target::uuid;
  INSERT INTO outbox(type, user_id, payload) VALUES ('identity.' || replace(NEW.action, '.', '_'), uid,
    jsonb_strip_nulls(jsonb_build_object('reason', NEW.meta->>'reason', 'device', NEW.meta->>'device')));
  RETURN NEW;
END $$;
CREATE TRIGGER audit_events AFTER INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION identity_events();
