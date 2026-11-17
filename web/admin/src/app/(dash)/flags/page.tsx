"use client";

import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { Header, useLoad, useToast } from "@/components/Shell";
import { api } from "@/lib/api";

const LABELS: Record<string, [string, string]> = {
  signups: ["New sign-ups", "Allow new accounts to be created."],
  deposits: ["Deposits", "Credit incoming bank transfers and show account numbers."],
  withdrawals: ["Withdrawals", "Let customers cash out to their banks."],
  crypto_trading: ["Crypto trading", "Buy and sell USDT, BTC and ETH."],
  gift_cards: ["Gift cards", "Not built yet (phase 2). Keep off."],
  usd_account: ["USD account", "Not built yet (phase 2). Keep off."],
  bill_payments: ["Bill payments", "Not built yet (phase 2). Keep off."],
};

/** Flags are enforced by the services themselves, not only hidden in the app. */
export default function Flags() {
  const { data } = useLoad<{ flags: Record<string, boolean> }>("/v1/config/public");
  const [flags, setFlags] = useState<Record<string, boolean> | null>(null);
  const toast = useToast();
  useEffect(() => {
    if (data) setFlags(data.flags);
  }, [data]);

  async function flip(k: string) {
    if (!flags) return;
    const next = { ...flags, [k]: !flags[k] };
    setFlags(next);
    try {
      await api("/v1/admin/config/flags", { flags: next });
      toast(`${LABELS[k]?.[0] ?? k} ${next[k] ? "on" : "off"} (services apply it within 30s)`);
    } catch (e) {
      setFlags(flags);
      toast((e as Error).message);
    }
  }

  return (
    <>
      <Header title="Feature flags" subtitle="Switch features on or off without an app release." />
      <div className="card" style={{ padding: 0 }}>
        {flags &&
          Object.entries(flags).map(([k, on], i) => (
            <div key={k} style={{ display: "flex", alignItems: "center", gap: 16, padding: "16px 18px", borderTop: i ? "1px solid var(--border)" : 0 }}>
              <div style={{ flex: 1 }}>
                <strong>{LABELS[k]?.[0] ?? k}</strong>
                <div className="muted">{LABELS[k]?.[1]}</div>
              </div>
              <button className={`toggle ${on ? "on" : ""}`} onClick={() => flip(k)} role="switch" aria-checked={on} aria-label={k}>
                <motion.span animate={{ x: on ? 18 : 0 }} transition={{ type: "spring", stiffness: 500, damping: 30 }} />
              </button>
            </div>
          ))}
      </div>
    </>
  );
}
