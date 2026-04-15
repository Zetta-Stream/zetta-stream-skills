# AGENTS.md

Instructions for agentic harnesses (Claude, Cursor, OpenAI codex, etc.) operating on
the Zetta-Stream codebase.

## Skill routing (how Claude picks a skill)

The 4 project-specific skills under `.agents/project-skills/zetta-stream-*/SKILL.md`
each have a `description` that Claude matches against the user's message:

| Skill | Triggers | Endpoint |
|-------|----------|----------|
| `zetta-stream-analyze` | "preview the yield stream" / "should I rotate now?" / "score current signal" / "dry-run a rotation" | `POST /analyze` |
| `zetta-stream-fund` | "fund zetta" / "open x402 session" / "bridge USDC for zetta" / "deposit into the stream" | `POST /fund` |
| `zetta-stream-action` | "rotate now" / "flip to Aave" / "flip to UniV4" / "rebalance my stream" | `POST /rotate` |
| `zetta-stream-monitor` | "start the autonomous stream" / "turn on zetta" / "stop the stream" | `POST /monitor/start` / `POST /monitor/stop` |

When Claude triggers any of these, it must:

1. Parse the user's natural language into the `Input schema` declared in the skill.
2. POST the JSON to the agent API: `http://localhost:${AGENT_API_PORT:-7777}/<endpoint>`.
3. Interpret the response: `decision`, `verdict`, `reason`, `findings`, `txHash`, `auditTx`, `medalTx?`.
4. For `EXECUTED` results, link the user to the X Layer audit entry on OKLink and (if
   minted) the medal NFT.

## Never do

- **Do not write a local NL parser in the agent.** Parsing is the harness's job; the
  agent endpoints expect structured JSON.
- **Do not bypass the firewall.** There is no "skip-scan" flag in production. The
  `force=true` flag on `/rotate` only skips dwell/cooldown gates, never the firewall.
- **Do not sign EIP-7702 authorizations from arbitrary private keys.** Only
  `DEMO_EOA_PRIVATE_KEY` is allowed; README discloses this.
- **Do not log secrets.** `.env` is gitignored; `okx-cli.ts` redacts sensitive env vars.
- **Do not call Aave / UniV4 outside the Delegate's allowlist.** `risk-scan` will
  REJECT and the firewall verdict will block execution.

## Demo scripts (for judges)

```bash
# 1. Verify environment
pnpm verify

# 2. Seed a few rotation log entries on X Layer
pnpm seed:rotations

# 3. Replay a rotation in the browser
#    open http://localhost:3000 and click "Replay rotate-up"
```

## Harness tips

- The `/sse` stream emits `signal`, `decision`, `firewall`, `exec`, `audit`, `medal`
  events. Subscribe to surface live progress to the user.
- The agent exposes `/debug/*` endpoints only when `DEMO_MODE=true`. Use
  `/debug/set-yield/uniFeeApr/0.082` to engineer a rotation trigger without waiting.
- The Pectra probe caches its result to `.agent-state.json`. Delete the file if
  X Layer adds Pectra and you want the agent to re-probe.

## Testing expectations

- `pnpm typecheck` must pass (zero TS errors)
- `pnpm contracts:test` must pass (all forge tests green)
- `pnpm test` runs the vitest suite (planner / verdict / scorer / rotator / log-encoder)
- Smoke: `pnpm agent:demo -- scenario=rotate-up` ends with a non-empty `batchTxHash` +
  `auditTx` and (if profitable) a `medalTx`

## Key invariants

1. The `signalHash` in an audit entry must equal `keccak256(canonicalJson(YieldSignal))` —
   tamper-evident tie between off-chain signal and on-chain rotation.
2. Every call inside `executeBatch` whose `target` is not the Delegate itself must be on
   `ZettaStreamDelegate.allowedTarget[]`. Risk-scan also enforces this off-chain.
3. `ZettaStreamDelegate.executeBatch` reverts atomically if any inner call reverts.
4. EIP-7702 path and Multicall fallback hit the **same** target contract with the
   **same** calldata — downstream observers see identical behavior; only the
   `mode` field of the audit entry changes.
5. A `MedalMinted` event MUST reference an existing `RotationLogged` id with positive
   `netYieldBps`.
