import { describe, it, expect } from "vitest";
import { synthesize } from "./verdict.js";
import type { Finding } from "./intent-types.js";

const info = (step: number, msg: string): Finding => ({
  level: "info",
  step,
  type: "sim_ok",
  message: msg,
});
const warn = (step: number, type: string, msg: string): Finding => ({
  level: "warn",
  step,
  type,
  message: msg,
});
const block = (step: number, type: string, msg: string): Finding => ({
  level: "block",
  step,
  type,
  message: msg,
});

describe("verdict.synthesize", () => {
  it("returns APPROVED on all-clean", () => {
    const r = synthesize([info(0, "ok"), info(1, "ok")]);
    expect(r.verdict).toBe("APPROVED");
    expect(r.confidence).toBeGreaterThanOrEqual(90);
  });

  it("returns REJECTED on any block", () => {
    const r = synthesize([
      info(0, "ok"),
      block(1, "tx_scan", "malicious spender"),
    ]);
    expect(r.verdict).toBe("REJECTED");
    expect(r.confidence).toBeGreaterThanOrEqual(90);
    expect(r.reason).toContain("malicious");
  });

  it("returns REJECTED on sim_revert even without scan blocks", () => {
    const r = synthesize([
      { level: "block", step: 0, type: "sim_revert", message: "insufficient balance" },
    ]);
    expect(r.verdict).toBe("REJECTED");
  });

  it("returns WARN on warn + sim ok", () => {
    const r = synthesize([info(0, "ok"), warn(0, "dapp_scan", "new spender")]);
    expect(r.verdict).toBe("WARN");
    expect(r.confidence).toBeLessThanOrEqual(80);
    expect(r.confidence).toBeGreaterThanOrEqual(60);
  });

  it("lower confidence WARN when all warns are scan_unavailable", () => {
    const r = synthesize([
      warn(0, "scan_unavailable", "offline"),
      warn(1, "scan_unavailable", "offline"),
    ]);
    expect(r.verdict).toBe("WARN");
    expect(r.confidence).toBe(50);
  });

  it("prefers the highest-severity block in reason", () => {
    const r = synthesize([
      warn(0, "dapp_scan", "meh"),
      block(1, "tx_scan", "CRITICAL PHISHING"),
    ]);
    expect(r.verdict).toBe("REJECTED");
    expect(r.reason).toContain("CRITICAL");
  });
});
