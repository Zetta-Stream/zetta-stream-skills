/**
 * The 24/7 watcher loop. Every POLL_INTERVAL_MS:
 *   1) Poll the x402 session for each unique symbol used by active watchers
 *   2) Evaluate each watcher's condition
 *   3) If fired, run firewall → (if APPROVED) batch-executor → write audit
 *   4) Emit SSE events
 */
import { getConfig } from "../config.js";
import { queryPrice } from "../x402/query.js";
import {
  listWatchers,
  evaluate,
  markFired,
  isCoolingDown,
  isExpired,
  type Watcher,
} from "./trigger.js";
import { getLogger } from "../lib/logger.js";
import { emitEvent, type SseEvent } from "../api/events.js";

const log = getLogger("monitor-loop");

let running = false;
let timer: ReturnType<typeof setInterval> | null = null;

export async function tick(): Promise<void> {
  const watchers = listWatchers();
  if (watchers.length === 0) return;
  const symbols = Array.from(new Set(watchers.map((w) => w.condition.symbol)));
  const prices: Record<string, number> = {};
  for (const s of symbols) {
    try {
      const q = await queryPrice(s);
      prices[s] = q.price;
      emitEvent({ type: "poll", symbol: s, price: q.price, latencyMs: q.latencyMs, t: q.t });
    } catch (e) {
      log.warn({ err: (e as Error).message, symbol: s }, "poll failed");
    }
  }
  for (const w of watchers) {
    if (isExpired(w)) {
      w.status = "expired";
      emitEvent({ type: "expire", watcher: w.id });
      continue;
    }
    if (isCoolingDown(w)) continue;
    const p = prices[w.condition.symbol];
    if (p === undefined) continue;
    if (!evaluate(w, p)) continue;
    void fireWatcher(w, p);
  }
}

async function fireWatcher(w: Watcher, price: number) {
  emitEvent({
    type: "fire",
    watcher: w.id,
    price,
    condition: `${w.condition.symbol} ${w.condition.op} ${w.condition.value}`,
  } as SseEvent);
  try {
    // Dynamic import avoids a startup cycle + keeps the loop lean
    const { runFullIntent } = await import("./run-intent.js");
    const result = await runFullIntent(w.thenIntent);
    emitEvent({
      type: "verdict",
      watcher: w.id,
      intentHash: result.intentHash,
      verdict: result.verdict,
      confidence: result.confidence,
      hash: result.hash,
    } as SseEvent);
    markFired(w);
  } catch (e) {
    log.error({ err: (e as Error).message, watcher: w.id }, "watcher fire failed");
    emitEvent({ type: "error", watcher: w.id, error: (e as Error).message } as SseEvent);
    markFired(w);
  }
}

export function start(): void {
  if (running) return;
  running = true;
  const cfg = getConfig();
  log.info({ intervalMs: cfg.POLL_INTERVAL_MS }, "monitor loop starting");
  timer = setInterval(() => {
    void tick().catch((e) =>
      log.error({ err: (e as Error).message }, "tick failed"),
    );
  }, cfg.POLL_INTERVAL_MS);
}

export function stop(): void {
  if (!running) return;
  running = false;
  if (timer) clearInterval(timer);
  timer = null;
  log.info("monitor loop stopped");
}
