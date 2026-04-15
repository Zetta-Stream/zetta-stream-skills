/**
 * Shared intent shapes used across planner / simulator / risk-scan / verdict.
 * Must stay in sync with the input schema in `zetta-stream-action/SKILL.md`.
 */
import { z } from "zod";

export const intentOpSchema = z.enum([
  "APPROVE",
  "SWAP",
  "DEPOSIT",
  "WITHDRAW",
  "BRIDGE",
  "STAKE",
  "MINT",
  "RAW",
]);
export type IntentOp = z.infer<typeof intentOpSchema>;

export const intentStepSchema = z.object({
  op: intentOpSchema,
  chainId: z.number().int().default(196),
  token: z.string().optional(),
  to: z.string().optional(),
  amount: z.string().optional(),
  spender: z.string().optional(),
  params: z.record(z.unknown()).optional(),
});
export type IntentStep = z.infer<typeof intentStepSchema>;

export const intentSchema = z.object({
  kind: z.string(),
  owner: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  steps: z.array(intentStepSchema).min(1).max(8),
  options: z.record(z.unknown()).optional().default({}),
});
export type Intent = z.infer<typeof intentSchema>;

export interface PlannedCall {
  step: IntentStep;
  stepIndex: number;
  to: `0x${string}`;
  value: bigint;
  data: `0x${string}`;
  label: string;         // for logs / SSE, e.g. "approve USDC → <vault>"
  opKind: IntentOp;
  chainId: number;
}

export type FindingLevel = "info" | "warn" | "block";

export interface Finding {
  level: FindingLevel;
  step: number;
  type: string;          // e.g. "sim_ok" | "sim_revert" | "tx_scan" | "dapp_scan"
  message: string;
  detail?: unknown;
}

export type VerdictKind = "APPROVED" | "REJECTED" | "WARN";

export interface VerdictResult {
  verdict: VerdictKind;
  confidence: number;
  reason: string;
  findings: Finding[];
}
