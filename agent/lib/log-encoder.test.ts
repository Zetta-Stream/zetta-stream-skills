import { describe, it, expect } from "vitest";
import {
  encodeLogIntent,
  encodeLogDelegation,
  intentHashOf,
  Verdict,
  DelegateMode,
} from "./log-encoder.js";

describe("log-encoder", () => {
  it("encodeLogIntent produces 0x-prefixed selector for logIntent", () => {
    const data = encodeLogIntent({
      owner: "0x1111111111111111111111111111111111111111",
      intentHash: "0x2222222222222222222222222222222222222222222222222222222222222222",
      verdict: Verdict.EXECUTED,
      confidence: 95,
      gasSaved: 12345,
      txHashes: [
        "0x3333333333333333333333333333333333333333333333333333333333333333",
      ],
      reason: "batch 3 steps",
    });
    expect(data).toMatch(/^0x[0-9a-f]+$/i);
    expect(data.length).toBeGreaterThan(500);
  });

  it("encodeLogDelegation round-trips mode byte", () => {
    const data7702 = encodeLogDelegation({
      eoa: "0x1111111111111111111111111111111111111111",
      delegate: "0x2222222222222222222222222222222222222222",
      chainId: 196,
      authTxHash: "0x3333333333333333333333333333333333333333333333333333333333333333",
      mode: DelegateMode.EIP7702,
    });
    const dataMulti = encodeLogDelegation({
      eoa: "0x1111111111111111111111111111111111111111",
      delegate: "0x2222222222222222222222222222222222222222",
      chainId: 196,
      authTxHash: "0x3333333333333333333333333333333333333333333333333333333333333333",
      mode: DelegateMode.MULTICALL_FALLBACK,
    });
    expect(data7702).not.toBe(dataMulti);
  });

  it("intentHashOf is deterministic for same content", () => {
    const a = intentHashOf({ kind: "BATCH", steps: [1, 2], owner: "0xabc" });
    const b = intentHashOf({ steps: [1, 2], owner: "0xabc", kind: "BATCH" });
    expect(a).toBe(b);
  });

  it("intentHashOf differs for different content", () => {
    const a = intentHashOf({ kind: "BATCH", steps: [1], owner: "0x1" });
    const b = intentHashOf({ kind: "BATCH", steps: [2], owner: "0x1" });
    expect(a).not.toBe(b);
  });
});
