/**
 * IntentJSON → PlannedCall[]. Turns high-level ops into the encoded calldata
 * that simulator / risk-scan / batch-executor all consume.
 *
 * For SWAP and BRIDGE, we rely on OKX DEX aggregator via `okx-cli.ts`. For
 * APPROVE / DEPOSIT / WITHDRAW / STAKE / MINT we use standard ABIs (ERC-20,
 * Aave V3 Pool, UniswapV3 NFT Manager, generic staker) with param defaults.
 */
import { encodeFunctionData, parseUnits, getAddress } from "viem";
import type { Hex } from "viem";
import { getConfig } from "../config.js";
import { runOkx, mustOk } from "../lib/okx-cli.js";
import type { Intent, IntentStep, PlannedCall } from "./intent-types.js";
import { getLogger } from "../lib/logger.js";

const log = getLogger("planner");

// ------- canonical token registry (X Layer mainnet) -------
// Extend as needed. Any token not listed falls back to raw address.
const XLAYER_TOKENS: Record<string, { address: `0x${string}`; decimals: number }> = {
  USDC: { address: "0x74b7f16337b8972027f6196a17a631ac6de26d22", decimals: 6 },
  USDT: { address: "0x1e4a5963abfd975d8c9021ce480b42188849d41d", decimals: 6 },
  OKB:  { address: "0xe538905cf8410324e03a5a23c1c177a474d59b2b", decimals: 18 },
  WOKB: { address: "0xe538905cf8410324e03a5a23c1c177a474d59b2b", decimals: 18 },
  WETH: { address: "0x5a77f1443d16ee5761d310e38b62f77f726bc71c", decimals: 18 },
  USDG: { address: "0x4ae46a509f6b1d9056937ba4500cb143933d2dc8", decimals: 6 },
};

const ERC20_APPROVE_ABI = [
  {
    type: "function",
    name: "approve",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
    stateMutability: "nonpayable",
  },
] as const;

const ERC20_TRANSFER_ABI = [
  {
    type: "function",
    name: "transfer",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
    stateMutability: "nonpayable",
  },
] as const;

// Minimal Aave V3 Pool ABI (deposit / withdraw)
const AAVE_V3_POOL_ABI = [
  {
    type: "function",
    name: "supply",
    inputs: [
      { name: "asset", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "onBehalfOf", type: "address" },
      { name: "referralCode", type: "uint16" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "withdraw",
    inputs: [
      { name: "asset", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "to", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
    stateMutability: "nonpayable",
  },
] as const;

// Generic single-asset staker (our "test vault") — deposit(uint256)
const GENERIC_STAKER_ABI = [
  {
    type: "function",
    name: "deposit",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const;

function resolveToken(symbolOrAddress: string | undefined): {
  address: `0x${string}`;
  decimals: number;
} {
  if (!symbolOrAddress) throw new Error("step.token missing");
  if (symbolOrAddress.startsWith("0x") && symbolOrAddress.length === 42) {
    // Lowercase then re-checksum to accept non-checksummed inputs from scenarios.
    return {
      address: getAddress(symbolOrAddress.toLowerCase() as `0x${string}`) as `0x${string}`,
      decimals: 18,
    };
  }
  const t = XLAYER_TOKENS[symbolOrAddress.toUpperCase()];
  if (!t) throw new Error(`unknown token symbol "${symbolOrAddress}"`);
  return t;
}

function resolveAddress(maybe: string | undefined, fallbackEnv?: string): `0x${string}` {
  const env = fallbackEnv ? process.env[fallbackEnv] : undefined;
  const raw = maybe ?? env;
  if (!raw) throw new Error(`address unresolved — provide step.to/spender or set ${fallbackEnv}`);
  if (raw.startsWith("0x") && raw.length === 42) {
    return getAddress(raw.toLowerCase() as `0x${string}`) as `0x${string}`;
  }
  // Named placeholders used in scenarios
  if (raw === "TEST_VAULT") {
    const cfg = getConfig();
    const v = cfg.TEST_VAULT_ADDRESS || "0x000000000000000000000000000000000000dead";
    return getAddress(v.toLowerCase() as `0x${string}`) as `0x${string}`;
  }
  if (raw === "AAVE_V3_POOL") {
    // Aave V3 Pool on Base (used by scenario 3 / cross-chain destination)
    return getAddress("0xa238dd80c259a72e81d7e4664a9801593f98d1c5") as `0x${string}`;
  }
  if (raw === "USDC") return resolveToken("USDC").address;
  throw new Error(`unresolved address token "${raw}"`);
}

async function planApprove(step: IntentStep, index: number): Promise<PlannedCall> {
  const tok = resolveToken(step.token);
  const spender = resolveAddress(step.spender);
  const amount = step.amount
    ? parseUnits(step.amount, tok.decimals)
    : (2n ** 256n - 1n); // max if unspecified
  const data = encodeFunctionData({
    abi: ERC20_APPROVE_ABI,
    functionName: "approve",
    args: [spender, amount],
  }) as Hex;
  return {
    step,
    stepIndex: index,
    to: tok.address,
    value: 0n,
    data,
    label: `approve ${step.token ?? "token"} → ${spender}`,
    opKind: "APPROVE",
    chainId: step.chainId ?? 196,
  };
}

async function planDeposit(step: IntentStep, index: number): Promise<PlannedCall> {
  const to = resolveAddress(step.to);
  const tok = resolveToken(step.token);
  const amount = step.amount ? parseUnits(step.amount, tok.decimals) : 0n;
  const data = encodeFunctionData({
    abi: GENERIC_STAKER_ABI,
    functionName: "deposit",
    args: [amount],
  }) as Hex;
  return {
    step,
    stepIndex: index,
    to,
    value: 0n,
    data,
    label: `deposit ${step.amount ?? "?"} ${step.token ?? ""} → ${to}`,
    opKind: "DEPOSIT",
    chainId: step.chainId ?? 196,
  };
}

async function planStake(step: IntentStep, index: number): Promise<PlannedCall> {
  // Same shape as DEPOSIT for our generic test vault.
  return { ...(await planDeposit(step, index)), opKind: "STAKE", label: `stake ${step.token ?? ""}` };
}

async function planWithdraw(step: IntentStep, index: number): Promise<PlannedCall> {
  const pool = resolveAddress(step.to);
  const tok = resolveToken(step.token);
  const amount = step.amount ? parseUnits(step.amount, tok.decimals) : 2n ** 256n - 1n;
  const to = (step.params?.to as `0x${string}`) ?? (step.params?.recipient as `0x${string}`);
  if (!to) throw new Error("withdraw: params.to required");
  const data = encodeFunctionData({
    abi: AAVE_V3_POOL_ABI,
    functionName: "withdraw",
    args: [tok.address, amount, to],
  }) as Hex;
  return {
    step,
    stepIndex: index,
    to: pool,
    value: 0n,
    data,
    label: `withdraw ${step.token ?? ""} from ${pool}`,
    opKind: "WITHDRAW",
    chainId: step.chainId ?? 196,
  };
}

async function planRaw(step: IntentStep, index: number): Promise<PlannedCall> {
  const to = resolveAddress(step.to);
  const data = ((step.params?.data as string) ?? "0x") as Hex;
  const value = BigInt((step.params?.value as string) ?? "0");
  return {
    step,
    stepIndex: index,
    to,
    value,
    data,
    label: `raw call → ${to}`,
    opKind: "RAW",
    chainId: step.chainId ?? 196,
  };
}

async function planSwap(
  step: IntentStep,
  index: number,
  owner: `0x${string}`,
): Promise<PlannedCall> {
  const cfg = getConfig();
  const fromTok = resolveToken(step.token);
  const toTok = resolveToken(step.to);
  const amount = step.amount ? parseUnits(step.amount, fromTok.decimals) : 0n;

  // Ask OKX DEX for calldata — this is the critical OKX integration for SWAP.
  const resp = await runOkx<unknown>(
    "swap",
    "swap",
    [
      "--chain",
      "xlayer",
      "--from",
      fromTok.address,
      "--to",
      toTok.address,
      "--readable-amount",
      step.amount ?? "0",
      "--wallet",
      owner,
      "--slippage",
      "1",
    ],
    { reason: `plan SWAP step ${index}`, timeoutMs: 30_000 },
  );
  if (!resp.ok) {
    log.warn({ resp }, "swap build failed — using stub data for demo");
    // demo fallback: call transfer on the source token to self as no-op stub
    const data = encodeFunctionData({
      abi: ERC20_TRANSFER_ABI,
      functionName: "transfer",
      args: [owner, amount],
    }) as Hex;
    return {
      step,
      stepIndex: index,
      to: fromTok.address,
      value: 0n,
      data,
      label: `[DEMO-STUB] swap ${step.amount ?? "?"} ${step.token ?? ""} → ${step.to ?? "?"}`,
      opKind: "SWAP",
      chainId: 196,
    };
  }
  // OKX CLI returns { data: [{ tx: { to, data, value, gas }, ... }] }
  const raw = resp.data as unknown;
  const rootArr = Array.isArray(raw) ? raw : [raw];
  const first = rootArr[0] as Record<string, unknown>;
  const tx = (first?.tx as { to: string; data: string; value?: string } | undefined) ?? (first as { to: string; data: string; value?: string });
  return {
    step,
    stepIndex: index,
    to: tx.to as `0x${string}`,
    value: BigInt(tx.value ?? "0"),
    data: tx.data as Hex,
    label: `swap ${step.amount ?? ""} ${step.token ?? ""} → ${step.to ?? ""}`,
    opKind: "SWAP",
    chainId: 196,
  };
}

async function planBridge(step: IntentStep, index: number, owner: `0x${string}`): Promise<PlannedCall> {
  const srcChain = step.chainId ?? 196;
  const dstChain = Number((step.params?.dstChainId as number) ?? 8453);
  const fromTok = resolveToken(step.token);
  const amount = step.amount ? parseUnits(step.amount, fromTok.decimals) : 0n;
  const srcChainName = srcChain === 196 ? "xlayer" : srcChain === 8453 ? "base" : srcChain.toString();
  const resp = await runOkx<unknown>(
    "swap",
    "swap",
    [
      "--chain",
      srcChainName,
      "--from",
      fromTok.address,
      "--to",
      (step.params?.dstToken as string) ?? fromTok.address,
      "--readable-amount",
      step.amount ?? "0",
      "--wallet",
      owner,
      "--slippage",
      "1",
    ],
    { reason: `plan BRIDGE step ${index}`, timeoutMs: 30_000 },
  );
  if (!resp.ok) {
    log.warn({ resp }, "bridge build failed — using demo stub");
    const data = encodeFunctionData({
      abi: ERC20_TRANSFER_ABI,
      functionName: "transfer",
      args: [owner, amount],
    }) as Hex;
    return {
      step,
      stepIndex: index,
      to: fromTok.address,
      value: 0n,
      data,
      label: `[DEMO-STUB] bridge ${step.amount ?? ""} ${step.token ?? ""} ${srcChain}→${dstChain}`,
      opKind: "BRIDGE",
      chainId: srcChain,
    };
  }
  const raw = resp.data as unknown;
  const rootArr = Array.isArray(raw) ? raw : [raw];
  const first = rootArr[0] as Record<string, unknown>;
  const tx = (first?.tx as { to: string; data: string; value?: string } | undefined) ?? (first as { to: string; data: string; value?: string });
  return {
    step,
    stepIndex: index,
    to: tx.to as `0x${string}`,
    value: BigInt(tx.value ?? "0"),
    data: tx.data as Hex,
    label: `bridge ${step.amount ?? ""} ${step.token ?? ""} ${srcChain}→${dstChain}`,
    opKind: "BRIDGE",
    chainId: srcChain,
  };
}

export async function planIntent(intent: Intent): Promise<PlannedCall[]> {
  const calls: PlannedCall[] = [];
  const owner = intent.owner as `0x${string}`;
  for (let i = 0; i < intent.steps.length; i++) {
    const s = intent.steps[i];
    switch (s.op) {
      case "APPROVE":
        calls.push(await planApprove(s, i));
        break;
      case "SWAP":
        calls.push(await planSwap(s, i, owner));
        break;
      case "DEPOSIT":
        calls.push(await planDeposit(s, i));
        break;
      case "STAKE":
        calls.push(await planStake(s, i));
        break;
      case "WITHDRAW":
        calls.push(await planWithdraw(s, i));
        break;
      case "BRIDGE":
        calls.push(await planBridge(s, i, owner));
        break;
      case "MINT":
        calls.push(await planDeposit(s, i)); // closest generic match for demo
        break;
      case "RAW":
        calls.push(await planRaw(s, i));
        break;
      default:
        throw new Error(`unsupported op: ${s.op as string}`);
    }
  }
  log.info({ callCount: calls.length }, "planned intent");
  return calls;
}
