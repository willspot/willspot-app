"use client";

import { useEffect, useState } from "react";
import { Header, useLoad, useToast } from "@/components/Shell";
import { api, naira } from "@/lib/api";

interface Pair { asset: string; name: string; enabled: boolean; buySpreadBps: number; sellSpreadBps: number; minNgn: string; maxNgn: string }
interface Market { asset: string; buyPrice: string; sellPrice: string }

export default function Trade() {
  const { data, reload } = useLoad<{ usdNgn: string; items: Pair[] }>("/v1/admin/trade/pairs");
  const markets = useLoad<{ items: Market[] }>("/v1/trade/markets");
  const [fx, setFx] = useState("");
  const [edits, setEdits] = useState<Record<string, Pair>>({});
  const toast = useToast();

  useEffect(() => {
    if (data) {
      setFx(data.usdNgn);
      setEdits(Object.fromEntries(data.items.map((p) => [p.asset, p])));
    }
  }, [data]);

  async function save(p: Pair) {
    try {
      await api(`/v1/admin/trade/pairs/${p.asset}`, { enabled: p.enabled, buySpreadBps: Number(p.buySpreadBps), sellSpreadBps: Number(p.sellSpreadBps), minNgn: p.minNgn, maxNgn: p.maxNgn });
      toast(`${p.asset} saved`);
      reload();
      markets.reload();
    } catch (e) {
      toast((e as Error).message);
    }
  }

  const set = (asset: string, patch: Partial<Pair>) => setEdits((e) => ({ ...e, [asset]: { ...e[asset]!, ...patch } }));

  return (
    <>
      <Header title="Rates & pairs" subtitle="Spreads are in basis points (100 = 1%). Prices come from the sandbox market feed." />
      <div className="card" style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap", marginBottom: 16 }}>
        <label style={{ width: 220 }}>
          USD → NGN rate
          <input value={fx} onChange={(e) => setFx(e.target.value)} />
        </label>
        <button
          className="btn"
          onClick={async () => {
            try {
              await api("/v1/admin/trade/fx", { usdNgn: fx });
              toast("Rate updated");
              markets.reload();
            } catch (e) {
              toast((e as Error).message);
            }
          }}
        >
          Save rate
        </button>
      </div>
      <div className="grid stats">
        {Object.values(edits).map((p) => {
          const m = markets.data?.items.find((x) => x.asset === p.asset);
          return (
            <div key={p.asset} className="card grid" style={{ gap: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <h2 style={{ margin: 0 }}>{p.name}</h2>
                <button className={`toggle ${p.enabled ? "on" : ""}`} aria-label="enabled" onClick={() => set(p.asset, { enabled: !p.enabled })}>
                  <span style={{ transform: `translateX(${p.enabled ? 18 : 0}px)`, transition: "transform .2s" }} />
                </button>
              </div>
              {m && <div className="muted">Buy {naira(m.buyPrice)} · Sell {naira(m.sellPrice)}</div>}
              <label>Buy spread (bps)<input type="number" value={p.buySpreadBps} onChange={(e) => set(p.asset, { buySpreadBps: Number(e.target.value) })} /></label>
              <label>Sell spread (bps)<input type="number" value={p.sellSpreadBps} onChange={(e) => set(p.asset, { sellSpreadBps: Number(e.target.value) })} /></label>
              <label>Minimum (₦)<input value={p.minNgn} onChange={(e) => set(p.asset, { minNgn: e.target.value })} /></label>
              <label>Maximum (₦)<input value={p.maxNgn} onChange={(e) => set(p.asset, { maxNgn: e.target.value })} /></label>
              <button className="btn" onClick={() => save(p)}>Save {p.asset}</button>
            </div>
          );
        })}
      </div>
    </>
  );
}
