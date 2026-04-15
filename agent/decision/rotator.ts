/**
 * Gate + signal-smoothing logic sitting between `scorer.ts` and the executor.
 *
 * Four hard gates must pass for an autonomous rotation to fire:
 *   1. net_bps         >= YIELD_MIN_SPREAD_BPS
 *   2. confidence      >= MIN_CONFIDENCE_APPROVE
 *   3. seconds since last rotation >= COOLDOWN_SECONDS
 *   4. same target observed for DWELL_SECONDS worth of ticks (>=3 entries)
 *
 * Callers with `force=true` skip gates 3 and 4 (but never 1 and 2, and never
 * the firewall — this is for the manual `zetta-stream-action` skill).
 */
import { getConfig } from "../config.js";
import type { SignalTick } from "../state.js";
import type { Decision, DecisionOutcome, GateResult, YieldSignal } from "./types.js";
import { score } from "./scorer.js";

export interface ScoreAndGateInputs {
  signal: YieldSignal;
  currentPosition: "IDLE" | "AAVE" | "UNIV4";
  ring: SignalTick[];            // newest-first, owned by state.rotation.signalRingBuffer
  lastRotatedAtMs: number;
  now?: number;                   // unix ms, overridable for tests
  force?: boolean;
}

export interface ScoreAndGateResult extends DecisionOutcome {
  /// The ring buffer updated with the current tick (ready to persist).
  nextRing: SignalTick[];
}

const MAX_RING = 8;

export function scoreAndGate({
  signal,
  currentPosition,
  ring,
  lastRotatedAtMs,
  now = Date.now(),
  force = false,
}: ScoreAndGateInputs): ScoreAndGateResult {
  const cfg = getConfig();
  const decision: Decision = score({ signal, currentPosition });

  // Always update the ring; it's used by rotator *and* exposed via SSE.
  const nextRing: SignalTick[] = [
    { target: asPosition(decision.target, currentPosition), netBps: decision.netYieldBps, confidence: decision.confidence, ts: signal.ts },
    ...ring,
  ].slice(0, MAX_RING);

  // Hard gates that no caller can bypass.
  if (decision.target === "HOLD") {
    return { decision, gate: { pass: false, blockedBy: "spread", dwellProgress: 0, secondsUntilReady: 0 }, nextRing };
  }
  if (decision.confidence < cfg.MIN_CONFIDENCE_APPROVE) {
    return { decision, gate: { pass: false, blockedBy: "confidence", dwellProgress: 0, secondsUntilReady: 0 }, nextRing };
  }

  // `force` bypasses dwell + cooldown only.
  if (force) {
    return { decision, gate: { pass: true, dwellProgress: 3, secondsUntilReady: 0 }, nextRing };
  }

  // Cooldown gate.
  const cooldownReadyAt = lastRotatedAtMs + cfg.COOLDOWN_SECONDS * 1000;
  if (now < cooldownReadyAt) {
    return {
      decision,
      gate: {
        pass: false,
        blockedBy: "cooldown",
        dwellProgress: 0,
        secondsUntilReady: Math.ceil((cooldownReadyAt - now) / 1000),
      },
      nextRing,
    };
  }

  // Dwell gate — consecutive-agreement test.
  const progress = consecutiveAgree(nextRing, decision.target as "AAVE" | "UNIV4");
  const needed = Math.max(3, Math.ceil(cfg.DWELL_SECONDS / Math.max(1, cfg.POLL_INTERVAL_MS / 1000)));
  if (progress < needed) {
    return {
      decision,
      gate: {
        pass: false,
        blockedBy: "dwell",
        dwellProgress: progress,
        secondsUntilReady: 0,
      },
      nextRing,
    };
  }

  return { decision, gate: { pass: true, dwellProgress: progress, secondsUntilReady: 0 }, nextRing };
}

function consecutiveAgree(ring: SignalTick[], target: "AAVE" | "UNIV4"): number {
  let n = 0;
  for (const t of ring) {
    if (t.target === target) n += 1;
    else break;
  }
  return n;
}

function asPosition(target: Decision["target"], fallback: "IDLE" | "AAVE" | "UNIV4"): "IDLE" | "AAVE" | "UNIV4" {
  return target === "HOLD" ? fallback : target;
}
