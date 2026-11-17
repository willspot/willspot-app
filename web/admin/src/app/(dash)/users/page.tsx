"use client";

import { useState } from "react";
import { Header, Status, useCan, useLoad, useToast } from "@/components/Shell";
import { api, when } from "@/lib/api";

interface User { id: string; email: string; phone: string; firstName: string; lastName: string; role: string; status: string; kycTier: number; totpEnabled?: boolean; createdAt: string }

export default function Users() {
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const { data, error, reload } = useLoad<{ items: User[]; total: number }>(`/v1/admin/users?q=${encodeURIComponent(query)}`);
  const toast = useToast();
  const canSuspend = useCan("users.suspend");
  const canReset2fa = useCan("users.reset_2fa");

  async function reset2fa(u: User) {
    const reason = prompt(`Reset two-factor sign-in for ${u.email}?\n\nOnly do this after confirming who they are (e.g. ID check on a call). They will be signed out everywhere.\n\nReason (at least 10 characters):`);
    if (!reason || reason.trim().length < 10) return;
    try {
      await api(`/v1/admin/users/${u.id}/reset-2fa`, { reason });
      toast(`Two-factor sign-in reset for ${u.email}`);
      reload();
    } catch (e) {
      toast((e as Error).message);
    }
  }

  async function setStatus(u: User, status: "active" | "suspended") {
    const reason = prompt(`Reason for ${status === "suspended" ? "suspending" : "reactivating"} ${u.email}?`);
    if (!reason || reason.length < 3) return;
    try {
      await api(`/v1/admin/users/${u.id}/status`, { status, reason });
      toast(`${u.email} ${status}`);
      reload();
    } catch (e) {
      toast((e as Error).message);
    }
  }

  return (
    <>
      <Header title="Users" subtitle={data ? `${data.total} accounts` : undefined}>
        <form onSubmit={(e) => { e.preventDefault(); setQuery(q); }} style={{ display: "flex", gap: 8 }}>
          <input placeholder="Search name, email, phone" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 260 }} />
          <button className="btn">Search</button>
        </form>
      </Header>
      {error && <p className="error">{error}</p>}
      <div className="card table-wrap">
        <table>
          <thead><tr><th>Name</th><th>Email / phone</th><th>KYC</th><th>2FA</th><th>Status</th><th>Joined</th><th /></tr></thead>
          <tbody>
            {data?.items.map((u) => (
              <tr key={u.id}>
                <td>{u.firstName} {u.lastName}{u.role === "admin" && <span className="badge" style={{ marginLeft: 6 }}>admin</span>}</td>
                <td>{u.email}<div className="muted">{u.phone}</div></td>
                <td>Tier {u.kycTier}</td>
                <td>{u.totpEnabled ? <span className="badge ok">on</span> : <span className="muted">off</span>}</td>
                <td><Status s={u.status} /></td>
                <td>{when(u.createdAt)}</td>
                <td style={{ display: "flex", gap: 6 }}>
                  {canReset2fa && u.role === "user" && u.totpEnabled && <button className="btn secondary" onClick={() => reset2fa(u)}>Reset 2FA</button>}
                  {canSuspend && u.role === "user" && u.status === "active" && <button className="btn danger" onClick={() => setStatus(u, "suspended")}>Suspend</button>}
                  {canSuspend && u.role === "user" && u.status === "suspended" && <button className="btn secondary" onClick={() => setStatus(u, "active")}>Reactivate</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
