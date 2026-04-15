/**
 * Calldata encoding for ZettaStreamLog.logIntent + logDelegation.
 * Callers pass high-level objects; we return `0x...` hex strings to pass to
 * `onchainos wallet contract-call --input-data <hex>`.
 */
import { encodeFunctionData, keccak256, toHex, type Hex } from "viem";

// Mirrors the enum in ZettaStreamLog.sol (order matters).
export enum Verdict {
  PENDING = 0,
  APPROVED = 1,
  REJECTED = 2,
  EXECUTED = 3,
}

export enum DelegateMode {
  EIP7702 = 0,
  MULTICALL_FALLBACK = 1,
}

const logIntentAbi = [
  {
    type: "function",
    name: "logIntent",
    inputs: [
      { name: "owner", type: "address" },
      { name: "intentHash", type: "bytes32" },
      { name: "verdict", type: "uint8" },
      { name: "confidence", type: "uint8" },
      { name: "gasSaved", type: "uint32" },
      { name: "txHashes", type: "bytes32[]" },
      { name: "reason", type: "string" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "logDelegation",
    inputs: [
      { name: "eoa", type: "address" },
      { name: "delegate", type: "address" },
      { name: "chainId", type: "uint256" },
      { name: "authTxHash", type: "bytes32" },
      { name: "mode", type: "uint8" },
    ],
    outputs: [{ type: "uint256" }],
  },
] as const;

export interface LogIntentArgs {
  owner: `0x${string}`;
  intentHash: `0x${string}`;
  verdict: Verdict;
  confidence: number;
  gasSaved: number;
  txHashes: `0x${string}`[];
  reason: string;
}

export function encodeLogIntent(args: LogIntentArgs): Hex {
  return encodeFunctionData({
    abi: logIntentAbi,
    functionName: "logIntent",
    args: [
      args.owner,
      args.intentHash,
      args.verdict,
      args.confidence,
      args.gasSaved,
      args.txHashes,
      args.reason,
    ],
  });
}

export interface LogDelegationArgs {
  eoa: `0x${string}`;
  delegate: `0x${string}`;
  chainId: bigint | number;
  authTxHash: `0x${string}`;
  mode: DelegateMode;
}

export function encodeLogDelegation(args: LogDelegationArgs): Hex {
  return encodeFunctionData({
    abi: logIntentAbi,
    functionName: "logDelegation",
    args: [
      args.eoa,
      args.delegate,
      BigInt(args.chainId),
      args.authTxHash,
      args.mode,
    ],
  });
}

/** Hash a normalized intent JSON for on-chain reference. */
export function intentHashOf(intent: unknown): `0x${string}` {
  const normalized = JSON.stringify(intent, Object.keys(intent as object).sort());
  return keccak256(toHex(normalized));
}
