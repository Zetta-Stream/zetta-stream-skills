/**
 * OKX DEX cross-chain quote wrapper. Asks the aggregator for candidate routes
 * from (srcChainId, srcToken) → (dstChainId, dstToken) for a given amount.
 */
import { runOkx } from "../lib/okx-cli.js";
import { getLogger } from "../lib/logger.js";

const log = getLogger("crosschain-quote");

export interface RawRoute {
  id: string;
  destApy?: number;
  bridgeFeeUsd: number;
  slippageBps: number;
  gasUsd: number;
  estimatedSeconds: number;
  protocol: string;
  tx?: { to: string; data: string; value?: string };
}

/**
 * Returns a list of candidate routes. If OKX DEX is unreachable, returns
 * 3 demo fallback routes to keep the demo deterministic.
 */
export async function quoteCrossChain(input: {
  srcChainId: number;
  dstChainId: number;
  srcToken: `0x${string}`;
  dstToken: `0x${string}`;
  amount: bigint;
  owner: `0x${string}`;
}): Promise<RawRoute[]> {
  const resp = await runOkx<{ routes?: RawRoute[] } | { data?: RawRoute[] } | RawRoute[]>(
    "swap",
    "cross-chain-quote",
    [
      "--from-chain-index",
      input.srcChainId.toString(),
      "--to-chain-index",
      input.dstChainId.toString(),
      "--from-token",
      input.srcToken,
      "--to-token",
      input.dstToken,
      "--amount",
      input.amount.toString(),
      "--user-wallet-address",
      input.owner,
    ],
    { reason: "cross-chain quote", timeoutMs: 10_000 },
  );
  if (resp.ok) {
    const d = resp.data;
    const routes = Array.isArray(d)
      ? (d as RawRoute[])
      : ((d as { routes?: RawRoute[]; data?: RawRoute[] }).routes ??
        (d as { routes?: RawRoute[]; data?: RawRoute[] }).data ??
        []);
    if (routes.length > 0) return routes;
  }
  log.warn("OKX cross-chain quote unavailable — returning demo fallback routes");
  return demoFallbackRoutes(input);
}

function demoFallbackRoutes(input: {
  srcChainId: number;
  dstChainId: number;
}): RawRoute[] {
  const base = {
    slippageBps: 6,
    gasUsd: 0.15,
  };
  return [
    {
      id: "stargate",
      destApy: 4.1,
      bridgeFeeUsd: 0.23,
      estimatedSeconds: 260,
      protocol: "Stargate",
      slippageBps: 5,
      gasUsd: 0.19,
    },
    {
      id: "across",
      destApy: 4.1,
      bridgeFeeUsd: 0.17,
      estimatedSeconds: 180,
      protocol: "Across",
      slippageBps: base.slippageBps,
      gasUsd: base.gasUsd,
    },
    {
      id: "cctp",
      destApy: 4.1,
      bridgeFeeUsd: 0.05,
      estimatedSeconds: 520,
      protocol: "Circle CCTP",
      slippageBps: 2,
      gasUsd: 0.11,
    },
  ];
}
