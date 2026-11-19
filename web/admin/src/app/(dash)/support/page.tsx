"use client";

import { AnimatePresence, motion } from "motion/react";
import { useState, type FormEvent } from "react";
import { Header, useLoad, useToast } from "@/components/Shell";
import { api, when } from "@/lib/api";

interface Ticket {
  id: string; number: number; subject: string; category: string; reference: string | null; status: string; priority: string;
  userId: string; userName: string; userEmail: string; assignedTo: string | null; createdAt: string; updatedAt: string; firstResponseAt: string | null;
}
interface Message { id: number; authorType: "customer" | "staff"; authorName: string; body: string; internal: boolean; createdAt: string }

const STATUS: Record<string, string> = { active: "Active", open: "Waiting for us", awaiting_customer: "Waiting for customer", resolved: "Resolved", closed: "Closed" };
const PRIORITY_CLS: Record<string, string> = { urgent: "bad", high: "warn", normal: "", low: "" };

/** Support queue: oldest-waiting first within priority; conversation with replies and internal notes. */
export default function Support() {
  const [status, setStatus] = useState("active");
  const [mine, setMine] = useState(false);
  const [q, setQ] = useState("");
  const list = useLoad<{ items: Ticket[] }>(`/v1/admin/support/tickets?status=${status}${mine ? "&mine=true" : ""}${q ? `&q=${encodeURIComponent(q)}` : ""}`);
  const stats = useLoad<{ open: number; awaitingCustomer: number; unassigned: number; avgFirstResponseMinutes30d: number | null }>("/v1/admin/support/stats");
  const [openId, setOpenId] = useState<string | null>(null);
  const thread = useLoad<{ ticket: Ticket; messages: Message[] }>(openId ? `/v1/admin/support/tickets/${openId}` : null);
  const toast = useToast();
  const t = openId ? thread.data : null;

  const refresh = () => { list.reload(); stats.reload(); thread.reload(); };

  async function reply(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const internal = (e.nativeEvent as SubmitEvent).submitter?.getAttribute("value") === "note";
    try {
      await api(`/v1/admin/support/tickets/${openId}/messages`, { message: f.get("message"), internal });
      form.reset();
      toast(internal ? "Internal note added" : "Reply sent; the customer gets a notification");
      refresh();
    } catch (err) {
      toast((err as Error).message);
    }
  }

  async function update(body: object) {
    try {
      await api(`/v1/admin/support/tickets/${openId}`, body);
      refresh();
    } catch (err) {
      toast((err as Error).message);
    }
  }

  return (
    <>
      <Header title="Support" subtitle="Customer requests from the app. Never ask customers for PINs, passwords or codes." />
      <div className="grid stats" style={{ marginBottom: 16 }}>
        {[["Waiting for us", stats.data?.open], ["Unassigned", stats.data?.unassigned], ["Waiting for customer", stats.data?.awaitingCustomer], ["Avg first reply (30d)", stats.data?.avgFirstResponseMinutes30d == null ? "—" : `${stats.data.avgFirstResponseMinutes30d} min`]].map(([label, v]) => (
          <div key={label as string} className="card"><div className="muted">{label}</div><div className="stat-value">{v ?? "…"}</div></div>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(280px, 380px) 1fr", gap: 16, alignItems: "start" }}>
        <div className="card" style={{ padding: 12 }}>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
            {Object.entries(STATUS).map(([k, label]) => (
              <button key={k} className={`btn ${status === k ? "" : "secondary"}`} style={{ padding: "4px 10px", fontSize: 12 }} onClick={() => setStatus(k)}>{label}</button>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <input placeholder="Search #, subject, email" value={q} onChange={(e) => setQ(e.target.value)} />
            <label style={{ display: "flex", gap: 4, alignItems: "center", fontWeight: 400, whiteSpace: "nowrap" }}>
              <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} style={{ width: "auto" }} /> Mine
            </label>
          </div>
          {list.data?.items.length === 0 && <p className="muted">Nothing here.</p>}
          {list.data?.items.map((x) => (
            <motion.button
              key={x.id}
              layout
              onClick={() => setOpenId(x.id)}
              className="navlink"
              style={{ display: "block", width: "100%", textAlign: "left", border: 0, background: openId === x.id ? "var(--surface-2, rgba(99,91,255,.08))" : "transparent", padding: 10, borderRadius: 10, cursor: "pointer", color: "inherit" }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <strong style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>#{x.number} {x.subject}</strong>
                {x.priority !== "normal" && <span className={`badge ${PRIORITY_CLS[x.priority]}`}>{x.priority}</span>}
              </div>
              <div className="muted" style={{ fontSize: 12 }}>{x.userName} · {STATUS[x.status]} · {when(x.updatedAt)}</div>
            </motion.button>
          ))}
        </div>

        <AnimatePresence mode="wait">
          {!t ? (
            <motion.div key="empty" className="card muted" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>Pick a request on the left.</motion.div>
          ) : (
            <motion.div key={t.ticket.id} className="card" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <div>
                  <h2 style={{ margin: 0 }}>#{t.ticket.number} {t.ticket.subject}</h2>
                  <div className="muted" style={{ fontSize: 13 }}>
                    {t.ticket.userName} · {t.ticket.userEmail} · {t.ticket.category}{t.ticket.reference ? ` · ${t.ticket.reference}` : ""} · opened {when(t.ticket.createdAt)}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6, alignItems: "start", flexWrap: "wrap" }}>
                  <select value={t.ticket.priority} onChange={(e) => update({ priority: e.target.value })} style={{ width: "auto" }} aria-label="Priority">
                    {["low", "normal", "high", "urgent"].map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                  {!t.ticket.assignedTo && <button className="btn secondary" onClick={() => update({ assign: "me" })}>Assign to me</button>}
                  {t.ticket.status !== "resolved" && t.ticket.status !== "closed" && <button className="btn" onClick={() => update({ status: "resolved" })}>Mark resolved</button>}
                </div>
              </div>
              <div style={{ display: "grid", gap: 10, margin: "16px 0", maxHeight: 460, overflowY: "auto" }}>
                {t.messages.map((m) => (
                  <motion.div
                    key={m.id}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    style={{
                      justifySelf: m.authorType === "staff" ? "end" : "start",
                      maxWidth: "78%",
                      padding: "10px 12px",
                      borderRadius: 14,
                      background: m.internal ? "rgba(245, 158, 11, .15)" : m.authorType === "staff" ? "var(--primary)" : "rgba(127,127,127,.12)",
                      color: m.authorType === "staff" && !m.internal ? "white" : "inherit",
                      border: m.internal ? "1px dashed rgba(245, 158, 11, .7)" : 0,
                    }}
                  >
                    <div style={{ fontSize: 12, fontWeight: 700, opacity: 0.85 }}>{m.internal ? `Internal note · ${m.authorName}` : m.authorName}</div>
                    <div style={{ whiteSpace: "pre-wrap" }}>{m.body}</div>
                    <div style={{ fontSize: 11, opacity: 0.7, marginTop: 4 }}>{when(m.createdAt)}</div>
                  </motion.div>
                ))}
              </div>
              {t.ticket.status === "closed" ? (
                <p className="muted">The customer closed this request. You can still add internal notes.</p>
              ) : null}
              <form onSubmit={reply} className="grid">
                <textarea name="message" rows={4} maxLength={4000} required placeholder="Write a reply (the customer sees your first name)" />
                <div style={{ display: "flex", gap: 8 }}>
                  {t.ticket.status !== "closed" && <button className="btn" value="reply">Send reply</button>}
                  <button className="btn secondary" value="note">Add internal note</button>
                </div>
              </form>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </>
  );
}
