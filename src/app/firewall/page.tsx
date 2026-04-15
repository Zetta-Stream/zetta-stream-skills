"use client";
import { useEffect, useState } from "react";
import { useAgentSse } from "@/hooks/use-sse";
import { OKLINK_TX } from "@/lib/addresses";
import {
  runMockScenario,
  runMockAnalyze,
  runMockIntent,
  type MockEvent,
  type MockVerdict,
  type ScenarioId,
} from "@/lib/mock-pipeline";

const DEMO_BUTTONS: Array<{ id: ScenarioId; label: string }> = [
  { id: "phishing", label: "Replay: Phishing rejection" },
  { id: "gas-save", label: "Replay: EIP-7702 batch" },
  { id: "x402-cross", label: "Replay: x402 → cross-chain" },
];

export default function FirewallPage() {
  const sseEvents = useAgentSse(60);
  const [mockEvents, setMockEvents] = useState<MockEvent[]>([]);
  const events = [...mockEvents, ...sseEvents].slice(0, 140);

  const [raw, setRaw] = useState<string>(
    JSON.stringify(
      {
        kind: "BATCH",
        owner: "0x13A7D19aD9de11fe1c6Eb9a9A093BB535A88f143",
        steps: [
          { op: "DEPOSIT", chainId: 196, to: "TEST_VAULT", token: "USDC", amount: "0.1" },
          { op: "DEPOSIT", chainId: 196, to: "TEST_VAULT", token: "USDC", amount: "0.2" },
          { op: "DEPOSIT", chainId: 196, to: "TEST_VAULT", token: "USDC", amount: "0.3" },
        ],
        options: { tag: "[UI]" },
      },
      null,
      2,
    ),
  );
  const [result, setResult] = useState<MockVerdict | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function pushEvent(ev: MockEvent) {
    setMockEvents((prev) => [{ ...ev, t: Date.now() }, ...prev].slice(0, 100));
  }

  async function runMock(kind: "scenario" | "analyze" | "intent", scenarioId?: ScenarioId) {
    setBusy(true);
    setError(null);
    setResult(null);
    setMockEvents([]);
    try {
      let r: MockVerdict;
      if (kind === "scenario" && scenarioId) r = await runMockScenario(scenarioId, pushEvent);
      else if (kind === "analyze") r = await runMockAnalyze(raw, pushEvent);
      else r = await runMockIntent(raw, pushEvent);
      setResult(r);
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  }

  // Auto-trigger a scenario if arriving from the landing page with ?scenario=…
  useEffect(() => {
    if (typeof window === "undefined") return;
    const sp = new URLSearchParams(window.location.search);
    const sid = sp.get("scenario") as ScenarioId | null;
    if (sid && DEMO_BUTTONS.some((b) => b.id === sid)) {
      runMock("scenario", sid);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <section className="space-y-4">
        <div className="card p-4">
          <h2 className="text-lg font-semibold">Intent input</h2>
          <p className="text-xs text-[rgb(var(--muted))] mt-1">
            Paste an IntentJSON. <b>Analyze</b> is read-only; <b>Run</b> fires the full pipeline. Demo mode:
            both run against a local mock that plays back the same sequence the agent would produce.
          </p>
          <textarea
            className="mono mt-3 w-full h-64 bg-[rgb(var(--background))] border border-[rgb(var(--card-border))] rounded p-3 text-xs"
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
          />
          <div className="flex flex-wrap gap-2 mt-3">
            <button
              onClick={() => runMock("analyze")}
              disabled={busy}
              className="px-3 py-1.5 rounded border border-[rgb(var(--card-border))] text-sm hover:border-[rgb(var(--accent))] disabled:opacity-50"
            >
              Analyze (read-only)
            </button>
            <button
              onClick={() => runMock("intent")}
              disabled={busy}
              className="px-3 py-1.5 rounded bg-[rgb(var(--accent))] text-[rgb(var(--background))] text-sm font-medium disabled:opacity-50"
            >
              Run (full pipeline)
            </button>
          </div>
        </div>
        <div className="card p-4">
          <h3 className="text-sm font-semibold">Demo scenarios</h3>
          <p className="text-xs text-[rgb(var(--muted))] mt-1">
            Each replay animates a realistic event timeline and links to the matching X Layer tx on OKLink.
          </p>
          <div className="flex flex-wrap gap-2 mt-3">
            {DEMO_BUTTONS.map((b) => (
              <button
                key={b.id}
                onClick={() => runMock("scenario", b.id)}
                disabled={busy}
                className="px-3 py-1.5 rounded border border-[rgb(var(--card-border))] text-xs hover:border-[rgb(var(--accent))] disabled:opacity-50"
              >
                {b.label}
              </button>
            ))}
          </div>
        </div>
        <VerdictPanel result={result} error={error} busy={busy} />
      </section>

      <section className="card p-4 h-[720px] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Live event stream</h2>
          <span className="text-xs text-[rgb(var(--muted))]">{events.length} events</span>
        </div>
        <div className="mt-3 flex-1 overflow-auto space-y-2 text-xs mono">
          {events.length === 0 && (
            <div className="text-[rgb(var(--muted))] text-center mt-8">
              Click a demo button or press <b>Run</b> to see the pipeline play back.
            </div>
          )}
          {events.map((ev, i) => (
            <div key={i} className={`event-line ${lineClass(ev.type)}`}>
              <span className="text-[rgb(var(--muted))] mr-2">[{ev.type}]</span>
              {renderLine(ev)}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function lineClass(type: string): string {
  if (type === "poll") return "poll";
  if (type === "fire") return "fire";
  if (type === "verdict") return "verdict";
  if (type === "error") return "error";
  if (type === "sim") return "poll";
  if (type === "scan") return "poll";
  if (type === "plan") return "verdict";
  if (type === "intent") return "verdict";
  return "";
}

function renderLine(ev: Record<string, unknown>): React.ReactNode {
  if (ev.type === "poll") {
    return (
      <>
        {String(ev.symbol)} = <b>{Number(ev.price).toFixed(2)}</b>{" "}
        <span className="text-[rgb(var(--muted))]">({String(ev.latencyMs)}ms)</span>
      </>
    );
  }
  if (ev.type === "fire") {
    const parts: string[] = [];
    if (ev.condition) parts.push(`cond ${String(ev.condition)}`);
    if (ev.price !== undefined) parts.push(`@ ${String(ev.price)}`);
    if (ev.mode) parts.push(`mode ${String(ev.mode)}`);
    if (ev.note) parts.push(String(ev.note));
    return <>fire — {parts.join(" · ")}</>;
  }
  if (ev.type === "plan") {
    return (
      <>
        step <b>{String(ev.step)}</b> → {String(ev.label)}
      </>
    );
  }
  if (ev.type === "sim") {
    const ok = ev.result === "ok";
    return (
      <>
        step <b>{String(ev.step)}</b> sim ={" "}
        <span className={ok ? "text-[rgb(var(--accent))]" : "text-[rgb(var(--accent-reject))]"}>
          {String(ev.result)}
        </span>
        {ev.note ? <span className="text-[rgb(var(--muted))]"> · {String(ev.note)}</span> : null}
      </>
    );
  }
  if (ev.type === "scan") {
    return (
      <>
        step <b>{String(ev.step)}</b> scan ={" "}
        <span className="text-[rgb(var(--accent))]">{String(ev.action)}</span>
        {ev.note ? <span className="text-[rgb(var(--muted))]"> · {String(ev.note)}</span> : null}
      </>
    );
  }
  if (ev.type === "verdict") {
    const hash = ev.hash as string | undefined;
    return (
      <>
        verdict={" "}
        <span className={`px-1.5 py-0.5 rounded tag-${String(ev.verdict).toLowerCase()}`}>
          {String(ev.verdict)}
        </span>{" "}
        conf={String(ev.confidence)}
        {hash && (
          <>
            {" "}
            tx=
            <a href={OKLINK_TX(hash)} target="_blank" rel="noreferrer" className="underline">
              {hash.slice(0, 10)}…
            </a>
          </>
        )}
      </>
    );
  }
  if (ev.type === "intent") {
    return (
      <>
        intent accepted{" "}
        {ev.kind ? <span className="text-[rgb(var(--muted))]">kind={String(ev.kind)}</span> : null}
        {ev.steps !== undefined ? (
          <span className="text-[rgb(var(--muted))]"> steps={String(ev.steps)}</span>
        ) : null}
      </>
    );
  }
  if (ev.type === "error") {
    return <>error: {String(ev.error)}</>;
  }
  if (ev.type === "heartbeat") {
    return <span className="text-[rgb(var(--muted))]">hb @ {new Date(Number(ev.t)).toLocaleTimeString()}</span>;
  }
  return <>{JSON.stringify(ev)}</>;
}

function VerdictPanel({
  result,
  error,
  busy,
}: {
  result: MockVerdict | null;
  error: string | null;
  busy: boolean;
}) {
  if (busy) return <div className="card p-4 text-sm text-[rgb(var(--muted))]">Running pipeline…</div>;
  if (error) return <div className="card p-4 text-sm text-[rgb(var(--accent-reject))]">{error}</div>;
  if (!result) return null;
  const r = result;
  return (
    <div className="card p-4 space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-sm text-[rgb(var(--muted))]">verdict</span>
        <span className={`px-2 py-1 rounded text-xs font-semibold tag-${String(r.verdict ?? "").toLowerCase()}`}>
          {r.verdict ?? "?"}
        </span>
        {r.confidence !== undefined && (
          <span className="text-xs text-[rgb(var(--muted))]">conf {r.confidence}</span>
        )}
        {r.mode && (
          <span className="text-xs ml-auto text-[rgb(var(--accent-exec))]">mode {r.mode}</span>
        )}
      </div>
      {r.reason && <div className="text-sm">{r.reason}</div>}
      {r.plan?.callCount !== undefined && (
        <div className="text-xs text-[rgb(var(--muted))]">
          plan: {r.plan.callCount} calls{" "}
          {r.plan.labels?.length ? `(${r.plan.labels.join(" → ")})` : ""}
        </div>
      )}
      {r.gasSavedPct !== undefined && (
        <div className="text-xs text-[rgb(var(--accent))]">
          gas saved vs baseline: {r.gasSavedPct.toFixed(1)}%
        </div>
      )}
      {r.hash && (
        <div className="text-xs">
          batch tx:{" "}
          <a className="underline" href={OKLINK_TX(r.hash)} target="_blank" rel="noreferrer">
            {r.hash}
          </a>
        </div>
      )}
      {r.auditTx && (
        <div className="text-xs">
          audit tx:{" "}
          <a className="underline" href={OKLINK_TX(r.auditTx)} target="_blank" rel="noreferrer">
            {r.auditTx}
          </a>
        </div>
      )}
      {r.findings && r.findings.length > 0 && (
        <div className="text-xs space-y-1 mt-2">
          <div className="font-semibold">Findings</div>
          {r.findings.map((f, i) => (
            <div
              key={i}
              className={`mono event-line ${
                f.level === "block" ? "error" : f.level === "warn" ? "fire" : "poll"
              }`}
            >
              [step {f.step}] {f.level}: {f.message}
            </div>
          ))}
        </div>
      )}
      {r.mocked && (
        <div className="mt-3 text-[10px] uppercase tracking-wider text-[rgb(var(--muted))] border-t border-[rgb(var(--card-border))] pt-2">
          note: some hashes in this scenario are mocked (bridge/aave legs not yet run end-to-end); audit tx on
          X Layer is real.
        </div>
      )}
    </div>
  );
}
