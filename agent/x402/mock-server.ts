#!/usr/bin/env tsx
/**
 * x402 session-issuing mock server.
 *
 * Layers a "reusable session" on top of the single-shot x402 payment:
 *   GET /price/:symbol       → 402 Payment Required (with x402 payload)
 *   POST /session/open       → accept payment proof, issue sessionId (TTL 5min / 1000q)
 *   GET /price/:symbol?session=<id> → real OKX DEX price (<100ms cached)
 *
 * Proxies to OKX DEX market-price when a valid session is attached.
 * For the hackathon demo, a lightweight inline mock price generator is provided
 * as fallback so the server works even without OKX reachability.
 */
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { getConfig } from "../config.js";
import { getLogger } from "../lib/logger.js";
import { runOkx } from "../lib/okx-cli.js";

const log = getLogger("x402-mock");

interface Session {
  id: string;
  openedAt: number;
  expiresAt: number;
  maxQueries: number;
  queriesUsed: number;
  paymentProof?: { signature: string; authorization: unknown };
}

const sessions = new Map<string, Session>();
const priceCache = new Map<string, { price: number; t: number }>();

function validSession(id: string | undefined | null): Session | null {
  if (!id) return null;
  const s = sessions.get(id);
  if (!s) return null;
  if (Date.now() > s.expiresAt) return null;
  if (s.queriesUsed >= s.maxQueries) return null;
  return s;
}

async function fetchOkxPrice(symbol: string): Promise<{ price: number; source: string }> {
  // Cache 500ms to avoid hammering.
  const cached = priceCache.get(symbol);
  if (cached && Date.now() - cached.t < 500) {
    return { price: cached.price, source: "cache" };
  }
  try {
    const r = await runOkx<{ price?: string; last?: string; priceUsd?: number | string }>(
      "market",
      "token-price-info",
      ["--chain", "196", "--symbol", symbol],
      { timeoutMs: 1500 },
    );
    if (r.ok) {
      const d = r.data as { price?: string; last?: string; priceUsd?: number | string };
      const raw = d.priceUsd ?? d.price ?? d.last ?? 0;
      const price = typeof raw === "string" ? Number(raw) : Number(raw);
      if (Number.isFinite(price) && price > 0) {
        priceCache.set(symbol, { price, t: Date.now() });
        return { price, source: "okx" };
      }
    }
  } catch {
    // fallthrough to stub
  }
  // Stub price generator (scenario 3 demo needs deterministic-ish prices)
  const base: Record<string, number> = { ETH: 3500, BTC: 95000, OKB: 45, USDC: 1 };
  const noise = (Math.random() - 0.5) * (base[symbol] ?? 1) * 0.002;
  const price = (base[symbol] ?? 1) + noise;
  priceCache.set(symbol, { price, t: Date.now() });
  return { price, source: "stub" };
}

export function buildApp() {
  const cfg = getConfig();
  const app = new Hono();

  app.get("/health", (c) =>
    c.json({ ok: true, sessions: sessions.size, uptime: process.uptime() }),
  );

  // --- 402 entrypoint (price feed) ---
  app.get("/price/:symbol", async (c) => {
    const symbol = c.req.param("symbol").toUpperCase();
    const sid = c.req.query("session") ?? c.req.header("X-Session-Id");
    const s = validSession(sid);
    if (!s) {
      const payload = {
        x402Version: 2,
        accepts: [
          {
            network: "eip155:196",
            amount: cfg.X402_PAYMENT_AMOUNT.toString(),
            payTo: cfg.X402_PAYTO_ADDRESS || "0x0000000000000000000000000000000000000000",
            asset: cfg.X402_ASSET_ADDRESS,
            maxTimeoutSeconds: 300,
            description: "ZettaStream reusable price feed session (1000 queries / 5 min)",
          },
        ],
      };
      const b64 = Buffer.from(JSON.stringify(payload)).toString("base64");
      c.status(402);
      c.header("Content-Type", "application/json");
      return c.body(b64);
    }
    s.queriesUsed += 1;
    const { price, source } = await fetchOkxPrice(symbol);
    return c.json({
      symbol,
      price,
      source,
      session: { id: s.id, queriesUsed: s.queriesUsed, queriesLeft: s.maxQueries - s.queriesUsed, expiresAt: s.expiresAt },
      t: Date.now(),
    });
  });

  // --- Session open: exchange payment proof for a sessionId ---
  app.post("/session/open", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ ok: false, error: "invalid json" }, 400);
    const { signature, authorization, maxQueries, ttlSeconds } = body as {
      signature?: string;
      authorization?: unknown;
      maxQueries?: number;
      ttlSeconds?: number;
    };
    if (!signature || !authorization) {
      return c.json({ ok: false, error: "signature+authorization required" }, 400);
    }
    // For the mock, we don't verify on-chain — a real facilitator would verify
    // the EIP-3009 transferWithAuthorization signature against the asset's domain.
    const id = `s_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    const now = Date.now();
    const ttl = Math.max(60, Math.min(3600, ttlSeconds ?? 300));
    const s: Session = {
      id,
      openedAt: now,
      expiresAt: now + ttl * 1000,
      maxQueries: Math.max(1, Math.min(100_000, maxQueries ?? 1000)),
      queriesUsed: 0,
      paymentProof: { signature, authorization },
    };
    sessions.set(id, s);
    log.info({ id, ttl, maxQueries: s.maxQueries }, "session opened");
    return c.json({
      ok: true,
      sessionId: s.id,
      ttlSeconds: ttl,
      maxQueries: s.maxQueries,
      priceUsdPerSession: (cfg.X402_PAYMENT_AMOUNT / 1_000_000).toFixed(6),
    });
  });

  // --- Session status ---
  app.get("/session/:id", (c) => {
    const s = sessions.get(c.req.param("id"));
    if (!s) return c.json({ ok: false, error: "unknown session" }, 404);
    return c.json({
      ok: true,
      id: s.id,
      openedAt: s.openedAt,
      expiresAt: s.expiresAt,
      maxQueries: s.maxQueries,
      queriesUsed: s.queriesUsed,
      alive: Date.now() < s.expiresAt && s.queriesUsed < s.maxQueries,
    });
  });

  // --- Admin endpoints (DEMO_MODE only) ---
  if (cfg.DEMO_MODE) {
    app.post("/debug/fake-session", (c) => {
      const id = `s_demo_${randomUUID().replace(/-/g, "").slice(0, 8)}`;
      const now = Date.now();
      sessions.set(id, {
        id,
        openedAt: now,
        expiresAt: now + 10 * 60 * 1000,
        maxQueries: 10_000,
        queriesUsed: 0,
      });
      return c.json({ ok: true, sessionId: id, note: "DEMO_MODE fake session" });
    });
    app.post("/debug/set-price/:symbol/:value", (c) => {
      const symbol = c.req.param("symbol").toUpperCase();
      const value = Number(c.req.param("value"));
      priceCache.set(symbol, { price: value, t: Date.now() });
      return c.json({ ok: true, symbol, price: value });
    });
  }

  return app;
}

// ESM entry
const isMain =
  typeof process !== "undefined" && process.argv[1]?.includes("mock-server");
if (isMain) {
  const cfg = getConfig();
  const app = buildApp();
  serve({ fetch: app.fetch, port: cfg.X402_MOCK_SERVER_PORT }, (info) => {
    log.info({ port: info.port }, "x402 mock server listening");
  });
}
