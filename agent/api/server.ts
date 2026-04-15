/**
 * ZettaStream agent API (port 7777).
 *   POST /intent             → run full intent pipeline (firewall + batch + audit)
 *   POST /analyze            → read-only firewall report
 *   POST /fund               → open x402 session OR run a cross-chain bridge
 *   POST /monitor/register   → register a conditional watcher
 *   GET  /monitor/list
 *   DELETE /monitor/:id
 *   GET  /sse                → server-sent events stream
 *   GET  /health
 */
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { getConfig } from "../config.js";
import { getLogger } from "../lib/logger.js";
import { runFirewall } from "../firewall/pipeline.js";
import { runFullIntent } from "../monitor/run-intent.js";
import {
  cancelWatcher,
  listWatchers,
  registerWatcher,
} from "../monitor/trigger.js";
import { intentSchema } from "../firewall/intent-types.js";
import { emitEvent, recentEvents, subscribe } from "./events.js";
import { openSession } from "../x402/session-client.js";
import { chooseRoute } from "../crosschain/router.js";
import { queryYieldFeed } from "../x402/query.js";
import { scoreAndGate } from "../decision/rotator.js";
import { loadState, updateRotation } from "../state.js";
import { runRotation } from "../monitor/run-rotation.js";
import {
  start as startMonitor,
  stop as stopMonitor,
  isRunning as monitorIsRunning,
  getSessionMetrics,
  currentState as monitorState,
} from "../monitor/loop.js";

const log = getLogger("api");

export function buildApp() {
  const app = new Hono();

  app.get("/health", (c) =>
    c.json({ ok: true, watchers: listWatchers().length, uptime: process.uptime() }),
  );

  // ---------------- /analyze (Zetta-Stream yield rotation preview) ----------------
  // Preview what the agent WOULD do right now — no broadcast, no audit, no medal.
  // This is the surface the `zetta-stream-analyze` skill calls.
  app.post("/analyze", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { owner?: string };
    try {
      const state = loadState();
      let signal;
      try {
        const quote = await queryYieldFeed();
        signal = quote.signal;
      } catch (err) {
        return c.json({
          ok: false,
          error: `no x402 yield feed available — open a session first (zetta-stream-fund target=x402). (${(err as Error).message})`,
        }, 424);
      }
      const outcome = scoreAndGate({
        signal,
        currentPosition: state.rotation.position,
        ring: state.rotation.signalRingBuffer,
        lastRotatedAtMs: state.rotation.lastRotatedAt,
      });
      // Persist the new ring tick so the autonomous loop can benefit from preview queries.
      updateRotation({ signalRingBuffer: outcome.nextRing });
      emitEvent({ type: "analyze", owner: body.owner ?? state.ownerAddress, decision: outcome.decision, gate: outcome.gate });
      return c.json({
        ok: true,
        signal,
        decision: outcome.decision,
        gate: outcome.gate,
      });
    } catch (e) {
      return c.json({ ok: false, error: (e as Error).message }, 400);
    }
  });

  app.post("/intent", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ ok: false, error: "invalid json" }, 400);
    try {
      const intent = intentSchema.parse(body);
      emitEvent({ type: "intent", intent, intentHash: "" });
      const result = await runFullIntent(intent);
      emitEvent({
        type: "verdict",
        intentHash: result.intentHash,
        verdict: result.verdict,
        confidence: result.confidence,
        hash: result.hash,
      });
      return c.json({ ok: true, ...result });
    } catch (e) {
      log.error({ err: (e as Error).message }, "/intent failed");
      return c.json({ ok: false, error: (e as Error).message }, 400);
    }
  });

  app.post("/fund", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ ok: false, error: "invalid json" }, 400);
    const target = (body.target ?? "x402") as "x402" | "bridge";
    try {
      if (target === "x402") {
        const s = await openSession({
          ttlSeconds: body.session_ttl_seconds,
          maxQueries: body.max_queries,
        });
        return c.json({ ok: true, target: "x402", session: s });
      }
      if (target === "bridge") {
        const decision = await chooseRoute({
          srcChainId: Number(body.from_chain_id ?? 196),
          dstChainId: Number(body.to_chain_id ?? 8453),
          srcToken: body.src_token as `0x${string}`,
          dstToken: body.dst_token as `0x${string}`,
          amount: BigInt(body.amount_wei ?? "0"),
          owner: body.owner as `0x${string}`,
        });
        return c.json({
          ok: true,
          target: "bridge",
          best: { id: decision.best.id, score: decision.best.score, protocol: decision.best.protocol },
          candidates: decision.candidates.map((r) => ({ id: r.id, score: r.score, protocol: r.protocol })),
        });
      }
      return c.json({ ok: false, error: "unknown target" }, 400);
    } catch (e) {
      return c.json({ ok: false, error: (e as Error).message }, 400);
    }
  });

  // ---------------- /rotate (execute one rotation NOW) ----------------
  app.post("/rotate", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      owner?: `0x${string}`;
      force?: boolean;
      options?: { tag?: string; force_fallback?: boolean; minNetBps?: number };
    };
    try {
      const result = await runRotation({
        owner: body.owner,
        force: body.force ?? true,
        tag: body.options?.tag,
        minBpsOverride: body.options?.minNetBps,
      });
      return c.json({ ok: true, ...result });
    } catch (e) {
      return c.json({ ok: false, error: (e as Error).message }, 400);
    }
  });

  // ---------------- /monitor/start — autonomous loop ----------------
  app.post("/monitor/start", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      owner?: `0x${string}`;
      durationSeconds?: number;
    };
    try {
      const info = startMonitor(body.durationSeconds);
      const cfg = getConfig();
      return c.json({
        ok: true,
        ...info,
        tickIntervalMs: cfg.POLL_INTERVAL_MS,
        sseUrl: `http://localhost:${cfg.AGENT_API_PORT}/sse`,
      });
    } catch (e) {
      return c.json({ ok: false, error: (e as Error).message }, 400);
    }
  });

  // ---------------- /monitor/stop — graceful shutdown + summary ----------------
  app.post("/monitor/stop", async (c) => {
    try {
      const metrics = stopMonitor();
      return c.json({ ok: true, stoppedAt: Date.now(), metrics });
    } catch (e) {
      return c.json({ ok: false, error: (e as Error).message }, 400);
    }
  });

  // ---------------- /state — snapshot ----------------
  app.get("/state", (c) => {
    const s = monitorState();
    return c.json({
      ok: true,
      running: monitorIsRunning(),
      metrics: getSessionMetrics(),
      rotation: s.rotation,
      x402: s.x402 ? { sessionId: s.x402.sessionId, queriesUsed: s.x402.queriesUsed, queriesLeft: s.x402.maxQueries - s.x402.queriesUsed, expiresAt: s.x402.expiresAt } : null,
    });
  });

  app.post("/monitor/register", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ ok: false, error: "invalid json" }, 400);
    try {
      const w = registerWatcher({
        condition: body.condition,
        thenIntent: intentSchema.parse(body.then_intent),
        options: body.options,
      });
      return c.json({ ok: true, watcher: w });
    } catch (e) {
      return c.json({ ok: false, error: (e as Error).message }, 400);
    }
  });

  app.get("/monitor/list", (c) => c.json({ ok: true, watchers: listWatchers() }));

  app.delete("/monitor/:id", (c) => {
    const ok = cancelWatcher(c.req.param("id"));
    return c.json({ ok });
  });

  app.get("/sse", (c) =>
    streamSSE(c, async (stream) => {
      // Replay recent ring first for late joiners
      for (const ev of recentEvents(20)) {
        await stream.writeSSE({ event: ev.type, data: JSON.stringify(ev) });
      }
      const unsub = subscribe((ev) => {
        stream.writeSSE({ event: ev.type, data: JSON.stringify(ev) }).catch(() => {
          /* drop */
        });
      });
      const heartbeat = setInterval(() => {
        stream
          .writeSSE({ event: "heartbeat", data: JSON.stringify({ type: "heartbeat", t: Date.now() }) })
          .catch(() => {
            /* drop */
          });
      }, 15_000);
      await new Promise<void>((resolve) => {
        stream.onAbort(() => {
          clearInterval(heartbeat);
          unsub();
          resolve();
        });
      });
    }),
  );

  // demo-only endpoints
  const cfg = getConfig();
  if (cfg.DEMO_MODE) {
    app.post("/debug/replay-scenario", async (c) => {
      const body = await c.req.json().catch(() => ({}));
      const id = (body.id as string) ?? "phishing";
      const { getScenario } = await import("../demo/scenarios.js");
      const s = getScenario(id as "phishing" | "gas-save" | "x402-cross");
      const parsed = intentSchema.parse(s.intent);
      const result = await runFullIntent(parsed);
      return c.json({ ok: true, scenario: s.id, result });
    });
  }

  return app;
}

export function start() {
  const cfg = getConfig();
  const app = buildApp();
  serve({ fetch: app.fetch, port: cfg.AGENT_API_PORT }, (info) => {
    log.info({ port: info.port }, "agent API listening");
  });
}
