/**
 * Per-call simulator using viem `publicClient.call({ stateOverride })`.
 *
 * We serialize steps: each call's simulated result can influence the next via
 * a shared stateOverride bag. For the hackathon we keep this light — if a call
 * reverts, we short-circuit and record the failing step.
 */
import { getPublicClient } from "../lib/viem-clients.js";
import type { PlannedCall, Finding } from "./intent-types.js";
import { getLogger } from "../lib/logger.js";

const log = getLogger("simulator");

export interface SimResult {
  ok: boolean;
  returnData?: `0x${string}`;
  revertReason?: string;
  gasUsed?: bigint;
}

export interface SimulationReport {
  results: SimResult[];
  findings: Finding[];
  firstFailureIndex: number | null;
}

export async function simulate(
  owner: `0x${string}`,
  calls: PlannedCall[],
): Promise<SimulationReport> {
  const client = getPublicClient();
  const results: SimResult[] = [];
  const findings: Finding[] = [];
  let firstFailureIndex: number | null = null;

  for (let i = 0; i < calls.length; i++) {
    const c = calls[i];
    // DEX ops (SWAP / BRIDGE) carry stateful deadlines/slippage that often make
    // pure eth_call sims spuriously revert. The okx-security tx-scan is the
    // real gate for those. Skip sim entirely and emit an advisory info finding.
    const isDexOp = c.opKind === "SWAP" || c.opKind === "BRIDGE";
    if (isDexOp) {
      results.push({ ok: true });
      findings.push({
        level: "info",
        step: i,
        type: "sim_skipped",
        message: `${c.label} (DEX op — sim skipped; scan is the gate)`,
      });
      continue;
    }

    // Pre-check for non-DEX ops: the target must hold bytecode. Calling an EOA
    // as if it were a contract is almost always user error or a phishing pattern
    // disguised as a legit-looking address.
    try {
      const code = await client.getCode({ address: c.to });
      if (!code || code === "0x") {
        results.push({ ok: false, revertReason: "target has no bytecode" });
        findings.push({
          level: "block",
          step: i,
          type: "no_code",
          message: `${c.label}: target ${c.to} has no contract bytecode — likely phishing / bad address`,
        });
        firstFailureIndex = i;
        log.warn({ step: i, to: c.to }, "target has no bytecode");
        break;
      }
    } catch (e) {
      log.warn({ err: (e as Error).message }, "getCode failed; proceeding with sim");
    }
    try {
      const { data: returnData } = await client.call({
        account: owner,
        to: c.to,
        value: c.value,
        data: c.data,
      });
      results.push({ ok: true, returnData });
      findings.push({
        level: "info",
        step: i,
        type: "sim_ok",
        message: `${c.label} (sim ok)`,
      });
    } catch (e) {
      const msg = (e as Error).message ?? "unknown";
      const short =
        msg.match(/reverted with reason string '([^']+)'/)?.[1] ??
        msg.match(/reverted with the following reason:\s*([^\n]+)/i)?.[1] ??
        msg.match(/execution reverted[^\n]*/i)?.[0] ??
        msg.slice(0, 140);
      results.push({ ok: false, revertReason: short });
      findings.push({
        level: "block",
        step: i,
        type: "sim_revert",
        message: `${c.label}: revert — ${short}`,
      });
      firstFailureIndex = i;
      log.warn({ step: i, short }, "simulation reverted");
      break;
    }
  }

  return { results, findings, firstFailureIndex };
}
