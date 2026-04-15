#!/usr/bin/env tsx
/**
 * End-to-end health check for a fresh Zetta-Stream install.
 *
 *   pnpm verify    # before demo day, before judging, after every deploy
 *
 * Reports every check in plain ASCII with a PASS/FAIL tag. Exit 0 only if
 * everything is green. Judges can copy-paste the output into the README or
 * submission checklist.
 */
import { createPublicClient, http } from "viem";
import { xLayer, arbitrum } from "viem/chains";
import { getConfig } from "../agent/config.js";

const results: { name: string; pass: boolean; detail: string }[] = [];

function record(name: string, pass: boolean, detail: string) {
  results.push({ name, pass, detail });
}

async function main() {
  const cfg = getConfig();

  /* ----- env vars ----- */
  const required = [
    "XLAYER_RPC_URL",
    "EXEC_CHAIN_RPC_URL",
    "ZETTA_STREAM_LOG_ADDRESS",
    "ZETTA_STREAM_MEDAL_ADDRESS",
    "ZETTA_STREAM_DELEGATE_ADDRESS",
    "DEMO_EOA_ADDRESS",
  ] as const;
  for (const k of required) {
    const v = (cfg as unknown as Record<string, string>)[k];
    record(`env.${k}`, !!v, v ? v : "(empty)");
  }

  /* ----- X Layer contracts ----- */
  const xClient = createPublicClient({ chain: xLayer, transport: http(cfg.XLAYER_RPC_URL) });
  if (cfg.ZETTA_STREAM_LOG_ADDRESS) {
    try {
      const count = (await xClient.readContract({
        address: cfg.ZETTA_STREAM_LOG_ADDRESS as `0x${string}`,
        abi: [
          {
            type: "function",
            name: "rotationCount",
            stateMutability: "view",
            inputs: [],
            outputs: [{ type: "uint256" }],
          },
        ],
        functionName: "rotationCount",
      })) as bigint;
      record("xlayer.ZettaStreamLog.rotationCount", true, `${count} rotations`);
    } catch (e) {
      record("xlayer.ZettaStreamLog.rotationCount", false, (e as Error).message);
    }
  }
  if (cfg.ZETTA_STREAM_MEDAL_ADDRESS) {
    try {
      const total = (await xClient.readContract({
        address: cfg.ZETTA_STREAM_MEDAL_ADDRESS as `0x${string}`,
        abi: [
          {
            type: "function",
            name: "totalSupply",
            stateMutability: "view",
            inputs: [],
            outputs: [{ type: "uint256" }],
          },
        ],
        functionName: "totalSupply",
      })) as bigint;
      record("xlayer.ZettaStreamMedal.totalSupply", true, `${total} medals`);
    } catch (e) {
      record("xlayer.ZettaStreamMedal.totalSupply", false, (e as Error).message);
    }
  }

  /* ----- Arbitrum contract ----- */
  const aClient = createPublicClient({ chain: arbitrum, transport: http(cfg.EXEC_CHAIN_RPC_URL) });
  if (cfg.ZETTA_STREAM_DELEGATE_ADDRESS) {
    try {
      const factory = (await aClient.readContract({
        address: cfg.ZETTA_STREAM_DELEGATE_ADDRESS as `0x${string}`,
        abi: [
          {
            type: "function",
            name: "factory",
            stateMutability: "view",
            inputs: [],
            outputs: [{ type: "address" }],
          },
        ],
        functionName: "factory",
      })) as `0x${string}`;
      record("arbitrum.ZettaStreamDelegate.factory", true, factory);
    } catch (e) {
      record("arbitrum.ZettaStreamDelegate.factory", false, (e as Error).message);
    }
  }

  /* ----- Balances ----- */
  try {
    const okb = await xClient.getBalance({ address: cfg.DEMO_EOA_ADDRESS as `0x${string}` });
    const okbStr = `${(Number(okb) / 1e18).toFixed(6)} OKB`;
    record("xlayer.balance", okb > 0n, okbStr);
  } catch (e) {
    record("xlayer.balance", false, (e as Error).message);
  }
  try {
    const eth = await aClient.getBalance({ address: cfg.DEMO_EOA_ADDRESS as `0x${string}` });
    const ethStr = `${(Number(eth) / 1e18).toFixed(6)} ETH`;
    record("arbitrum.balance", eth > 0n, ethStr);
  } catch (e) {
    record("arbitrum.balance", false, (e as Error).message);
  }

  /* ----- Local services (best-effort) ----- */
  for (const [label, url] of [
    ["agent:7777", `http://localhost:${cfg.AGENT_API_PORT}/health`],
    ["mock:8402", `http://localhost:${cfg.X402_MOCK_SERVER_PORT}/health`],
    ["dashboard:3000", "http://localhost:3000"],
  ] as const) {
    try {
      const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
      record(label, resp.ok, `HTTP ${resp.status}`);
    } catch {
      record(label, false, "not running (start with pnpm dev:all)");
    }
  }

  /* ----- Print ----- */
  const pad = (s: string, n: number) => s + " ".repeat(Math.max(0, n - s.length));
  console.log("\n== Zetta-Stream health report ==\n");
  let passed = 0;
  for (const r of results) {
    const tag = r.pass ? "PASS" : "FAIL";
    console.log(`  [${tag}]  ${pad(r.name, 40)} ${r.detail}`);
    if (r.pass) passed += 1;
  }
  console.log(
    `\n  ${passed}/${results.length} checks passed${passed === results.length ? " ✓" : " ✗"}\n`,
  );
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
