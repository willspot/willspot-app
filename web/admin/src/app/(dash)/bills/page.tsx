"use client";

import { Counter, Header, Status, useLoad } from "@/components/Shell";
import { naira, when } from "@/lib/api";

interface Payment { id: string; billerName: string; customerId: string; customerName: string | null; amount: string; status: string; token: string | null; failure: string | null; createdAt: string }

export default function Bills() {
  const { data, error } = useLoad<{ items: Payment[]; totals: { status: string; count: number; total: string }[] }>("/v1/admin/bills/payments");
  return (
    <>
      <Header title="Bill payments" subtitle="Failed vends are refunded to the customer automatically. Sandbox biller only." />
      {error && <p className="error">{error}</p>}
      <div className="grid stats" style={{ marginBottom: 16 }}>
        {(data?.totals ?? []).map((t) => (
          <div key={t.status} className="card">
            <div className="muted">{t.status} · {t.count}</div>
            <div className="stat-value"><Counter value={Number(t.total)} format={naira} /></div>
          </div>
        ))}
      </div>
      <div className="card table-wrap">
        <table>
          <thead><tr><th>When</th><th>Biller</th><th>Customer</th><th>Amount</th><th>Status</th></tr></thead>
          <tbody>
            {data?.items.map((p) => (
              <tr key={p.id}>
                <td>{when(p.createdAt)}</td>
                <td>{p.billerName}</td>
                <td>{p.customerId}{p.customerName && <div className="muted">{p.customerName}</div>}</td>
                <td>{naira(p.amount)}</td>
                <td><Status s={p.status} />{p.failure && <div className="muted">{p.failure}</div>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
