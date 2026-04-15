import { describe, it, expect, beforeEach } from "vitest";
import { parseUnits } from "viem";
import { resetConfig } from "../config.js";
import { buildRotationBatch } from "./intent-builder.js";
import type { Decision } from "./types.js";

const OWNER = "0x1111111111111111111111111111111111111111" as const;

beforeEach(() => {
  process.env.USDC_ADDRESS = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";
  process.env.AAVE_V3_POOL = "0x794a61358D6845594F94dc1DB02A252b5b4814aD";
  process.env.UNI_V4_POSITION_MANAGER = "0xd88F38F930b7952f2DB2432Cb002E7abbF3dD869";
  process.env.UNI_V4_POOL_KEY_TOKEN0 = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";
  process.env.UNI_V4_POOL_KEY_TOKEN1 = "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1";
  process.env.UNI_V4_POOL_KEY_FEE = "500";
  process.env.UNI_V4_POOL_KEY_TICKSPACING = "10";
  process.env.UNI_V4_POOL_KEY_HOOKS = "0x0000000000000000000000000000000000000000";
  process.env.NOTIONAL_USD = "200";
  resetConfig();
});

function mkDecision(
  target: "AAVE" | "UNIV4" | "HOLD",
  from: "IDLE" | "AAVE" | "UNIV4",
): Decision {
  return {
    target,
    currentPosition: from,
    grossSpreadBps: 110,
    ilPenaltyBps: 80,
    gasCostBps: 25,
    rawNetBps: 5,
    netYieldBps: 85,
    confidence: 78,
    score: 92,
    reason: "test",
  };
}

describe("buildRotationBatch", () => {
  it("returns null for HOLD", () => {
    const out = buildRotationBatch({
      owner: OWNER,
      decision: mkDecision("HOLD", "AAVE"),
      currentUsdc: parseUnits("200", 6),
    });
    expect(out).toBeNull();
  });

  it("builds IDLE → AAVE with 2 calls (approve + supply)", () => {
    const out = buildRotationBatch({
      owner: OWNER,
      decision: mkDecision("AAVE", "IDLE"),
      currentUsdc: parseUnits("200", 6),
    });
    expect(out).not.toBeNull();
    expect(out!.calls.length).toBe(2);
    expect(out!.calls[0].label).toContain("approve");
    expect(out!.calls[1].label).toContain("aave.supply");
    // calldata should be valid hex
    for (const c of out!.calls) {
      expect(c.data).toMatch(/^0x[0-9a-fA-F]+$/);
      expect(c.data.length).toBeGreaterThan(10);
    }
  });

  it("builds AAVE → UNIV4 with 3 calls (withdraw + approve + mint)", () => {
    const out = buildRotationBatch({
      owner: OWNER,
      decision: mkDecision("UNIV4", "AAVE"),
      currentUsdc: parseUnits("200", 6),
    });
    expect(out).not.toBeNull();
    expect(out!.calls.length).toBe(3);
    expect(out!.calls[0].label).toContain("aave.withdraw");
    expect(out!.calls[1].label).toContain("approve");
    expect(out!.calls[2].label).toContain("univ4.mint");
    expect(out!.from).toBe("AAVE");
    expect(out!.to).toBe("UNIV4");
  });

  it("builds UNIV4 → AAVE with 3 calls (decrease + approve + supply)", () => {
    const out = buildRotationBatch({
      owner: OWNER,
      decision: mkDecision("AAVE", "UNIV4"),
      currentUsdc: parseUnits("200", 6),
    });
    expect(out).not.toBeNull();
    expect(out!.calls.length).toBe(3);
    expect(out!.calls[0].label).toContain("univ4.decreaseLiquidity");
    expect(out!.calls[2].label).toContain("aave.supply");
  });

  it("returns null when rotating to same position", () => {
    const out = buildRotationBatch({
      owner: OWNER,
      decision: mkDecision("AAVE", "AAVE"),
      currentUsdc: parseUnits("200", 6),
    });
    expect(out).toBeNull();
  });
});
