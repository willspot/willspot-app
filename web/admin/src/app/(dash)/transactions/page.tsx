"use client";

import { Header, useLoad } from "@/components/Shell";
import { when } from "@/lib/api";

interface Journal { id: string; type: string; user_id: string | null; description: string; created_at: string; legs: { code: string; asset: string; amount: string }[] }

export default function Transactions() {
  const { data, error } = useLoad<{ items: Journal[] }>("/v1/admin/wallet/journals?limit=100");
  return (
    <>
      <Header title="Ledger" subtitle="Append-only double-entry journals. Each one balances to zero per asset." />
      {error && <p className="error">{error}</p>}
      <div className="card table-wrap">
        <table>
          <thead><tr><th>When</th><th>Type</th><th>Description</th><th>Postings</th></tr></thead>
          <tbody>
            {data?.items.map((j) => (
              <tr key={j.id}>
                <td style={{ whiteSpace: "nowrap" }}>{when(j.created_at)}</td>
                <td><span className="badge">{j.type}</span></td>
                <td>{j.description}<div className="muted" style={{ fontSize: 12 }}>{j.user_id}</div></td>
                <td>
                  {j.legs.map((l, i) => (
                    <div key={i} style={{ fontFamily: "ui-monospace, monospace", fontSize: 12 }}>
                      <span style={{ color: l.amount.startsWith("-") ? "var(--danger)" : "var(--success)" }}>{l.amount.startsWith("-") ? "" : "+"}{l.amount} {l.asset}</span>{" "}
                      <span className="muted">{l.code.replace(/^user:[0-9a-f-]+/, "user")}</span>
                    </div>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
