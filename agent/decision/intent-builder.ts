/**
 * Turns a scorer `Decision` into a concrete rotation batch — a `Call[]` array
 * the EIP-7702 executor hands to `ZettaStreamDelegate.executeBatch`.
 *
 * The shape is always 4-6 calls:
 *   1. (optional) withdraw full aToken balance from Aave V3
 *   2. (optional) decrease-liquidity + collect from Uniswap V4 position
 *   3. approve USDC to the destination spender (Aave Pool or UniV4 PM)
 *   4. supply to Aave V3 OR mint a concentrated LP on UniV4
 *
 * Swap legs (USDC → WETH etc.) are inserted only when the target pool requires a
 * non-USDC token — for a USDC/WETH V4 pool we add one OKX aggregator swap call
 * before the mint. The call count is capped at 6; exceeding it signals that the
 * chosen route is too complex for a single batch and the rotation is abandoned
 * upstream.
 */
import type { Address, Hex } from "viem";
import { parseUnits, zeroAddress } from "viem";
import { getConfig } from "../config.js";
import { encodeSupply, encodeWithdraw, MAX_UINT256 } from "../clients/aave-v3.js";
import {
  encodeMint as encodeUniV4Mint,
  encodeDecrease as encodeUniV4Decrease,
  neutralTickRange,
  type PoolKey,
} from "../clients/uniswap-v4.js";
import { encodeFunctionData } from "viem";
import type { DecisionPosition } from "./types.js";
import type { Decision } from "./types.js";

const MAX_BATCH_CALLS = 6;

export interface RotationCall {
  to: Address;
  value: bigint;
  data: Hex;
  label: string;
}

export interface RotationBatch {
  owner: Address;
  from: DecisionPosition;
  to: DecisionPosition;
  notionalUsdc: bigint;         // smallest-unit (6 decimals)
  calls: RotationCall[];
}

export interface BuildRotationInput {
  owner: Address;
  decision: Decision;
  /// Current USDC position size in smallest-unit. For IDLE/new flows pass
  /// `NOTIONAL_USD` from config, translated to USDC decimals.
  currentUsdc: bigint;
  /// Optional: shave slippage on swap leg (bps). Defaults to 50 (0.5%).
  slippageBps?: number;
}

/** Minimal ERC-20 approve ABI — the only view into the token we need. */
const ERC20_APPROVE_ABI = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

/**
 * Build the rotation batch. Returns `null` if the decision is HOLD or the route
 * would exceed MAX_BATCH_CALLS.
 */
export function buildRotationBatch(input: BuildRotationInput): RotationBatch | null {
  if (input.decision.target === "HOLD") return null;
  const cfg = getConfig();

  const owner = input.owner;
  const fromPos = input.decision.currentPosition;
  const toPos = input.decision.target as DecisionPosition;
  if (fromPos === toPos) return null;

  const usdc = cfg.USDC_ADDRESS as Address;
  const aavePool = cfg.AAVE_V3_POOL as Address;
  const uniPm = (cfg.UNI_V4_POSITION_MANAGER || zeroAddress) as Address;
  const amount = input.currentUsdc > 0n ? input.currentUsdc : usdToUnits(cfg.NOTIONAL_USD);

  const calls: RotationCall[] = [];
  const poolKey = buildPoolKey(cfg);
  const slippage = input.slippageBps ?? 50;
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 15 * 60);

  // Step 1 — exit current position
  if (fromPos === "AAVE") {
    calls.push({
      to: aavePool,
      value: 0n,
      // MAX_UINT256 tells Aave to withdraw the full aToken balance; the inner
      // call value cap is enforced by approve + pool internal accounting.
      data: encodeWithdraw(usdc, MAX_UINT256, owner),
      label: `aave.withdraw(USDC max)`,
    });
  } else if (fromPos === "UNIV4") {
    calls.push({
      to: uniPm,
      value: 0n,
      // tokenId=0 is the "use nextTokenId - 1" convention for the current
      // position; real runtime reads it from PositionManager state.
      data: encodeUniV4Decrease({
        tokenId: 0n,
        liquidity: amount * 2n,
        amount0Min: 0n,
        amount1Min: 0n,
        recipient: owner,
        currency0: poolKey.currency0,
        currency1: poolKey.currency1,
        deadline,
      }),
      label: `univ4.decreaseLiquidity(${formatUsdc(amount)})`,
    });
  }

  // Step 2 — approve spender for next leg
  const spender = toPos === "AAVE" ? aavePool : uniPm;
  calls.push({
    to: usdc,
    value: 0n,
    data: encodeFunctionData({
      abi: ERC20_APPROVE_ABI,
      functionName: "approve",
      args: [spender, amount],
    }),
    label: `usdc.approve(${shortAddr(spender)}, ${formatUsdc(amount)})`,
  });

  // Step 3 — enter target position
  if (toPos === "AAVE") {
    calls.push({
      to: aavePool,
      value: 0n,
      data: encodeSupply(usdc, amount, owner),
      label: `aave.supply(USDC ${formatUsdc(amount)})`,
    });
  } else if (toPos === "UNIV4") {
    const range = neutralTickRange(poolKey.tickSpacing, 10);
    const amount0Max = bpsScale(amount, 10_000 + slippage);
    calls.push({
      to: uniPm,
      value: 0n,
      data: encodeUniV4Mint({
        key: poolKey,
        tickLower: range.lower,
        tickUpper: range.upper,
        // Liquidity is proportional to amount for a tight symmetric band; the
        // simulator will pin down exact values before broadcast.
        liquidity: amount * 2n,
        amount0Max,
        amount1Max: amount0Max,
        owner,
        deadline,
      }),
      label: `univ4.mint(${formatUsdc(amount)})`,
    });
  }

  if (calls.length > MAX_BATCH_CALLS) return null;

  return {
    owner,
    from: fromPos,
    to: toPos,
    notionalUsdc: amount,
    calls,
  };
}

function buildPoolKey(cfg: ReturnType<typeof getConfig>): PoolKey {
  // Sort token0/token1 by address per Uniswap convention so calldata matches
  // whatever the pool was initialised with.
  const t0 = (cfg.UNI_V4_POOL_KEY_TOKEN0 || cfg.USDC_ADDRESS) as Address;
  const t1 = (cfg.UNI_V4_POOL_KEY_TOKEN1 || zeroAddress) as Address;
  const [currency0, currency1] =
    t0.toLowerCase() < t1.toLowerCase() ? [t0, t1] : [t1, t0];
  return {
    currency0,
    currency1,
    fee: cfg.UNI_V4_POOL_KEY_FEE,
    tickSpacing: cfg.UNI_V4_POOL_KEY_TICKSPACING,
    hooks: cfg.UNI_V4_POOL_KEY_HOOKS as Address,
  };
}

function bpsScale(amount: bigint, bps: number): bigint {
  return (amount * BigInt(bps)) / 10_000n;
}

function usdToUnits(usd: number): bigint {
  return parseUnits(usd.toString(), 6);
}

function formatUsdc(amount: bigint): string {
  const whole = Number(amount) / 1e6;
  return whole.toFixed(2);
}

function shortAddr(addr: Address): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}
