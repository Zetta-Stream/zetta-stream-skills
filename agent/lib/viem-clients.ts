/**
 * viem clients — one public for reads/simulation, one wallet (local demo EOA) for
 * EIP-7702 authorization signing. Everything else goes through the TEE via okx-cli.
 */
import { createPublicClient, createWalletClient, http, defineChain, type Chain } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { getConfig } from "../config.js";

// X Layer is not in viem/chains yet — define inline.
export const xLayer: Chain = defineChain({
  id: 196,
  name: "X Layer",
  nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.xlayer.tech"] } },
  blockExplorers: {
    default: { name: "OKLink", url: "https://www.oklink.com/xlayer" },
  },
  testnet: false,
});

let _publicClient: ReturnType<typeof createPublicClient> | null = null;
let _walletClient: ReturnType<typeof createWalletClient> | null = null;

export function getPublicClient() {
  if (!_publicClient) {
    const cfg = getConfig();
    _publicClient = createPublicClient({
      chain: xLayer,
      transport: http(cfg.XLAYER_RPC_URL),
    });
  }
  return _publicClient;
}

export function getDemoEoaAccount() {
  const cfg = getConfig();
  if (!cfg.DEMO_EOA_PRIVATE_KEY) return null;
  const pk = cfg.DEMO_EOA_PRIVATE_KEY.startsWith("0x")
    ? (cfg.DEMO_EOA_PRIVATE_KEY as `0x${string}`)
    : (`0x${cfg.DEMO_EOA_PRIVATE_KEY}` as `0x${string}`);
  return privateKeyToAccount(pk);
}

export function getWalletClient() {
  if (_walletClient) return _walletClient;
  const cfg = getConfig();
  const account = getDemoEoaAccount();
  if (!account) return null;
  _walletClient = createWalletClient({
    account,
    chain: xLayer,
    transport: http(cfg.XLAYER_RPC_URL),
  });
  return _walletClient;
}
