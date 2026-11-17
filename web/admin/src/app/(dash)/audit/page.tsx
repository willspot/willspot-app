"use client";

import { Header, useLoad } from "@/components/Shell";
import { when } from "@/lib/api";

interface Entry { id: number; actor_id: string | null; action: string; target: string | null; meta: Record<string, unknown>; at: string }

export default function Audit() {
  const { data, error } = useLoad<{ items: Entry[] }>("/v1/admin/audit");
  return (
    <>
      <Header title="Audit log" subtitle="Sign-in lockouts, PIN changes, KYC decisions and account actions (identity service)." />
      {error && <p className="error">{error}</p>}
      <div className="card table-wrap">
        <table>
          <thead><tr><th>When</th><th>Action</th><th>Actor</th><th>Target</th><th>Details</th></tr></thead>
          <tbody>
            {data?.items.map((e) => (
              <tr key={e.id}>
                <td style={{ whiteSpace: "nowrap" }}>{when(e.at)}</td>
                <td><span className="badge">{e.action}</span></td>
                <td className="muted" style={{ fontSize: 12 }}>{e.actor_id ?? "system"}</td>
                <td className="muted" style={{ fontSize: 12 }}>{e.target}</td>
                <td style={{ fontFamily: "ui-monospace, monospace", fontSize: 12 }}>{Object.keys(e.meta).length ? JSON.stringify(e.meta) : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
