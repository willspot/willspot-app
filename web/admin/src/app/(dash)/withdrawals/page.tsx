"use client";

import { useState } from "react";
import { Header, Status, useLoad } from "@/components/Shell";
import { naira, when } from "@/lib/api";

interface W { id: string; userId: string; amount: string; fee: string; bankCode: string; accountNumber: string; accountName: string; status: string; failureReason: string | null; createdAt: string }

export default function Withdrawals() {
  const [status, setStatus] = useState("");
  const { data, error } = useLoad<{ items: W[] }>(`/v1/admin/wallet/withdrawals${status ? `?status=${status}` : ""}`);
  return (
    <>
      <Header title="Withdrawals" subtitle="Failed payouts are reversed to the customer automatically.">
        <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: 180 }}>
          <option value="">All</option>
          <option value="processing">Processing</option>
          <option value="completed">Completed</option>
          <option value="failed">Failed</option>
        </select>
      </Header>
      {error && <p className="error">{error}</p>}
      <div className="card table-wrap">
        <table>
          <thead><tr><th>When</th><th>Beneficiary</th><th>Amount</th><th>Fee</th><th>Status</th></tr></thead>
          <tbody>
            {data?.items.map((w) => (
              <tr key={w.id}>
                <td>{when(w.createdAt)}</td>
                <td>{w.accountName}<div className="muted">{w.bankCode} · {w.accountNumber}</div></td>
                <td>{naira(w.amount)}</td>
                <td>{naira(w.fee)}</td>
                <td><Status s={w.status} />{w.failureReason && <div className="muted">{w.failureReason}</div>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
