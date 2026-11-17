"use client";

import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import brand from "../brand.json";
import { api } from "@/lib/api";

const NAV = [
  ["/", "Overview"],
  ["/users", "Users"],
  ["/kyc", "KYC review"],
  ["/transactions", "Ledger"],
  ["/withdrawals", "Withdrawals"],
  ["/trade", "Rates & pairs"],
  ["/branding", "Branding"],
  ["/flags", "Feature flags"],
  ["/audit", "Audit log"],
] as const;

const ToastCtx = createContext<(msg: string) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function Shell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const [me, setMe] = useState<{ email: string } | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    api<{ user: { email: string } }>("/api/auth/session")
      .then((r) => setMe(r.user))
      .catch(() => (location.href = "/login"));
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  if (!me) return <div className="login-wrap muted">Checking your session…</div>;

  return (
    <ToastCtx.Provider value={setToast}>
      <div className="shell">
        <aside className="sidebar">
          <div className="brand">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/logo-mark.svg" alt="" width={30} height={30} />
            {brand.name} Admin
          </div>
          {NAV.map(([href, label]) => {
            const active = href === "/" ? path === "/" : path.startsWith(href);
            return (
              <Link key={href} href={href} className={`navlink ${active ? "active" : ""}`} style={{ isolation: "isolate" }}>
                {active && <motion.span layoutId="nav-pill" className="nav-pill" transition={{ type: "spring", stiffness: 400, damping: 32 }} />}
                {label}
              </Link>
            );
          })}
          <div style={{ marginTop: "auto", fontSize: 12, padding: 8 }}>
            <div style={{ wordBreak: "break-all" }}>{me.email}</div>
            <button
              className="btn secondary"
              style={{ marginTop: 8, width: "100%", justifyContent: "center" }}
              onClick={async () => {
                await api("/api/auth/logout", {});
                location.href = "/login";
              }}
            >
              Sign out
            </button>
          </div>
        </aside>
        <main className="main">
          <AnimatePresence mode="wait">
            <motion.div key={path} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>
              {children}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
      <AnimatePresence>
        {toast && (
          <motion.div className="toast" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }}>
            {toast}
          </motion.div>
        )}
      </AnimatePresence>
    </ToastCtx.Provider>
  );
}

export function Header({ title, subtitle, children }: { title: string; subtitle?: string; children?: ReactNode }) {
  return (
    <div className="header">
      <div>
        <h1>{title}</h1>
        {subtitle && <div className="muted">{subtitle}</div>}
      </div>
      {children}
    </div>
  );
}

/** Animated number for stat cards. */
export function Counter({ value, format = (n) => n.toLocaleString("en-NG") }: { value: number; format?: (n: number) => string }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    const start = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const p = Math.min(1, (t - start) / 900);
      setN(value * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <>{format(n)}</>;
}

export function Status({ s }: { s: string }) {
  const cls = ["completed", "approved", "active"].includes(s) ? "ok" : ["failed", "rejected", "suspended", "deleted"].includes(s) ? "bad" : "warn";
  return <span className={`badge ${cls}`}>{s}</span>;
}

export function useLoad<T>(path: string, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    api<T>(path)
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, tick, ...deps]);
  return { data, error, reload: () => setTick((t) => t + 1) };
}
