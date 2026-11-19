"use client";

import { AnimatePresence, motion, Reorder } from "motion/react";
import { useEffect, useState } from "react";
import { Header, useLoad, useToast } from "@/components/Shell";
import { api } from "@/lib/api";

interface Item { id: string; q: string; a: string }
interface Category { id: string; title: string; items: Item[] }
interface Faq { categories: Category[]; version?: number }

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "item";
const uniq = (base: string, taken: string[]) => {
  let id = base.length >= 2 ? base : `${base}-1`;
  for (let i = 2; taken.includes(id); i++) id = `${base}-${i}`;
  return id;
};

/**
 * Help centre FAQ shown in the app and on the website. Plain text; write {{brand}} for
 * the brand name. Changes are live within ~5 minutes (cache) and every save is versioned.
 */
export default function FaqEditor() {
  const loaded = useLoad<Faq>("/v1/config/faq");
  const [faq, setFaq] = useState<Faq | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  useEffect(() => {
    if (loaded.data && !faq) setFaq({ categories: loaded.data.categories });
  }, [loaded.data, faq]);

  const update = (fn: (f: Faq) => Faq) => {
    setFaq((f) => (f ? fn(structuredClone(f)) : f));
    setDirty(true);
  };

  async function save() {
    if (!faq) return;
    setBusy(true);
    try {
      const r = await api<{ version: number }>("/v1/admin/config/faq", { faq });
      toast(`Saved (version ${r.version}). The app and website update within a few minutes.`);
      setDirty(false);
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!faq) return <Header title="Help centre FAQ" subtitle={loaded.error ?? "Loading…"} />;

  return (
    <>
      <Header title="Help centre FAQ" subtitle="Shown in the app (Help & support) and on the website (/help). Plain text; write {{brand}} for your brand name.">
        <button className="btn" disabled={!dirty || busy} onClick={save}>{busy ? "Saving…" : dirty ? "Save changes" : "Saved"}</button>
      </Header>
      <Reorder.Group axis="y" values={faq.categories} onReorder={(cats) => update((f) => ({ ...f, categories: cats }))} style={{ listStyle: "none", padding: 0, display: "grid", gap: 16 }}>
        {faq.categories.map((c, ci) => (
          <Reorder.Item key={c.id} value={c} className="card" style={{ cursor: "grab" }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span className="muted" title="Drag to reorder">⋮⋮</span>
              <input value={c.title} maxLength={60} aria-label="Category title" onChange={(e) => update((f) => { f.categories[ci]!.title = e.target.value; return f; })} style={{ fontWeight: 700 }} />
              <button className="btn danger" onClick={() => confirm(`Delete “${c.title}” and its ${c.items.length} questions?`) && update((f) => ({ ...f, categories: f.categories.filter((_, i) => i !== ci) }))}>Delete</button>
            </div>
            <AnimatePresence initial={false}>
              {c.items.map((it, ii) => (
                <motion.div key={it.id} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} style={{ display: "grid", gap: 6, marginTop: 12, paddingLeft: 20, borderLeft: "3px solid var(--primary)" }}>
                  <input value={it.q} maxLength={200} placeholder="Question" aria-label="Question" onChange={(e) => update((f) => { f.categories[ci]!.items[ii]!.q = e.target.value; return f; })} />
                  <textarea value={it.a} maxLength={2000} rows={3} placeholder="Answer" aria-label="Answer" onChange={(e) => update((f) => { f.categories[ci]!.items[ii]!.a = e.target.value; return f; })} />
                  <div style={{ display: "flex", gap: 6 }}>
                    <button className="btn secondary" disabled={ii === 0} onClick={() => update((f) => { const a = f.categories[ci]!.items; [a[ii - 1], a[ii]] = [a[ii]!, a[ii - 1]!]; return f; })}>↑</button>
                    <button className="btn secondary" disabled={ii === c.items.length - 1} onClick={() => update((f) => { const a = f.categories[ci]!.items; [a[ii + 1], a[ii]] = [a[ii]!, a[ii + 1]!]; return f; })}>↓</button>
                    <button className="btn danger" disabled={c.items.length === 1} onClick={() => update((f) => { f.categories[ci]!.items.splice(ii, 1); return f; })}>Remove</button>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
            <button
              className="btn secondary"
              style={{ marginTop: 12 }}
              onClick={() => update((f) => { const items = f.categories[ci]!.items; items.push({ id: uniq("question", items.map((x) => x.id)), q: "", a: "" }); return f; })}
            >
              + Add question
            </button>
          </Reorder.Item>
        ))}
      </Reorder.Group>
      <button
        className="btn secondary"
        style={{ marginTop: 16 }}
        onClick={() => {
          const title = prompt("New category title?");
          if (!title) return;
          update((f) => ({ ...f, categories: [...f.categories, { id: uniq(slug(title), f.categories.map((x) => x.id)), title, items: [{ id: "question", q: "", a: "" }] }] }));
        }}
      >
        + Add category
      </button>
    </>
  );
}
