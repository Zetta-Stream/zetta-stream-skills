/**
 * Sub-100ms price query via an open x402 session. Auto-reopens on expiry.
 */
import { getConfig } from "../config.js";
import { ensureSession } from "./session-client.js";
import { updateState, loadState } from "../state.js";

export interface PriceQuote {
  symbol: string;
  price: number;
  source: string;
  t: number;
  latencyMs: number;
  session: { id: string; queriesUsed: number; queriesLeft: number };
}

export async function queryPrice(symbol: string): Promise<PriceQuote> {
  const cfg = getConfig();
  const sym = symbol.toUpperCase();
  let session = await ensureSession();
  const url = `${cfg.X402_FACILITATOR_URL}/price/${sym}?session=${encodeURIComponent(session.sessionId)}`;
  const start = Date.now();
  let resp = await fetch(url);
  if (resp.status === 402) {
    // Session expired server-side — reopen
    session = await ensureSession({ force: true });
    resp = await fetch(
      `${cfg.X402_FACILITATOR_URL}/price/${sym}?session=${encodeURIComponent(session.sessionId)}`,
    );
  }
  if (!resp.ok) throw new Error(`query failed: ${resp.status} ${await resp.text()}`);
  const body = (await resp.json()) as {
    symbol: string;
    price: number;
    source: string;
    session: { id: string; queriesUsed: number; queriesLeft: number; expiresAt: number };
    t: number;
  };
  // Update local queries used
  const state = loadState();
  if (state.x402) {
    updateState({
      x402: {
        ...state.x402,
        queriesUsed: body.session.queriesUsed,
      },
    });
  }
  return {
    symbol: body.symbol,
    price: body.price,
    source: body.source,
    t: body.t,
    latencyMs: Date.now() - start,
    session: {
      id: body.session.id,
      queriesUsed: body.session.queriesUsed,
      queriesLeft: body.session.queriesLeft,
    },
  };
}
