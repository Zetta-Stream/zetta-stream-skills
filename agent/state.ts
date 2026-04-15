/**
 * Simple JSON-file state persistence. The agent reads at start and writes
 * whenever it mutates owner/session/delegation state.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { getConfig } from "./config.js";

export interface X402Session {
  sessionId: string;
  openedAt: number;   // unix ms
  expiresAt: number;  // unix ms
  maxQueries: number;
  queriesUsed: number;
  paymentTxHash?: string;
  asset: string;
}

export interface DelegationState {
  mode: "EIP7702" | "MULTICALL_FALLBACK";
  delegateAddress: string;
  authorizedAt: number;  // unix ms
  chainId: number;
  authTxHash?: string;
  supports7702: boolean | null;  // null = not probed yet
}

export interface AgentState {
  ownerAddress: string;
  teeAgentAddress: string;
  x402?: X402Session;
  delegation?: DelegationState;
  lastIntentHash?: string;
  activeWatchers: string[]; // watcher IDs
}

const EMPTY: AgentState = {
  ownerAddress: "",
  teeAgentAddress: "",
  activeWatchers: [],
};

export function loadState(): AgentState {
  const path = getConfig().AGENT_STATE_PATH;
  if (!existsSync(path)) return { ...EMPTY };
  try {
    const raw = readFileSync(path, "utf8");
    return { ...EMPTY, ...(JSON.parse(raw) as Partial<AgentState>) };
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
