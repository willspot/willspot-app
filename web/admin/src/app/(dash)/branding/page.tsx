"use client";

import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { Header, useLoad, useToast } from "@/components/Shell";
import { api } from "@/lib/api";

const FONTS = ["Inter", "Manrope", "Poppins", "DM Sans", "Plus Jakarta Sans", "Space Grotesk", "Outfit", "Nunito"];
type Brand = {
  name: string;
  tagline: string;
  logoUrl: string;
  logoMarkUrl: string;
  colors: Record<string, string>;
  fonts: { heading: string; body: string };
  radius: number;
  support: { email: string };
  legal: { companyName: string };
  [k: string]: unknown;
};

/** Edits the brand the apps and website load at start-up. Changes apply without a release. */
export default function Branding() {
  const { data } = useLoad<{ brand: Brand }>("/v1/config/public");
  const [b, setB] = useState<Brand | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  useEffect(() => {
    if (data) setB(data.brand);
  }, [data]);
  if (!b) return <Header title="Branding" subtitle="Loading…" />;

  const color = (k: string, v: string) => setB({ ...b, colors: { ...b.colors, [k]: v } });

  return (
    <>
      <Header title="Branding" subtitle="Name, logo, colours and fonts for the app, website and this dashboard.">
        <button
          className="btn"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await api("/v1/admin/config/brand", { brand: b });
              toast("Brand published. Apps pick it up on next launch.");
            } catch (e) {
              toast((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Publishing…" : "Publish"}
        </button>
      </Header>
      <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", alignItems: "start" }}>
        <div className="card grid">
          <label>Name<input value={b.name} onChange={(e) => setB({ ...b, name: e.target.value })} maxLength={40} /></label>
          <label>Tagline<input value={b.tagline} onChange={(e) => setB({ ...b, tagline: e.target.value })} maxLength={120} /></label>
          <label>Logo URL (https:// or /path; PNG works in the app)<input value={b.logoUrl} onChange={(e) => setB({ ...b, logoUrl: e.target.value })} /></label>
          <label>Logo mark URL<input value={b.logoMarkUrl} onChange={(e) => setB({ ...b, logoMarkUrl: e.target.value })} /></label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <label>Heading font<select value={b.fonts.heading} onChange={(e) => setB({ ...b, fonts: { ...b.fonts, heading: e.target.value } })}>{FONTS.map((f) => <option key={f}>{f}</option>)}</select></label>
            <label>Body font<select value={b.fonts.body} onChange={(e) => setB({ ...b, fonts: { ...b.fonts, body: e.target.value } })}>{FONTS.map((f) => <option key={f}>{f}</option>)}</select></label>
          </div>
          <label>Corner radius: {b.radius}px<input type="range" min={0} max={32} value={b.radius} onChange={(e) => setB({ ...b, radius: Number(e.target.value) })} /></label>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10 }}>
            {Object.entries(b.colors).map(([k, v]) => (
              <label key={k} style={{ gridTemplateColumns: "auto 1fr", alignItems: "center", display: "grid", gap: 8 }}>
                <input type="color" value={v} onChange={(e) => color(k, e.target.value.toUpperCase())} style={{ width: 40, height: 34, padding: 2 }} />
                <span>{k}</span>
              </label>
            ))}
          </div>
          <label>Support email<input value={b.support.email} onChange={(e) => setB({ ...b, support: { ...b.support, email: e.target.value } })} /></label>
          <label>Company name<input value={b.legal.companyName} onChange={(e) => setB({ ...b, legal: { ...b.legal, companyName: e.target.value } })} /></label>
        </div>
        <div className="card" style={{ position: "sticky", top: 20 }}>
          <h2>Live preview</h2>
          <motion.div layout style={{ borderRadius: 28, background: b.colors.background, padding: 18, maxWidth: 300, margin: "0 auto", border: "8px solid #0e0d15" }}>
            <div style={{ fontWeight: 700, color: b.colors.text, fontFamily: `"${b.fonts.heading}", system-ui, sans-serif` }}>{b.name}</div>
            <div style={{ color: b.colors.muted, fontSize: 12, marginBottom: 12 }}>{b.tagline}</div>
            <motion.div
              animate={{ background: `linear-gradient(135deg, ${b.colors.primary}, ${b.colors.secondary})` }}
              style={{ borderRadius: b.radius + 6, padding: 16, color: "#fff" }}
            >
              <div style={{ opacity: 0.8, fontSize: 12 }}>Naira balance</div>
              <div style={{ fontSize: 24, fontWeight: 700, fontFamily: `"${b.fonts.heading}", system-ui, sans-serif` }}>₦49,950.00</div>
            </motion.div>
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <div style={{ flex: 1, textAlign: "center", padding: 10, borderRadius: b.radius, background: b.colors.primary, color: "#fff", fontWeight: 600 }}>Add money</div>
              <div style={{ flex: 1, textAlign: "center", padding: 10, borderRadius: b.radius, background: b.colors.surface, color: b.colors.text }}>Withdraw</div>
            </div>
            <div style={{ marginTop: 12, fontSize: 13, display: "flex", justifyContent: "space-between", color: b.colors.text }}>
              <span>Bank transfer</span>
              <strong style={{ color: b.colors.success }}>+₦100,000</strong>
            </div>
          </motion.div>
        </div>
      </div>
    </>
  );
}
