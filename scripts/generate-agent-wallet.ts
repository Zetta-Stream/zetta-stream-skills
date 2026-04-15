#!/usr/bin/env tsx
/**
 * Generate a fresh local EVM account for ZettaStream's EIP-7702 demo EOA.
 *
 * This key signs ONLY the EIP-7702 authorization tuple (viem's `signAuthorization`
 * requires a local account — the OKX TEE CLI does not yet expose that API). Every
 * inner call in the batch is still TEE-signed via `onchainos wallet contract-call`.
 *
 * DO NOT use this key as a real wallet. Fund it with the minimum OKB needed for
 * the demo (~1 OKB + ~100 USDC on X Layer) and treat it as throwaway.
 *
 * Flow:
 *   1. Generate 32-byte random key
 *   2. Derive checksummed EVM address
 *   3. If .env doesn't exist, clone from .env.example
 *   4. Patch DEMO_EOA_PRIVATE_KEY + DEMO_EOA_ADDRESS in .env
 *   5. Print a human-readable summary
 */
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { readFileSync, writeFileSync, existsSync, copyFileSync } from "node:fs";
import { resolve } from "node:path";

const ENV_PATH = resolve(process.cwd(), ".env");
const EXAMPLE_PATH = resolve(process.cwd(), ".env.example");

function setEnvVar(env: string, key: string, value: string): string {
  const re = new RegExp(`^${key}=.*$`, "m");
  if (re.test(env)) return env.replace(re, `${key}=${value}`);
  // Append if the key doesn't exist yet
  return `${env.trimEnd()}\n${key}=${value}\n`;
}

function main() {
  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);

  if (!existsSync(ENV_PATH)) {
    if (!existsSync(EXAMPLE_PATH)) {
      console.error(".env.example missing — are you in the project root?");
      process.exit(1);
    }
    copyFileSync(EXAMPLE_PATH, ENV_PATH);
    console.log("created .env from .env.example");
  }

  let env = readFileSync(ENV_PATH, "utf8");
  env = setEnvVar(env, "DEMO_EOA_PRIVATE_KEY", privateKey);
  env = setEnvVar(env, "DEMO_EOA_ADDRESS", account.address);
  writeFileSync(ENV_PATH, env);

  console.log("\n╭──────────────── ZettaStream Demo EOA ────────────────╮");
  console.log(`│ address:      ${account.address.padEnd(45)} │`);
  console.log(`│ private key:  ${privateKey.slice(0, 14)}…${privateKey.slice(-14).padStart(28)} │`);
  console.log("╰────────────────────────────────────────────────────╯");
  console.log("\nWritten to .env:");
  console.log("  DEMO_EOA_PRIVATE_KEY=" + privateKey);
  console.log("  DEMO_EOA_ADDRESS=" + account.address);
  console.log("\nNext steps:");
  console.log("  1. Fund this address on X Layer with ~1 OKB (for gas) + ~100 USDC (for demo swaps)");
  console.log("     → send from an exchange that supports X Layer or bridge via OKX");
  console.log("  2. Separately run the TEE wallet (for inner-call signing):");
  console.log("     onchainos wallet login <your-email>");
  console.log("     onchainos wallet verify <code>");
  console.log("     pnpm verify:wallet");
  console.log("  3. Deploy the two contracts:");
  console.log("     pnpm contracts:deploy");
  console.log("  4. From the Demo EOA, call ZettaStreamLog.authorizeAgent(<TEE-EVM address>)");
  console.log("\nReminder: .env is gitignored. Do NOT share this private key.");
}

main();
