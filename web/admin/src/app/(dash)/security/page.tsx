"use client";

import { motion } from "motion/react";
import { useState } from "react";
import { Header, useLoad, useToast } from "@/components/Shell";
import { api } from "@/lib/api";

/** Two-factor sign-in (TOTP) for the signed-in admin. Required in production (ADMIN_REQUIRE_MFA=1). */
export default function Security() {
  const me = useLoad<{ email: string; totpEnabled: boolean }>("/v1/me");
  const [setup, setSetup] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const toast = useToast();

  async function start() {
    try {
      setSetup(await api("/v1/me/totp/setup", { password }));
      setPassword("");
    } catch (e) {
      toast((e as Error).message);
    }
  }

  async function enable() {
    try {
      await api("/v1/me/totp/enable", { code });
      toast("Two-factor sign-in is on. Signing you out so you can sign in with it.");
      await api("/api/auth/logout", {});
      location.href = "/login";
    } catch (e) {
      toast((e as Error).message);
    }
  }

  return (
    <>
      <Header title="Security" subtitle="Protect admin access with an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password, Authy…)." />
      <div className="card grid" style={{ maxWidth: 560 }}>
        {me.data?.totpEnabled ? (
          <div><span className="badge ok">On</span> Two-factor sign-in is enabled for {me.data.email}.</div>
        ) : !setup ? (
          <>
            <div><span className="badge warn">Off</span> Two-factor sign-in is not enabled.</div>
            <label>
              Confirm your password to start
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
            </label>
            <button className="btn" onClick={start} disabled={!password}>Set up authenticator</button>
          </>
        ) : (
          <motion.div className="grid" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
            <div>
              1. In your authenticator app, add an account using this key (or open the link on your phone):
              <code style={{ display: "block", fontSize: 18, letterSpacing: 2, margin: "10px 0", wordBreak: "break-all" }}>{setup.secret.match(/.{1,4}/g)?.join(" ")}</code>
              <a href={setup.otpauthUrl}>Open in authenticator app</a>
            </div>
            <label>
              2. Enter the 6-digit code it shows
              <input inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} autoComplete="one-time-code" />
            </label>
            <button className="btn" onClick={enable} disabled={code.length !== 6}>Turn on</button>
          </motion.div>
        )}
      </div>
    </>
  );
}
