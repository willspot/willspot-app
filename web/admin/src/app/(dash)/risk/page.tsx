"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { Counter, Header, Status, useLoad, useToast } from "@/components/Shell";
import { api, when } from "@/lib/api";

interface Summary { openAlerts: number; highAlerts: number; holds: number; openCases: number; blocked24h: number }
interface Alert { id: string; user_id: string; rule_id: string; description: string; severity: string; kind: string | null; amount_ngn: string | null; details: Record<string, unknown>; created_at: string }
interface Case { id: string; user_id: string; title: string; status: string; alert_count: number; on_hold: boolean; str_reference: string | null; updated_at: string }
interface CaseDetail extends Case { notes: { note: string; at: string }[]; alerts: Alert[]; events: { kind: string; direction: string; amount_ngn: string; decision: string; created_at: string }[]; hold: { reason: string } | null }
interface Hold { user_id: string; reason: string; placed_by: string; created_at: string }
interface Rule { id: string; description: string; enabled: boolean; action: string; severity: string; params: Record<string, number> }

const TABS = ["Alerts", "Cases", "Holds", "Rules", "Reports"] as const;

export default function Risk() {
  const [tab, setTab] = useState<(typeof TABS)[number]>("Alerts");
  const summary = useLoad<Summary>("/v1/admin/risk/summary");
  const s = summary.data;
  return (
    <>
      <Header title="Risk & AML" subtitle="Every money movement is screened before it happens. Review alerts, open cases, hold accounts, tune rules." />
      <div className="grid stats" style={{ marginBottom: 16 }}>
        {(
          [
            ["Open alerts", s?.openAlerts],
            ["High severity", s?.highAlerts],
            ["Open cases", s?.openCases],
            ["Accounts on hold", s?.holds],
            ["Blocked (24h)", s?.blocked24h],
          ] as const
        ).map(([l, v]) => (
          <div key={l} className="card">
            <div className="muted">{l}</div>
            <div className="stat-value"><Counter value={v ?? 0} /></div>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        {TABS.map((t) => (
          <button key={t} className={`btn ${tab === t ? "" : "secondary"}`} onClick={() => setTab(t)}>{t}</button>
        ))}
      </div>
      {tab === "Alerts" && <Alerts onChange={summary.reload} />}
      {tab === "Cases" && <Cases />}
      {tab === "Holds" && <Holds onChange={summary.reload} />}
      {tab === "Rules" && <Rules />}
      {tab === "Reports" && <Reports />}
    </>
  );
}

function Alerts({ onChange }: { onChange: () => void }) {
  const { data, reload } = useLoad<{ items: Alert[] }>("/v1/admin/risk/alerts?status=open");
  const toast = useToast();
  async function act(a: Alert, action: "dismiss" | "escalate") {
    const note = prompt(action === "dismiss" ? "Why is this not suspicious?" : "What needs investigating?") ?? undefined;
    if (action === "dismiss" && !note) return;
    try {
      await api(`/v1/admin/risk/alerts/${a.id}`, { action, note });
      toast(action === "dismiss" ? "Alert dismissed" : "Case opened");
      reload();
      onChange();
    } catch (e) {
      toast((e as Error).message);
    }
  }
  if (data?.items.length === 0) return <div className="card muted">No open alerts.</div>;
  return (
    <div className="grid">
      <AnimatePresence>
        {data?.items.map((a) => (
          <motion.div key={a.id} layout className="card" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: 40 }} style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
            <span className={`badge ${a.severity === "high" ? "bad" : a.severity === "medium" ? "warn" : ""}`}>{a.severity}</span>
            <div style={{ flex: 1, minWidth: 240 }}>
              <strong>{a.description}</strong>
              <div className="muted" style={{ fontSize: 12 }}>
                {a.kind} {a.amount_ngn ? `· ₦${Number(a.amount_ngn).toLocaleString("en-NG")}` : ""} · user {a.user_id.slice(0, 8)} · {when(a.created_at)}
              </div>
              <code style={{ fontSize: 11 }}>{JSON.stringify(a.details)}</code>
            </div>
            <button className="btn secondary" onClick={() => act(a, "dismiss")}>Dismiss</button>
            <button className="btn" onClick={() => act(a, "escalate")}>Open case</button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

function Cases() {
  const { data, reload } = useLoad<{ items: Case[] }>("/v1/admin/risk/cases");
  const [open, setOpen] = useState<CaseDetail | null>(null);
  const [note, setNote] = useState("");
  const toast = useToast();
  const load = async (id: string) => setOpen(await api<CaseDetail>(`/v1/admin/risk/cases/${id}`));
  async function update(body: Record<string, unknown>) {
    if (!open) return;
    try {
      await api(`/v1/admin/risk/cases/${open.id}`, body);
      setNote("");
      await load(open.id);
      reload();
    } catch (e) {
      toast((e as Error).message);
    }
  }
  async function hold() {
    if (!open) return;
    const reason = prompt("Reason for holding this account?");
    if (!reason) return;
    await api("/v1/admin/risk/holds", { userId: open.user_id, reason, caseId: open.id }).catch((e) => toast((e as Error).message));
    await load(open.id);
  }
  return (
    <div style={{ display: "grid", gap: 16, gridTemplateColumns: open ? "minmax(260px, 1fr) 2fr" : "1fr" }}>
      <div className="card table-wrap">
        <table>
          <thead><tr><th>Case</th><th>Status</th><th>Alerts</th></tr></thead>
          <tbody>
            {data?.items.map((c) => (
              <tr key={c.id} onClick={() => load(c.id)} style={{ cursor: "pointer", background: open?.id === c.id ? "color-mix(in srgb, var(--primary) 8%, transparent)" : undefined }}>
                <td>{c.title}{c.on_hold && <span className="badge bad" style={{ marginLeft: 6 }}>on hold</span>}<div className="muted" style={{ fontSize: 12 }}>{when(c.updated_at)}</div></td>
                <td><Status s={c.status} /></td>
                <td>{c.alert_count}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {data?.items.length === 0 && <p className="muted">No cases yet. Open one from an alert.</p>}
      </div>
      {open && (
        <motion.div className="card grid" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
            <h2 style={{ margin: 0 }}>{open.title}</h2>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {(["investigating", "closed"] as const).map((st) => (
                <button key={st} className="btn secondary" onClick={() => update({ status: st })}>Mark {st}</button>
              ))}
              <button className="btn secondary" onClick={() => { const ref = prompt("Reference from the regulator's portal after filing:"); if (ref) update({ status: "reported", strReference: ref }); }}>Mark reported</button>
              {!open.hold && <button className="btn danger" onClick={hold}>Hold account</button>}
              <a className="btn secondary" href={`/api/gw/v1/admin/risk/reports/str/${open.id}?format=csv`}>STR draft (CSV)</a>
            </div>
          </div>
          <div className="muted">User {open.user_id} · <Status s={open.status} /> {open.str_reference && `· filed ref ${open.str_reference}`} {open.hold && <span className="error">· on hold: {open.hold.reason}</span>}</div>
          <div>
            <strong>Notes</strong>
            {open.notes.map((n, i) => <p key={i} style={{ margin: "6px 0" }}>{n.note} <span className="muted" style={{ fontSize: 12 }}>{when(n.at)}</span></p>)}
            <div style={{ display: "flex", gap: 8 }}>
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note" />
              <button className="btn" disabled={!note} onClick={() => update({ note })}>Add</button>
            </div>
          </div>
          <div className="table-wrap">
            <strong>Recent activity</strong>
            <table>
              <thead><tr><th>When</th><th>Type</th><th>Amount (₦)</th><th>Screening</th></tr></thead>
              <tbody>{open.events.slice(0, 20).map((e, i) => <tr key={i}><td>{when(e.created_at)}</td><td>{e.kind}</td><td>{Number(e.amount_ngn).toLocaleString("en-NG")}</td><td><Status s={e.decision === "allow" ? "completed" : e.decision === "block" ? "failed" : "pending"} /></td></tr>)}</tbody>
            </table>
          </div>
        </motion.div>
      )}
    </div>
  );
}

function Holds({ onChange }: { onChange: () => void }) {
  const { data, reload } = useLoad<{ items: Hold[] }>("/v1/admin/risk/holds");
  const toast = useToast();
  async function release(h: Hold) {
    const reason = prompt("Why is it safe to release this account?");
    if (!reason) return;
    try {
      await api(`/v1/admin/risk/holds/${h.user_id}/release`, { reason });
      toast("Hold released");
      reload();
      onChange();
    } catch (e) {
      toast((e as Error).message);
    }
  }
  return (
    <div className="card table-wrap">
      <table>
        <thead><tr><th>User</th><th>Reason</th><th>Placed by</th><th>Since</th><th /></tr></thead>
        <tbody>{data?.items.map((h) => <tr key={h.user_id}><td>{h.user_id}</td><td>{h.reason}</td><td>{h.placed_by.startsWith("rule:") ? h.placed_by : "admin"}</td><td>{when(h.created_at)}</td><td><button className="btn secondary" onClick={() => release(h)}>Release</button></td></tr>)}</tbody>
      </table>
      {data?.items.length === 0 && <p className="muted">No accounts on hold. Held accounts can receive money but can't send, buy or pay.</p>}
    </div>
  );
}

function Rules() {
  const { data, reload } = useLoad<{ items: Rule[] }>("/v1/admin/risk/rules");
  const [rows, setRows] = useState<Rule[]>([]);
  const toast = useToast();
  useEffect(() => {
    if (data) setRows(data.items);
  }, [data]);
  const set = (id: string, patch: Partial<Rule>) => setRows((r) => r.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  async function save(r: Rule) {
    try {
      await api(`/v1/admin/risk/rules/${r.id}`, { enabled: r.enabled, action: r.action, params: r.params });
      toast(`${r.id} saved`);
      reload();
    } catch (e) {
      toast((e as Error).message);
    }
  }
  return (
    <div className="grid">
      {rows.map((r) => (
        <div key={r.id} className="card" style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <input type="checkbox" checked={r.enabled} onChange={(e) => set(r.id, { enabled: e.target.checked })} style={{ width: "auto" }} aria-label={`${r.id} enabled`} />
          <div style={{ flex: 1, minWidth: 220 }}><strong>{r.id}</strong><div className="muted">{r.description}</div></div>
          <select value={r.action} onChange={(e) => set(r.id, { action: e.target.value })} style={{ width: 110 }}>
            <option value="review">review</option><option value="block">block</option><option value="hold">hold</option>
          </select>
          {Object.entries(r.params).map(([k, v]) => (
            <label key={k} style={{ width: 150, fontSize: 12 }}>{k}<input type="number" value={v} onChange={(e) => set(r.id, { params: { ...r.params, [k]: Number(e.target.value) } })} /></label>
          ))}
          <button className="btn" onClick={() => save(r)}>Save</button>
        </div>
      ))}
    </div>
  );
}

function Reports() {
  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  return (
    <div className="card grid" style={{ maxWidth: 620 }}>
      <div className="error" style={{ fontWeight: 600 }}>Drafts only. NFIU's required format (goAML), thresholds and deadlines are not confirmed. Check with counsel before filing anything.</div>
      <h2>Currency transaction report (CTR) candidates</h2>
      <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
        <label>From<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label>To<input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <a className="btn" href={`/api/gw/v1/admin/risk/reports/ctr?from=${from}&to=${to}`}>Download CSV</a>
      </div>
      <h2>Suspicious transaction report (STR)</h2>
      <p className="muted">Open the case in the Cases tab and use “STR draft”. Mark the case reported with the portal reference once filed.</p>
    </div>
  );
}
