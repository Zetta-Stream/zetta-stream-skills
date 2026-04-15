import { describe, it, expect } from "vitest";
import { scoreRoutes } from "./scorer.js";
import type { RawRoute } from "./quote.js";

const r = (over: Partial<RawRoute>): RawRoute => ({
  id: over.id ?? "x",
  protocol: over.protocol ?? "Test",
  destApy: over.destApy ?? 4,
  bridgeFeeUsd: over.bridgeFeeUsd ?? 0.2,
  slippageBps: over.slippageBps ?? 5,
  gasUsd: over.gasUsd ?? 0.15,
  estimatedSeconds: over.estimatedSeconds ?? 300,
});

describe("scoreRoutes", () => {
  it("returns empty on empty input", () => {
    expect(scoreRoutes([])).toEqual([]);
  });

  it("ranks lower fee + lower slippage higher", () => {
    const a = r({ id: "A", bridgeFeeUsd: 0.1, slippageBps: 2 });
    const b = r({ id: "B", bridgeFeeUsd: 0.5, slippageBps: 20 });
    const [best] = scoreRoutes([a, b]);
    expect(best.id).toBe("A");
  });

  it("ranks higher APY higher", () => {
    const a = r({ id: "A", destApy: 10 });
    const b = r({ id: "B", destApy: 2 });
    const [best] = scoreRoutes([a, b]);
    expect(best.id).toBe("A");
  });

  it("scores are 0-100", () => {
    const routes = [
      r({ id: "A", destApy: 8, bridgeFeeUsd: 0.1, slippageBps: 2, gasUsd: 0.1 }),
      r({ id: "B", destApy: 2, bridgeFeeUsd: 2.0, slippageBps: 50, gasUsd: 1.0 }),
    ];
    const out = scoreRoutes(routes);
    for (const o of out) {
      expect(o.score).toBeGreaterThanOrEqual(0);
      expect(o.score).toBeLessThanOrEqual(100);
    }
  });
});
