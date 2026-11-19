-- Customer support tickets (ADR-030).
CREATE TABLE tickets (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number        bigserial UNIQUE,                     -- human-friendly #1042
  user_id       uuid NOT NULL,
  user_name     text NOT NULL,                        -- snapshot for the staff queue
  user_email    text NOT NULL,
  subject       text NOT NULL,
  category      text NOT NULL CHECK (category IN ('account', 'deposit', 'withdrawal', 'trade', 'giftcard', 'bill', 'verification', 'other')),
  reference     text,                                 -- optional transaction reference (WS-…)
  status        text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'awaiting_customer', 'resolved', 'closed')),
  priority      text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  assigned_to   uuid,
  first_response_at timestamptz,
  user_seen_at  timestamptz NOT NULL DEFAULT now(),
  last_staff_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tickets_user ON tickets(user_id, updated_at DESC);
CREATE INDEX tickets_queue ON tickets(status, priority, updated_at);

CREATE TABLE messages (
  id          bigserial PRIMARY KEY,
  ticket_id   uuid NOT NULL REFERENCES tickets(id),
  author_type text NOT NULL CHECK (author_type IN ('customer', 'staff')),
  author_id   uuid NOT NULL,
  author_name text NOT NULL,
  body        text NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
  internal    boolean NOT NULL DEFAULT false,         -- staff-only notes, never shown to customers
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (NOT internal OR author_type = 'staff')
);
CREATE INDEX messages_ticket ON messages(ticket_id, id);

-- Transactional outbox (ADR-021): customers are notified of staff replies and resolutions.
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

CREATE FUNCTION support_events() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE t tickets;
BEGIN
  IF TG_TABLE_NAME = 'messages' THEN
    IF NEW.author_type = 'staff' AND NOT NEW.internal THEN
      SELECT * INTO t FROM tickets WHERE id = NEW.ticket_id;
      INSERT INTO outbox(type, user_id, payload) VALUES ('support.staff_replied', t.user_id,
        jsonb_build_object('ticketId', t.id, 'number', t.number, 'subject', t.subject));
    END IF;
  ELSIF NEW.status = 'resolved' AND OLD.status IS DISTINCT FROM 'resolved' THEN
    INSERT INTO outbox(type, user_id, payload) VALUES ('support.resolved', NEW.user_id,
      jsonb_build_object('ticketId', NEW.id, 'number', NEW.number, 'subject', NEW.subject));
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER messages_events AFTER INSERT ON messages FOR EACH ROW EXECUTE FUNCTION support_events();
CREATE TRIGGER tickets_events AFTER UPDATE OF status ON tickets FOR EACH ROW EXECUTE FUNCTION support_events();
