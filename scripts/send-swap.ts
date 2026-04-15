#!/usr/bin/env tsx
/**
 * One-off: fund the Demo EOA with USDC by swapping 0.04 OKB via OKX DEX aggregator.
 * Reads the pre-built tx from stdin JSON (piped from `onchainos swap swap`).
 * Usage:
 *   onchainos swap swap ... | tsx scripts/send-swap.ts
 */
import { createWalletClient, http, defineChain, publicActions, hexToBigInt } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import "dotenv/config";
import { readFileSync } from "node:fs";

const xLayer = defineChain({
  id: 196,
  name: "X Layer",
  nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
  rpcUrls: { default: { http: [process.env.XLAYER_RPC_URL ?? "https://rpc.xlayer.tech"] } },
});

async function main() {
  const raw = readFileSync("/tmp/swap-tx.json", "utf8");
  const obj = JSON.parse(raw);
  const root = obj.data ?? obj;
  const first = Array.isArray(root) ? root[0] : root;
  const tx = first.tx ?? first;
  const to = tx.to as `0x${string}`;
  const data = tx.data as `0x${string}`;
  const value = BigInt(tx.value ?? "0");
  const gas = BigInt(tx.gas ?? "350000");

  const pk = process.env.DEMO_EOA_PRIVATE_KEY!;
  const account = privateKeyToAccount(pk as `0x${string}`);
  const client = createWalletClient({ account, chain: xLayer, transport: http() }).extend(publicActions);

  console.log("→ sending swap");
  console.log("  to:   ", to);
  console.log("  value:", value.toString(), "wei (", Number(value) / 1e18, "OKB)");
  console.log("  gas:  ", gas.toString());
  console.log("  data: ", data.slice(0, 20) + "…", "(", data.length - 2, "hex chars)");

  const hash = await client.sendTransaction({
    to,
    data,
    value,
    gas: gas + 50_000n,
    type: "legacy",
  });
  console.log("tx broadcast:", hash);
  console.log("waiting for confirmation…");
  const receipt = await client.waitForTransactionReceipt({ hash });
  console.log("✅ status:", receipt.status);
  console.log("   block:", receipt.blockNumber.toString());
  console.log("   gas used:", receipt.gasUsed.toString());
  console.log("   explorer: https://www.oklink.com/xlayer/tx/" + hash);
}

main().catch((e) => {
  console.error("FAIL:", e);
  process.exit(1);
});
