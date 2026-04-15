/**
 * Pass each PlannedCall through okx-security tx-scan; APPROVE ops additionally
 * trigger a dapp-scan of the spender. Aggregates into typed Findings.
 *
 * Fail-safe: if the scanner returns an error or times out, we emit a WARN-level
 * finding with type "scan_unavailable" — the verdict layer biases to REJECT
 * unless the spender is in a pre-configured whitelist.
 */
import { runOkx } from "../lib/okx-cli.js";
import type { PlannedCall, Finding } from "./intent-types.js";
import { getLogger } from "../lib/logger.js";
import { getConfig } from "../config.js";

const log = getLogger("risk-scan");

interface ScanResponse {
  action?: string;
  level?: string;
  risks?: Array<{ level?: string; title?: string; description?: string }>;
  items?: Array<{ level?: string; title?: string; description?: string }>;
  riskItemDetail?: Array<{ level?: string; title?: string; description?: string }>;
  warnings?: unknown;
  tags?: string[];
  verdict?: string;
  simulator?: { revertReason?: string };
}

const SCAN_TIMEOUT_MS = 5_000;

// A tiny whitelist so that if scan is unavailable, well-known spenders still pass.
// Extend for your deployment.
const TRUSTED_SPENDERS = new Set<string>([
  "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5", // Aave V3 Pool (Base)
]);

function readLevel(r: ScanResponse | undefined): "block" | "warn" | "safe" | "unknown" {
  if (!r) return "unknown";
  const raw = (r.action ?? r.level ?? r.verdict ?? "").toString().toLowerCase();
  if (raw.includes("block") || raw.includes("dang") || raw.includes("deny")) return "block";
  if (raw.includes("warn") || raw.includes("caution") || raw.includes("risk")) return "warn";
  if (raw.includes("safe") || raw.includes("allow") || raw.includes("pass")) return "safe";
  // OKX tx-scan returns action="" with empty risk/warning arrays when the call
  // is clean. Treat (empty action) + (no risks) + (no warnings) as SAFE.
  const risks = (r.risks ?? r.items ?? r.riskItemDetail ?? []) as unknown[];
  const warnings = Array.isArray(r.warnings) ? r.warnings : r.warnings ? [r.warnings] : [];
  if (raw === "" && risks.length === 0 && warnings.length === 0) return "safe";
  return "unknown";
}

export async function scanCall(call: PlannedCall): Promise<Finding[]> {
  const findings: Finding[] = [];
  const cfg = getConfig();
  const from = cfg.DEMO_EOA_ADDRESS || "0x0000000000000000000000000000000000000000";
  try {
    const resp = await runOkx<ScanResponse>(
      "security",
      "tx-scan",
      [
        "--chain",
        call.chainId.toString(),
        "--from",
        from,
        "--to",
        call.to,
        "--data",
        call.data,
      ],
      { reason: `risk-scan step ${call.stepIndex}`, timeoutMs: SCAN_TIMEOUT_MS },
    );
    if (!resp.ok) {
      findings.push({
        level: "warn",
        step: call.stepIndex,
        type: "scan_unavailable",
        message: `tx-scan failed: ${"message" in resp ? resp.message : "unknown"}`,
      });
      return findings;
    }
    const level = readLevel(resp.data as ScanResponse);
    const detail = resp.data as ScanResponse;
    const risks = detail?.risks ?? detail?.items ?? [];
    if (level === "block") {
      findings.push({
        level: "block",
        step: call.stepIndex,
        type: "tx_scan",
        message: `${call.label}: tx-scan BLOCK — ${(risks[0]?.title ?? detail?.tags?.[0] ?? "malicious call")}`,
        detail,
      });
    } else if (level === "warn") {
      findings.push({
        level: "warn",
        step: call.stepIndex,
        type: "tx_scan",
        message: `${call.label}: tx-scan WARN — ${(risks[0]?.title ?? "moderate risk")}`,
        detail,
      });
    } else {
      findings.push({
        level: "info",
        step: call.stepIndex,
        type: "tx_scan",
        message: `${call.label}: tx-scan ${level === "safe" ? "SAFE" : "unknown (treated as info)"}`,
      });
    }
  } catch (e) {
    log.warn({ err: (e as Error).message, step: call.stepIndex }, "tx-scan threw");
    findings.push({
      level: "warn",
      step: call.stepIndex,
      type: "scan_unavailable",
      message: `tx-scan threw: ${(e as Error).message}`,
    });
  }

  // Extra dapp-scan for APPROVE: check spender against the database.
  if (call.opKind === "APPROVE") {
    const spender = call.step.spender;
    if (spender && spender.startsWith("0x")) {
      try {
        const resp = await runOkx<ScanResponse>(
          "security",
          "dapp-scan",
          ["--chain", call.chainId.toString(), "--address", spender],
          { reason: `dapp-scan step ${call.stepIndex}`, timeoutMs: SCAN_TIMEOUT_MS },
        );
        if (!resp.ok) {
          const trusted = TRUSTED_SPENDERS.has(spender);
          findings.push({
            level: trusted ? "info" : "warn",
            step: call.stepIndex,
            type: "scan_unavailable",
            message: trusted
              ? `dapp-scan unavailable; spender ${spender} whitelisted`
              : `dapp-scan unavailable; spender ${spender} unknown (heuristic warn)`,
          });
        } else {
          const level = readLevel(resp.data as ScanResponse);
          if (level === "block") {
            findings.push({
              level: "block",
              step: call.stepIndex,
              type: "dapp_scan",
              message: `spender ${spender}: dapp-scan BLOCK (${((resp.data as ScanResponse)?.tags ?? []).join(",") || "malicious"})`,
            });
          } else if (level === "warn") {
            findings.push({
              level: "warn",
              step: call.stepIndex,
              type: "dapp_scan",
              message: `spender ${spender}: dapp-scan WARN`,
            });
          } else {
            findings.push({
              level: "info",
              step: call.stepIndex,
              type: "dapp_scan",
              message: `spender ${spender}: dapp-scan ${level === "safe" ? "SAFE" : "info"}`,
            });
          }
        }
      } catch (e) {
        const trusted = TRUSTED_SPENDERS.has(spender);
        findings.push({
          level: trusted ? "info" : "warn",
          step: call.stepIndex,
          type: "scan_unavailable",
          message: trusted
            ? `dapp-scan exception; spender ${spender} whitelisted (${(e as Error).message})`
            : `dapp-scan exception: ${(e as Error).message}`,
        });
      }
    }
  }
  return findings;
}

export async function scanAll(calls: PlannedCall[]): Promise<Finding[]> {
  const out: Finding[] = [];
  for (const c of calls) {
    const f = await scanCall(c);
    out.push(...f);
  }
  return out;
}
