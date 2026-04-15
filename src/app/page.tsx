import Image from "next/image";
import Link from "next/link";
import { createPublicClient, http } from "viem";
import { xLayer } from "viem/chains";
import {
  zettaStreamLogAbi,
  zettaStreamMedalAbi,
  POSITION_LABELS,
} from "@/lib/abi";
import {
  ZETTA_STREAM_LOG_ADDRESS,
  ZETTA_STREAM_MEDAL_ADDRESS,
  ZETTA_STREAM_DELEGATE_ADDRESS,
  XLAYER_RPC,
  OKLINK_ADDRESS,
  OKLINK_TX,
  ARBISCAN_ADDRESS,
  ARBISCAN_TX,
} from "@/lib/addresses";

export const revalidate = 30;  // re-fetch on-chain stats every 30s

const client = createPublicClient({ chain: xLayer, transport: http(XLAYER_RPC) });

const skills = [
  {
    id: "analyze",
    title: "zetta-stream-analyze",
    hook: "Preview a rotation without executing",
    body:
      "Pull the latest x402 yield signal, run the deterministic scorer, dry-run the firewall. Returns net APY in bps + per-call findings. Read-only — never broadcasts.",
    triggers: ["preview the yield stream", "should I rotate now?", "score the current signal"],
  },
  {
    id: "fund",
    title: "zetta-stream-fund",
    hook: "Open x402 session OR bridge USDC",
    body:
      "Pay $0.001 USDC on X Layer once → get a sessionId good for 1000 yield-feed queries. Or bridge USDC from Base/X Layer into Arbitrum so the agent has working capital.",
    triggers: ["open an x402 session", "fund zetta", "bridge USDC for zetta"],
  },
  {
    id: "action",
    title: "zetta-stream-action",
    hook: "Execute one rotation NOW",
    body:
      "Aave withdraw → swap → UniV4 mint-LP composed into a single EIP-7702 batch on Arbitrum. Audit lands on X Layer; if profit > 0 bps, a Medal NFT is minted.",
    triggers: ["rotate now", "flip to UniV4", "rebalance my stream"],
  },
  {
    id: "monitor",
    title: "zetta-stream-monitor",
    hook: "Start the autonomous loop",
    body:
      "60s tick: signal → score → gates (dwell + cooldown + confidence + spread). Hands-free until you stop it. Every step streams over SSE to the dashboard.",
    triggers: ["start the autonomous stream", "turn on zetta", "stop the stream"],
  },
];

const genesisTxs = [
  {
    label: "Deploy ZettaStreamLog",
    chain: "X Layer",
    hash: "0xc0b0b320ca0261f25e17ada9e676d78694dc057884493a2368c2f97fac12dd80",
    href: "xlayer",
  },
  {
    label: "Deploy ZettaStreamMedal",
    chain: "X Layer",
    hash: "0x2d7dd71f8776b0fdd08701af1e19e00ea7d7097638c6c13cc719425c4ddba24c",
    href: "xlayer",
  },
  {
    label: "Genesis rotation (AAVE→UNIV4 +85bps)",
    chain: "X Layer",
    hash: "0x0273779900d7e4c21060fe6a2afd90b6f7df4f635fc8620b3e0e7ea39932ac97",
    href: "xlayer",
  },
  {
    label: "Genesis Medal mint (tokenId=0)",
    chain: "X Layer",
    hash: "0x1e53c5c030a84ef3804a430aaa428234a97dc76a2d61ae06c6bb4a1b325321a1",
    href: "xlayer",
  },
  {
    label: "Deploy ZettaStreamDelegate",
    chain: "Arbitrum",
    hash: "0x89e92feecb288ea9320c4264d4f55ae2230d374a6c7415c87dd653cb07ffdc9d",
    href: "arbitrum",
  },
] as const;

async function fetchOnChainStats() {
  if (!ZETTA_STREAM_LOG_ADDRESS || !ZETTA_STREAM_MEDAL_ADDRESS) {
    return { rotations: null as bigint | null, medals: null as bigint | null };
  }
  try {
    const [rotations, medals] = await Promise.all([
      client.readContract({
        address: ZETTA_STREAM_LOG_ADDRESS,
        abi: zettaStreamLogAbi,
        functionName: "rotationCount",
      }),
      client.readContract({
        address: ZETTA_STREAM_MEDAL_ADDRESS,
        abi: zettaStreamMedalAbi,
        functionName: "totalSupply",
      }),
    ]);
    return { rotations, medals };
  } catch {
    return { rotations: null, medals: null };
  }
}

async function fetchRecentRotations() {
  if (!ZETTA_STREAM_LOG_ADDRESS) return [] as Array<RotationCard>;
  try {
    const rows = (await client.readContract({
      address: ZETTA_STREAM_LOG_ADDRESS,
      abi: zettaStreamLogAbi,
      functionName: "recent",
      args: [5n],
    })) as RotationRaw[];
    return rows.map((r): RotationCard => ({
      timestamp: Number(r.timestamp),
      from: POSITION_LABELS[r.from] ?? "?",
      to: POSITION_LABELS[r.to] ?? "?",
      netYieldBps: r.netYieldBps,
      confidence: r.confidence,
      reason: r.reason,
      mode: r.mode === 0 ? "EIP-7702" : "Multicall",
    }));
  } catch {
    return [];
  }
}

interface RotationRaw {
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

interface RotationCard {
  timestamp: number;
  from: string;
  to: string;
  netYieldBps: number;
  confidence: number;
  reason: string;
  mode: string;
}

export default async function Home() {
  const stats = await fetchOnChainStats();
  const recent = await fetchRecentRotations();
  return (
    <div className="space-y-12">
      {/* ─────────────────────── HERO ─────────────────────── */}
      <section className="relative overflow-hidden rounded-2xl border border-[rgb(var(--card-border))] bg-black">
        <video
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          aria-hidden="true"
          className="absolute inset-0 h-full w-full object-cover opacity-50"
        >
          <source src="/zetta-stream.mp4" type="video/mp4" />
        </video>
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-gradient-to-r from-black/85 via-black/55 to-black/30"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent"
        />

        <div className="relative z-10 p-8 md:p-14">
          <div className="font-mono text-xs uppercase tracking-[0.25em] text-[rgb(var(--accent))]">
            x402 V2 · EIP-7702 · TEE · MCP — fused
          </div>
          <h1 className="mt-4 text-4xl md:text-6xl font-semibold tracking-tight max-w-3xl leading-[1.05]">
            Self-driving{" "}
            <span className="text-[rgb(var(--accent))]">yield</span> for the agent economy.
          </h1>
          <p className="mt-5 text-lg text-[rgb(var(--muted))] max-w-2xl leading-relaxed">
            Zetta-Stream is an AI agent that rotates USDC between Aave V3 and Uniswap V4
            on Arbitrum, driven by paid x402 V2 yield signals. Every batch is byte-scanned
            in TEE before signing; every rotation lands on X Layer; every profitable
            rotation mints a Medal NFT.
          </p>

          {/* 3-Z logo treatment */}
          <div className="mt-8 max-w-xl">
            <Image
              src="/zetta-stream.png"
              alt="Zetta-Stream logo treatment — bold, outlined, animated stream variants"
              width={1376}
              height={768}
              priority
              className="rounded-md w-full h-auto"
            />
          </div>

          <div className="mt-7 flex gap-3 flex-wrap">
            <Link
              href="/audit"
              className="px-5 py-2.5 rounded-md bg-[rgb(var(--accent))] text-black font-medium hover:opacity-90 transition"
            >
              See live rotations
            </Link>
            <Link
              href="/medals"
              className="px-5 py-2.5 rounded-md border border-[rgb(var(--card-border))] bg-black/50 backdrop-blur-sm hover:border-[rgb(var(--accent))] transition"
            >
              Browse Medals
            </Link>
            <a
              href={OKLINK_ADDRESS(ZETTA_STREAM_LOG_ADDRESS)}
              target="_blank"
              rel="noopener noreferrer"
              className="px-5 py-2.5 rounded-md border border-[rgb(var(--card-border))] bg-black/50 backdrop-blur-sm hover:border-[rgb(var(--accent))] transition font-mono text-sm"
            >
              View on OKLink ↗
            </a>
          </div>
        </div>
      </section>

      {/* ─────────────────── LIVE ON-CHAIN STATS ─────────────────── */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard
          label="rotations on X Layer"
          value={stats.rotations?.toString() ?? "—"}
          sublabel="ZettaStreamLog.rotationCount()"
          accent
        />
        <StatCard
          label="Medals minted"
          value={stats.medals?.toString() ?? "—"}
          sublabel="ZettaStreamMedal.totalSupply()"
        />
        <StatCard
          label="Delegate allowlist"
          value="2 seed targets"
          sublabel="Aave V3 Pool · USDC · Arbitrum"
        />
      </section>

      {/* ─────────────────── RECENT ROTATIONS ─────────────────── */}
      <section>
        <div className="flex items-baseline justify-between mb-4">
          <h2 className="text-2xl font-semibold tracking-tight">
            Recent rotations
          </h2>
          <Link
            href="/audit"
            className="text-sm text-[rgb(var(--accent))] hover:underline font-mono"
          >
            full ledger →
          </Link>
        </div>
        {recent.length === 0 ? (
          <div className="card p-6 text-sm text-[rgb(var(--muted))]">
            no rotations on-chain yet — check back when the autonomous loop fires.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {recent.map((r, i) => (
              <RotationCardView key={i} r={r} />
            ))}
          </div>
        )}
      </section>

      {/* ─────────────────── 4 SKILLS ─────────────────── */}
      <section>
        <h2 className="text-2xl font-semibold tracking-tight mb-2">
          Four Claude skills, one autonomous rotator
        </h2>
        <p className="text-sm text-[rgb(var(--muted))] mb-5 max-w-2xl">
          Speak to the agent in natural language. Claude routes your message to the
          right skill via trigger phrases, then POSTs structured JSON to the agent
          API on <code className="font-mono text-xs">localhost:7777</code>.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {skills.map((s) => (
            <div
              key={s.id}
              className="card p-5 flex flex-col gap-3 hover:border-[rgb(var(--accent))]/50 transition"
            >
              <div className="font-mono text-xs text-[rgb(var(--accent))]">{s.title}</div>
              <div className="text-base font-medium">{s.hook}</div>
              <p className="text-sm leading-relaxed text-[rgb(var(--muted))]">{s.body}</p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {s.triggers.map((t) => (
                  <span
                    key={t}
                    className="font-mono text-[10px] px-2 py-0.5 rounded border border-[rgb(var(--card-border))] text-[rgb(var(--muted))]"
                  >
                    “{t}”
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ─────────────────── CONTRACT ADDRESSES ─────────────────── */}
      <section className="card p-6 space-y-4">
        <h2 className="text-lg font-semibold tracking-tight">
          Deployed contracts
        </h2>
        <ContractRow
          label="ZettaStreamLog"
          chain="X Layer (196)"
          address={ZETTA_STREAM_LOG_ADDRESS}
          href={OKLINK_ADDRESS(ZETTA_STREAM_LOG_ADDRESS)}
        />
        <ContractRow
          label="ZettaStreamMedal"
          chain="X Layer (196)"
          address={ZETTA_STREAM_MEDAL_ADDRESS}
          href={OKLINK_ADDRESS(ZETTA_STREAM_MEDAL_ADDRESS)}
        />
        <ContractRow
          label="ZettaStreamDelegate"
          chain="Arbitrum (42161)"
          address={ZETTA_STREAM_DELEGATE_ADDRESS}
          href={ARBISCAN_ADDRESS(ZETTA_STREAM_DELEGATE_ADDRESS)}
        />
      </section>

      {/* ─────────────────── GENESIS TX EVIDENCE ─────────────────── */}
      <section>
        <h2 className="text-lg font-semibold tracking-tight mb-3">
          Genesis on-chain evidence
        </h2>
        <div className="card divide-y divide-[rgb(var(--card-border))]">
          {genesisTxs.map((t) => (
            <a
              key={t.hash}
              href={t.href === "xlayer" ? OKLINK_TX(t.hash) : ARBISCAN_TX(t.hash)}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between px-5 py-3 hover:bg-white/[0.03] transition"
            >
              <div>
                <div className="text-sm">{t.label}</div>
                <div className="font-mono text-[10px] text-[rgb(var(--muted))]">
                  {t.chain} · {t.hash.slice(0, 12)}…{t.hash.slice(-6)}
                </div>
              </div>
              <span className="text-[rgb(var(--accent))] font-mono text-xs">↗</span>
            </a>
          ))}
        </div>
      </section>
    </div>
  );
}

/* ───────────────────────── small components ───────────────────────── */

function StatCard({
  label,
  value,
  sublabel,
  accent,
}: {
  label: string;
  value: string;
  sublabel: string;
  accent?: boolean;
}) {
  return (
    <div className="card p-5">
      <div className="font-mono text-[11px] uppercase tracking-wider text-[rgb(var(--muted))]">
        {label}
      </div>
      <div
        className={`mt-2 text-3xl font-semibold tabular-nums ${
          accent ? "text-[rgb(var(--accent))]" : ""
        }`}
      >
        {value}
      </div>
      <div className="mt-1 font-mono text-[10px] text-[rgb(var(--muted))]">
        {sublabel}
      </div>
    </div>
  );
}

function RotationCardView({ r }: { r: RotationCard }) {
  const positive = r.netYieldBps >= 0;
  return (
    <div className="card p-4 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <div className="font-mono text-sm">
          <span className="text-[rgb(var(--muted))]">{r.from}</span>
          <span className="mx-2">→</span>
          <span className="text-[rgb(var(--accent))]">{r.to}</span>
        </div>
        <div
          className={`font-mono text-sm font-semibold ${
            positive ? "text-[rgb(var(--accent))]" : "text-[rgb(var(--muted))]"
          }`}
        >
          {positive ? "+" : ""}
          {r.netYieldBps} bps
        </div>
      </div>
      <div className="text-xs text-[rgb(var(--muted))] line-clamp-2">{r.reason}</div>
      <div className="font-mono text-[10px] text-[rgb(var(--muted))] flex gap-3">
        <span>{r.mode}</span>
        <span>conf {r.confidence}</span>
        <span>{new Date(r.timestamp * 1000).toLocaleString()}</span>
      </div>
    </div>
  );
}

function ContractRow({
  label,
  chain,
  address,
  href,
}: {
  label: string;
  chain: string;
  address: string;
  href: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <div className="text-sm">{label}</div>
        <div className="font-mono text-[10px] text-[rgb(var(--muted))]">{chain}</div>
      </div>
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="font-mono text-xs text-[rgb(var(--accent))] hover:underline truncate max-w-[55%] text-right"
      >
        {address || "(not deployed)"}
      </a>
    </div>
  );
}
