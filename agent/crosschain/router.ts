/**
 * Pick the best scored route and build its Call[] for the batch executor.
 */
import { quoteCrossChain, type RawRoute } from "./quote.js";
import { scoreRoutes, type ScoredRoute } from "./scorer.js";
import type { BatchCall } from "../eip7702/delegate-abi.js";
import { getLogger } from "../lib/logger.js";

const log = getLogger("crosschain-router");

export interface RouteDecision {
  best: ScoredRoute;
  candidates: ScoredRoute[];
  calls: BatchCall[];
}

export async function chooseRoute(input: {
  srcChainId: number;
  dstChainId: number;
  srcToken: `0x${string}`;
  dstToken: `0x${string}`;
  amount: bigint;
  owner: `0x${string}`;
}): Promise<RouteDecision> {
  const routes = await quoteCrossChain(input);
  const scored = scoreRoutes(routes);
  const best = scored[0];
  log.info(
    {
      best: { id: best.id, score: best.score, fee: best.bridgeFeeUsd },
      candidates: scored.map((s) => ({ id: s.id, score: s.score })),
    },
    "route chosen",
  );
  const calls: BatchCall[] = best.tx
    ? [
        {
          to: best.tx.to as `0x${string}`,
          value: BigInt(best.tx.value ?? "0"),
          data: best.tx.data as `0x${string}`,
        },
      ]
    : [];
  return { best, candidates: scored, calls };
}

export type { RawRoute };
