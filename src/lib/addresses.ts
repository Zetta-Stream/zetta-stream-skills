export const ZETTA_STREAM_LOG_ADDRESS =
  (process.env.NEXT_PUBLIC_ZETTA_STREAM_LOG_ADDRESS ?? "") as `0x${string}`;

export const BATCH_CALL_DELEGATE_ADDRESS =
  (process.env.NEXT_PUBLIC_BATCH_CALL_DELEGATE_ADDRESS ?? "") as `0x${string}`;

export const XLAYER_RPC = process.env.NEXT_PUBLIC_XLAYER_RPC ?? "https://rpc.xlayer.tech";

export const AGENT_API = process.env.NEXT_PUBLIC_AGENT_API_URL ?? "http://localhost:7777";

export const OKLINK_TX = (hash: string) => `https://www.oklink.com/xlayer/tx/${hash}`;
export const OKLINK_ADDRESS = (addr: string) => `https://www.oklink.com/xlayer/address/${addr}`;
