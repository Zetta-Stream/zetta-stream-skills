/**
 * Typed env loader for ZettaStream. All runtime modules import from here.
 */
import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  // X Layer
  XLAYER_RPC_URL: z.string().url().default("https://rpc.xlayer.tech"),
  XLAYER_CHAIN_ID: z.coerce.number().int().default(196),

  // Deployed contracts (filled after forge deploy)
  ZETTA_STREAM_LOG_ADDRESS: z.string().default(""),
  BATCH_CALL_DELEGATE_ADDRESS: z.string().default(""),
  PHISHING_VAULT_ADDRESS: z.string().default(""),

  // Demo EOA for EIP-7702 authorization signing (disclosed in README)
  DEMO_EOA_PRIVATE_KEY: z.string().default(""),
  DEMO_EOA_ADDRESS: z.string().default(""),

  // x402
  X402_FACILITATOR_URL: z.string().default("http://localhost:4402"),
  X402_ASSET_ADDRESS: z.string().default("0x4ae46a509f6b1d9056937ba4500cb143933d2dc8"),
  X402_PAYTO_ADDRESS: z.string().default(""),
  X402_PAYMENT_AMOUNT: z.coerce.number().int().default(1000),
  X402_MOCK_SERVER_PORT: z.coerce.number().int().default(4402),

  // Agent tuning
  POLL_INTERVAL_MS: z.coerce.number().int().default(500),
  MIN_CONFIDENCE_APPROVE: z.coerce.number().int().default(60),
  SILENT_MODE: z
    .string()
    .default("false")
    .transform((v) => v === "true"),
  DEMO_MODE: z
    .string()
    .default("true")
    .transform((v) => v === "true"),

  // Agent API
  TEST_VAULT_ADDRESS: z.string().default(""),
  LOCAL_SIGN_FALLBACK: z
    .string()
    .default("false")
    .transform((v) => v === "true"),

  AGENT_API_PORT: z.coerce.number().int().default(7777),
  AGENT_STATE_PATH: z.string().default("./.agent-state.json"),
  AGENT_LOG_PATH: z.string().default("./logs/agent.jsonl"),

  // Log level
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error"]).default("info"),
});

export type Config = z.infer<typeof schema>;

let cached: Config | null = null;

export function getConfig(): Config {
  if (!cached) {
    cached = schema.parse(process.env);
  }
  return cached;
}

/** Resets the cached config — useful in tests. */
export function resetConfig(): void {
  cached = null;
}
