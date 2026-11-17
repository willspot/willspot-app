"use client";

import { MotionConfig } from "motion/react";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import bundled from "../brand.json";

export type Brand = typeof bundled;
export type Flags = Brand["flags"];

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

const BrandContext = createContext<{ brand: Brand; live: boolean }>({ brand: bundled, live: false });
export const useBrand = () => useContext(BrandContext);

function applyCssVars(b: Brand) {
  const root = document.documentElement.style;
  for (const [k, v] of Object.entries(b.colors)) root.setProperty(`--${k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}`, v);
  root.setProperty("--radius", `${b.radius}px`);
}

/**
 * Starts with the bundled brand (so the page renders instantly and works without
 * the API), then swaps in the admin-edited brand from the config service.
 */
export function BrandProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState({ brand: bundled as Brand, live: false });
  useEffect(() => {
    const ctl = new AbortController();
    fetch(`${API_URL}/v1/config/public`, { signal: ctl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((c: { brand: Omit<Brand, "flags">; flags: Flags }) => {
        const next = { ...bundled, ...c.brand, flags: c.flags } as Brand;
        applyCssVars(next);
        document.title = `${next.name} — ${next.tagline}`;
        setState({ brand: next, live: true });
      })
      .catch(() => {});
    return () => ctl.abort();
  }, []);
  return (
    <MotionConfig reducedMotion="user">
      <BrandContext.Provider value={state}>{children}</BrandContext.Provider>
    </MotionConfig>
  );
}
