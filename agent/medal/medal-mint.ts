/**
 * Thin wrapper around `ZettaStreamMedal.mintTo`. Called from the rotation
 * orchestrator whenever `netYieldBps > 0`. All signing goes through the
 * `onchainos wallet contract-call` TEE path (with a `LOCAL_SIGN_FALLBACK` for
 * development convenience).
 */
import { encodeMintMedal } from "../lib/log-encoder.js";
import { runOkx, mustOk } from "../lib/okx-cli.js";
import { getConfig } from "../config.js";
import { getWalletClient, getDemoEoaAccount, xLayer } from "../lib/viem-clients.js";
import { getLogger } from "../lib/logger.js";

const log = getLogger("medal-mint");

export interface MintResult {
  tokenId?: bigint;
  mintTx: `0x${string}`;
}

/**
 * Mint one Medal NFT for the caller (their own EOA) tied to the given rotation
 * and net yield. Returns the mint tx hash. Throws if the contract rejects or
 * the wallet is not configured.
 */
export async function mintMedalFor(params: {
  recipient: `0x${string}`;
  rotationId: bigint;
  netYieldBps: number;
}): Promise<MintResult> {
  if (params.netYieldBps <= 0) {
    throw new Error(`cannot mint medal for non-positive yield ${params.netYieldBps}`);
  }
  const cfg = getConfig();
  if (!cfg.ZETTA_STREAM_MEDAL_ADDRESS) {
    throw new Error("ZETTA_STREAM_MEDAL_ADDRESS not set — deploy the Medal contract first");
  }
  const calldata = encodeMintMedal({
    to: params.recipient,
    rotationId: params.rotationId,
    netYieldBps: params.netYieldBps,
  });

  let mintTx: `0x${string}`;
  if (cfg.LOCAL_SIGN_FALLBACK) {
    const wallet = getWalletClient();
    const account = getDemoEoaAccount();
    if (!wallet || !account) {
      throw new Error("LOCAL_SIGN_FALLBACK=true but wallet/demo EOA missing");
    }
    mintTx = await wallet.sendTransaction({
      account,
      chain: xLayer,
      to: cfg.ZETTA_STREAM_MEDAL_ADDRESS as `0x${string}`,
      data: calldata,
      value: 0n,
      gas: 500_000n,
      type: "legacy",
    });
  } else {
    const resp = await runOkx<{ txHash?: string; hash?: string }>(
      "wallet",
      "contract-call",
      [
        "--to",
        cfg.ZETTA_STREAM_MEDAL_ADDRESS,
        "--chain",
        "196",
        "--input-data",
        calldata,
        "--value",
        "0",
        "--force",
      ],
      { reason: "mintMedal", timeoutMs: 90_000 },
    );
    const data = mustOk(resp, "mintMedal");
    const hash =
      ((data as { txHash?: string }).txHash ?? (data as { hash?: string }).hash) as
        | `0x${string}`
        | undefined;
    if (!hash) throw new Error("mintMedal: no tx hash returned from TEE");
    mintTx = hash;
  }

  log.info({ mintTx, rotationId: String(params.rotationId) }, "medal minted");
  return { mintTx };
}
