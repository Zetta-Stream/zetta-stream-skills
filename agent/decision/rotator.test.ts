import { describe, it, expect, beforeEach } from "vitest";
import { resetConfig } from "../config.js";
import type { SignalTick } from "../state.js";
import type { YieldSignal } from "./types.js";
import { scoreAndGate } from "./rotator.js";

const T0 = 1_700_000_000_000;  // fixed test base time

function mkSignal(partial: Partial<YieldSignal> = {}): YieldSignal {
  return {
    aavePoolApy: 0.031,
    uniFeeApr: 0.055,
    ilRisk: 0.2,
    confidence: 80,
    ts: T0,
    source: "fixture",
    ...partial,
  };
}

beforeEach(() => {
  process.env.YIELD_MIN_SPREAD_BPS = "30";
  process.env.MIN_CONFIDENCE_APPROVE = "60";
  process.env.COOLDOWN_SECONDS = "1800";
  process.env.DWELL_SECONDS = "180";
  process.env.POLL_INTERVAL_MS = "60000";  // ⇒ dwell needs ceil(180/60)=3 ticks
  process.env.ESTIMATED_GAS_USD = "0.5";
  process.env.NOTIONAL_USD = "200";
  resetConfig();
});

describe("scoreAndGate", () => {
  it("force=true bypasses cooldown and dwell but still requires positive spread", () => {
    const out = scoreAndGate({
      signal: mkSignal(),
      currentPosition: "AAVE",
      ring: [],
      lastRotatedAtMs: T0 - 1000,  // inside cooldown
      now: T0,
      force: true,
    });
    expect(out.decision.target).toBe("UNIV4");
    expect(out.gate.pass).toBe(true);
  });

  it("force=true still HOLDs on sub-threshold spread", () => {
    const out = scoreAndGate({
      signal: mkSignal({ aavePoolApy: 0.045, uniFeeApr: 0.042, ilRisk: 0.4, confidence: 80 }),
      currentPosition: "AAVE",
      ring: [],
      lastRotatedAtMs: 0,
      now: T0,
      force: true,
    });
    expect(out.decision.target).toBe("HOLD");
    expect(out.gate.pass).toBe(false);
    expect(out.gate.blockedBy).toBe("spread");
  });

  it("blocks on low confidence", () => {
    const out = scoreAndGate({
      signal: mkSignal({ confidence: 40 }),
      currentPosition: "AAVE",
      ring: [],
      lastRotatedAtMs: 0,
      now: T0,
    });
    expect(out.gate.pass).toBe(false);
    expect(out.gate.blockedBy).toBe("confidence");
  });

  it("blocks on cooldown window", () => {
    const out = scoreAndGate({
      signal: mkSignal(),
      currentPosition: "AAVE",
      ring: [{ target: "UNIV4", netBps: 100, confidence: 80, ts: T0 - 60_000 }, { target: "UNIV4", netBps: 100, confidence: 80, ts: T0 - 120_000 }, { target: "UNIV4", netBps: 100, confidence: 80, ts: T0 - 180_000 }],
      lastRotatedAtMs: T0 - 60 * 1000,   // 1 min ago, cooldown 30 min
      now: T0,
    });
    expect(out.gate.pass).toBe(false);
    expect(out.gate.blockedBy).toBe("cooldown");
    expect(out.gate.secondsUntilReady).toBeGreaterThan(1700);
  });

  it("blocks on dwell when consecutive agreement < 3 ticks", () => {
    const ring: SignalTick[] = [
      { target: "UNIV4", netBps: 100, confidence: 80, ts: T0 - 60_000 },
      { target: "AAVE", netBps: 10, confidence: 80, ts: T0 - 120_000 },  // flip
    ];
    const out = scoreAndGate({
      signal: mkSignal(),
      currentPosition: "AAVE",
      ring,
      lastRotatedAtMs: 0,
      now: T0,
    });
    expect(out.gate.pass).toBe(false);
    expect(out.gate.blockedBy).toBe("dwell");
    expect(out.gate.dwellProgress).toBe(2); // new tick + last matching one
  });

  it("passes when spread + confidence + cooldown + dwell all clear", () => {
    const ring: SignalTick[] = [
      { target: "UNIV4", netBps: 100, confidence: 80, ts: T0 - 60_000 },
      { target: "UNIV4", netBps: 100, confidence: 80, ts: T0 - 120_000 },
    ];
    const out = scoreAndGate({
      signal: mkSignal(),
      currentPosition: "AAVE",
      ring,
      lastRotatedAtMs: 0,
      now: T0,
    });
    expect(out.gate.pass).toBe(true);
    expect(out.decision.target).toBe("UNIV4");
    expect(out.gate.dwellProgress).toBeGreaterThanOrEqual(3);
  });

  it("nextRing is newest-first and capped at 8 entries", () => {
    const longRing: SignalTick[] = Array.from({ length: 10 }, (_, i) => ({
      target: "UNIV4",
      netBps: 50,
      confidence: 80,
      ts: T0 - (i + 1) * 60_000,
    }));
    const out = scoreAndGate({
      signal: mkSignal(),
      currentPosition: "AAVE",
      ring: longRing,
      lastRotatedAtMs: 0,
      now: T0,
    });
    expect(out.nextRing.length).toBe(8);
    expect(out.nextRing[0].ts).toBe(T0);  // newest first
  });
});
