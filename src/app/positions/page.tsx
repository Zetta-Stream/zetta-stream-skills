"use client";
import { useState } from "react";
import { AGENT_API } from "@/lib/addresses";

type RouteCandidate = {
  id: string;
  score: number;
  protocol: string;
};

export default function PositionsPage() {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [routes, setRoutes] = useState<RouteCandidate[] | null>(null);
  const [best, setBest] = useState<RouteCandidate | null>(null);

  async function quote(fromChain: number, toChain: number) {
    setBusy(true);
    setErr(null);
    setRoutes(null);
    try {
      const resp = await fetch(`${AGENT_API}/fund`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target: "bridge",
          from_chain_id: fromChain,
          to_chain_id: toChain,
          src_token: "0x74b7f16337b8972027f6196a17a631ac6de26d22",
          dst_token: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
          amount_wei: "500000000",
          owner: "0x0000000000000000000000000000000000000000",
        }),
      });
      const j = (await resp.json()) as {
        ok: boolean;
        best?: RouteCandidate;
        candidates?: RouteCandidate[];
        error?: string;
      };
      if (!j.ok) {
        setErr(j.error ?? "unknown");
      } else {
        setBest(j.best ?? null);
        setRoutes(j.candidates ?? null);
      }
    } catch (e) {
      setErr((e as Error).message);
    }
    setBusy(false);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold">Cross-chain routes</h1>
        <p className="text-sm text-[rgb(var(--muted))] mt-1">
          Agent scores candidates by APY / fee / slippage / gas and picks the highest-scoring path. Quote uses OKX
          DEX aggregator when reachable; otherwise falls back to demo routes (flagged below).
        </p>
      </div>

      <div className="card p-4 space-y-3">
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => quote(196, 8453)}
            disabled={busy}
            className="px-3 py-1.5 rounded border border-[rgb(var(--card-border))] text-sm hover:border-[rgb(var(--accent))] disabled:opacity-50"
          >
            Quote: X Layer → Base (500 USDC)
          </button>
          <button
            onClick={() => quote(196, 42161)}
            disabled={busy}
            className="px-3 py-1.5 rounded border border-[rgb(var(--card-border))] text-sm hover:border-[rgb(var(--accent))] disabled:opacity-50"
          >
            Quote: X Layer → Arbitrum (500 USDC)
          </button>
          <button
            onClick={() => quote(8453, 196)}
            disabled={busy}
            className="px-3 py-1.5 rounded border border-[rgb(var(--card-border))] text-sm hover:border-[rgb(var(--accent))] disabled:opacity-50"
          >
            Quote: Base → X Layer (500 USDC)
          </button>
        </div>
        {busy && <div className="text-sm text-[rgb(var(--muted))]">Quoting…</div>}
        {err && <div className="text-sm text-[rgb(var(--accent-reject))]">{err}</div>}
      </div>

      {best && (
        <div className="card p-4">
          <div className="text-xs text-[rgb(var(--muted))]">Best route</div>
          <div className="text-2xl font-semibold mt-1">
            {best.protocol} · <span className="text-[rgb(var(--accent))]">score {best.score}</span>
          </div>
        </div>
      )}

      {routes && routes.length > 0 && (
        <div className="card p-4">
          <h2 className="text-lg font-semibold mb-2">All candidates</h2>
          <table className="w-full text-sm">
            <thead className="text-[rgb(var(--muted))] text-xs text-left">
              <tr>
                <th className="py-2 pr-4">id</th>
                <th className="pr-4">protocol</th>
                <th>score</th>
              </tr>
            </thead>
            <tbody>
              {routes.map((r) => (
                <tr key={r.id} className="border-t border-[rgb(var(--card-border))]">
                  <td className="py-2 pr-4 mono">{r.id}</td>
                  <td className="pr-4">{r.protocol}</td>
                  <td className="pr-4">
                    <div className="flex items-center gap-3">
                      <div className="w-32 h-1.5 bg-[rgb(var(--card-border))] rounded">
                        <div
                          className="h-1.5 rounded bg-[rgb(var(--accent))]"
                          style={{ width: `${r.score}%` }}
                        />
                      </div>
                      <span>{r.score}</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
