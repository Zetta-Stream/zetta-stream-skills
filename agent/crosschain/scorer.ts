/**
 * Route scorer. Normalizes candidate quotes and assigns a 0-100 score:
 *   score = 0.5 * normApy - 0.2 * normBridgeFee - 0.2 * normSlippage - 0.1 * normGas
 * We shift to 0-100 so the dashboard can render a bar.
 */
import type { RawRoute } from "./quote.js";

export interface ScoredRoute extends RawRoute {
  score: number;
  breakdown: {
    apy: number;
    bridgeFee: number;
    slippage: number;
    gas: number;
  };
}

function norm(values: number[]): (v: number) => number {
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max === min) return () => 0.5;
  return (v) => (v - min) / (max - min);
}

export function scoreRoutes(routes: RawRoute[]): ScoredRoute[] {
  if (routes.length === 0) return [];
  const apys = routes.map((r) => r.destApy ?? 0);
  const fees = routes.map((r) => r.bridgeFeeUsd);
  const slips = routes.map((r) => r.slippageBps);
  const gases = routes.map((r) => r.gasUsd);

  const nApy = norm(apys);
  const nFee = norm(fees);
  const nSlip = norm(slips);
  const nGas = norm(gases);

  const scored: ScoredRoute[] = routes.map((r) => {
    const a = nApy(r.destApy ?? 0);
    const f = nFee(r.bridgeFeeUsd);
    const s = nSlip(r.slippageBps);
    const g = nGas(r.gasUsd);
    const raw = 0.5 * a - 0.2 * f - 0.2 * s - 0.1 * g;
    // shift/scale raw to 0-100
    const shifted = Math.max(0, Math.min(100, Math.round((raw + 0.5) * 100)));
    return {
      ...r,
      score: shifted,
      breakdown: { apy: a, bridgeFee: f, slippage: s, gas: g },
    };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored;
}
