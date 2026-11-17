"use client";

import { AnimatePresence, motion } from "motion/react";
import { useState, type FormEvent } from "react";
import { Header, Status, useLoad, useMe, useToast } from "@/components/Shell";
import { api, when } from "@/lib/api";

interface Admin { id: string; email: string; firstName: string; lastName: string; status: string; roles: string[]; totpEnabled: boolean; createdAt: string }

const ROLE_HELP: Record<string, string> = {
  super_admin: "Everything, including managing staff",
  compliance: "KYC, risk & AML, suspensions, gift-card review, audit log",
  finance: "Money views, rates and fees, gift-card review, operations",
  support: "Look up customers and transactions, reset a customer's 2FA",
  operations: "Operations health, branding and feature flags",
};

/** Staff accounts and their roles. Super admins only (enforced by the API). */
export default function Admins() {
  const { data, error, reload } = useLoad<{ items: Admin[]; roles: Record<string, string[]> }>("/v1/admin/admins");
  const me = useMe();
  const toast = useToast();
  const [link, setLink] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<string[]>([]);
  const roleNames = Object.keys(data?.roles ?? ROLE_HELP);

  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    try {
      const r = await api<{ setupToken: string; admin: Admin }>("/v1/admin/admins", {
        email: f.get("email"), phone: f.get("phone"), firstName: f.get("firstName"), lastName: f.get("lastName"), roles: f.getAll("roles"),
      });
      setLink(`${location.origin}/setup#${r.setupToken}`);
      form.reset();
      reload();
    } catch (err) {
      toast((err as Error).message);
    }
  }

  async function saveRoles(a: Admin) {
    try {
      await api(`/v1/admin/admins/${a.id}/roles`, { roles: draft });
      toast(`Roles updated for ${a.email}. They'll need to sign in again.`);
      setEditing(null);
      reload();
    } catch (err) {
      toast((err as Error).message);
    }
  }

  return (
    <>
      <Header title="Staff & roles" subtitle="Give each person only the access their job needs. Role changes sign them out." />
      {error && <p className="error">{error}</p>}

      <AnimatePresence>
        {link && (
          <motion.div className="card" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} style={{ marginBottom: 16, borderColor: "var(--primary)" }}>
            <strong>Setup link (shown once, valid 48 hours)</strong>
            <p className="muted" style={{ margin: "6px 0" }}>Send it to them privately (not by email to a shared inbox). It lets them set their own password.</p>
            <code style={{ wordBreak: "break-all", display: "block", padding: 8 }}>{link}</code>
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <button className="btn" onClick={() => navigator.clipboard.writeText(link).then(() => toast("Link copied"))}>Copy link</button>
              <button className="btn secondary" onClick={() => setLink(null)}>Done</button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="card table-wrap">
        <table>
          <thead><tr><th>Name</th><th>Email</th><th>Roles</th><th>2FA</th><th>Status</th><th>Added</th><th /></tr></thead>
          <tbody>
            {data?.items.map((a) => (
              <tr key={a.id}>
                <td>{a.firstName} {a.lastName}{a.id === me?.id && <span className="badge" style={{ marginLeft: 6 }}>you</span>}</td>
                <td>{a.email}</td>
                <td>
                  {editing === a.id ? (
                    <div style={{ display: "grid", gap: 4 }}>
                      {roleNames.map((r) => (
                        <label key={r} style={{ display: "flex", gap: 6, alignItems: "center", fontWeight: 400 }}>
                          <input type="checkbox" checked={draft.includes(r)} onChange={(e) => setDraft(e.target.checked ? [...draft, r] : draft.filter((x) => x !== r))} style={{ width: "auto" }} />
                          {r.replace("_", " ")}
                        </label>
                      ))}
                    </div>
                  ) : a.roles.length ? (
                    a.roles.map((r) => <span key={r} className="badge" style={{ marginRight: 4 }}>{r.replace("_", " ")}</span>)
                  ) : (
                    <span className="muted">no access</span>
                  )}
                </td>
                <td>{a.totpEnabled ? <span className="badge ok">on</span> : <span className="badge warn">off</span>}</td>
                <td><Status s={a.status} /></td>
                <td>{when(a.createdAt)}</td>
                <td>
                  {a.id !== me?.id &&
                    (editing === a.id ? (
                      <div style={{ display: "flex", gap: 6 }}>
                        <button className="btn" onClick={() => saveRoles(a)}>Save</button>
                        <button className="btn secondary" onClick={() => setEditing(null)}>Cancel</button>
                      </div>
                    ) : (
                      <button className="btn secondary" onClick={() => { setEditing(a.id); setDraft(a.roles); }}>Change roles</button>
                    ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <form className="card grid" style={{ marginTop: 16, maxWidth: 640 }} onSubmit={create}>
        <h2>Add a staff member</h2>
        <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <label>First name<input name="firstName" required /></label>
          <label>Last name<input name="lastName" required /></label>
          <label>Work email<input name="email" type="email" required /></label>
          <label>Phone<input name="phone" placeholder="0803 123 4567" required /></label>
        </div>
        <fieldset style={{ border: 0, padding: 0, display: "grid", gap: 6 }}>
          <legend style={{ fontWeight: 600, marginBottom: 6 }}>Roles</legend>
          {Object.entries(ROLE_HELP).map(([r, help]) => (
            <label key={r} style={{ display: "flex", gap: 8, alignItems: "baseline", fontWeight: 400 }}>
              <input type="checkbox" name="roles" value={r} style={{ width: "auto" }} />
              <span><strong>{r.replace("_", " ")}</strong> <span className="muted">— {help}</span></span>
            </label>
          ))}
        </fieldset>
        <button className="btn" style={{ justifySelf: "start" }}>Create and get setup link</button>
      </form>
    </>
  );
}
