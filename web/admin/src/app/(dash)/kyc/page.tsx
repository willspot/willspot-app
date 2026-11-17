"use client";

import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { Header, Status, useLoad, useToast } from "@/components/Shell";
import { api, when } from "@/lib/api";

interface Sub { id: string; user_id: string; level: number; status: string; id_type: string; id_last4: string; selfie_ref: string; reason: string | null; created_at: string; first_name: string; last_name: string; email: string }

export default function Kyc() {
  const [status, setStatus] = useState("pending");
  const { data, error, reload } = useLoad<{ items: Sub[] }>(`/v1/admin/kyc?status=${status}`);
  const toast = useToast();

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
      <Header title="KYC review" subtitle="Tier 2 needs a person to check the ID against the selfie.">
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
                {s.reason && <div className="error">{s.reason}</div>}
              </div>
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
