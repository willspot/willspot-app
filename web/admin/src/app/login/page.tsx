"use client";

import { motion } from "motion/react";
import { useState, type FormEvent } from "react";
import brand from "../../brand.json";
import { api } from "@/lib/api";

export default function Login() {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await api("/api/auth/login", { email: f.get("email"), password: f.get("password") });
      location.href = "/";
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <motion.form
        onSubmit={submit}
        className="card grid"
        style={{ width: "min(400px, 100%)", padding: 32 }}
        initial={{ opacity: 0, y: 30, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/logo-mark.svg" alt="" width={40} height={40} />
          <div>
            <h1 style={{ fontSize: "1.3rem" }}>{brand.name} Admin</h1>
            <div className="muted">Staff sign-in</div>
          </div>
        </div>
        <label>
          Email
          <input name="email" type="email" autoComplete="username" required />
        </label>
        <label>
          Password
          <input name="password" type="password" autoComplete="current-password" required />
        </label>
        {error && (
          <motion.div className="error" initial={{ x: -8 }} animate={{ x: [8, -6, 4, 0] }}>
            {error}
          </motion.div>
        )}
        <button className="btn" disabled={busy} style={{ justifyContent: "center", padding: 12 }}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </motion.form>
    </div>
  );
}
