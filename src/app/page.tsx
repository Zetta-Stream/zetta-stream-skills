import Link from "next/link";

const scenarios = [
  {
    id: "phishing",
    title: "1. Intent Firewall",
    hook: "Phishing rejection in <2 seconds",
    body:
      "A user approves USDC to a malicious vault. The firewall simulates, sees the draining deposit, and REJECTS before any tx hits mainnet. Verdict is written to X Layer.",
    tag: "Intent Firewall · okx-security · TEE",
  },
  {
    id: "gas-save",
    title: "2. EIP-7702 Batch",
    hook: "3 calls, 1 tx, ~58% less gas",
    body:
      "Swap + Approve + Stake packed into one X Layer transaction. Pectra path if available, Multicall fallback otherwise — either way, the UX and gas report are identical.",
    tag: "EIP-7702 · BatchCallDelegate · X Layer",
  },
  {
    id: "x402-cross",
    title: "3. x402 → Cross-chain",
    hook: "One $0.001 payment, 1,200+ price queries, then a cross-chain batch",
    body:
      "Open an x402 reusable session. Poll ETH at 500ms. On threshold, run the scorer + fire XLayer→Base Aave in a single batched tx. All three links land on X Layer audit.",
    tag: "x402 V2 · AggLayer · okx-dex-swap",
  },
];

export default function Home() {
  return (
    <div className="space-y-10">
      <section className="relative overflow-hidden rounded-2xl border border-[rgb(var(--card-border))] bg-black">
        <video
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          aria-hidden="true"
          className="absolute inset-0 h-full w-full object-cover opacity-45"
        >
          <source src="/internal-hub.mp4" type="video/mp4" />
        </video>
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-gradient-to-r from-black/85 via-black/55 to-black/10"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent"
        />
        <div className="relative z-10 p-8 md:p-14">
          <h1 className="text-4xl md:text-5xl font-semibold tracking-tight max-w-2xl">
            Web3&apos;s{" "}
            <span className="text-[rgb(var(--accent))]">Agentic Kernel</span>.
          </h1>
          <p className="mt-4 text-lg text-[rgb(var(--muted))] max-w-2xl">
            One sentence in, auditable on-chain outcome out. TEE-simulated · EIP-7702 batched · x402 intel-fed ·
            X Layer-audited.
          </p>
          <div className="mt-6 flex gap-3 flex-wrap">
            <Link
              href="/firewall"
              className="px-4 py-2 rounded-md bg-[rgb(var(--accent))] text-[rgb(var(--background))] font-medium hover:opacity-90"
            >
              Try the firewall
            </Link>
            <Link
              href="/audit"
              className="px-4 py-2 rounded-md border border-[rgb(var(--card-border))] bg-black/40 backdrop-blur-sm hover:border-[rgb(var(--accent))]"
            >
              See the audit trail
            </Link>
          </div>
        </div>
      </section>

      <section>
        <h2 className="text-2xl font-semibold mb-4">Three demo scenarios</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {scenarios.map((s) => (
            <div key={s.id} className="card p-5 flex flex-col gap-3">
              <div className="text-xs text-[rgb(var(--accent))] font-medium">{s.tag}</div>
              <div>
                <h3 className="text-lg font-semibold">{s.title}</h3>
                <div className="text-sm text-[rgb(var(--muted))]">{s.hook}</div>
              </div>
              <p className="text-sm leading-relaxed">{s.body}</p>
              <div className="mt-auto">
                <Link
                  href={`/firewall?scenario=${s.id}`}
                  className="text-sm text-[rgb(var(--accent))] hover:underline"
                >
                  Replay →
                </Link>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="card p-5">
        <h2 className="text-lg font-semibold">The 4 project skills</h2>
        <ul className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
          <li>
            <b>zetta-stream-action</b> — parse NL → simulate → risk-scan → batch-execute + audit
          </li>
          <li>
            <b>zetta-stream-analyze</b> — read-only verdict (what would happen if I ran this?)
          </li>
          <li>
            <b>zetta-stream-fund</b> — open an x402 session or bridge into X Layer
          </li>
          <li>
            <b>zetta-stream-monitor</b> — 24/7 watcher with x402-fed triggers
          </li>
        </ul>
      </section>
    </div>
  );
}
