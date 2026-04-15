/**
 * The firewall pipeline: plan → simulate → risk-scan → verdict.
 * Returns a VerdictResult + PlannedCall[]. The caller (zetta-stream-action skill
 * handler) decides whether to call batch-executor and write ZettaStreamLog.
 */
import { intentSchema, type Intent, type PlannedCall, type VerdictResult, type Finding } from "./intent-types.js";
import { planIntent } from "./planner.js";
import { simulate } from "./simulator.js";
import { scanAll } from "./risk-scan.js";
import { synthesize } from "./verdict.js";
import { intentHashOf } from "../lib/log-encoder.js";
import { getLogger } from "../lib/logger.js";

const log = getLogger("firewall");

export interface FirewallReport {
  intent: Intent;
  intentHash: `0x${string}`;
  calls: PlannedCall[];
  findings: Finding[];
  verdict: VerdictResult;
}

export async function runFirewall(raw: unknown): Promise<FirewallReport> {
  const intent = intentSchema.parse(raw);
  const intentHash = intentHashOf(intent);
  log.info({ intentHash, kind: intent.kind, steps: intent.steps.length }, "firewall start");

  const calls = await planIntent(intent);
  const simReport = await simulate(intent.owner as `0x${string}`, calls);
  const scanFindings = simReport.firstFailureIndex === null ? await scanAll(calls) : [];
  const findings = [...simReport.findings, ...scanFindings];
  const verdict = synthesize(findings);

  log.info(
    { intentHash, verdict: verdict.verdict, confidence: verdict.confidence, reason: verdict.reason },
    "firewall verdict",
  );

  return { intent, intentHash, calls, findings, verdict };
}
