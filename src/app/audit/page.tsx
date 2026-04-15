import { createPublicClient, http } from "viem";
import { xLayer } from "viem/chains";
import { zettaStreamLogAbi, POSITION_LABELS, DELEGATION_MODE_LABELS } from "@/lib/abi";
import { ZETTA_STREAM_LOG_ADDRESS, XLAYER_RPC, OKLINK_ADDRESS, OKLINK_TX } from "@/lib/addresses";

export const revalidate = 30;

const client = createPublicClient({ chain: xLayer, transport: http(XLAYER_RPC) });

interface Rotation {
  timestamp: bigint;
  owner: `0x${string}`;
  agent: `0x${string}`;
  signalHash: `0x${string}`;
  from: number;
  to: number;
  confidence: number;
  netYieldBps: number;
  gasSavedBps: number;
  batchTxHash: `0x${string}`;
  mode: number;
  reason: string;
}

async function fetchAll() {
  if (!ZETTA_STREAM_LOG_ADDRESS) return { count: 0n, rotations: [] as Rotation[] };
  try {
    const [count, rotations] = await Promise.all([
      client.readContract({
        address: ZETTA_STREAM_LOG_ADDRESS,
        abi: zettaStreamLogAbi,
        functionName: "rotationCount",
      }),
      client.readContract({
        address: ZETTA_STREAM_LOG_ADDRESS,
        abi: zettaStreamLogAbi,
        functionName: "recent",
        args: [50n],
      }) as Promise<Rotation[]>,
    ]);
    return { count, rotations };
  } catch {
    return { count: 0n, rotations: [] as Rotation[] };
  }
}

export default async function AuditPage() {
  const { count, rotations } = await fetchAll();
  const addrReady = !!ZETTA_STREAM_LOG_ADDRESS;

  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Rotation ledger</h1>
          <p className="text-sm text-[rgb(var(--muted))] mt-1">
            Every yield rotation Zetta-Stream commits, immutable on X Layer.
          </p>
        </div>
        <div className="text-xs text-[rgb(var(--muted))] font-mono">
          {addrReady ? (
            <>
              Contract:{" "}
              <a
                className="underline text-[rgb(var(--accent))]"
                href={OKLINK_ADDRESS(ZETTA_STREAM_LOG_ADDRESS)}
                target="_blank"
                rel="noreferrer"
              >
                {ZETTA_STREAM_LOG_ADDRESS.slice(0, 8)}…{ZETTA_STREAM_LOG_ADDRESS.slice(-6)}
              </a>
              <span className="ml-3">rotations: {String(count)}</span>
            </>
          ) : (
            <>Set NEXT_PUBLIC_ZETTA_STREAM_LOG_ADDRESS in .env</>
          )}
        </div>
      </div>

      <section className="card p-0 overflow-hidden">
        {rotations.length === 0 ? (
          <div className="p-8 text-center text-sm text-[rgb(var(--muted))]">
            No rotations on-chain yet. Run{" "}
            <code className="font-mono text-xs px-1.5 py-0.5 rounded bg-white/[0.05]">pnpm seed:rotations</code>{" "}
            or trigger one via the <code className="font-mono text-xs px-1.5 py-0.5 rounded bg-white/[0.05]">zetta-stream-action</code> skill.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-[rgb(var(--muted))] text-left bg-white/[0.02]">
                <tr>
                  <th className="py-3 px-4 font-mono uppercase">when</th>
                  <th className="px-4 font-mono uppercase">route</th>
                  <th className="px-4 font-mono uppercase">net</th>
                  <th className="px-4 font-mono uppercase">conf</th>
                  <th className="px-4 font-mono uppercase">mode</th>
                  <th className="px-4 font-mono uppercase">reason</th>
                  <th className="px-4 font-mono uppercase">batch</th>
                </tr>
              </thead>
              <tbody>
                {rotations.map((r, i) => {
                  const positive = r.netYieldBps >= 0;
                  return (
                    <tr key={i} className="border-t border-[rgb(var(--card-border))] hover:bg-white/[0.02]">
                      <td className="py-3 px-4 text-[rgb(var(--muted))] whitespace-nowrap">
                        {new Date(Number(r.timestamp) * 1000).toLocaleString()}
                      </td>
                      <td className="px-4 font-mono whitespace-nowrap">
                        <span className="text-[rgb(var(--muted))]">{POSITION_LABELS[r.from]}</span>
                        <span className="mx-1.5">→</span>
                        <span className="text-[rgb(var(--accent))]">{POSITION_LABELS[r.to]}</span>
                      </td>
                      <td className={`px-4 font-mono font-semibold ${positive ? "text-[rgb(var(--accent))]" : "text-[rgb(var(--muted))]"}`}>
                        {positive ? "+" : ""}{r.netYieldBps} bps
                      </td>
                      <td className="px-4 font-mono">{r.confidence}</td>
                      <td className="px-4">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-mono ${r.mode === 0 ? "tag-approved" : "tag-warn"}`}>
                          {DELEGATION_MODE_LABELS[r.mode]}
                        </span>
                      </td>
                      <td className="px-4 max-w-xs truncate">{r.reason}</td>
                      <td className="px-4 font-mono">
                        {r.batchTxHash !== "0x0000000000000000000000000000000000000000000000000000000000000000" ? (
                          <a
                            className="underline text-[rgb(var(--accent))]"
                            href={OKLINK_TX(r.batchTxHash)}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {r.batchTxHash.slice(0, 8)}…
                          </a>
                        ) : (
                          <span className="text-[rgb(var(--muted))]">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
