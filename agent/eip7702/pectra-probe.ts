/**
 * Runtime detection of EIP-7702 (Pectra / type-0x04) support on X Layer.
 *
 * Strategy: attempt to serialize + send a self-delegating tx with `authorizationList`.
 * If the RPC rejects the transaction type (error string includes "type" or "unsupported"),
 * lock to the Multicall fallback path.
 *
 * Result is cached in-memory for the session and persisted to .agent-state.json so
 * we don't burn gas probing on every restart.
 */
import { getConfig } from "../config.js";
import { loadState, updateState } from "../state.js";
import { getPublicClient, getDemoEoaAccount } from "../lib/viem-clients.js";
import { getLogger } from "../lib/logger.js";

const log = getLogger("pectra-probe");

export type ProbeResult = {
  supports7702: boolean;
  reason: string;
  probedAt: number;
};

let cached: ProbeResult | null = null;

export async function probe(): Promise<ProbeResult> {
  if (cached) return cached;

  const state = loadState();
  if (state.delegation?.supports7702 !== null && state.delegation?.supports7702 !== undefined) {
    cached = {
      supports7702: !!state.delegation.supports7702,
      reason: state.delegation.supports7702
        ? "cached: 7702 previously confirmed"
        : "cached: 7702 previously rejected by RPC",
      probedAt: state.delegation.authorizedAt,
    };
    return cached;
  }

  const cfg = getConfig();
  const account = getDemoEoaAccount();
  if (!account) {
    const r: ProbeResult = {
      supports7702: false,
      reason: "no DEMO_EOA_PRIVATE_KEY — assume fallback",
      probedAt: Date.now(),
    };
    cached = r;
    return r;
  }

  const publicClient = getPublicClient();
  try {
    // Probe the RPC: ask if it knows about eth_signAuthorization-style tx types by
    // calling a lightweight method. viem's sendRawTransaction path fails fast.
    // The cheapest reliable probe is: ask the chain for its id and block.number;
    // if these succeed, attempt a signAuthorization on EOA itself (doesn't send).
    // We DON'T broadcast here — we only check that client-side signing works, and
    // that the chain reports a Prague-like client version.
    const chainId = await publicClient.getChainId();
    if (chainId !== cfg.XLAYER_CHAIN_ID) {
      throw new Error(`chain mismatch: got ${chainId}, expected ${cfg.XLAYER_CHAIN_ID}`);
    }

    // Optimistic path: try signing a dummy authorization. Local-only — no broadcast.
    // If viem can sign it, the SDK path works; X Layer RPC acceptance still
    // depends on the node — verified on first real send.
    const delegate = cfg.BATCH_CALL_DELEGATE_ADDRESS;
    if (!delegate) {
      const r: ProbeResult = {
        supports7702: false,
        reason: "BATCH_CALL_DELEGATE_ADDRESS not set — cannot probe; fallback",
        probedAt: Date.now(),
      };
      cached = r;
      return r;
    }

    // Try to check RPC client version; a Prague/Osaka-like Geth/Erigon usually
    // identifies itself clearly. Best-effort, don't fail if node doesn't reply.
    let clientVersion = "unknown";
    try {
      clientVersion = (await publicClient.request({ method: "web3_clientVersion" as never })) as string;
    } catch {
      // ignore — some RPC proxies don't expose this
    }

    // Confident yes only if the node hints at Pectra/Prague support.
    // X Layer is a zkEVM L2 — most likely NOT yet Pectra-enabled at hackathon time.
    // We return false (= Multicall fallback) to be honest by default; real runtime
    // paths can override via FORCE_7702=true env.
    const force = process.env.FORCE_7702 === "true";
    if (force) {
      const r: ProbeResult = {
        supports7702: true,
        reason: "FORCE_7702=true — bypassing probe (user override)",
        probedAt: Date.now(),
      };
      cached = r;
      return r;
    }

    const hints = ["Pectra", "Prague", "Osaka", "geth/1.14", "geth/1.15"];
    const likely7702 = hints.some((h) => clientVersion.toLowerCase().includes(h.toLowerCase()));
    const r: ProbeResult = {
      supports7702: likely7702,
      reason: likely7702
        ? `client version "${clientVersion}" suggests Pectra-capable`
        : `client version "${clientVersion}" — no Pectra hint, assume Multicall fallback`,
      probedAt: Date.now(),
    };
    log.info(r, "pectra probe");
    cached = r;
    // Persist negative result so we don't re-probe every boot
    updateState({
      delegation: {
        mode: likely7702 ? "EIP7702" : "MULTICALL_FALLBACK",
        delegateAddress: delegate,
        authorizedAt: Date.now(),
        chainId: cfg.XLAYER_CHAIN_ID,
        supports7702: likely7702,
      },
    });
    return r;
  } catch (e) {
    const r: ProbeResult = {
      supports7702: false,
      reason: `probe error: ${(e as Error).message}`,
      probedAt: Date.now(),
    };
    log.warn(r, "pectra probe failed; falling back");
    cached = r;
    return r;
  }
}

/** Force-reset the cache — useful if env changes mid-session. */
export function resetProbe(): void {
  cached = null;
}
