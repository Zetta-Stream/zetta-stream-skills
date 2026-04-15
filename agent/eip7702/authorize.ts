/**
 * EIP-7702 authorization signing.
 *
 * viem's `signAuthorization` requires a local account (private key). The demo EOA's
 * key is used here. README discloses this honestly; TEE-signed authorization is a
 * roadmap item once OKX exposes the API.
 */
import { getPublicClient, getDemoEoaAccount, getWalletClient } from "../lib/viem-clients.js";
import { getConfig } from "../config.js";
import { getLogger } from "../lib/logger.js";

const log = getLogger("authorize");

export type Authorization = {
  chainId: number;
  address: `0x${string}`;
  nonce: number;
  r: `0x${string}`;
  s: `0x${string}`;
  v: bigint;
  yParity?: number;
};

/**
 * Build + sign an EIP-7702 authorization for the demo EOA to delegate to
 * BatchCallDelegate on X Layer (chainId 196). Returns a structured auth
 * that viem's `writeContract` accepts as `authorizationList: [auth]`.
 */
export async function signDelegationAuthorization(): Promise<Authorization> {
  const cfg = getConfig();
  const account = getDemoEoaAccount();
  const walletClient = getWalletClient();
  if (!account || !walletClient) {
    throw new Error("DEMO_EOA_PRIVATE_KEY not set — cannot sign 7702 authorization");
  }
  if (!cfg.ZETTA_STREAM_DELEGATE_ADDRESS) {
    throw new Error("ZETTA_STREAM_DELEGATE_ADDRESS not set — deploy contracts first");
  }

  const publicClient = getPublicClient();
  const nonce = await publicClient.getTransactionCount({ address: account.address });

  log.info(
    {
      eoa: account.address,
      delegate: cfg.ZETTA_STREAM_DELEGATE_ADDRESS,
      chainId: cfg.XLAYER_CHAIN_ID,
      nonce,
    },
    "signing 7702 authorization (local key — disclosed in README)",
  );

  // viem's API: account.signAuthorization({ contractAddress, chainId, nonce })
  // Returns a SignedAuthorization object directly consumable by writeContract.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const auth = await (account as any).signAuthorization({
    contractAddress: cfg.ZETTA_STREAM_DELEGATE_ADDRESS as `0x${string}`,
    chainId: cfg.XLAYER_CHAIN_ID,
    nonce,
  });

  return auth as Authorization;
}
