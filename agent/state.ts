/**
 * Simple JSON-file state persistence. The agent reads at start and writes
 * whenever it mutates rotation/session/delegation state.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { getConfig } from "./config.js";

export interface X402Session {
  sessionId: string;
  openedAt: number;
  expiresAt: number;
  maxQueries: number;
  queriesUsed: number;
  paymentTxHash?: string;
  asset: string;
}

export interface DelegationState {
  mode: "EIP7702" | "MULTICALL_FALLBACK";
  delegateAddress: string;
  authorizedAt: number;
  chainId: number;
  authTxHash?: string;
  supports7702: boolean | null;
}

export type Position = "IDLE" | "AAVE" | "UNIV4";

/// Short ring buffer of recent target decisions, used by the rotator to enforce
/// a `DWELL_SECONDS` worth of consecutive agreement before acting.
export interface SignalTick {
  target: Position;
  netBps: number;
  confidence: number;
  ts: number;
}

export interface RotationState {
  position: Position;
  lastRotatedAt: number;       // unix ms of last completed rotation (0 = never)
  cumulativeYieldBps: number;  // sum of all netYieldBps since agent started
  rotationCount: number;
  medalsMinted: number;
  signalRingBuffer: SignalTick[];  // newest first, capped at 8 entries
  lastReject?: { reason: string; at: number };
}

export const EMPTY_ROTATION: RotationState = {
  position: "IDLE",
  lastRotatedAt: 0,
  cumulativeYieldBps: 0,
  rotationCount: 0,
  medalsMinted: 0,
  signalRingBuffer: [],
};

export interface AgentState {
  ownerAddress: string;
  teeAgentAddress: string;
  x402?: X402Session;
  delegation?: DelegationState;
  rotation: RotationState;
  lastSignalHash?: string;
  monitorRunning: boolean;
  activeWatchers: string[];
}

const EMPTY: AgentState = {
  ownerAddress: "",
  teeAgentAddress: "",
  rotation: EMPTY_ROTATION,
  monitorRunning: false,
  activeWatchers: [],
};

export function loadState(): AgentState {
  const path = getConfig().AGENT_STATE_PATH;
  if (!existsSync(path)) return { ...EMPTY };
  try {
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw) as Partial<AgentState>;
    return {
      ...EMPTY,
      ...parsed,
      rotation: { ...EMPTY_ROTATION, ...(parsed.rotation ?? {}) },
    };
  } catch {
    return { ...EMPTY };
  }
}

export function saveState(s: AgentState): void {
  writeFileSync(getConfig().AGENT_STATE_PATH, JSON.stringify(s, null, 2));
}

export function updateState(patch: Partial<AgentState>): AgentState {
  const next = { ...loadState(), ...patch };
  saveState(next);
  return next;
}

export function updateRotation(patch: Partial<RotationState>): AgentState {
  const s = loadState();
  const next: AgentState = {
    ...s,
    rotation: { ...s.rotation, ...patch },
  };
  saveState(next);
  return next;
}
