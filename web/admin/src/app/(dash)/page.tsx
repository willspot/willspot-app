"use client";

import { motion } from "motion/react";
import { Counter, Header, useLoad } from "@/components/Shell";
import { naira } from "@/lib/api";

interface Stats { users: number; active: number; tier1: number; tier2: number; pendingKyc: number }
interface Summary { accounts: { asset: string; kind: string; code: string; balance: string }[]; deposits: { count: number; total: string }; withdrawals: { count: number; completedTotal: string } }
interface Orders { volume: { side: string; count: number; ngn: string }[] }

export default function Overview() {
  const stats = useLoad<Stats>("/v1/admin/stats");
  const wallet = useLoad<Summary>("/v1/admin/wallet/summary");
  const orders = useLoad<Orders>("/v1/admin/trade/orders");
  const userNgn = wallet.data?.accounts.find((a) => a.kind === "user" && a.asset === "NGN")?.balance ?? "0";
  const vol = (side: string) => Number(orders.data?.volume.find((v) => v.side === side)?.ngn ?? 0);

  const cards: [string, number, ((n: number) => string) | undefined][] = [
    ["Users", stats.data?.users ?? 0, undefined],
    ["BVN verified", stats.data?.tier1 ?? 0, undefined],
    ["KYC awaiting review", stats.data?.pendingKyc ?? 0, undefined],
    ["Customer Naira held", Number(userNgn), naira],
    ["Deposits", Number(wallet.data?.deposits.total ?? 0), naira],
    ["Withdrawals paid", Number(wallet.data?.withdrawals.completedTotal ?? 0), naira],
    ["Crypto bought (NGN)", vol("buy"), naira],
    ["Crypto sold (NGN)", vol("sell"), naira],
  ];

  return (
    <>
      <Header title="Overview" subtitle="Sandbox data: no real money is moving." />
      {[stats.error, wallet.error, orders.error].some((e) => e && !/role doesn't allow/.test(e)) && <p className="error">{stats.error ?? wallet.error ?? orders.error}</p>}
      {[stats.error, wallet.error, orders.error].some((e) => e && /role doesn't allow/.test(e)) && <p className="muted">Some figures are hidden because your role doesn&apos;t include them.</p>}
      <div className="grid stats">
        {cards.map(([label, value, fmt], i) => (
          <motion.div key={label} className="card" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
            <div className="muted">{label}</div>
            <div className="stat-value">
              <Counter value={value} format={fmt} />
            </div>
          </motion.div>
        ))}
      </div>
      <div className="card" style={{ marginTop: 16 }}>
        <h2>Ledger balances by account</h2>
        <p className="muted" style={{ marginTop: -6 }}>Every journal balances per asset, so system accounts mirror customer balances.</p>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Account</th><th>Asset</th><th>Balance</th></tr></thead>
            <tbody>
              {wallet.data?.accounts.map((a) => (
                <tr key={`${a.code}-${a.asset}`}><td>{a.code}</td><td>{a.asset}</td><td>{a.balance}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
