#!/usr/bin/env tsx
/**
 * Proof-of-life seed for ZettaStreamLog on X Layer. Writes exactly one
 * `logRotation` entry directly from the deployer EOA so the README can point at
 * a real on-chain audit record before the full Arbitrum pipeline is online.
 *
 * After the Delegate is deployed on Arbitrum the autonomous loop will feed this
 * contract through `runFullIntent` — but for Day 1 delivery we just need proof
 * that the contract accepts a rotation write.
 */
import { createWalletClient, createPublicClient, http, keccak256, toBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { xLayer } from "viem/chains";
import { getConfig } from "../agent/config.js";

const ZETTA_STREAM_LOG_ABI = [
  {
    type: "function",
    name: "logRotation",
    stateMutability: "nonpayable",
    inputs: [
      { name: "owner", type: "address" },
      { name: "signalHash", type: "bytes32" },
      { name: "from", type: "uint8" },
      { name: "to", type: "uint8" },
      { name: "confidence", type: "uint8" },
      { name: "netYieldBps", type: "int32" },
      { name: "gasSavedBps", type: "uint32" },
      { name: "batchTxHash", type: "bytes32" },
      { name: "mode", type: "uint8" },
      { name: "reason", type: "string" },
    ],
    outputs: [{ name: "id", type: "uint256" }],
  },
  {
    type: "function",
    name: "rotationCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
] as const;

async function main() {
  const cfg = getConfig();
  if (!cfg.ZETTA_STREAM_LOG_ADDRESS) {
    console.error("ZETTA_STREAM_LOG_ADDRESS not set");
    process.exit(1);
  }
  if (!cfg.DEPLOYER_PRIVATE_KEY) {
    console.error("DEPLOYER_PRIVATE_KEY not set");
    process.exit(1);
  }

  const account = privateKeyToAccount(cfg.DEPLOYER_PRIVATE_KEY as `0x${string}`);
  const pub = createPublicClient({ chain: xLayer, transport: http(cfg.XLAYER_RPC_URL) });
  const wallet = createWalletClient({ account, chain: xLayer, transport: http(cfg.XLAYER_RPC_URL) });
  const log = cfg.ZETTA_STREAM_LOG_ADDRESS as `0x${string}`;

  const before = await pub.readContract({ address: log, abi: ZETTA_STREAM_LOG_ABI, functionName: "rotationCount" });
  console.log(`rotationCount before: ${before}`);

  const signalJson = JSON.stringify({
    aavePoolApy: 0.031,
    uniFeeApr: 0.055,
    ilRisk: 0.22,
    confidence: 78,
    ts: Math.floor(Date.now() / 1000),
  });
  const signalHash = keccak256(toBytes(signalJson));

  const hash = await wallet.writeContract({
    address: log,
    abi: ZETTA_STREAM_LOG_ABI,
    functionName: "logRotation",
    args: [
      account.address,                                          // owner (msg.sender path)
      signalHash,
      1,                                                        // Position.AAVE (from)
      2,                                                        // Position.UNIV4 (to)
      78,                                                       // confidence
      85,                                                       // netYieldBps (+0.85%)
      42,                                                       // gasSavedBps
      "0x0000000000000000000000000000000000000000000000000000000000000000",
      0,                                                        // DelegateMode.EIP7702
      "proof-of-life: genesis rotation AAVE→UNIV4",
    ],
  });
  console.log(`logRotation tx: ${hash}`);
  const receipt = await pub.waitForTransactionReceipt({ hash });
  console.log(`  block ${receipt.blockNumber}, gas ${receipt.gasUsed}, status ${receipt.status}`);

  const after = await pub.readContract({ address: log, abi: ZETTA_STREAM_LOG_ABI, functionName: "rotationCount" });
  console.log(`rotationCount after:  ${after}`);

  console.log("\nOKLink: https://www.oklink.com/xlayer/tx/" + hash);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
