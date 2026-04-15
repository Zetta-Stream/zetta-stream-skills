---
name: zetta-stream-action
description: "Use this skill when the user wants ZettaStream to EXECUTE a multi-step on-chain intent as ONE batched transaction — after parsing the natural language into structured steps, simulating them in TEE, risk-scanning each call via okx-security, and finally broadcasting via EIP-7702 batch (with a Multicall fallback on X Layer) — and then logging the verdict to ZettaStreamLog on X Layer. Triggers: 'execute my intent', 'run intent now', 'batch these calls', 'swap X for Y and stake it', 'upgrade my EOA and run', 'do this for me safely', 'approve and deposit in one tx', 'bundle these operations', 'run my plan'. Every approved path goes through okx-security tx-scan + okx-agentic-wallet TEE signing. Requires SILENT_MODE=true to add --force automatically. Do NOT use to just preview or score an intent — use zetta-stream-analyze. Do NOT use to bridge funds in — use zetta-stream-fund. Do NOT use to set up a watcher — use zetta-stream-monitor."
license: MIT
metadata:
  author: zetta-stream
  version: "0.1.0"
---

# ZettaStream Action — Parse, simulate, batch-execute, audit

The core autonomous action. Takes a structured intent (produced by Claude from the
user's NL), runs it through the firewall pipeline, and — only if APPROVED — executes
as one atomic batch on X Layer. Every verdict (approved, rejected, executed) lands on
`ZettaStreamLog` on X Layer.

## Architecture

```
Claude parses NL → IntentJSON
         ↓
   POST /intent to agent (:7777)
         ↓
   planner.ts         → Call[] with encoded calldata
         ↓
   simulator.ts       → viem eth_call + stateOverride, per-step state diffs
         ↓
   risk-scan.ts       → okx-security tx-scan (per call) + dapp-scan (per spender)
         ↓
   verdict.ts         → APPROVED | REJECTED | WARN with confidence 0-100
         ↓
   ┌─────────┴─────────┐
   │ APPROVED          │ REJECTED
   ▼                   ▼
batch-executor.ts   ZettaStreamLog.logIntent(REJECTED)
(7702 → Multicall)        │
   │                      ▼
   ▼                 done (no execute tx)
ZettaStreamLog.logIntent(EXECUTED)
ZettaStreamLog.logDelegation(mode=7702|Multicall)
```

## Input schema (what Claude must produce)

```json
{
  "kind": "BATCH" | "SWAP" | "STAKE" | "BRIDGE" | "APPROVE" | "WITHDRAW" | "LEND" | "MINT",
  "owner": "0x<EOA>",
  "steps": [
    {
      "op": "APPROVE" | "SWAP" | "DEPOSIT" | "WITHDRAW" | "BRIDGE" | "STAKE" | "MINT" | "RAW",
      "chainId": 196,
      "token": "0x<addr>"          // optional, for token ops
      "to": "0x<addr>"             // optional, for raw/approve/deposit targets
      "amount": "human"            // optional, human-readable like "0.1" or "100"
      "spender": "0x<addr>"        // required for APPROVE
      "params": { ... }            // op-specific (tickLower/tickUpper for STAKE etc.)
    }
  ],
  "options": {
    "force_fallback": false,       // force Multicall path even if 7702 available
    "tag": "[DEMO]"                // reason prefix for auditing
  }
}
```

## Prerequisites

1. Wallet logged in (`onchainos wallet status` shows `loggedIn: true`)
2. `ZETTA_STREAM_LOG_ADDRESS` set (ran `pnpm contracts:deploy:log`)
3. `BATCH_CALL_DELEGATE_ADDRESS` set (ran `pnpm contracts:deploy:delegate`)
4. `DEMO_EOA_PRIVATE_KEY` + `DEMO_EOA_ADDRESS` set (for EIP-7702 signing)
5. Owner address in `steps[].owner` has called `authorizeAgent(<TEE-EVM>)` on `ZettaStreamLog`
6. `SILENT_MODE=true` in `.env`

## Command Index

| # | Command | Purpose |
|---|---|---|
| 1 | `POST http://localhost:7777/intent` | Submit structured intent to agent |
| 2 | `onchainos security tx-scan` | Per-step risk check (agent-internal) |
| 3 | `onchainos security dapp-scan` | Spender check for APPROVE ops |
| 4 | `onchainos swap quote` | Route + calldata for SWAP steps |
| 5 | `onchainos wallet contract-call --force` | TEE-sign each inner call |
| 6 | `onchainos wallet contract-call` | Write ZettaStreamLog audit entry |

## Main Flow

### Step 1 — Parse NL into IntentJSON

Analyze the user's message. Extract the operation kind, tokens, amounts, and
destinations. Produce an `IntentJSON` object that conforms to the schema above.

**Example mappings:**

| User says | IntentJSON |
|---|---|
| "swap 0.1 OKB to USDC then stake USDC in test vault" | `{kind:"BATCH", steps:[{op:"SWAP",token:"OKB",amount:"0.1",to:"USDC"},{op:"APPROVE",token:"USDC",spender:"<vault>"},{op:"STAKE",to:"<vault>",token:"USDC"}]}` |
| "approve 100 USDC to 0xBadC0ffee and deposit" | `{kind:"BATCH", steps:[{op:"APPROVE",token:"USDC",amount:"100",spender:"0xBadC0ffee"},{op:"DEPOSIT",to:"0xBadC0ffee",token:"USDC",amount:"100"}]}` |
| "bridge 500 USDC from X Layer to Base Aave deposit" | `{kind:"BATCH", steps:[{op:"BRIDGE",token:"USDC",amount:"500",chainId:196,params:{dstChainId:8453}},{op:"APPROVE",token:"USDC",chainId:8453,spender:"<aave>"},{op:"DEPOSIT",to:"<aave>",token:"USDC",chainId:8453}]}` |

### Step 2 — POST /intent

```bash
curl -X POST http://localhost:7777/intent \
  -H 'Content-Type: application/json' \
  -d '{"kind":"BATCH","owner":"0x...","steps":[...]}'
```

Response:

```json
{
  "intentHash": "0xabc...",
  "verdict": "APPROVED" | "REJECTED",
  "confidence": 92,
  "reason": "all checks clean",
  "plan": { "callCount": 3, "mode": "EIP7702|Multicall" },
  "txHashes": ["0x..."] ,          // present when verdict=EXECUTED
  "auditTx": "0x..."               // X Layer tx of logIntent
}
```

### Step 3 — Present verdict

If `verdict === "REJECTED"`, summarize the reason conversationally. Point the user to
the X Layer audit entry:
`https://www.oklink.com/xlayer/tx/<auditTx>` and offer to run `zetta-stream-analyze`
with a different target if they want to try a safer variant.

If `verdict === "APPROVED"` and execution succeeded, show:

- The single batched tx hash
- The mode used (EIP-7702 or Multicall fallback)
- Gas saved percentage (gasSaved / baseline ratio)
- The audit entry link

### Step 4 — Confirm audit landed

The agent writes `ZettaStreamLog.logIntent(...)` last. Verify via:

```bash
curl http://localhost:7777/verdict/<intentHash>
```

Response shows the chain state matches the agent's self-reported result.

## Critical Rules

| Rule | Detail |
|------|--------|
| **Never skip simulation** — even dry-run commands go through simulator.ts |
| **Never skip tx-scan** — a failed scan is a hard REJECT, no "best-effort" |
| **One batch per intent** — if the intent needs >8 steps, split into multiple intents |
| **--force required** — after `SILENT_MODE=true`, OR the CLI will prompt and break flow |
| **Log entry is the last step** — audit reflects what actually happened, not what was planned |
| **On 7702 probe fail** — silently degrade to Multicall path; don't error out |

## Error Reference

| Condition | Cause | Fix |
|-----------|-------|-----|
| `verdict=REJECTED, reason="block: ..."` | okx-security flagged a call | Expected for phishing scenario; don't retry |
| `verdict=REJECTED, reason="sim revert at step N: ..."` | Plan is infeasible (insufficient balance / wrong ABI) | Re-check `steps[]` encoding; verify token balances |
| `verdict=WARN` | scan warn + sim OK | Surface to user; ask for explicit go-ahead |
| `mode=Multicall` unexpectedly | Pectra probe failed on X Layer | Expected until X Layer upgrades; README discloses |
| `HTTP 402` from agent | (shouldn't happen on /intent) | Report; paths are not payment-gated here |
| `confirming:true` from CLI | SILENT_MODE not set | Set `SILENT_MODE=true` in `.env` |
| `tx status != 2` | X Layer broadcast failed | Check gas / nonce; agent retries once |

## Cross-Skill Workflows

### A. Preview then execute
> "analyze this intent — if safe, run it"
```
1. zetta-stream-analyze  → score + highlights risks
2. zetta-stream-action   → actually execute (same IntentJSON)
```

### B. Funded + executed in one user message
> "deposit 100 USDC from Base to X Layer Aave"
```
1. zetta-stream-fund     → bridge Base→XLayer
2. zetta-stream-action   → approve + supply on Aave/XLayer
```

### C. Monitored + fired
> "when ETH drops below $3,400 run scenario X"
```
1. zetta-stream-monitor  → register condition + then_intent
2. (later, triggered) → zetta-stream-action auto-invoked by monitor
```
