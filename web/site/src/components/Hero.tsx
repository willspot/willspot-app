"use client";

import { animate, motion, useMotionValue, useTransform } from "motion/react";
import { useEffect } from "react";
import { useBrand } from "@/lib/brand";
import { ICONS, Icon } from "./Reveal";

function CountUp({ to }: { to: number }) {
  const v = useMotionValue(0);
  const text = useTransform(v, (n) => `₦${Math.round(n).toLocaleString("en-NG")}.00`);
  useEffect(() => {
    const c = animate(v, to, { duration: 1.8, ease: [0.16, 1, 0.3, 1], delay: 0.6 });
    return () => c.stop();
  }, [to, v]);
  return <motion.span>{text}</motion.span>;
}

/** Original illustration of the app, built in HTML/CSS (no screenshots). */
function PhoneMock() {
  const rows = [
    ["Bank transfer", "+₦100,000.00", "var(--success)"],
    ["Bought USDT", "-₦30,000.00", "var(--text)"],
    ["Withdrawal", "-₦20,050.00", "var(--text)"],
  ];
  return (
    <motion.div
      className="phone"
      initial={{ opacity: 0, y: 60, rotate: 4 }}
      animate={{ opacity: 1, y: 0, rotate: 0 }}
      transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1], delay: 0.2 }}
    >
      <motion.div className="screen" animate={{ y: [0, -6, 0] }} transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}>
        <div style={{ fontWeight: 700 }}>Hi Ada 👋</div>
        <div className="balance-card">
          <div style={{ opacity: 0.8, fontSize: 13 }}>Naira balance</div>
          <div style={{ fontSize: 26, fontWeight: 700, margin: "6px 0 12px" }}>
            <CountUp to={49950} />
          </div>
          <div style={{ display: "flex", gap: 6, fontSize: 11 }}>
            {["19.35 USDT", "0 BTC", "0 ETH"].map((c) => (
              <span key={c} style={{ background: "rgba(255,255,255,.2)", borderRadius: 999, padding: "3px 8px" }}>
                {c}
              </span>
            ))}
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 6, textAlign: "center", fontSize: 10 }}>
          {[
            [ICONS.plus, "Add"],
            [ICONS.arrow, "Send"],
            [ICONS.swap, "Buy"],
            [ICONS.bank, "Bank"],
          ].map(([d, l], i) => (
            <motion.div key={l} initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.9 + i * 0.08, type: "spring", stiffness: 300 }}>
              <div style={{ width: 40, height: 40, margin: "0 auto 4px", borderRadius: 12, display: "grid", placeItems: "center", background: "color-mix(in srgb, var(--primary) 12%, transparent)", color: "var(--primary)" }}>
                <Icon d={d} size={18} />
              </div>
              {l}
            </motion.div>
          ))}
        </div>
        <div style={{ fontWeight: 700, fontSize: 13, marginTop: 4 }}>Recent activity</div>
        {rows.map(([t, a, c], i) => (
          <motion.div key={t} className="mini-row" initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 1.2 + i * 0.12 }}>
            <span>{t}</span>
            <strong style={{ color: c }}>{a}</strong>
          </motion.div>
        ))}
      </motion.div>
    </motion.div>
  );
}

export function Hero() {
  const { brand } = useBrand();
  const words = "Spend, save and trade in Naira.".split(" ");
  return (
    <section className="hero">
      <motion.div className="blob" style={{ width: 420, height: 420, background: "var(--primary)", top: -120, right: -80 }} animate={{ scale: [1, 1.15, 1] }} transition={{ duration: 10, repeat: Infinity }} />
      <motion.div className="blob" style={{ width: 360, height: 360, background: "var(--secondary)", bottom: -140, left: -100 }} animate={{ scale: [1.1, 1, 1.1] }} transition={{ duration: 12, repeat: Infinity }} />
      <div className="container hero-grid">
        <div>
          <motion.span className="eyebrow" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            {brand.tagline}
          </motion.span>
          <h1>
            {words.map((w, i) => (
              <motion.span
                key={i}
                style={{ display: "inline-block", marginRight: "0.25em" }}
                className={i >= words.length - 2 ? "gradient-text" : undefined}
                initial={{ opacity: 0, y: 40, filter: "blur(8px)" }}
                animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                transition={{ delay: 0.1 + i * 0.08, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
              >
                {w}
              </motion.span>
            ))}
          </h1>
          <motion.p className="muted" style={{ fontSize: "1.15rem", maxWidth: 520 }} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.6 }}>
            {brand.name} gives you a Naira account number in minutes. Add money by bank transfer, buy and sell crypto with the price locked while you confirm, and cash out to any Nigerian bank.
          </motion.p>
          <motion.div id="download" className="store-row" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.75 }}>
            <a className="btn store" href="#" aria-disabled="true" title="Store link added at launch">
              <Icon d={ICONS.apple} /> App Store · soon
            </a>
            <a className="btn store" href="#" aria-disabled="true" title="Store link added at launch">
              <Icon d={ICONS.play} /> Google Play · soon
            </a>
          </motion.div>
        </div>
        <PhoneMock />
      </div>
    </section>
  );
}
