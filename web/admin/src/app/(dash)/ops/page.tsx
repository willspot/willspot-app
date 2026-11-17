"use client";

import { motion } from "motion/react";
import { Header, useLoad, useToast } from "@/components/Shell";
import { api, when } from "@/lib/api";

interface Reconcile { ok: boolean; assets: { asset: string; netBalance: string }[]; balanceMismatches: number; stuckWithdrawals: number; webhookFailures24h: number; checkedAt: string }
interface Failure { id: number; route: string; reference: string | null; status: number; at: string }

function Light({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <motion.div className="card" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} style={{ display: "flex", gap: 12, alignItems: "center" }}>
      <motion.span
        animate={ok ? {} : { scale: [1, 1.25, 1] }}
        transition={{ repeat: ok ? 0 : Infinity, duration: 1.4 }}
        style={{ width: 14, height: 14, borderRadius: "50%", background: ok ? "var(--success)" : "var(--danger)", flex: "none" }}
      />
      <div>
        <strong>{label}</strong>
        <div className="muted" style={{ fontSize: 13 }}>{detail}</div>
      </div>
    </motion.div>
  );
}

/** Live health of money flows. The same checks run on a timer and post to OPS_ALERT_WEBHOOK_URL. */
export default function Ops() {
  const rec = useLoad<Reconcile>("/v1/admin/wallet/reconcile");
  const trade = useLoad<{ pendingSettlements: number; oldestPendingMinutes: number }>("/v1/admin/trade/health");
  const bills = useLoad<{ processing: number; oldestProcessingMinutes: number }>("/v1/admin/bills/health");
  const hooks = useLoad<{ items: Failure[] }>("/v1/admin/wallet/webhook-failures");
  const push = useLoad<{ provider: string; notifications24h: number; pushFailures24h: number; devices: number }>("/v1/admin/notifications/health");
  const toast = useToast();
  const r = rec.data;
  return (
    <>
      <Header title="Operations" subtitle="Ledger reconciliation, stuck payments and webhook health.">
        <button className="btn secondary" onClick={() => { rec.reload(); trade.reload(); bills.reload(); hooks.reload(); push.reload(); }}>Refresh</button>
      </Header>
      <div className="grid stats">
        <Light ok={!!r?.ok} label="Ledger reconciles" detail={r ? (r.ok ? `Every asset nets to zero · ${r.balanceMismatches} balance mismatches` : `DRIFT: ${r.assets.filter((a) => Number(a.netBalance) !== 0).map((a) => `${a.asset} ${a.netBalance}`).join(", ") || ""} ${r.balanceMismatches} mismatched balances`) : "Checking…"} />
        <Light ok={(r?.stuckWithdrawals ?? 0) === 0} label="Payouts" detail={`${r?.stuckWithdrawals ?? 0} withdrawal(s) processing over 30 min`} />
        <Light ok={(trade.data?.pendingSettlements ?? 0) === 0 || (trade.data?.oldestPendingMinutes ?? 0) < 15} label="Trade settlement" detail={`${trade.data?.pendingSettlements ?? 0} pending · oldest ${trade.data?.oldestPendingMinutes ?? 0} min`} />
        <Light ok={(bills.data?.processing ?? 0) === 0 || (bills.data?.oldestProcessingMinutes ?? 0) < 15} label="Bill payments" detail={`${bills.data?.processing ?? 0} processing · oldest ${bills.data?.oldestProcessingMinutes ?? 0} min`} />
        <Light ok={(r?.webhookFailures24h ?? 0) < 5} label="Webhooks" detail={`${r?.webhookFailures24h ?? 0} failures in 24h`} />
        <Light
          ok={!!push.data && push.data.pushFailures24h <= Math.max(5, push.data.notifications24h * 0.2)}
          label="Notifications"
          detail={push.data ? `${push.data.notifications24h} in 24h · ${push.data.pushFailures24h} push failures · ${push.data.devices} devices · ${push.data.provider}` : "Checking…"}
        />
      </div>
      <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
        <button
          className="btn secondary"
          onClick={async () => {
            try {
              const x = await api<{ settled: number }>("/v1/admin/bills/requery", {});
              toast(`Requeried bills: ${x.settled} settled`);
              bills.reload();
            } catch (e) {
              toast((e as Error).message);
            }
          }}
        >
          Requery pending bills now
        </button>
      </div>
      <div className="card table-wrap" style={{ marginTop: 16 }}>
        <h2>Recent webhook failures</h2>
        <table>
          <thead><tr><th>When</th><th>Route</th><th>Reference</th><th>Status</th></tr></thead>
          <tbody>{hooks.data?.items.map((f) => <tr key={f.id}><td>{when(f.at)}</td><td>{f.route}</td><td>{f.reference ?? "—"}</td><td>{f.status}</td></tr>)}</tbody>
        </table>
        {hooks.data?.items.length === 0 && <p className="muted">None.</p>}
      </div>
      {r && <p className="muted" style={{ fontSize: 12 }}>Last checked {when(r.checkedAt)}</p>}
    </>
  );
}
