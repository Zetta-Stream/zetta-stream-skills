/**
 * Verdict synthesizer. Combines simulator findings + risk-scan findings into
 * { verdict, confidence, reason } per the decision table in CLAUDE.md.
 */
import type { Finding, VerdictResult } from "./intent-types.js";

export function synthesize(findings: Finding[]): VerdictResult {
  const blocks = findings.filter((f) => f.level === "block");
  const warns = findings.filter((f) => f.level === "warn");
  const scanUnavail = findings.filter((f) => f.type === "scan_unavailable");
  // Only consider HARD sim reverts (level=block) for rejection. DEX-op reverts
  // are intentionally emitted as warn-level and treated as advisory.
  const simRevert = findings.find((f) => f.type === "sim_revert" && f.level === "block");

  // Decision table
  if (blocks.length > 0) {
    const top = blocks[0];
    return {
      verdict: "REJECTED",
      confidence: Math.min(98, 90 + blocks.length * 2),
      reason: top.message.slice(0, 140),
      findings,
    };
  }
  if (simRevert) {
    return {
      verdict: "REJECTED",
      confidence: 90,
      reason: simRevert.message.slice(0, 140),
      findings,
    };
  }
  if (warns.length > 0) {
    // If any warn is a scan_unavailable, heuristic path — lower confidence, WARN verdict
    const heuristic = scanUnavail.length === warns.length;
    return {
      verdict: "WARN",
      confidence: heuristic ? 50 : Math.max(60, 80 - warns.length * 5),
      reason: heuristic
        ? `scan unavailable on ${scanUnavail.length} step(s); heuristic fallback`
        : warns[0].message.slice(0, 140),
      findings,
    };
  }
  return {
    verdict: "APPROVED",
    confidence: 92,
    reason: "all checks clean",
    findings,
  };
}
