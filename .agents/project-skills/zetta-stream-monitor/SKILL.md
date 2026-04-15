---
name: zetta-stream-monitor
description: "Use this skill when the user wants ZettaStream to run as a 24/7 AUTONOMOUS agent — watching a condition (price crossing, balance threshold, time window) and firing a pre-defined intent automatically when the trigger fires. Under the hood it polls an x402 reusable session every 500ms (opened once via zetta-stream-fund) and invokes zetta-stream-action when the condition hits. Triggers: 'start monitoring', 'watch for opportunities', 'run the agent 24/7', 'auto-execute when ETH drops below 3400', 'keep firewall live', 'tail the intent queue', 'watch price and act', 'auto-trade when condition', 'set up a trigger'. Do NOT use to execute an intent once — use zetta-stream-action. Do NOT use to preview — use zetta-stream-analyze. Do NOT use to open a session/bridge funds — use zetta-stream-fund first."
license: MIT
metadata:
  author: zetta-stream
  version: "0.1.0"
---

# ZettaStream Monitor — 24/7 autonomous watcher

Registers a `(condition, then_intent)` pair with the agent. The agent polls price /
balance / time signals via the x402 session at 500ms cadence. When the condition
fires, the agent auto-invokes `zetta-stream-action` with the pre-defined `then_intent` —
no human in the loop.

## Architecture

```
zetta-stream-fund (:4402 session open, $0.001 paid)
         ↓
POST /monitor/register (:7777)
         ↓
monitor/loop.ts  — every 500ms:
   ├─ query.ts → GET :4402/price/:symbol?session=sid  (<100ms)
   ├─ evaluate condition
   └─ if fired:
        ├─ call /intent with then_intent → full firewall pipeline
        ├─ log trigger-fire event to SSE /sse
        └─ auto-unregister (unless repeat=true)
```

## Input schema

```json
{
  "condition": {
    "symbol": "ETH" | "BTC" | "OKB" | "<any-token>",
    "op": "<" | ">" | "==",
    "value": 3400,
    "source": "x402_session" | "okx_market"   // default "x402_session"
  },
  "then_intent": {
    "kind": "BATCH",
    "owner": "0x...",
    "steps": [ ... ]
  },
  "options": {
    "repeat": false,                   // re-arm after fire? default false
    "max_fires": 1,                    // hard cap
    "expires_at_unix": 1772236800,     // auto-stop deadline
    "cooldown_seconds": 60             // min gap between fires if repeat=true
  }
}
```

## Prerequisites

1. Wallet logged in + `SILENT_MODE=true` (so auto-exec doesn't prompt)
2. x402 session already open — run `zetta-stream-fund` first (`target=x402`)
3. Owner in `then_intent.owner` has called `authorizeAgent(...)` on ZettaStreamLog

## Command Index

| # | Command | Purpose |
|---|---|---|
| 1 | `POST :7777/monitor/register` | Register a condition + then_intent |
| 2 | `GET :7777/monitor/list` | List active watchers |
| 3 | `DELETE :7777/monitor/:id` | Cancel a watcher |
| 4 | `GET :7777/sse` | Stream live events (polls, fires, verdicts) |

## Main Flow

### Step 1 — Register

```bash
curl -X POST :7777/monitor/register \
  -d '{
    "condition": {"symbol":"ETH","op":"<","value":3400},
    "then_intent": { "kind":"BATCH", "owner":"0x...", "steps":[
        { "op":"BRIDGE","token":"USDC","amount":"500","chainId":196,
          "params":{"dstChainId":8453} },
        { "op":"APPROVE","token":"USDC","chainId":8453,"spender":"<aave>"},
        { "op":"DEPOSIT","to":"<aave>","token":"USDC","chainId":8453 }
    ]},
    "options": {"repeat":false, "max_fires":1, "cooldown_seconds":60}
  }'
```

Response: `{ id: "w_xyz789", status: "active", created_at, expires_at }`

### Step 2 — Stream events

```bash
curl -N :7777/sse
# event: poll  data: { symbol:"ETH", price:3412, t:... }
# event: fire  data: { id:"w_xyz789", intentHash:"0x...", auditTx:"0x..." }
```

### Step 3 — Report back to user

Once the fire event arrives:

> "Condition hit — ETH touched $3,399.82. Fired the X Layer→Base Aave batch.
>   Verdict: APPROVED (confidence 91). X Layer batch tx: 0x...
>   Base Aave deposit tx: 0x...
>   Audit trail: https://oklink.com/xlayer/tx/<auditTx>"

## Demo-mode helpers (DEMO_MODE=true)

- `POST /api/debug/fake-price` — inject a synthetic price for instant trigger
- `POST /api/debug/replay-scenario` — replay one of the 3 demo scenarios

## Critical Rules

| Rule | Detail |
|------|--------|
| **Always fund an x402 session first** — or monitor falls back to okx_market (costs more) |
| **cooldown_seconds required with repeat** — prevents fire-storm on noisy prices |
| **All fires go through the full firewall** — REJECTED fires still audit, no shortcut |
| **Max 10 active watchers** — safety cap; agent refuses to register #11 |
| **Session expiry handled automatically** — transparent re-open |

## Error Reference

| Condition | Cause | Fix |
|-----------|-------|-----|
| `409 no x402 session` | Forgot to run zetta-stream-fund | Run `zetta-stream-fund target=x402` |
| `422 owner not authorized` | EOA hasn't called authorizeAgent | Call `authorizeAgent(<TEE-EVM>)` on ZettaStreamLog |
| `429 max watchers` | >10 active | Cancel stale ones via DELETE |
| `ECONNREFUSED :4402` | Mock x402 server down | Start `pnpm agent:mock-x402` |

## Cross-Skill Workflows

### A. The classic autonomous trade
```
1. zetta-stream-fund     (x402 session)      → queries cost $0.001 / 1000
2. zetta-stream-fund     (bridge if needed)  → capital in place
3. zetta-stream-monitor  (register trigger)  → watcher active
4. (wait)             → condition fires
5. (auto)             → zetta-stream-action fires the then_intent → audit on X Layer
```

### B. Early-exit monitoring
```
1. zetta-stream-monitor (with cancel-on-fire) → watches once
2. DELETE /monitor/:id                     → cancel manually
```
