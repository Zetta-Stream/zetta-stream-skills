/**
 * Uniswap V4 PositionManager client.
 *
 * V4 collapses the router + position manager into one contract with a single
 * entry point: `modifyLiquidities(bytes unlockData, uint256 deadline)`. The
 * `unlockData` blob is `abi.encode(actions, params[])` where `actions` is a
 * packed byte-array of action selectors (one per step) and `params[]` is a
 * parallel array of abi-encoded parameter bundles.
 *
 * This module exposes builders for MINT_POSITION / DECREASE_LIQUIDITY /
 * SETTLE_PAIR / TAKE_PAIR so the rotation batch can be assembled without
 * pulling Uniswap's SDK into the runtime.
 *
 * Reference: https://github.com/Uniswap/v4-periphery/blob/main/src/libraries/Actions.sol
 */
import type { Address, Hex } from "viem";
import { encodeAbiParameters, encodeFunctionData, encodePacked } from "viem";

/** V4 Actions enum (subset the rotator needs). */
export const V4_ACTION = {
  INCREASE_LIQUIDITY: 0x00,
  DECREASE_LIQUIDITY: 0x01,
  MINT_POSITION: 0x02,
  BURN_POSITION: 0x03,
  SETTLE: 0x0a,
  SETTLE_ALL: 0x0b,
  SETTLE_PAIR: 0x0d,
  TAKE: 0x0e,
  TAKE_ALL: 0x0f,
  TAKE_PAIR: 0x11,
  CLOSE_CURRENCY: 0x12,
} as const;

export interface PoolKey {
  currency0: Address;
  currency1: Address;
  fee: number;          // 3000 = 0.3%, 500 = 0.05%
  tickSpacing: number;
  hooks: Address;
}

export const POSITION_MANAGER_ABI = [
  {
    type: "function",
    name: "modifyLiquidities",
    stateMutability: "payable",
    inputs: [
      { name: "unlockData", type: "bytes" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "nextTokenId",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "getPoolAndPositionInfo",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "currency0", type: "address" },
          { name: "currency1", type: "address" },
          { name: "fee", type: "uint24" },
          { name: "tickSpacing", type: "int24" },
          { name: "hooks", type: "address" },
        ],
      },
      { name: "info", type: "uint256" },
    ],
  },
] as const;

/* ---------- Action parameter encoders ---------- */

const POOL_KEY_STRUCT = {
  type: "tuple",
  components: [
    { type: "address" },
    { type: "address" },
    { type: "uint24" },
    { type: "int24" },
    { type: "address" },
  ],
} as const;

function encodePoolKey(k: PoolKey) {
  return [k.currency0, k.currency1, k.fee, k.tickSpacing, k.hooks] as const;
}

export function mintPositionParams(args: {
  key: PoolKey;
  tickLower: number;
  tickUpper: number;
  liquidity: bigint;
  amount0Max: bigint;
  amount1Max: bigint;
  owner: Address;
  hookData?: Hex;
}): Hex {
  return encodeAbiParameters(
    [
      POOL_KEY_STRUCT,
      { type: "int24" },
      { type: "int24" },
      { type: "uint256" },
      { type: "uint128" },
      { type: "uint128" },
      { type: "address" },
      { type: "bytes" },
    ],
    [
      encodePoolKey(args.key),
      args.tickLower,
      args.tickUpper,
      args.liquidity,
      args.amount0Max,
      args.amount1Max,
      args.owner,
      args.hookData ?? "0x",
    ],
  );
}

export function decreaseLiquidityParams(args: {
  tokenId: bigint;
  liquidity: bigint;
  amount0Min: bigint;
  amount1Min: bigint;
  hookData?: Hex;
}): Hex {
  return encodeAbiParameters(
    [
      { type: "uint256" },
      { type: "uint256" },
      { type: "uint128" },
      { type: "uint128" },
      { type: "bytes" },
    ],
    [args.tokenId, args.liquidity, args.amount0Min, args.amount1Min, args.hookData ?? "0x"],
  );
}

export function settlePairParams(currency0: Address, currency1: Address): Hex {
  return encodeAbiParameters([{ type: "address" }, { type: "address" }], [currency0, currency1]);
}

export function takePairParams(currency0: Address, currency1: Address, recipient: Address): Hex {
  return encodeAbiParameters(
    [{ type: "address" }, { type: "address" }, { type: "address" }],
    [currency0, currency1, recipient],
  );
}

/**
 * Pack the actions byte-array + matching params into the `unlockData` blob
 * expected by `modifyLiquidities`.
 */
export function buildUnlockData(actions: number[], params: Hex[]): Hex {
  if (actions.length !== params.length) {
    throw new Error(`action/params length mismatch: ${actions.length} vs ${params.length}`);
  }
  const actionsPacked = encodePacked(
    actions.map(() => "uint8" as const),
    actions,
  );
  return encodeAbiParameters([{ type: "bytes" }, { type: "bytes[]" }], [actionsPacked, params]);
}

/** Full `modifyLiquidities(unlockData, deadline)` calldata for a MINT flow. */
export function encodeMint(args: {
  key: PoolKey;
  tickLower: number;
  tickUpper: number;
  liquidity: bigint;
  amount0Max: bigint;
  amount1Max: bigint;
  owner: Address;
  deadline: bigint;
}): Hex {
  const unlockData = buildUnlockData(
    [V4_ACTION.MINT_POSITION, V4_ACTION.SETTLE_PAIR],
    [
      mintPositionParams({
        key: args.key,
        tickLower: args.tickLower,
        tickUpper: args.tickUpper,
        liquidity: args.liquidity,
        amount0Max: args.amount0Max,
        amount1Max: args.amount1Max,
        owner: args.owner,
      }),
      settlePairParams(args.key.currency0, args.key.currency1),
    ],
  );
  return encodeFunctionData({
    abi: POSITION_MANAGER_ABI,
    functionName: "modifyLiquidities",
    args: [unlockData, args.deadline],
  });
}

/** Full `modifyLiquidities` calldata for a DECREASE flow. */
export function encodeDecrease(args: {
  tokenId: bigint;
  liquidity: bigint;
  amount0Min: bigint;
  amount1Min: bigint;
  recipient: Address;
  currency0: Address;
  currency1: Address;
  deadline: bigint;
}): Hex {
  const unlockData = buildUnlockData(
    [V4_ACTION.DECREASE_LIQUIDITY, V4_ACTION.TAKE_PAIR],
    [
      decreaseLiquidityParams({
        tokenId: args.tokenId,
        liquidity: args.liquidity,
        amount0Min: args.amount0Min,
        amount1Min: args.amount1Min,
      }),
      takePairParams(args.currency0, args.currency1, args.recipient),
    ],
  );
  return encodeFunctionData({
    abi: POSITION_MANAGER_ABI,
    functionName: "modifyLiquidities",
    args: [unlockData, args.deadline],
  });
}

/** Tick range for a "neutral" concentrated-LP band centred at tick 0. */
export function neutralTickRange(tickSpacing: number, widthBuckets = 10): { lower: number; upper: number } {
  const half = Math.max(1, widthBuckets) * tickSpacing;
  // Must be multiples of tickSpacing.
  return { lower: -half, upper: half };
}
