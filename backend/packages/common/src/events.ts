import { connect, type NatsConnection } from "@nats-io/transport-node";
import { AckPolicy, DeliverPolicy, jetstream, jetstreamManager, RetentionPolicy, type JetStreamClient } from "@nats-io/jetstream";
import type { Db } from "./db.js";
import { every } from "./ops.js";
import { counter } from "./telemetry.js";

/**
 * Domain events between services.
 *
 * Producers never publish directly. A business change and its event are written in
 * the same database transaction (an `outbox` row, usually by a trigger), and a relay
 * publishes outbox rows to the bus. So an event is sent if and only if the change
 * committed, even if the process dies in between (transactional outbox).
 *
 * Delivery is at-least-once. Every event has a stable id; JetStream drops repeats
 * within its duplicate window (Nats-Msg-Id) and consumers also dedupe by id.
 */

export interface DomainEvent {
  id: string;
  /** "<service>.<what_happened>", e.g. "wallet.deposit_received". */
  type: string;
  userId: string | null;
  data: Record<string, unknown>;
  occurredAt: string;
}

export type EventHandler = (e: DomainEvent) => Promise<void>;

export interface EventBus {
  publish(e: DomainEvent): Promise<void>;
  /** Durable subscription: `name` keeps its position across restarts and is shared by replicas. */
  subscribe(name: string, handler: EventHandler): Promise<void>;
  close(): Promise<void>;
}

export const STREAM = "WILLSPOT_EVENTS";
export const SUBJECT_PREFIX = "willspot.events";
const subjectFor = (type: string) => `${SUBJECT_PREFIX}.${type.replace(/[^\w.-]/g, "_")}`;

const published = counter("willspot_events_published_total", "Outbox events published to the bus", ["type"]);
const handled = counter("willspot_events_handled_total", "Events handled by consumers", ["consumer", "result"]);

/** NATS JetStream. One stream for all domain events, kept 7 days; consumers ack explicitly. */
export class NatsBus implements EventBus {
  private constructor(
    private readonly nc: NatsConnection,
    private readonly js: JetStreamClient,
    private readonly log: (msg: string, err?: unknown) => void,
  ) {}

  static async connect(url: string, opts: { name: string; token?: string; log?: (msg: string, err?: unknown) => void }): Promise<NatsBus> {
    const nc = await connect({ servers: url.split(","), name: opts.name, token: opts.token, maxReconnectAttempts: -1 });
    const jsm = await jetstreamManager(nc);
    const cfg = { name: STREAM, subjects: [`${SUBJECT_PREFIX}.>`], retention: RetentionPolicy.Limits, max_age: 7 * 24 * 3600 * 1e9, duplicate_window: 10 * 60 * 1e9 };
    try {
      await jsm.streams.info(STREAM);
    } catch {
      try {
        await jsm.streams.add(cfg);
      } catch {
        // another replica created it first
      }
    }
    return new NatsBus(nc, jetstream(nc), opts.log ?? ((m, e) => console.warn(m, e ?? "")));
  }

  async publish(e: DomainEvent) {
    await this.js.publish(subjectFor(e.type), JSON.stringify(e), { msgID: e.id });
  }

  async subscribe(name: string, handler: EventHandler) {
    const jsm = await jetstreamManager(this.nc);
    try {
      await jsm.consumers.info(STREAM, name);
    } catch {
      await jsm.consumers.add(STREAM, { durable_name: name, ack_policy: AckPolicy.Explicit, deliver_policy: DeliverPolicy.All, max_deliver: 10, ack_wait: 30 * 1e9 });
    }
    const consumer = await this.js.consumers.get(STREAM, name);
    const messages = await consumer.consume();
    void (async () => {
      for await (const m of messages) {
        let e: DomainEvent;
        try {
          e = m.json<DomainEvent>();
        } catch {
          m.term();
          handled.inc({ consumer: name, result: "malformed" });
          continue;
        }
        try {
          await handler(e);
          m.ack();
          handled.inc({ consumer: name, result: "ok" });
        } catch (err) {
          this.log(`event handler failed (${e.type} ${e.id}); will redeliver`, err);
          m.nak(5000);
          handled.inc({ consumer: name, result: "error" });
        }
      }
    })();
  }

  async close() {
    await this.nc.drain();
  }
}

/** In-process bus for tests and single-process development. Same at-least-once contract. */
export class MemoryBus implements EventBus {
  readonly events: DomainEvent[] = [];
  private handlers: EventHandler[] = [];
  async publish(e: DomainEvent) {
    this.events.push(e);
    for (const h of this.handlers) await h(e);
  }
  async subscribe(_name: string, handler: EventHandler) {
    this.handlers.push(handler);
  }
  async close() {}
}

interface OutboxRow {
  id: string;
  type: string;
  user_id: string | null;
  payload: Record<string, unknown>;
  created_at: Date;
}

/**
 * Publishes up to `batch` unpublished outbox rows in commit order. Rows are locked
 * (SKIP LOCKED) so several relays never send the same row at the same time. Stops at
 * the first failure so ordering per producer is kept; the row is retried next tick.
 */
export async function relayOutbox(db: Db, bus: EventBus, batch = 100): Promise<number> {
  const c = await db.connect();
  let sent = 0;
  try {
    await c.query("BEGIN");
    const rows = (await c.query<OutboxRow>("SELECT id, type, user_id, payload, created_at FROM outbox WHERE published_at IS NULL ORDER BY created_at, id LIMIT $1 FOR UPDATE SKIP LOCKED", [batch])).rows;
    for (const r of rows) {
      try {
        await bus.publish({ id: r.id, type: r.type, userId: r.user_id, data: r.payload, occurredAt: r.created_at.toISOString() });
      } catch (e) {
        await c.query("UPDATE outbox SET attempts = attempts + 1, last_error = $2 WHERE id = $1", [r.id, String((e as Error).message ?? e).slice(0, 300)]);
        break;
      }
      await c.query("UPDATE outbox SET published_at = now(), attempts = attempts + 1 WHERE id = $1", [r.id]);
      published.inc({ type: r.type });
      sent++;
    }
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
  return sent;
}

/** Deletes published rows after a week (the stream itself keeps 7 days too). */
export async function pruneOutbox(db: Db): Promise<number> {
  return (await db.query("DELETE FROM outbox WHERE published_at < now() - interval '7 days'")).rowCount ?? 0;
}

/** Relay loop for a producer service: every second, one replica at a time. */
export function startOutboxRelay(db: Db, bus: EventBus, service: string, onError: (e: unknown) => void, everyMs = 1000) {
  const stopRelay = every(everyMs, () => relayOutbox(db, bus), onError, { db, key: `outbox-relay-${service}` });
  const stopPrune = every(6 * 3600_000, () => pruneOutbox(db), onError, { db, key: `outbox-prune-${service}` });
  return () => {
    stopRelay();
    stopPrune();
  };
}

/** Writes an event into the outbox inside the caller's transaction. */
export async function emitEvent(c: { query: Db["query"] }, type: string, userId: string | null, data: Record<string, unknown> = {}) {
  await c.query("INSERT INTO outbox(type, user_id, payload) VALUES ($1, $2, $3)", [type, userId, data]);
}

/** Connects to NATS when NATS_URL is set; returns null otherwise (events stay in the outbox until a bus is configured). */
export async function busFromEnv(service: string, log: (msg: string, err?: unknown) => void): Promise<EventBus | null> {
  const url = process.env.NATS_URL;
  if (!url) return null;
  return NatsBus.connect(url, { name: `willspot-${service}`, token: process.env.NATS_TOKEN || undefined, log });
}
