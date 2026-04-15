/**
 * Autonomous rotation loop. Every POLL_INTERVAL_MS:
 *   1. pull x402 yield signal via queryYieldFeed()
 *   2. scoreAndGate (full 4-gate set, `force=false`)
 *   3. if the gate passes, runRotation() — which executes, audits, and mints
 *   4. stream every step as an SSE event
 *
 * Replaces the IntentHub price-watcher. Three consecutive REJECTs auto-pause
 * the loop (state.lastReject is updated) so operators can investigate before
 * it keeps retrying.
 */
import { getConfig } from "../config.js";
import { getLogger } from "../lib/logger.js";
import { emitEvent } from "../api/events.js";
import { runRotation } from "./run-rotation.js";
import { updateRotation, loadState, updateState } from "../state.js";

const log = getLogger("monitor-loop");

let running = false;
let timer: ReturnType<typeof setInterval> | null = null;
let consecutiveRejects = 0;
const MAX_CONSECUTIVE_REJECTS = 3;

/// Per-owner metrics for the session. Reset on every `start()`.
interface SessionMetrics {
  startedAt: number;
  ticksRun: number;
  rotationsExecuted: number;
  totalNetYieldBps: number;
  medalsMinted: number;
}
let session: SessionMetrics | null = null;

export async function tick(): Promise<void> {
  if (!session) return;
  session.ticksRun += 1;

  let result;
  try {
    result = await runRotation({ force: false, tag: "[AUTO]" });
  } catch (e) {
    log.error({ err: (e as Error).message }, "runRotation threw unexpectedly");
    emitEvent({ type: "error", error: (e as Error).message });
    return;
  }

  switch (result.status) {
    case "EXECUTED":
      session.rotationsExecuted += 1;
      session.totalNetYieldBps += result.decision.netYieldBps;
      if (result.medal) session.medalsMinted += 1;
      consecutiveRejects = 0;
      break;
    case "REJECTED":
    case "ERROR":
      consecutiveRejects += 1;
      updateRotation({
        lastReject: { reason: result.reason, at: Date.now() },
      });
      if (consecutiveRejects >= MAX_CONSECUTIVE_REJECTS) {
        log.warn(
          { consecutiveRejects },
          "auto-stopping loop after consecutive REJECTs",
        );
        emitEvent({
          type: "error",
          error: `loop auto-stopped after ${consecutiveRejects} consecutive REJECTs — ${result.reason}`,
        });
        stop();
      }
      break;
    case "HOLD":
    case "GATED":
    default:
      break;
  }

  emitEvent({ type: "heartbeat", t: Date.now() });
}

export function start(autoStopAfterSeconds?: number): { watcherId: string; startedAt: number } {
  const cfg = getConfig();
  if (running) {
    return { watcherId: "watcher_singleton", startedAt: session?.startedAt ?? Date.now() };
  }
  running = true;
  consecutiveRejects = 0;
  session = {
    startedAt: Date.now(),
    ticksRun: 0,
    rotationsExecuted: 0,
    totalNetYieldBps: 0,
    medalsMinted: 0,
  };
  updateState({ monitorRunning: true });
  log.info({ intervalMs: cfg.POLL_INTERVAL_MS, autoStopAfterSeconds }, "monitor loop starting");
  timer = setInterval(() => {
    void tick().catch((e) =>
      log.error({ err: (e as Error).message }, "tick failed"),
    );
  }, cfg.POLL_INTERVAL_MS);
  if (autoStopAfterSeconds && autoStopAfterSeconds > 0) {
    setTimeout(() => {
      log.info({ autoStopAfterSeconds }, "auto-stop deadline reached");
      stop();
    }, autoStopAfterSeconds * 1000);
  }
  return { watcherId: "watcher_singleton", startedAt: session.startedAt };
}

export function stop(): SessionMetrics | null {
  if (!running) return session;
  running = false;
  if (timer) clearInterval(timer);
  timer = null;
  updateState({ monitorRunning: false });
  const metrics = session;
  session = null;
  log.info({ metrics }, "monitor loop stopped");
  return metrics;
}

export function isRunning(): boolean {
  return running;
}

export function getSessionMetrics(): SessionMetrics | null {
  return session;
}

export function currentState() {
  const s = loadState();
  return {
    monitorRunning: running,
    session,
    rotation: s.rotation,
    x402: s.x402,
  };
}
