/**
 * Client for the x402 session gateway. Opens a session (TEE payment via
 * okx-x402-payment), caches the sessionId in agent state, and provides a
 * query function with automatic session re-open on expiry.
 */
import { getConfig } from "../config.js";
import { loadState, updateState, type X402Session } from "../state.js";
import { runOkx, mustOk } from "../lib/okx-cli.js";
import { getLogger } from "../lib/logger.js";

const log = getLogger("x402-client");

interface PayResult {
  signature: string;
  authorization: Record<string, unknown>;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(url, init);
  const text = await resp.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`non-JSON response ${resp.status}: ${text.slice(0, 200)}`);
  }
}

export async function openSession(opts?: {
  ttlSeconds?: number;
  maxQueries?: number;
}): Promise<X402Session> {
  const cfg = getConfig();
  const url = `${cfg.X402_FACILITATOR_URL}/price/ETH`;
  const resp = await fetch(url);
  if (resp.status !== 402) {
    throw new Error(`expected 402 from ${url}, got ${resp.status}`);
  }
  const b64 = (await resp.text()).trim();
  const payload = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
  const accept = payload.accepts?.[0];
  if (!accept) throw new Error("402 payload missing accepts[0]");

  // Pay via TEE
  const payResp = await runOkx<PayResult>(
    "payment",
    "x402-pay",
    [
      "--network",
      accept.network as string,
      "--amount",
      accept.amount as string,
      "--pay-to",
      accept.payTo as string,
      "--asset",
      accept.asset as string,
      "--max-timeout-seconds",
      (accept.maxTimeoutSeconds ?? 300).toString(),
    ],
    { reason: "x402 session open", timeoutMs: 30_000 },
  );
  const pay = mustOk(payResp, "x402-pay");

  const openResp = await fetchJson<{
    ok: boolean;
    sessionId?: string;
    ttlSeconds?: number;
    maxQueries?: number;
    error?: string;
  }>(`${cfg.X402_FACILITATOR_URL}/session/open`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      signature: pay.signature,
      authorization: pay.authorization,
      ttlSeconds: opts?.ttlSeconds ?? 300,
      maxQueries: opts?.maxQueries ?? 1000,
    }),
  });
  if (!openResp.ok || !openResp.sessionId) {
    throw new Error(`session open failed: ${openResp.error ?? "unknown"}`);
  }
  const now = Date.now();
  const session: X402Session = {
    sessionId: openResp.sessionId,
    openedAt: now,
    expiresAt: now + (openResp.ttlSeconds ?? 300) * 1000,
    maxQueries: openResp.maxQueries ?? 1000,
    queriesUsed: 0,
    paymentTxHash: undefined,
    asset: accept.asset as string,
  };
  updateState({ x402: session });
  log.info({ session }, "x402 session opened");
  return session;
}

export async function ensureSession(opts?: { force?: boolean }): Promise<X402Session> {
  const state = loadState();
  const s = state.x402;
  const alive =
    s &&
    Date.now() < s.expiresAt &&
    s.queriesUsed < s.maxQueries &&
    !opts?.force;
  if (alive) return s;
  return openSession();
}
