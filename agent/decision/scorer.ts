/**
 * Deterministic scoring formula — no ML, all integer bps math.
 *
 *     gross_spread_bps = (target_apr - current_apr) * 10000
 *     il_penalty_bps   = target == UNIV4 ? round(ilRisk * 400) : 0
 *     gas_cost_bps     = round(ESTIMATED_GAS_USD / NOTIONAL_USD * 10000)
 *     confidence_mult  = signal.confidence / 100
 *     net_bps          = round((gross - il - gas) * confidence_mult)
 *
 * Picks the target that maximizes positive `net_bps`; returns `HOLD` when all
 * candidates are below `YIELD_MIN_SPREAD_BPS`. This is the core innovation —
 * every rotation the agent commits on-chain is traceable back to this file.
 */
import { getConfig } from "../config.js";
import type { Position } from "../state.js";
import type { Decision, DecisionTarget, YieldSignal } from "./types.js";

export interface ScoreInputs {
  signal: YieldSignal;
  currentPosition: Position;
  /// Optional overrides (mainly for analyze-preview tuning).
  overrides?: Partial<{
    gasUsd: number;
    notionalUsd: number;
    minSpreadBps: number;
  }>;
}

export function score({ signal, currentPosition, overrides }: ScoreInputs): Decision {
  const cfg = getConfig();
  const gasUsd = overrides?.gasUsd ?? cfg.ESTIMATED_GAS_USD;
  const notionalUsd = overrides?.notionalUsd ?? cfg.NOTIONAL_USD;
  const minSpread = overrides?.minSpreadBps ?? cfg.YIELD_MIN_SPREAD_BPS;

  const gasCostBps = Math.round((gasUsd / notionalUsd) * 10_000);
  const confMult = signal.confidence / 100;

  const candidates: { target: DecisionTarget; netBps: number; rawNetBps: number; grossSpreadBps: number; ilPenaltyBps: number }[] = [];

  // --- candidate: rotate to AAVE (or stay if already there) ---
  if (currentPosition !== "AAVE") {
    const gross = Math.round((signal.aavePoolApy - signal.uniFeeApr) * 10_000);
    const raw = gross - gasCostBps;                      // no IL when entering Aave
    candidates.push({
      target: "AAVE",
      grossSpreadBps: gross,
      ilPenaltyBps: 0,
      rawNetBps: raw,
      netBps: Math.round(raw * confMult),
    });
  }

  // --- candidate: rotate to UNIV4 (or stay if already there) ---
  if (currentPosition !== "UNIV4") {
    const gross = Math.round((signal.uniFeeApr - signal.aavePoolApy) * 10_000);
    const il = Math.round(signal.ilRisk * 400);
    const raw = gross - il - gasCostBps;
    candidates.push({
      target: "UNIV4",
      grossSpreadBps: gross,
      ilPenaltyBps: il,
      rawNetBps: raw,
      netBps: Math.round(raw * confMult),
    });
  }

  // Pick the best-scoring target. If none clears the minimum spread, HOLD.
  candidates.sort((a, b) => b.netBps - a.netBps);
  const best = candidates[0];
  const hold = !best || best.netBps < minSpread;

  const targetPos: Position = hold ? currentPosition : (best.target as Position);
  const reason = hold
    ? buildHoldReason(currentPosition, best?.netBps ?? 0, minSpread)
    : buildRotateReason(best.target, best.grossSpreadBps, best.ilPenaltyBps);

  return {
    target: hold ? "HOLD" : best.target,
    currentPosition,
    grossSpreadBps: best?.grossSpreadBps ?? 0,
    ilPenaltyBps: best?.ilPenaltyBps ?? 0,
    gasCostBps,
    rawNetBps: best?.rawNetBps ?? 0,
    netYieldBps: best?.netBps ?? 0,
    confidence: Math.round(signal.confidence),
    score: clampScore(best?.netBps ?? 0),
    reason: reason.slice(0, 140),
  };
}

function buildRotateReason(target: DecisionTarget, grossBps: number, ilBps: number): string {
  const sign = grossBps >= 0 ? "+" : "";
  if (target === "UNIV4") {
    return `rotate to UniV4: ${sign}${grossBps}bps gross fee spread, -${ilBps}bps IL`;
  }
  if (target === "AAVE") {
    return `rotate to Aave: ${sign}${grossBps}bps spread, zero IL`;
  }
  return "hold";
}

function buildHoldReason(currentPosition: Position, bestBps: number, minSpread: number): string {
  if (currentPosition === "IDLE") {
    return `idle: best candidate ${bestBps}bps < ${minSpread}bps threshold`;
  }
  return `hold ${currentPosition}: best rotation ${bestBps}bps < ${minSpread}bps threshold`;
}

function clampScore(netBps: number): number {
  // Map -100..+100 bps onto 0..100 for UI.
  const s = Math.round((netBps + 100) / 2);
  if (s < 0) return 0;
  if (s > 100) return 100;
  return s;
}
