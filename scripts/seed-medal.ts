#!/usr/bin/env tsx
/**
 * Proof-of-life Medal mint. Mints one ERC-721 for the genesis rotation so the
 * Medal NFT contract has on-chain activity in the README evidence list.
 */
import { createWalletClient, createPublicClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { xLayer } from "viem/chains";
import { getConfig } from "../agent/config.js";

const MEDAL_ABI = [
  {
    type: "function",
    name: "mintTo",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "rotationId", type: "uint256" },
      { name: "netYieldBps", type: "int32" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "totalSupply",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "tokenURI",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ type: "string" }],
  },
] as const;

async function main() {
  const cfg = getConfig();
  if (!cfg.ZETTA_STREAM_MEDAL_ADDRESS) {
    console.error("ZETTA_STREAM_MEDAL_ADDRESS not set");
    process.exit(1);
  }
  const account = privateKeyToAccount(cfg.DEPLOYER_PRIVATE_KEY as `0x${string}`);
  const pub = createPublicClient({ chain: xLayer, transport: http(cfg.XLAYER_RPC_URL) });
  const wallet = createWalletClient({ account, chain: xLayer, transport: http(cfg.XLAYER_RPC_URL) });
  const medal = cfg.ZETTA_STREAM_MEDAL_ADDRESS as `0x${string}`;

  const before = await pub.readContract({ address: medal, abi: MEDAL_ABI, functionName: "totalSupply" });
  console.log(`totalSupply before: ${before}`);

  const hash = await wallet.writeContract({
    address: medal,
    abi: MEDAL_ABI,
    functionName: "mintTo",
    args: [account.address, 0n, 85],  // rotationId=0, netYieldBps=+0.85%
  });
  console.log(`mintTo tx: ${hash}`);
  const receipt = await pub.waitForTransactionReceipt({ hash });
  console.log(`  block ${receipt.blockNumber}, gas ${receipt.gasUsed}, status ${receipt.status}`);

  const after = await pub.readContract({ address: medal, abi: MEDAL_ABI, functionName: "totalSupply" });
  console.log(`totalSupply after:  ${after}`);

  const uri = await pub.readContract({ address: medal, abi: MEDAL_ABI, functionName: "tokenURI", args: [0n] });
  console.log(`token 0 URI starts with: ${(uri as string).slice(0, 40)}…`);

  console.log("\nOKLink: https://www.oklink.com/xlayer/tx/" + hash);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
