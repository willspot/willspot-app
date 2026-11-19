"use client";

import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { Header, Status, useLoad, useToast } from "@/components/Shell";
import { api, when } from "@/lib/api";

interface Sub {
  id: string; user_id: string; level: number; status: string; id_type: string; id_last4: string; selfie_ref: string | null; reason: string | null; created_at: string;
  first_name: string; last_name: string; email: string; liveness_probability: string | null; match_confidence: string | null; selfie_provider: string | null;
}

/** Score chip: green at/above the bar, amber below. */
function Score({ label, value, ok }: { label: string; value: string | null; ok: number }) {
  if (value === null) return null;
  const n = Number(value);
  return <span className={`badge ${n >= ok ? "ok" : "warn"}`} style={{ marginRight: 6 }}>{label} {n.toFixed(0)}%</span>;
}

export default function Kyc() {
  const [status, setStatus] = useState("pending");
  const { data, error, reload } = useLoad<{ items: Sub[] }>(`/v1/admin/kyc?status=${status}`);
  const toast = useToast();
  const [shown, setShown] = useState<Record<string, boolean>>({});

  async function decide(s: Sub, decision: "approved" | "rejected") {
    const reason = decision === "rejected" ? prompt("Reason shown to the customer?") : undefined;
    if (decision === "rejected" && !reason) return;
    try {
      await api(`/v1/admin/kyc/${s.id}/decision`, { decision, reason });
      toast(`${s.first_name} ${s.last_name}: ${decision}`);
      reload();
    } catch (e) {
      toast((e as Error).message);
    }
  }

  return (
    <>
      <Header title="KYC review" subtitle="Tier 2: the selfie already passed liveness and matched the BVN photo; check the ID document. Viewing a selfie is logged.">
        <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: 180 }}>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
        </select>
      </Header>
      {error && <p className="error">{error}</p>}
      {data && data.items.length === 0 && <div className="card muted">Nothing {status}. 🎉</div>}
      <div className="grid">
        <AnimatePresence>
          {data?.items.map((s) => (
            <motion.div key={s.id} layout className="card" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 40 }} style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 220 }}>
                <strong>{s.first_name} {s.last_name}</strong> <span className="muted">{s.email}</span>
                <div className="muted">
                  Level {s.level} · {s.id_type} ending {s.id_last4} · submitted {when(s.created_at)}
                </div>
                {s.level === 2 && (
                  <div style={{ marginTop: 6 }}>
                    <Score label="Live" value={s.liveness_probability} ok={90} />
                    <Score label="Face match" value={s.match_confidence} ok={90} />
                    {s.selfie_provider && <span className="muted" style={{ fontSize: 12 }}>via {s.selfie_provider}</span>}
                  </div>
                )}
                {s.reason && <div className="error">{s.reason}</div>}
              </div>
              {s.level === 2 && s.selfie_ref && (
                shown[s.id] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <motion.img initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} src={`/api/gw/v1/admin/kyc/selfies/${s.selfie_ref}`} alt={`Selfie of ${s.first_name}`} width={120} height={150} style={{ objectFit: "cover", borderRadius: 12 }} />
                ) : (
                  <button className="btn secondary" onClick={() => setShown({ ...shown, [s.id]: true })}>Show selfie</button>
                )
              )}
              <Status s={s.status} />
              {s.status === "pending" && (
                <>
                  <button className="btn" onClick={() => decide(s, "approved")}>Approve</button>
                  <button className="btn danger" onClick={() => decide(s, "rejected")}>Reject</button>
                </>
              )}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </>
  );
}
