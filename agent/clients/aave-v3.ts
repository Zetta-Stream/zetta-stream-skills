/**
 * Aave V3 client — just the two encoders the rotation batch needs.
 *
 * The agent never calls `supply` / `withdraw` directly from the runtime; it
 * builds calldata here, then `ZettaStreamDelegate.executeBatch` dispatches the
 * inner call. `readSupplyApy` / `readATokenBalance` are convenience views for
 * the preview pipeline.
 */
import type { Address, Hex, PublicClient } from "viem";
import { encodeFunctionData } from "viem";

/** Minimal Aave V3 Pool ABI — just supply / withdraw / getReserveData. */
export const AAVE_V3_POOL_ABI = [
  {
    type: "function",
    name: "supply",
    stateMutability: "nonpayable",
    inputs: [
      { name: "asset", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "onBehalfOf", type: "address" },
      { name: "referralCode", type: "uint16" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "withdraw",
    stateMutability: "nonpayable",
    inputs: [
      { name: "asset", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "to", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "getReserveData",
    stateMutability: "view",
    inputs: [{ name: "asset", type: "address" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "configuration", type: "uint256" },
          { name: "liquidityIndex", type: "uint128" },
          { name: "currentLiquidityRate", type: "uint128" },
          { name: "variableBorrowIndex", type: "uint128" },
          { name: "currentVariableBorrowRate", type: "uint128" },
          { name: "currentStableBorrowRate", type: "uint128" },
          { name: "lastUpdateTimestamp", type: "uint40" },
          { name: "id", type: "uint16" },
          { name: "aTokenAddress", type: "address" },
          { name: "stableDebtTokenAddress", type: "address" },
          { name: "variableDebtTokenAddress", type: "address" },
          { name: "interestRateStrategyAddress", type: "address" },
          { name: "accruedToTreasury", type: "uint128" },
          { name: "unbacked", type: "uint128" },
          { name: "isolationModeTotalDebt", type: "uint128" },
        ],
      },
    ],
  },
] as const;

const ERC20_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

/** Build `Pool.supply(asset, amount, onBehalfOf, 0)` calldata. */
export function encodeSupply(asset: Address, amount: bigint, onBehalfOf: Address): Hex {
  return encodeFunctionData({
    abi: AAVE_V3_POOL_ABI,
    functionName: "supply",
    args: [asset, amount, onBehalfOf, 0],
  });
}

/**
 * Build `Pool.withdraw(asset, amount, to)` calldata. Pass `UINT256_MAX` in
 * `amount` to withdraw the full balance (Aave convention — see V3 docs).
 */
export function encodeWithdraw(asset: Address, amount: bigint, to: Address): Hex {
  return encodeFunctionData({
    abi: AAVE_V3_POOL_ABI,
    functionName: "withdraw",
    args: [asset, amount, to],
  });
}

export const MAX_UINT256 = (1n << 256n) - 1n;

export interface AaveReserve {
  /// currentLiquidityRate is in ray (1e27) per second-adjusted — convert to APY below.
  currentLiquidityRate: bigint;
  aTokenAddress: Address;
}

/**
 * Fetch Aave reserve data and return the fields the scorer cares about plus an
 * APY number computed from the ray-scaled liquidity rate.
 */
export async function readReserve(
  client: PublicClient,
  pool: Address,
  asset: Address,
): Promise<{ apy: number; aToken: Address }> {
  const r = (await client.readContract({
    address: pool,
    abi: AAVE_V3_POOL_ABI,
    functionName: "getReserveData",
    args: [asset],
  })) as AaveReserve;
  const RAY = 10n ** 27n;
  // liquidityRate is an annualised APR in ray (per Aave protocol docs).
  const apr = Number(r.currentLiquidityRate) / Number(RAY);
  // Convert continuous-compounding APR to effective APY.
  const apy = Math.expm1(apr);
  return { apy, aToken: r.aTokenAddress };
}

/** Current supplied position (aToken balance) for `owner`. */
export async function readSuppliedBalance(
  client: PublicClient,
  aToken: Address,
  owner: Address,
): Promise<bigint> {
  return (await client.readContract({
    address: aToken,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [owner],
  })) as bigint;
}
