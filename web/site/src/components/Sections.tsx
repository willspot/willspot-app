"use client";

import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { API_URL, useBrand } from "@/lib/brand";
import { Logo } from "./Nav";
import { ICONS, Icon, Reveal } from "./Reveal";

interface Market {
  asset: string;
  name: string;
  buyPrice: string;
  sellPrice: string;
  change24h: number;
}

const naira = (v: string) => `₦${Number(v).toLocaleString("en-NG", { maximumFractionDigits: 0 })}`;

/** Live rates from the trade service; the strip scrolls and pauses on hover. */
export function Rates() {
  const [items, setItems] = useState<Market[] | null>(null);
  useEffect(() => {
    fetch(`${API_URL}/v1/trade/markets`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: { items: Market[] }) => setItems(d.items))
      .catch(() => setItems([]));
  }, []);
  const list = items?.length ? [...items, ...items, ...items, ...items] : [];
  return (
    <section id="rates" className="ticker" aria-label="Current rates">
      {items === null ? (
        <div className="container" style={{ padding: 16 }}>Loading rates…</div>
      ) : items.length === 0 ? (
        <div className="container muted" style={{ padding: 16 }}>Live rates appear here when the service is online.</div>
      ) : (
        <div className="ticker-track">
          {list.map((m, i) => (
            <span key={i} style={{ display: "inline-flex", gap: 12, alignItems: "center", whiteSpace: "nowrap" }}>
              <strong>{m.asset}</strong>
              <span>Buy {naira(m.buyPrice)}</span>
              <span className="muted">Sell {naira(m.sellPrice)}</span>
              <span style={{ color: m.change24h >= 0 ? "var(--success)" : "var(--danger)", fontWeight: 700 }}>
                {m.change24h >= 0 ? "▲" : "▼"} {Math.abs(m.change24h).toFixed(2)}%
              </span>
            </span>
          ))}
        </div>
      )}
    </section>
  );
}

const FEATURES = [
  { icon: ICONS.wallet, title: "Your own account number", body: "Verify your BVN and get a dedicated Naira account number. Transfers from any bank land in your wallet." },
  { icon: ICONS.swap, title: "Buy and sell crypto in Naira", body: "USDT, BTC and ETH, priced in Naira. Your quote is locked for 30 seconds while you confirm with your PIN." },
  { icon: ICONS.bank, title: "Cash out to any bank", body: "Withdraw to any Nigerian bank account. You see the fee and the total before you confirm." },
  { icon: ICONS.eye, title: "One clear rate", body: "No surprise charges. The rate you're shown already includes our margin, and the fee is stated up front." },
  { icon: ICONS.shield, title: "Built to protect you", body: "Every withdrawal and trade needs your PIN. Sessions are encrypted on your phone and revoked if anything looks wrong." },
  { icon: ICONS.bolt, title: "Every kobo accounted for", body: "A double-entry ledger records each movement. Your balance can never be spent twice." },
];

export function Features() {
  const { brand } = useBrand();
  return (
    <section id="features" className="section">
      <div className="container">
        <Reveal>
          <span className="eyebrow">Why {brand.name}</span>
          <h2 style={{ maxWidth: 640 }}>Everything your Naira needs, in one app.</h2>
        </Reveal>
        <div className="grid-3" style={{ marginTop: 40 }}>
          {FEATURES.map((f, i) => (
            <Reveal key={f.title} delay={(i % 3) * 0.08}>
              <motion.div className="card" whileHover={{ y: -6 }} transition={{ type: "spring", stiffness: 300, damping: 20 }}>
                <div className="icon-bubble">
                  <Icon d={f.icon} />
                </div>
                <h3>{f.title}</h3>
                <p className="muted">{f.body}</p>
              </motion.div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

export function HowItWorks() {
  const steps = [
    ["Sign up with your phone", "Create an account and confirm the code we text you."],
    ["Verify and set a PIN", "Add your BVN to unlock your account number, then choose a 4-digit PIN."],
    ["Add money and go", "Transfer in from any bank, then trade or cash out whenever you like."],
  ];
  return (
    <section id="how" className="section" style={{ background: "var(--surface)" }}>
      <div className="container" style={{ display: "grid", gap: 48, gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", alignItems: "center" }}>
        <Reveal>
          <span className="eyebrow">How it works</span>
          <h2>Ready in three steps.</h2>
          <p className="muted">Most people are set up in under five minutes.</p>
        </Reveal>
        <div className="steps">
          {steps.map(([t, b], i) => (
            <Reveal key={t} delay={i * 0.12}>
              <div className="step">
                <motion.div className="step-num" initial={{ scale: 0 }} whileInView={{ scale: 1 }} viewport={{ once: true }} transition={{ type: "spring", delay: 0.2 + i * 0.12 }}>
                  {i + 1}
                </motion.div>
                <div>
                  <h3 style={{ fontSize: "1.15rem", marginBottom: 4 }}>{t}</h3>
                  <p className="muted">{b}</p>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

const FAQS = [
  ["How fast are deposits?", "Bank transfers to your account number usually arrive within minutes. We credit your wallet as soon as the bank confirms."],
  ["What does it cost?", "Adding money is free. Withdrawals have a flat fee that is shown before you confirm. Crypto prices include our margin, with no extra fee on top."],
  ["Why do you need my BVN?", "Nigerian rules require us to confirm who you are before you can hold and move money. We store only the last four digits."],
  ["Is my money safe?", "Every withdrawal and trade needs your PIN, sessions can be revoked instantly, and every balance change is recorded in a double-entry ledger."],
  ["Can I close my account?", "Yes. Go to Profile → Close account in the app, or email us. Records we must keep by law are retained for the required period, then deleted."],
];

export function Faq() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section id="faq" className="section">
      <div className="container" style={{ maxWidth: 820 }}>
        <Reveal>
          <span className="eyebrow">FAQ</span>
          <h2>Questions, answered.</h2>
        </Reveal>
        <p className="muted" style={{ marginTop: 8 }}>
          More answers in the <a href="/help">help centre</a>.
        </p>
        <div style={{ marginTop: 24 }}>
          {FAQS.map(([q, a], i) => (
            <div key={q} className="faq-item">
              <button className="faq-q" aria-expanded={open === i} onClick={() => setOpen(open === i ? null : i)}>
                {q}
                <motion.span animate={{ rotate: open === i ? 45 : 0 }} style={{ color: "var(--primary)", display: "inline-flex" }}>
                  <Icon d={ICONS.plus} />
                </motion.span>
              </button>
              <AnimatePresence initial={false}>
                {open === i && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.3 }} style={{ overflow: "hidden" }}>
                    <p className="muted" style={{ paddingBottom: 20 }}>{a}</p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function Cta() {
  const { brand } = useBrand();
  return (
    <section className="section" style={{ paddingTop: 0 }}>
      <div className="container">
        <Reveal>
          <div className="cta">
            <motion.div className="blob" style={{ width: 300, height: 300, background: "#fff", right: -60, top: -80, opacity: 0.15 }} animate={{ x: [0, 30, 0], y: [0, 20, 0] }} transition={{ duration: 8, repeat: Infinity }} />
            <h2>Start with {brand.name} today.</h2>
            <p style={{ opacity: 0.85, maxWidth: 520 }}>Download the app, verify in minutes and get your own Naira account number.</p>
            <a className="btn" style={{ background: "#fff", color: "var(--primary-dark)", marginTop: 12 }} href="#download">
              Get the app <Icon d={ICONS.arrow} />
            </a>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

export function Footer() {
  const { brand } = useBrand();
  return (
    <footer className="footer">
      <div className="container footer-grid">
        <div style={{ maxWidth: 320 }}>
          <Logo />
          <p className="muted" style={{ marginTop: 12 }}>{brand.tagline}</p>
          <p className="muted" style={{ fontSize: 13 }}>
            © {new Date().getFullYear()} {brand.legal.companyName}
          </p>
        </div>
        <div>
          <strong>Product</strong>
          <a href="/#features">Features</a>
          <a href="/#rates">Rates</a>
          <a href="/help">Help centre</a>
        </div>
        <div>
          <strong>Legal</strong>
          <Link href="/legal/terms">Terms of service</Link>
          <Link href="/legal/privacy">Privacy policy</Link>
          <Link href="/delete-account">Delete your account</Link>
        </div>
        <div>
          <strong>Contact</strong>
          <a href={`mailto:${brand.support.email}`}>{brand.support.email}</a>
        </div>
      </div>
    </footer>
  );
}
