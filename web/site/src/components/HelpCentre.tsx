"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import bundledFaq from "../faq.json";
import { API_URL, useBrand } from "@/lib/brand";
import { ICONS, Icon, Reveal } from "./Reveal";

type Faq = typeof bundledFaq;

/** Plain text only: answers are rendered as text, never as HTML. */
const fill = (s: string, brand: string) => s.replaceAll("{{brand}}", brand);

/**
 * Help centre: the bundled FAQ renders immediately (and is in the static HTML for search
 * engines); the admin-edited version from the API replaces it when it loads.
 */
export function HelpCentre() {
  const { brand } = useBrand();
  const [faq, setFaq] = useState<Faq>(bundledFaq);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string>("all");
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    const ctl = new AbortController();
    fetch(`${API_URL}/v1/config/faq`, { signal: ctl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((f: Faq) => Array.isArray(f.categories) && setFaq(f))
      .catch(() => {});
    return () => ctl.abort();
  }, []);

  const results = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return faq.categories
      .filter((c) => cat === "all" || c.id === cat)
      .map((c) => ({
        ...c,
        items: c.items.filter((i) => !needle || `${i.q} ${i.a}`.toLowerCase().replaceAll("{{brand}}", brand.name.toLowerCase()).includes(needle)),
      }))
      .filter((c) => c.items.length > 0);
  }, [faq, q, cat, brand.name]);
  const total = results.reduce((n, c) => n + c.items.length, 0);

  return (
    <main className="section">
      <div className="container" style={{ maxWidth: 860 }}>
        <Reveal>
          <span className="eyebrow">Help centre</span>
          <h1 style={{ fontSize: "clamp(2rem, 5vw, 3rem)" }}>How can we help?</h1>
        </Reveal>
        <Reveal delay={0.05}>
          <label className="help-search">
            <span className="sr-only">Search help articles</span>
            <input type="search" placeholder="Search, e.g. withdrawal fee" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" />
          </label>
        </Reveal>
        <div className="help-cats" role="tablist" aria-label="Topics">
          {[{ id: "all", title: "All topics" }, ...faq.categories].map((c) => (
            <button key={c.id} role="tab" aria-selected={cat === c.id} className={`chip ${cat === c.id ? "active" : ""}`} onClick={() => setCat(c.id)}>
              {c.title}
            </button>
          ))}
        </div>
        <p className="muted" aria-live="polite" style={{ fontSize: 14 }}>
          {q ? `${total} result${total === 1 ? "" : "s"}` : " "}
        </p>
        {results.map((c) => (
          <section key={c.id} style={{ marginTop: 28 }}>
            <h2 style={{ fontSize: "1.3rem" }}>{c.title}</h2>
            {c.items.map((i) => {
              const key = `${c.id}/${i.id}`;
              const isOpen = open === key || (q.trim().length > 2 && total <= 3);
              return (
                <div key={key} className="faq-item" id={key.replace("/", "-")}>
                  <button className="faq-q" aria-expanded={isOpen} onClick={() => setOpen(open === key ? null : key)}>
                    {fill(i.q, brand.name)}
                    <motion.span animate={{ rotate: isOpen ? 45 : 0 }} style={{ color: "var(--primary)", display: "inline-flex" }}>
                      <Icon d={ICONS.plus} />
                    </motion.span>
                  </button>
                  <AnimatePresence initial={false}>
                    {isOpen && (
                      <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.3 }} style={{ overflow: "hidden" }}>
                        <p className="muted" style={{ paddingBottom: 20, whiteSpace: "pre-line" }}>{fill(i.a, brand.name)}</p>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
          </section>
        ))}
        {total === 0 && <p className="muted" style={{ marginTop: 24 }}>No answers match “{q}”. Try other words, or contact us below.</p>}
        <div className="card" style={{ marginTop: 40 }}>
          <h2 style={{ fontSize: "1.2rem", marginTop: 0 }}>Still need help?</h2>
          <p className="muted">
            Open the app and go to Profile → Help &amp; support to chat with our team, or email{" "}
            <a href={`mailto:${brand.support.email}`}>{brand.support.email}</a>. We will never ask for your PIN, password or one-time codes.
          </p>
        </div>
      </div>
    </main>
  );
}
