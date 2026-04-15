import { describe, it, expect, beforeEach } from "vitest";
import { resetConfig } from "../config.js";
import { score } from "./scorer.js";

beforeEach(() => {
  process.env.YIELD_MIN_SPREAD_BPS = "30";
  process.env.ESTIMATED_GAS_USD = "0.50";
  process.env.NOTIONAL_USD = "200";
  resetConfig();
});

describe("scorer.score", () => {
  it("chooses UNIV4 when fee APR is well above Aave and IL is modest", () => {
    const d = score({
      signal: { aavePoolApy: 0.031, uniFeeApr: 0.055, ilRisk: 0.2, confidence: 80, ts: 0, source: "fixture" },
      currentPosition: "AAVE",
    });
    // gross = (0.055 - 0.031) * 10000 = 240
    // il = round(0.2 * 400) = 80
    // gas = round(0.5 / 200 * 10000) = 25
    // raw = 240 - 80 - 25 = 135
    // net = round(135 * 0.8) = 108
    expect(d.target).toBe("UNIV4");
    expect(d.grossSpreadBps).toBe(240);
    expect(d.ilPenaltyBps).toBe(80);
    expect(d.gasCostBps).toBe(25);
    expect(d.netYieldBps).toBe(108);
    expect(d.confidence).toBe(80);
    expect(d.score).toBeGreaterThan(50);
  });

  it("HOLDs when the best candidate clears no min spread", () => {
    const d = score({
      signal: { aavePoolApy: 0.040, uniFeeApr: 0.042, ilRisk: 0.3, confidence: 90, ts: 0, source: "fixture" },
      currentPosition: "AAVE",
    });
    // UniV4 gross 20, il 120 → raw -125 -> net ~-113 → not min_spread-clearing
    expect(d.target).toBe("HOLD");
    expect(d.reason).toMatch(/hold/i);
  });

  it("rotates back to AAVE when Aave APR jumps above UniV4 fees", () => {
    const d = score({
      signal: { aavePoolApy: 0.055, uniFeeApr: 0.030, ilRisk: 0.4, confidence: 90, ts: 0, source: "fixture" },
      currentPosition: "UNIV4",
    });
    expect(d.target).toBe("AAVE");
    expect(d.ilPenaltyBps).toBe(0); // AAVE has no IL penalty
  });

  it("scales net down linearly with confidence", () => {
    const base = {
      signal: { aavePoolApy: 0.031, uniFeeApr: 0.055, ilRisk: 0.2, confidence: 100, ts: 0, source: "fixture" as const },
      currentPosition: "AAVE" as const,
    };
    const full = score(base);
    const half = score({ ...base, signal: { ...base.signal, confidence: 50 } });
    expect(half.netYieldBps).toBeLessThan(full.netYieldBps);
    // half confidence → ~half the net
    expect(Math.abs(half.netYieldBps * 2 - full.netYieldBps)).toBeLessThanOrEqual(2);
  });

  it("honours minSpreadBps override", () => {
    const d = score({
      signal: { aavePoolApy: 0.031, uniFeeApr: 0.055, ilRisk: 0.2, confidence: 80, ts: 0, source: "fixture" },
      currentPosition: "AAVE",
      overrides: { minSpreadBps: 200 },
    });
    // net 108 < override 200 → HOLD despite positive spread
    expect(d.target).toBe("HOLD");
  });

  it("reason string stays within 140 bytes", () => {
    const d = score({
      signal: { aavePoolApy: 0.031, uniFeeApr: 0.055, ilRisk: 0.2, confidence: 80, ts: 0, source: "fixture" },
      currentPosition: "AAVE",
    });
    expect(d.reason.length).toBeLessThanOrEqual(140);
  });

  it("IDLE → AAVE with zero IL penalty", () => {
    const d = score({
      signal: { aavePoolApy: 0.055, uniFeeApr: 0.020, ilRisk: 0.0, confidence: 90, ts: 0, source: "fixture" },
      currentPosition: "IDLE",
    });
    expect(d.target).toBe("AAVE");
    expect(d.ilPenaltyBps).toBe(0);
  });
});
