/**
 * Trigger registry: keeps (condition, then_intent) watchers in memory.
 * On fire, invokes the full firewall pipeline and (if APPROVED) the batch executor.
 */
import { randomUUID } from "node:crypto";
import type { Intent } from "../firewall/intent-types.js";
import { getLogger } from "../lib/logger.js";

const log = getLogger("trigger");

export interface Condition {
  symbol: string;
  op: "<" | ">" | "==";
  value: number;
  source?: "x402_session" | "okx_market";
}

export interface WatcherOptions {
  repeat?: boolean;
  max_fires?: number;
  expires_at_unix?: number;
  cooldown_seconds?: number;
}

export interface Watcher {
  id: string;
  createdAt: number;
  condition: Condition;
  thenIntent: Intent;
  options: WatcherOptions;
  firesLeft: number;
  lastFireAt?: number;
  status: "active" | "fired" | "expired" | "cancelled";
}

const watchers = new Map<string, Watcher>();
const MAX_WATCHERS = 10;

export function listWatchers(): Watcher[] {
  return Array.from(watchers.values());
}

export function getWatcher(id: string): Watcher | undefined {
  return watchers.get(id);
}

export function cancelWatcher(id: string): boolean {
  const w = watchers.get(id);
  if (!w) return false;
  w.status = "cancelled";
  watchers.delete(id);
  return true;
}

export function registerWatcher(input: {
  condition: Condition;
  thenIntent: Intent;
  options?: WatcherOptions;
}): Watcher {
  if (watchers.size >= MAX_WATCHERS) {
    throw new Error(`max ${MAX_WATCHERS} active watchers — cancel one first`);
  }
  const opts: WatcherOptions = input.options ?? {};
  const id = `w_${randomUUID().replace(/-/g, "").slice(0, 8)}`;
  const w: Watcher = {
    id,
    createdAt: Date.now(),
    condition: input.condition,
    thenIntent: input.thenIntent,
    options: opts,
    firesLeft: opts.max_fires ?? 1,
    status: "active",
  };
  watchers.set(id, w);
  log.info({ id, condition: w.condition }, "watcher registered");
  return w;
}

export function evaluate(w: Watcher, price: number): boolean {
  switch (w.condition.op) {
    case "<":
      return price < w.condition.value;
    case ">":
      return price > w.condition.value;
    case "==":
      return Math.abs(price - w.condition.value) < 1e-6;
  }
}

/**
 * Post-fire bookkeeping. The actual firing (firewall → batch-executor) happens
 * in `monitor/loop.ts` so we don't import the heavy modules here.
 */
export function markFired(w: Watcher): "done" | "rearm" {
  w.firesLeft -= 1;
  w.lastFireAt = Date.now();
  if (w.firesLeft <= 0 || !w.options.repeat) {
    w.status = "fired";
    watchers.delete(w.id);
    return "done";
  }
  return "rearm";
}

export function isCoolingDown(w: Watcher): boolean {
  if (!w.options.cooldown_seconds || !w.lastFireAt) return false;
  return Date.now() - w.lastFireAt < w.options.cooldown_seconds * 1000;
}

export function isExpired(w: Watcher): boolean {
  if (!w.options.expires_at_unix) return false;
  return Math.floor(Date.now() / 1000) > w.options.expires_at_unix;
}
