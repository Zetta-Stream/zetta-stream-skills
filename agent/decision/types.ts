/**
 * Decision-engine types. Schemas double as runtime validators for the x402 feed
 * and the /analyze + /rotate responses.
 */
import { z } from "zod";

export const positionSchema = z.enum(["IDLE", "AAVE", "UNIV4"]);
export type DecisionPosition = z.infer<typeof positionSchema>;

/// Shape returned by the x402 yield-feed (mock or real).
export const yieldSignalSchema = z.object({
  aavePoolApy: z.number().min(0).max(2),       // 0.031 = 3.1% APY
  uniFeeApr: z.number().min(0).max(2),         // concentrated-LP annualized fee APR
  ilRisk: z.number().min(0).max(1),            // 0 = no IL risk, 1 = guaranteed IL bigger than fees
  confidence: z.number().min(0).max(100),      // integer recommended
  ts: z.number().int(),
  source: z.enum(["x402", "cache", "fixture"]).default("x402"),
});
export type YieldSignal = z.infer<typeof yieldSignalSchema>;

export type DecisionTarget = "HOLD" | "AAVE" | "UNIV4";

/// Full scorer output — self-describing so `/analyze` can expose every intermediate.
export interface Decision {
  target: DecisionTarget;
  currentPosition: DecisionPosition;
  grossSpreadBps: number;
  ilPenaltyBps: number;
  gasCostBps: number;
  rawNetBps: number;           // before confidence multiplier
  netYieldBps: number;         // signed, after IL + gas + confidence
  confidence: number;          // 0-100
  score: number;               // UI-friendly 0-100 bar
  reason: string;              // human-readable, <=140 bytes
}

export interface GateResult {
  pass: boolean;
  /// Which hard-gate blocked the rotation (undefined when pass = true).
  blockedBy?: "spread" | "confidence" | "cooldown" | "dwell";
  dwellProgress: number;      // 0..3 — how many consecutive ticks agree
  secondsUntilReady: number;  // time until the cooldown gate would open; 0 if open
}

/// Combined — what `scoreAndGate()` returns.
export interface DecisionOutcome {
  decision: Decision;
  gate: GateResult;
}

export const analyzeResponseSchema = z.object({
  signal: yieldSignalSchema.nullable(),
  decision: z.custom<Decision>(),
  gate: z.custom<GateResult>(),
});
export type AnalyzeResponse = z.infer<typeof analyzeResponseSchema>;
