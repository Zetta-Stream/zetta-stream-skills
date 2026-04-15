#!/usr/bin/env tsx
/**
 * Deploy a minimal "phishing vault" on X Layer for scenario 1.
 * Not actually malicious — it's a deposit() that just accepts tokens. The demo
 * trigger is okx-security flagging the spender address via tx-scan; the sim
 * would otherwise succeed.
 *
 * Usage:
 *   DEPLOYER_PRIVATE_KEY=0x... tsx scripts/mock-phishing-deploy.ts
 */
import { createWalletClient, http, publicActions, defineChain } from "viem";
import { privateKeyToAccount } from "viem/accounts";

// Hand-compiled bytecode for a stub PhishingVault.sol:
//   pragma solidity ^0.8.24;
//   contract PhishingVault { function deposit(uint256) external {} }
// (no state mutation — it's the address that's "flagged" in the demo)
const BYTECODE =
  "0x6080604052348015600e575f5ffd5b50603e80601a5f395ff3fe6080604052348015600e575f5ffd5b50600436106026575f3560e01c8063b6b55f2514602a575b5f5ffd5b60306032565b005b56fea2646970667358221220af79b9cfd7e1c4f85bd3ab3a4c47d40d614ff63daf8e0d4e5a7b41a12e2f7fe664736f6c634300081c0033";

const xLayer = defineChain({
  id: 196,
  name: "X Layer",
  nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
  rpcUrls: { default: { http: [process.env.XLAYER_RPC_URL ?? "https://rpc.xlayer.tech"] } },
});

async function main() {
  const pk = process.env.DEPLOYER_PRIVATE_KEY;
  if (!pk) {
    console.error("DEPLOYER_PRIVATE_KEY not set");
    process.exit(1);
  }
  const account = privateKeyToAccount(pk.startsWith("0x") ? (pk as `0x${string}`) : (`0x${pk}` as `0x${string}`));
  const client = createWalletClient({
    account,
    chain: xLayer,
    transport: http(),
  }).extend(publicActions);

  const hash = await client.deployContract({ bytecode: BYTECODE as `0x${string}`, abi: [] });
  console.log("deploy tx:", hash);
  const receipt = await client.waitForTransactionReceipt({ hash });
  console.log("PHISHING_VAULT_ADDRESS =", receipt.contractAddress);
  console.log("\nAdd to .env and re-run demo scenario 1");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
