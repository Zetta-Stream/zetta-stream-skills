/**
 * Dual-path batch executor.
 *
 * Path 1 (EIP-7702): viem.writeContract with authorizationList. EOA temporarily
 *                    delegates to BatchCallDelegate; single type-0x04 tx runs N calls.
 * Path 2 (Multicall): plain tx to BatchCallDelegate.executeBatch via TEE-signed
 *                     okx-cli. UX and gas-savings report are identical.
 */
import { encodeFunctionData } from "viem";
import { getConfig } from "../config.js";
import { getPublicClient, getWalletClient, getDemoEoaAccount, xLayer } from "../lib/viem-clients.js";
import { runOkx, mustOk } from "../lib/okx-cli.js";
import { probe } from "./pectra-probe.js";
import { signDelegationAuthorization } from "./authorize.js";
import { batchCallDelegateAbi, type BatchCall } from "./delegate-abi.js";
import { compareGas, avgOpGas, type GasCompareResult } from "./gas-compare.js";
import { updateState } from "../state.js";
import { getLogger } from "../lib/logger.js";

const log = getLogger("batch-executor");

export type ExecuteMode = "EIP7702" | "MULTICALL_FALLBACK";

export interface ExecuteInput {
  calls: BatchCall[];
  opKinds: string[];     // for gas baseline
  forceFallback?: boolean;
}

export interface ExecuteResult {
  hash: `0x${string}`;
  mode: ExecuteMode;
  gasCompare: GasCompareResult;
  authTxHash?: `0x${string}`;  // only set on first 7702 delegation
}

export async function executeBatch(input: ExecuteInput): Promise<ExecuteResult> {
  const cfg = getConfig();
  const delegate = cfg.ZETTA_STREAM_DELEGATE_ADDRESS as `0x${string}`;
  if (!delegate) throw new Error("ZETTA_STREAM_DELEGATE_ADDRESS not set");

  const probed = input.forceFallback ? { supports7702: false, reason: "forced" } : await probe();

  const totalValue = input.calls.reduce((s, c) => s + c.value, 0n);
  const callData = encodeFunctionData({
    abi: batchCallDelegateAbi,
    functionName: "executeBatch",
    args: [input.calls.map((c) => ({ to: c.to, value: c.value, data: c.data }))],
  });

  const perCallOpGas = avgOpGas(input.opKinds);

  if (probed.supports7702) {
    return execute7702({ delegate, calls: input.calls, totalValue, perCallOpGas });
  }

  return executeFallback({ delegate, callData, totalValue, callCount: input.calls.length, perCallOpGas });
}

// ------- EIP-7702 path -------

async function execute7702(args: {
  delegate: `0x${string}`;
  calls: BatchCall[];
  totalValue: bigint;
  perCallOpGas: number;
}): Promise<ExecuteResult> {
  const wallet = getWalletClient();
  const account = getDemoEoaAccount();
  const publicClient = getPublicClient();
  if (!wallet || !account) throw new Error("no wallet client — DEMO_EOA_PRIVATE_KEY required");

  const auth = await signDelegationAuthorization();
  log.info({ auth: { chainId: auth.chainId, address: auth.address } }, "7702 auth ready");

  // writeContract targets the EOA itself — after the authorization is applied,
  // calls to EOA execute the delegate's code.
  const hash = (await wallet.writeContract({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    address: account.address,
    abi: batchCallDelegateAbi,
    functionName: "executeBatch",
    args: [args.calls.map((c) => ({ to: c.to, value: c.value, data: c.data }))],
    value: args.totalValue,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    authorizationList: [auth] as any,
  } as never)) as `0x${string}`;

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  const gasCompare = compareGas({
    callCount: args.calls.length,
    perCallOpGas: args.perCallOpGas,
    actualBatchGas: receipt.gasUsed,
  });
  log.info({ hash, mode: "EIP7702", gasCompare }, "batch executed (7702)");

  updateState({
    delegation: {
      mode: "EIP7702",
      delegateAddress: args.delegate,
      authorizedAt: Date.now(),
      chainId: 196,
      authTxHash: hash,
      supports7702: true,
    },
  });

  return { hash, mode: "EIP7702", gasCompare, authTxHash: hash };
}

// ------- Multicall fallback path (TEE or local-sign) -------

async function executeFallback(args: {
  delegate: `0x${string}`;
  callData: `0x${string}`;
  totalValue: bigint;
  callCount: number;
  perCallOpGas: number;
}): Promise<ExecuteResult> {
  const cfg = getConfig();
  let txHash: `0x${string}`;

  if (cfg.LOCAL_SIGN_FALLBACK) {
    // Local-sign path: send raw tx via viem + DEMO_EOA. Used when TEE not logged in.
    const wallet = getWalletClient();
    const eoaAccount = getDemoEoaAccount();
    if (!wallet || !eoaAccount) {
      throw new Error(
        "LOCAL_SIGN_FALLBACK=true but DEMO_EOA_PRIVATE_KEY missing — cannot sign locally",
      );
    }
    txHash = await wallet.sendTransaction({
      account: eoaAccount,
      chain: xLayer,
      to: args.delegate,
      data: args.callData,
      value: args.totalValue,
      gas: 500_000n,
      type: "legacy",
    });
    log.info({ txHash, mode: "MULTICALL_FALLBACK", signer: "local" }, "fallback tx broadcast (local)");
  } else {
    // TEE path: onchainos wallet contract-call
    const valueArg = args.totalValue === 0n ? "0" : (Number(args.totalValue) / 1e18).toString();
    const resp = await runOkx<{ txHash?: string; hash?: string }>(
      "wallet",
      "contract-call",
      [
        "--to",
        args.delegate,
        "--chain",
        "196",
        "--input-data",
        args.callData,
        "--value",
        valueArg,
        "--force",
      ],
      { reason: "multicall fallback batch", timeoutMs: 120_000 },
    );
    const data = mustOk(resp, "multicall fallback");
    txHash = ((data as { txHash?: string; hash?: string }).txHash ??
      (data as { hash?: string }).hash ??
      "") as `0x${string}`;
    if (!txHash || !txHash.startsWith("0x")) {
      throw new Error(`multicall fallback did not return a tx hash: ${JSON.stringify(data)}`);
    }
  }

  const publicClient = getPublicClient();
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  const gasCompare = compareGas({
    callCount: args.callCount,
    perCallOpGas: args.perCallOpGas,
    actualBatchGas: receipt.gasUsed,
  });
  log.info({ txHash, mode: "MULTICALL_FALLBACK", gasCompare, status: receipt.status }, "batch executed (fallback)");

  if (receipt.status !== "success") {
    throw new Error(`batch tx reverted on-chain: ${txHash}`);
  }

  updateState({
    delegation: {
      mode: "MULTICALL_FALLBACK",
      delegateAddress: args.delegate,
      authorizedAt: Date.now(),
      chainId: 196,
      authTxHash: txHash,
      supports7702: false,
    },
  });

  return { hash: txHash, mode: "MULTICALL_FALLBACK", gasCompare, authTxHash: txHash };
}
