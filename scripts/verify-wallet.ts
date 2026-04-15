#!/usr/bin/env tsx
/**
 * Verify the TEE wallet is logged in and has X Layer balance.
 * Prints the EVM address + OKB/USDC balances. Used by judges to confirm the
 * agent has a live wallet before a demo run.
 */
import { runOkx, mustOk } from "../agent/lib/okx-cli.js";
import { getConfig } from "../agent/config.js";

interface Status {
  loggedIn?: boolean;
  user?: { email?: string; accountId?: string };
}
interface Addrs {
  evm?: Array<{ address: string; chainIndex: string }>;
}
interface Balances {
  balances?: Array<{ symbol: string; readableAmount: string; chainIndex: string }>;
  list?: Array<{ symbol: string; readableAmount: string; chainIndex: string }>;
}

async function main() {
  const cfg = getConfig();
  console.log("--- ZettaStream wallet verification ---");

  const status = mustOk(
    await runOkx<Status>("wallet", "status", [], { reason: "verify" }),
    "wallet status",
  );
  if (!status.loggedIn) {
    console.error("NOT logged in — run: onchainos wallet login <email>");
    process.exit(1);
  }
  console.log("logged in:", status.user?.email ?? status.user?.accountId ?? "?");

  const addrs = mustOk(
    await runOkx<Addrs>("wallet", "addresses", [], { reason: "verify" }),
    "wallet addresses",
  );
  const evm =
    addrs.evm?.find((a) => a.chainIndex === "196" || a.chainIndex === "0xc4") ??
    addrs.evm?.find((a) => a.address?.startsWith("0x"));
  if (!evm) {
    console.error("no EVM address found");
    process.exit(1);
  }
  console.log("TEE EVM (X Layer):", evm.address);

  const bal = mustOk(
    await runOkx<Balances>("portfolio", "all-balances", [
      "--address",
      evm.address,
      "--chains",
      "xlayer",
    ], { reason: "verify" }),
    "portfolio",
  );
  const list = bal.balances ?? bal.list ?? [];
  for (const b of list.slice(0, 10)) {
    console.log(`  ${b.symbol.padEnd(8)} ${b.readableAmount}`);
  }

  console.log("\nContracts:");
  console.log("  ZettaStreamLog:        ", cfg.ZETTA_STREAM_LOG_ADDRESS || "(not deployed)");
  console.log("  BatchCallDelegate:   ", cfg.BATCH_CALL_DELEGATE_ADDRESS || "(not deployed)");
  console.log("\nExpected next:");
  console.log("  1. deploy contracts: pnpm contracts:deploy");
  console.log("  2. call ZettaStreamLog.authorizeAgent(<TEE-EVM>) from owner EOA");
  console.log("  3. pnpm agent:monitor");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
