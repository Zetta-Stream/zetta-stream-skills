/**
 * Typed env loader for Zetta-Stream. All runtime modules import from here.
 */
import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  // ---- X Layer (audit + Medal) ----
  XLAYER_RPC_URL: z.string().url().default("https://rpc.xlayer.tech"),
  XLAYER_CHAIN_ID: z.coerce.number().int().default(196),

  // ---- Execution chain (Arbitrum) ----
  EXEC_CHAIN_RPC_URL: z.string().url().default("https://arb1.arbitrum.io/rpc"),
  EXEC_CHAIN_ID: z.coerce.number().int().default(42161),
  USDC_ADDRESS: z.string().default("0xaf88d065e77c8cC2239327C5EDb3A432268e5831"),
  AAVE_V3_POOL: z.string().default("0x794a61358D6845594F94dc1DB02A252b5b4814aD"),
  UNI_V4_POSITION_MANAGER: z.string().default(""),
  UNI_V4_POOL_KEY_TOKEN0: z.string().default(""),
  UNI_V4_POOL_KEY_TOKEN1: z.string().default(""),
  UNI_V4_POOL_KEY_FEE: z.coerce.number().int().default(500),
  UNI_V4_POOL_KEY_TICKSPACING: z.coerce.number().int().default(10),
  UNI_V4_POOL_KEY_HOOKS: z
    .string()
    .default("0x0000000000000000000000000000000000000000"),
  OKX_DEX_ROUTER: z.string().default(""),
  ARBISCAN_API_KEY: z.string().default(""),

  // ---- Deployed contracts ----
  ZETTA_STREAM_LOG_ADDRESS: z.string().default(""),
  ZETTA_STREAM_MEDAL_ADDRESS: z.string().default(""),
  ZETTA_STREAM_DELEGATE_ADDRESS: z.string().default(""),
  DELEGATE_FACTORY_ADDRESS: z.string().default(""),
  MEDAL_OWNER_ADDRESS: z.string().default(""),
  TEST_VAULT_ADDRESS: z.string().default(""),
  /// Legacy IntentHub scenario fixture — kept to satisfy leftover demo scripts;
  /// replaced by rotate-up/rotate-down scenarios in Day 4.
  PHISHING_VAULT_ADDRESS: z.string().default(""),

  // ---- EIP-7702 demo EOA ----
  DEMO_EOA_PRIVATE_KEY: z.string().default(""),
  DEMO_EOA_ADDRESS: z.string().default(""),
  DEPLOYER_PRIVATE_KEY: z.string().default(""),

  // ---- x402 yield-feed ----
  X402_FACILITATOR_URL: z.string().default("http://localhost:8402"),
  X402_ASSET_ADDRESS: z.string().default("0x4ae46a509f6b1d9056937ba4500cb143933d2dc8"),
  X402_PAYTO_ADDRESS: z.string().default(""),
  X402_PAYMENT_AMOUNT: z.coerce.number().int().default(100000),
  X402_MOCK_SERVER_PORT: z.coerce.number().int().default(8402),

  // ---- Decision engine tuning ----
  POLL_INTERVAL_MS: z.coerce.number().int().default(15000),
  MIN_CONFIDENCE_APPROVE: z.coerce.number().int().default(60),
  DWELL_SECONDS: z.coerce.number().int().default(180),
  COOLDOWN_SECONDS: z.coerce.number().int().default(1800),
  YIELD_MIN_SPREAD_BPS: z.coerce.number().int().default(30),
  ESTIMATED_GAS_USD: z.coerce.number().default(0.5),
  NOTIONAL_USD: z.coerce.number().default(200),

  // ---- Flags ----
  SILENT_MODE: z
    .string()
    .default("false")
    .transform((v) => v === "true"),
  FORCE_7702: z
    .string()
    .default("false")
    .transform((v) => v === "true"),
  LOCAL_SIGN_FALLBACK: z
    .string()
    .default("false")
    .transform((v) => v === "true"),
  DEMO_MODE: z
    .string()
    .default("true")
    .transform((v) => v === "true"),

  // ---- Agent API ----
  AGENT_API_PORT: z.coerce.number().int().default(7777),
  AGENT_STATE_PATH: z.string().default("./.agent-state.json"),
  AGENT_LOG_PATH: z.string().default("./logs/agent.jsonl"),

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
