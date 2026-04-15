"use client";
import { useReadContract } from "wagmi";
import { zettaStreamLogAbi, VERDICT_LABELS, DELEGATION_MODE_LABELS } from "@/lib/abi";
import { ZETTA_STREAM_LOG_ADDRESS, OKLINK_ADDRESS, OKLINK_TX } from "@/lib/addresses";

export default function AuditPage() {
  const addrReady = ZETTA_STREAM_LOG_ADDRESS && ZETTA_STREAM_LOG_ADDRESS.length === 42;

  const { data: count } = useReadContract({
    abi: zettaStreamLogAbi,
    address: addrReady ? ZETTA_STREAM_LOG_ADDRESS : undefined,
    functionName: "entryCount",
    query: { enabled: addrReady },
  });

  const { data: entries } = useReadContract({
    abi: zettaStreamLogAbi,
    address: addrReady ? ZETTA_STREAM_LOG_ADDRESS : undefined,
    functionName: "recent",
    args: [50n],
    query: { enabled: addrReady },
  });

  const { data: delegations } = useReadContract({
    abi: zettaStreamLogAbi,
    address: addrReady ? ZETTA_STREAM_LOG_ADDRESS : undefined,
    functionName: "recentDelegations",
    args: [20n],
    query: { enabled: addrReady },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="text-3xl font-semibold">Audit trail</h1>
          <p className="text-sm text-[rgb(var(--muted))] mt-1">
            Every intent verdict + EIP-7702 delegation written to ZettaStreamLog on X Layer.
          </p>
        </div>
        <div className="text-xs text-[rgb(var(--muted))]">
          {addrReady ? (
            <>
              Contract:{" "}
              <a
                className="underline"
                href={OKLINK_ADDRESS(ZETTA_STREAM_LOG_ADDRESS)}
                target="_blank"
                rel="noreferrer"
              >
                {ZETTA_STREAM_LOG_ADDRESS}
              </a>
              {count !== undefined && <> · entries: {String(count)}</>}
            </>
          ) : (
            <>Set NEXT_PUBLIC_ZETTA_STREAM_LOG_ADDRESS after `pnpm contracts:deploy`.</>
          )}
        </div>
      </div>

      <section className="card p-4">
        <h2 className="text-lg font-semibold mb-3">Recent verdicts</h2>
        {!addrReady && (
          <div className="text-sm text-[rgb(var(--muted))]">
            Deploy the contract and set the address to see live data.
          </div>
        )}
        {addrReady && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-[rgb(var(--muted))] text-left">
                <tr>
                  <th className="py-2 pr-4">when</th>
                  <th className="pr-4">owner</th>
                  <th className="pr-4">verdict</th>
                  <th className="pr-4">conf</th>
                  <th className="pr-4">gasSaved</th>
                  <th className="pr-4">reason</th>
                  <th className="pr-4">txs</th>
                </tr>
              </thead>
              <tbody>
                {(entries as Entry[] | undefined)?.map((e, i) => (
                  <tr key={i} className="border-t border-[rgb(var(--card-border))]">
                    <td className="py-2 pr-4 text-[rgb(var(--muted))]">
                      {new Date(Number(e.timestamp) * 1000).toLocaleString()}
                    </td>
                    <td className="pr-4 mono">{e.owner.slice(0, 8)}…</td>
                    <td className="pr-4">
                      <span className={`px-2 py-0.5 rounded tag-${VERDICT_LABELS[e.verdict].toLowerCase()}`}>
                        {VERDICT_LABELS[e.verdict]}
                      </span>
                    </td>
                    <td className="pr-4">{e.confidence}</td>
                    <td className="pr-4">{e.gasSaved ? `${(e.gasSaved / 1000).toFixed(1)}%` : "-"}</td>
                    <td className="pr-4 max-w-xs truncate">{e.reason}</td>
                    <td className="pr-4 mono">
                      {e.txHashes.map((h, j) => (
                        <a
                          key={j}
                          className="underline mr-2"
                          href={OKLINK_TX(h)}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {h.slice(0, 8)}…
                        </a>
                      ))}
                    </td>
                  </tr>
                ))}
                {(entries as Entry[] | undefined)?.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-6 text-center text-[rgb(var(--muted))]">
                      No entries yet. Fire an intent from{" "}
                      <a href="/firewall" className="underline text-[rgb(var(--accent))]">
                        /firewall
                      </a>
                      .
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card p-4">
        <h2 className="text-lg font-semibold mb-3">Recent EIP-7702 delegations</h2>
        {addrReady && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-[rgb(var(--muted))] text-left">
                <tr>
                  <th className="py-2 pr-4">when</th>
                  <th className="pr-4">eoa</th>
                  <th className="pr-4">delegate</th>
                  <th className="pr-4">mode</th>
                  <th className="pr-4">authTx</th>
                  <th className="pr-4">revoked</th>
                </tr>
              </thead>
              <tbody>
                {(delegations as Delegation[] | undefined)?.map((d, i) => (
                  <tr key={i} className="border-t border-[rgb(var(--card-border))]">
                    <td className="py-2 pr-4 text-[rgb(var(--muted))]">
                      {new Date(Number(d.timestamp) * 1000).toLocaleString()}
                    </td>
                    <td className="pr-4 mono">{d.eoa.slice(0, 8)}…</td>
                    <td className="pr-4 mono">{d.delegate.slice(0, 8)}…</td>
                    <td className="pr-4">
                      <span
                        className={`px-2 py-0.5 rounded ${
                          d.mode === 0 ? "tag-approved" : "tag-warn"
                        }`}
                      >
                        {DELEGATION_MODE_LABELS[d.mode]}
                      </span>
                    </td>
                    <td className="pr-4 mono">
                      <a
                        className="underline"
                        href={OKLINK_TX(d.authTxHash)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {d.authTxHash.slice(0, 8)}…
                      </a>
                    </td>
                    <td className="pr-4">{d.revoked ? "yes" : "no"}</td>
                  </tr>
                ))}
                {(delegations as Delegation[] | undefined)?.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-6 text-center text-[rgb(var(--muted))]">
                      No delegations yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

type Entry = {
  timestamp: bigint;
  owner: `0x${string}`;
  agent: `0x${string}`;
  intentHash: `0x${string}`;
  verdict: 0 | 1 | 2 | 3;
  confidence: number;
  gasSaved: number;
  txHashes: `0x${string}`[];
  reason: string;
};

type Delegation = {
  timestamp: bigint;
  eoa: `0x${string}`;
  delegate: `0x${string}`;
  chainId: bigint;
  authTxHash: `0x${string}`;
  mode: 0 | 1;
  revoked: boolean;
};
