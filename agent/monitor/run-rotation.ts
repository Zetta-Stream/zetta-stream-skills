/**
 * Full rotation orchestrator. Used by `POST /rotate` (force=true one-shots) and
 * by the autonomous monitor loop.
 *
 *   queryYieldFeed → scoreAndGate → buildRotationBatch
 *     → executeBatch (7702 / Multicall) → logRotation (X Layer)
 *     → mintMedal (X Layer, if netYieldBps > 0)
 *
 * Emits SSE events at every step so the dashboard can visualise the pipeline
 * live. Returns a structured result for the skill's response JSON.
 */
import { parseUnits } from "viem";
import { queryYieldFeed } from "../x402/query.js";
import { scoreAndGate } from "../decision/rotator.js";
import { buildRotationBatch } from "../decision/intent-builder.js";
import { executeBatch } from "../eip7702/batch-executor.js";
import {
  encodeLogRotation,
  positionToEnum,
  signalHashOf,
  DelegateMode,
} from "../lib/log-encoder.js";
import { runOkx, mustOk } from "../lib/okx-cli.js";
import { getConfig } from "../config.js";
import { getLogger } from "../lib/logger.js";
import { loadState, updateRotation, updateState } from "../state.js";
import { mintMedalFor } from "../medal/medal-mint.js";
import { emitEvent } from "../api/events.js";
import type { Decision, GateResult, YieldSignal } from "../decision/types.js";
import {
  getPublicClient,
  getWalletClient,
  getDemoEoaAccount,
  xLayer,
} from "../lib/viem-clients.js";

const log = getLogger("run-rotation");

export interface RunRotationInput {
  owner?: `0x${string}`;
  force?: boolean;
  tag?: string;
  minBpsOverride?: number;
}

export interface RunRotationResult {
  signal: YieldSignal | null;
  decision: Decision;
  gate: GateResult;
  exec?: {
    batchTxHash: `0x${string}`;
    mode: "EIP7702" | "MULTICALL_FALLBACK";
    gasSavedBps: number;
    callCount: number;
  };
  audit?: { rotationId: number | null; auditTx: `0x${string}` };
  medal?: { mintTx: `0x${string}` };
  reason: string;
  status: "HOLD" | "GATED" | "EXECUTED" | "REJECTED" | "ERROR";
  errorMsg?: string;
}

export async function runRotation(input: RunRotationInput = {}): Promise<RunRotationResult> {
  const cfg = getConfig();
  const state = loadState();
  const owner = (input.owner ?? state.ownerAddress ?? cfg.DEMO_EOA_ADDRESS) as `0x${string}`;
  if (!owner) {
    return blankError("no owner address configured");
  }

  /* 1 · signal ------------------------------------------------------------ */
  let signal: YieldSignal;
  try {
    const { signal: s } = await queryYieldFeed();
    signal = s;
    emitEvent({ type: "signal", signal });
  } catch (e) {
    return blankError(`x402 yield feed unavailable: ${(e as Error).message}`);
  }

  /* 2 · score + gate ----------------------------------------------------- */
  const outcome = scoreAndGate({
    signal,
    currentPosition: state.rotation.position,
    ring: state.rotation.signalRingBuffer,
    lastRotatedAtMs: state.rotation.lastRotatedAt,
    force: input.force === true,
  });
  updateRotation({ signalRingBuffer: outcome.nextRing });
  emitEvent({ type: "analyze", owner, decision: outcome.decision, gate: outcome.gate });

  if (outcome.decision.target === "HOLD") {
    return {
      signal,
      decision: outcome.decision,
      gate: outcome.gate,
      reason: outcome.decision.reason,
      status: "HOLD",
    };
  }
  if (!outcome.gate.pass) {
    return {
      signal,
      decision: outcome.decision,
      gate: outcome.gate,
      reason: `gate blocked: ${outcome.gate.blockedBy}`,
      status: "GATED",
    };
  }

  /* 3 · intent builder --------------------------------------------------- */
  const batch = buildRotationBatch({
    owner,
    decision: outcome.decision,
    currentUsdc: parseUnits(cfg.NOTIONAL_USD.toString(), 6),
  });
  if (!batch) {
    return {
      signal,
      decision: outcome.decision,
      gate: outcome.gate,
      reason: "intent-builder returned null (route too complex)",
      status: "REJECTED",
    };
  }

  /* 4 · batch-executor --------------------------------------------------- */
  let exec;
  try {
    exec = await executeBatch({
      calls: batch.calls.map((c) => ({ to: c.to, value: c.value, data: c.data })),
      opKinds: batch.calls.map(() => "RAW"),
    });
    emitEvent({
      type: "rotation",
      owner,
      from: batch.from,
      to: batch.to,
      batchTxHash: exec.hash,
      netYieldBps: outcome.decision.netYieldBps,
    });
  } catch (e) {
    log.error({ err: (e as Error).message }, "executeBatch failed");
    return {
      signal,
      decision: outcome.decision,
      gate: outcome.gate,
      reason: `batch exec failed: ${(e as Error).message}`,
      status: "ERROR",
      errorMsg: (e as Error).message,
    };
  }

  /* 5 · logRotation on X Layer ------------------------------------------- */
  const gasSavedBps = Math.round(exec.gasCompare.savedPct * 100);
  const prefix = input.tag ? `${input.tag} ` : "";
  const reasonStr = `${prefix}${batch.from}→${batch.to} +${outcome.decision.netYieldBps}bps`;
  const auditCalldata = encodeLogRotation({
    owner,
    signalHash: signalHashOf({
      aavePoolApy: signal.aavePoolApy,
      uniFeeApr: signal.uniFeeApr,
      ilRisk: signal.ilRisk,
      confidence: signal.confidence,
      ts: signal.ts,
    }),
    from: positionToEnum(batch.from),
    to: positionToEnum(batch.to),
    confidence: outcome.decision.confidence,
    netYieldBps: outcome.decision.netYieldBps,
    gasSavedBps,
    batchTxHash: exec.hash,
    mode: exec.mode === "EIP7702" ? DelegateMode.EIP7702 : DelegateMode.MULTICALL_FALLBACK,
    reason: reasonStr,
  });
  const auditTx = await sendAuditTx(auditCalldata);

  // Advance rotation state
  updateRotation({
    position: batch.to,
    lastRotatedAt: Date.now(),
    cumulativeYieldBps: state.rotation.cumulativeYieldBps + outcome.decision.netYieldBps,
    rotationCount: state.rotation.rotationCount + 1,
  });
  updateState({ lastSignalHash: signalHashOf(signal) });

  /* 6 · mint Medal if profit ---------------------------------------------- */
  let medalResult: { mintTx: `0x${string}` } | undefined;
  if (outcome.decision.netYieldBps > 0 && cfg.ZETTA_STREAM_MEDAL_ADDRESS) {
    try {
      const { mintTx } = await mintMedalFor({
        recipient: owner,
        rotationId: BigInt(state.rotation.rotationCount), // id of the rotation we just appended
        netYieldBps: outcome.decision.netYieldBps,
      });
      medalResult = { mintTx };
      updateRotation({ medalsMinted: state.rotation.medalsMinted + 1 });
      emitEvent({
        type: "medal",
        owner,
        tokenId: state.rotation.medalsMinted,
        mintTx,
      });
    } catch (e) {
      log.warn({ err: (e as Error).message }, "medal mint failed (non-fatal)");
    }
  }

  return {
    signal,
    decision: outcome.decision,
    gate: outcome.gate,
    exec: {
      batchTxHash: exec.hash,
      mode: exec.mode,
      gasSavedBps,
      callCount: batch.calls.length,
    },
    audit: { rotationId: null, auditTx },
    medal: medalResult,
    reason: reasonStr,
    status: "EXECUTED",
  };
}

/* ───────────────────── internal helpers ────────────────────── */

async function sendAuditTx(calldata: `0x${string}`): Promise<`0x${string}`> {
  const cfg = getConfig();
  if (cfg.LOCAL_SIGN_FALLBACK) {
    const wallet = getWalletClient();
    const eoa = getDemoEoaAccount();
    if (!wallet || !eoa) throw new Error("LOCAL_SIGN_FALLBACK but no wallet");
    return wallet.sendTransaction({
      account: eoa,
      chain: xLayer,
      to: cfg.ZETTA_STREAM_LOG_ADDRESS as `0x${string}`,
      data: calldata,
      value: 0n,
      gas: 500_000n,
      type: "legacy",
    });
  }
  const resp = await runOkx<{ txHash?: string; hash?: string }>(
    "wallet",
    "contract-call",
    [
      "--to",
      cfg.ZETTA_STREAM_LOG_ADDRESS,
      "--chain",
      "196",
      "--input-data",
      calldata,
      "--value",
      "0",
      "--force",
    ],
    { reason: "logRotation", timeoutMs: 90_000 },
  );
  const data = mustOk(resp, "logRotation");
  const hash =
    ((data as { txHash?: string }).txHash ?? (data as { hash?: string }).hash) as
      | `0x${string}`
      | undefined;
  if (!hash) throw new Error("logRotation: no tx hash returned");
  return hash;
}

function blankError(msg: string): RunRotationResult {
  return {
    signal: null,
    decision: {
      target: "HOLD",
      currentPosition: "IDLE",
      grossSpreadBps: 0,
      ilPenaltyBps: 0,
      gasCostBps: 0,
      rawNetBps: 0,
      netYieldBps: 0,
      confidence: 0,
      score: 0,
      reason: msg,
    },
    gate: { pass: false, dwellProgress: 0, secondsUntilReady: 0 },
    reason: msg,
    status: "ERROR",
    errorMsg: msg,
  };
}
