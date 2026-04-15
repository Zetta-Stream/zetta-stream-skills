/**
 * In-memory event bus for the SSE stream. The monitor loop and intent runner
 * publish events; the /sse endpoint subscribes.
 */
import type { Intent } from "../firewall/intent-types.js";

export type SseEvent =
  | { type: "poll"; symbol: string; price: number; latencyMs: number; t: number }
  | { type: "fire"; watcher: string; price: number; condition: string }
  | { type: "verdict"; watcher?: string; intentHash: string; verdict: string; confidence: number; hash?: string }
  | { type: "intent"; intent: Intent; intentHash: string }
  | { type: "expire"; watcher: string }
  | { type: "error"; watcher?: string; error: string }
  | { type: "heartbeat"; t: number };

type Subscriber = (event: SseEvent) => void;

const subs = new Set<Subscriber>();
const RING_SIZE = 200;
const ring: SseEvent[] = [];

export function emitEvent(ev: SseEvent): void {
  ring.push(ev);
  if (ring.length > RING_SIZE) ring.shift();
  for (const s of subs) {
    try {
      s(ev);
    } catch {
      /* drop */
    }
  }
}

export function subscribe(fn: Subscriber): () => void {
  subs.add(fn);
  return () => {
    subs.delete(fn);
  };
}

export function recentEvents(n = 50): SseEvent[] {
  return ring.slice(-n);
}
