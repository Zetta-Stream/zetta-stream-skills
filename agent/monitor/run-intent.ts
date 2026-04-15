/**
 * Runs the full intent pipeline: firewall → (APPROVED) batch-executor → audit log.
 * Used by both the monitor loop and the API /intent endpoint.
 */
import { runFirewall } from "../firewall/pipeline.js";
import { executeBatch } from "../eip7702/batch-executor.js";
import { runOkx, mustOk } from "../lib/okx-cli.js";
import { encodeLogIntent, Verdict as V, intentHashOf } from "../lib/log-encoder.js";
import { getConfig } from "../config.js";
import { getLogger } from "../lib/logger.js";
import { getWalletClient, getDemoEoaAccount, xLayer } from "../lib/viem-clients.js";
import type { Intent } from "../firewall/intent-types.js";

const log = getLogger("run-intent");

export interface FullResult {
  intentHash: `0x${string}`;
  verdict: "APPROVED" | "REJECTED" | "WARN" | "EXECUTED";
  confidence: number;
  reason: string;
  hash?: `0x${string}`;                 // batch tx hash, only on EXECUTED
  auditTx?: `0x${string}`;              // X Layer audit tx
  mode?: "EIP7702" | "MULTICALL_FALLBACK";
  gasSavedPct?: number;
  txHashes: `0x${string}`[];
}

export async function runFullIntent(intent: Intent): Promise<FullResult> {
  const cfg = getConfig();
  const report = await runFirewall(intent);
  const out: FullResult = {
    intentHash: report.intentHash,
    verdict: report.verdict.verdict,
    confidence: report.verdict.confidence,
    reason: report.verdict.reason,
    txHashes: [],
  };

  if (report.verdict.verdict === "APPROVED" && report.verdict.confidence >= cfg.MIN_CONFIDENCE_APPROVE) {
    const exec = await executeBatch({
      calls: report.calls.map((c) => ({ to: c.to, value: c.value, data: c.data })),
      opKinds: report.calls.map((c) => c.opKind),
    });
    out.hash = exec.hash;
    out.mode = exec.mode;
    out.gasSavedPct = exec.gasCompare.savedPct;
    out.txHashes = [exec.hash];
    out.verdict = "EXECUTED";
  }

  // Audit to X Layer
  if (cfg.ZETTA_STREAM_LOG_ADDRESS) {
    try {
      const auditCalldata = encodeLogIntent({
        owner: intent.owner as `0x${string}`,
        intentHash: intentHashOf(intent),
        verdict:
          out.verdict === "EXECUTED"
            ? V.EXECUTED
            : out.verdict === "REJECTED"
            ? V.REJECTED
            : out.verdict === "WARN"
            ? V.PENDING
            : V.APPROVED,
        confidence: out.confidence,
        gasSaved: out.gasSavedPct ? Math.round(out.gasSavedPct * 1000) : 0,
        txHashes: out.txHashes,
        reason: out.reason.slice(0, 140),
      });
      let auditHash: `0x${string}` | undefined;
      if (cfg.LOCAL_SIGN_FALLBACK) {
        const wallet = getWalletClient();
        const eoaAccount = getDemoEoaAccount();
        if (!wallet || !eoaAccount) throw new Error("LOCAL_SIGN_FALLBACK=true but no wallet client");
        auditHash = await wallet.sendTransaction({
          account: eoaAccount,
          chain: xLayer,
          to: cfg.ZETTA_STREAM_LOG_ADDRESS as `0x${string}`,
          data: auditCalldata,
          value: 0n,
          gas: 500_000n,
          type: "legacy",
        });
      } else {
        const auditResp = await runOkx<{ txHash?: string; hash?: string }>(
          "wallet",
          "contract-call",
          [
            "--to",
            cfg.ZETTA_STREAM_LOG_ADDRESS,
            "--chain",
            "196",
            "--input-data",
            auditCalldata,
            "--value",
            "0",
            "--force",
          ],
          { reason: "logIntent", timeoutMs: 90_000 },
        );
        const auditData = mustOk(auditResp, "logIntent");
        auditHash = ((auditData as { txHash?: string; hash?: string }).txHash ??
          (auditData as { hash?: string }).hash) as `0x${string}` | undefined;
      }
      out.auditTx = auditHash;
    } catch (e) {
      log.warn({ err: (e as Error).message }, "audit log write failed (non-fatal for demo)");
    }
  } else {
    log.warn("ZETTA_STREAM_LOG_ADDRESS not set — skipping audit write");
  }

  return out;
}
