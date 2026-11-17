"use client";

import { motion } from "motion/react";
import { useEffect, useState, type FormEvent } from "react";
import brand from "../../brand.json";
import { api } from "@/lib/api";

/**
 * First sign-in for new staff. The link looks like /setup#<token>: the token sits in the
 * URL fragment, which browsers never send to servers or in Referer headers.
 */
export default function Setup() {
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const [checked, setChecked] = useState(false);
  useEffect(() => {
    // Keep the first token seen: the effect can run twice (React strict mode) and the
    // second run finds the fragment already removed.
    const t = location.hash.slice(1);
    if (t) {
      setToken(t);
      history.replaceState(null, "", "/setup"); // drop it from the address bar and history
    }
    setChecked(true);
  }, []);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    if (f.get("password") !== f.get("confirm")) return setError("The two passwords don't match");
    setBusy(true);
    setError(null);
    try {
      await api("/api/auth/setup", { token, password: f.get("password") });
      setDone(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <motion.div className="card grid" style={{ width: "min(420px, 100%)", padding: 32 }} initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }}>
        <h1 style={{ fontSize: "1.3rem" }}>{brand.name} Admin · set your password</h1>
        {done ? (
          <>
            <p>Your password is set. Sign in, then turn on two-factor sign-in under “My security”. Admin tools need it.</p>
            <a className="btn" href="/login">Go to sign-in</a>
          </>
        ) : !checked ? (
          <p className="muted">Checking your link…</p>
        ) : !token ? (
          <p className="error">This page needs the setup link a super admin sent you. Ask them for a new one if it has expired (links last 48 hours).</p>
        ) : (
          <form className="grid" onSubmit={submit}>
            <label>
              New password
              <input name="password" type="password" autoComplete="new-password" minLength={10} required />
            </label>
            <label>
              Confirm password
              <input name="confirm" type="password" autoComplete="new-password" minLength={10} required />
            </label>
            <div className="muted" style={{ fontSize: 12 }}>At least 10 characters with upper and lower case letters and a number.</div>
            {error && <p className="error">{error}</p>}
            <button className="btn" disabled={busy}>{busy ? "Saving…" : "Set password"}</button>
          </form>
        )}
      </motion.div>
    </div>
  );
}
