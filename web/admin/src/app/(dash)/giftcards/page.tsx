"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { Header, Status, useLoad, useToast } from "@/components/Shell";
import { api, naira, when } from "@/lib/api";

interface Trade { id: string; userId: string; brandName: string; value: number; currency: string; codeLast4: string | null; hasImage: boolean; payout: string; status: string; reason: string | null; createdAt: string }
interface Detail extends Trade { code: string | null; image: string | null; rate: string }
interface Brand { id: string; name: string; currency: string; sellRate: string; buyRate: string; minValue: number; maxValue: number; sellEnabled: boolean; buyEnabled: boolean }

export default function GiftCards() {
  const [tab, setTab] = useState<"queue" | "rates">("queue");
  return (
    <>
      <Header title="Gift cards" subtitle="Check each card before paying out. Card codes are decrypted only here, and every view is audited.">
        <div style={{ display: "flex", gap: 8 }}>
          <button className={`btn ${tab === "queue" ? "" : "secondary"}`} onClick={() => setTab("queue")}>Review queue</button>
          <button className={`btn ${tab === "rates" ? "" : "secondary"}`} onClick={() => setTab("rates")}>Brands & rates</button>
        </div>
      </Header>
      {tab === "queue" ? <Queue /> : <Rates />}
    </>
  );
}

function Queue() {
  const [status, setStatus] = useState("pending");
  const { data, error, reload } = useLoad<{ items: Trade[] }>(`/v1/admin/giftcards/queue?status=${status}`);
  const [open, setOpen] = useState<Detail | null>(null);
  const [confirmed, setConfirmed] = useState("");
  const toast = useToast();

  async function view(t: Trade) {
    try {
      const d = await api<Detail>(`/v1/admin/giftcards/trades/${t.id}`);
      setOpen(d);
      setConfirmed(String(d.value));
    } catch (e) {
      toast((e as Error).message);
    }
  }

  async function decide(decision: "approved" | "rejected") {
    if (!open) return;
    const reason = decision === "rejected" ? prompt("Reason shown to the customer (e.g. card already used)?") : undefined;
    if (decision === "rejected" && !reason) return;
    try {
      await api(`/v1/admin/giftcards/trades/${open.id}/decision`, { decision, reason, ...(decision === "approved" ? { confirmedValue: Number(confirmed) } : {}) });
      toast(decision === "approved" ? "Approved and paid" : "Rejected");
      setOpen(null);
      reload();
    } catch (e) {
      toast((e as Error).message);
    }
  }

  return (
    <>
      <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: 180, marginBottom: 16 }}>
        <option value="pending">Pending</option>
        <option value="approved">Approved</option>
        <option value="rejected">Rejected</option>
      </select>
      {error && <p className="error">{error}</p>}
      {data?.items.length === 0 && <div className="card muted">Nothing {status}.</div>}
      <div className="grid">
        <AnimatePresence>
          {data?.items.map((t) => (
            <motion.div key={t.id} layout className="card" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 40 }} style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 220 }}>
                <strong>{t.brandName}</strong> · {t.value} {t.currency}
                <div className="muted">
                  {t.codeLast4 ? `Code ending ${t.codeLast4}` : "Photo only"}
                  {t.hasImage && t.codeLast4 ? " + photo" : ""} · pays {naira(t.payout)} · {when(t.createdAt)}
                </div>
                {t.reason && <div className="error">{t.reason}</div>}
              </div>
              <Status s={t.status} />
              {t.status === "pending" && <button className="btn" onClick={() => view(t)}>Review</button>}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setOpen(null)}
            style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", display: "grid", placeItems: "center", padding: 16, zIndex: 50 }}
          >
            <motion.div className="card grid" onClick={(e) => e.stopPropagation()} initial={{ scale: 0.95, y: 20 }} animate={{ scale: 1, y: 0 }} style={{ width: "min(520px, 100%)", maxHeight: "90vh", overflow: "auto" }}>
              <h2>{open.brandName} · {open.value} {open.currency}</h2>
              {open.code && (
                <div>
                  <div className="muted">Card code</div>
                  <code style={{ fontSize: 20, letterSpacing: 1 }}>{open.code}</code>
                </div>
              )}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {open.image && <img src={open.image} alt="Gift card photo" style={{ maxWidth: "100%", borderRadius: 10 }} />}
              <label>
                Confirmed balance on the card ({open.currency})
                <input type="number" min={1} max={open.value} value={confirmed} onChange={(e) => setConfirmed(e.target.value)} />
              </label>
              <div className="muted">Pays {naira(Number(open.rate) * Number(confirmed || 0))} at {naira(open.rate)} per {open.currency}</div>
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button className="btn secondary" onClick={() => setOpen(null)}>Close</button>
                <button className="btn danger" onClick={() => decide("rejected")}>Reject</button>
                <button className="btn" onClick={() => decide("approved")}>Approve & pay</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

function Rates() {
  const brands = useLoad<{ items: Brand[] }>("/v1/admin/giftcards/brands");
  return <BrandEditor initial={brands.data?.items} error={brands.error} reload={brands.reload} />;
}

function BrandEditor({ initial, error, reload }: { initial?: Brand[]; error: string | null; reload: () => void }) {
  const [rows, setRows] = useState<Brand[]>([]);
  const toast = useToast();
  useEffect(() => {
    if (initial) setRows(initial);
  }, [initial]);
  const set = (id: string, patch: Partial<Brand>) => setRows((r) => r.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  async function save(b: Brand) {
    try {
      await api(`/v1/admin/giftcards/brands/${b.id}`, { sellRate: b.sellRate, buyRate: b.buyRate, minValue: Number(b.minValue), maxValue: Number(b.maxValue), sellEnabled: b.sellEnabled, buyEnabled: b.buyEnabled });
      toast(`${b.name} saved`);
      reload();
    } catch (e) {
      toast((e as Error).message);
    }
  }
  if (error) return <p className="error">{error}</p>;
  return (
    <div className="card table-wrap">
      <table>
        <thead><tr><th>Brand</th><th>We pay (₦ per unit)</th><th>We charge (₦ per unit)</th><th>Min</th><th>Max</th><th>Buying</th><th>Selling</th><th /></tr></thead>
        <tbody>
          {rows.map((b) => (
            <tr key={b.id}>
              <td>{b.name}</td>
              <td><input value={b.sellRate} onChange={(e) => set(b.id, { sellRate: e.target.value })} style={{ width: 110 }} /></td>
              <td><input value={b.buyRate} onChange={(e) => set(b.id, { buyRate: e.target.value })} style={{ width: 110 }} /></td>
              <td><input type="number" value={b.minValue} onChange={(e) => set(b.id, { minValue: Number(e.target.value) })} style={{ width: 70 }} /></td>
              <td><input type="number" value={b.maxValue} onChange={(e) => set(b.id, { maxValue: Number(e.target.value) })} style={{ width: 80 }} /></td>
              <td><input type="checkbox" checked={b.sellEnabled} onChange={(e) => set(b.id, { sellEnabled: e.target.checked })} style={{ width: "auto" }} aria-label="we buy cards" /></td>
              <td><input type="checkbox" checked={b.buyEnabled} onChange={(e) => set(b.id, { buyEnabled: e.target.checked })} style={{ width: "auto" }} aria-label="we sell cards" /></td>
              <td><button className="btn" onClick={() => save(b)}>Save</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
