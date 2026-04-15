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

/* ────────────────────────────────────────────────────────────────────────
 * Zetta-Stream: Rotation + Medal encoders
 * Keyed against the current (Rotation/Position) contract ABI.
 * ──────────────────────────────────────────────────────────────────────── */

export enum Position {
  IDLE = 0,
  AAVE = 1,
  UNIV4 = 2,
}

const rotationAbi = [
  {
    type: "function",
    name: "logRotation",
    inputs: [
      { name: "owner", type: "address" },
      { name: "signalHash", type: "bytes32" },
      { name: "from", type: "uint8" },
      { name: "to", type: "uint8" },
      { name: "confidence", type: "uint8" },
      { name: "netYieldBps", type: "int32" },
      { name: "gasSavedBps", type: "uint32" },
      { name: "batchTxHash", type: "bytes32" },
      { name: "mode", type: "uint8" },
      { name: "reason", type: "string" },
    ],
    outputs: [{ type: "uint256" }],
  },
] as const;

const medalAbi = [
  {
    type: "function",
    name: "mintTo",
    inputs: [
      { name: "to", type: "address" },
      { name: "rotationId", type: "uint256" },
      { name: "netYieldBps", type: "int32" },
    ],
    outputs: [{ type: "uint256" }],
  },
] as const;

export interface LogRotationArgs {
  owner: `0x${string}`;
  signalHash: `0x${string}`;
  from: Position;
  to: Position;
  confidence: number;
  netYieldBps: number;
  gasSavedBps: number;
  batchTxHash: `0x${string}`;
  mode: DelegateMode;
  reason: string;
}

export function encodeLogRotation(args: LogRotationArgs): Hex {
  return encodeFunctionData({
    abi: rotationAbi,
    functionName: "logRotation",
    args: [
      args.owner,
      args.signalHash,
      args.from,
      args.to,
      args.confidence,
      args.netYieldBps,
      args.gasSavedBps,
      args.batchTxHash,
      args.mode,
      args.reason.slice(0, 140),
    ],
  });
}

export interface MintMedalArgs {
  to: `0x${string}`;
  rotationId: bigint;
  netYieldBps: number;
}

export function encodeMintMedal(args: MintMedalArgs): Hex {
  return encodeFunctionData({
    abi: medalAbi,
    functionName: "mintTo",
    args: [args.to, args.rotationId, args.netYieldBps],
  });
}

/** Hash a canonical JSON of the YieldSignal for tamper-evident on-chain refs. */
export function signalHashOf(signal: unknown): `0x${string}` {
  const normalized = JSON.stringify(signal, Object.keys(signal as object).sort());
  return keccak256(toHex(normalized));
}

export function positionToEnum(p: "IDLE" | "AAVE" | "UNIV4"): Position {
  return p === "IDLE" ? Position.IDLE : p === "AAVE" ? Position.AAVE : Position.UNIV4;
}
