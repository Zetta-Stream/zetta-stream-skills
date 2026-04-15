#!/usr/bin/env tsx
/**
 * Seed ZettaStreamLog on X Layer with 20+ realistic entries so the /audit page
 * has content during judging. Fires all 3 demo scenarios in a loop, each producing
 * APPROVED / REJECTED / EXECUTED audit writes.
 */
import { getConfig } from "../agent/config.js";
import { intentSchema } from "../agent/firewall/intent-types.js";
import { runFullIntent } from "../agent/monitor/run-intent.js";
import { getScenario, ALL_SCENARIOS } from "../agent/demo/scenarios.js";

async function main() {
  const cfg = getConfig();
  if (!cfg.ZETTA_STREAM_LOG_ADDRESS) {
    console.error("ZETTA_STREAM_LOG_ADDRESS not set — deploy contracts first");
    process.exit(1);
  }
  const rounds = Number(process.argv[2] ?? 7);
  console.log(`seeding ${rounds * ALL_SCENARIOS.length} audit entries…`);
  for (let r = 0; r < rounds; r++) {
    for (const id of ALL_SCENARIOS) {
      const s = getScenario(id);
      try {
        const result = await runFullIntent(intentSchema.parse(s.intent));
        console.log(
          `round ${r + 1} · ${id} → ${result.verdict} (${result.confidence}%) ${result.auditTx ?? ""}`,
        );
      } catch (e) {
        console.error(`round ${r + 1} · ${id} failed:`, (e as Error).message);
      }
    }
  }
  console.log("seeding done");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
