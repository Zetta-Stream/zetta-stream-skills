---
name: zetta-stream-action
description: "Use this skill when the user wants Zetta-Stream to EXECUTE one yield rotation NOW between Aave V3 and Uniswap V4 — pulling the latest x402 yield signal, scoring net APY (after IL + gas), composing the multi-step batch (withdraw → swap → supply / mint-LP), running it through the TEE intent firewall, broadcasting via EIP-7702 on Arbitrum (with Multicall fallback), and writing the audit entry to ZettaStreamLog on X Layer (plus a Medal mint if profitable). Triggers: 'rotate now', 'execute the rotation', 'flip to Aave', 'flip to UniV4', 'rebalance my stream', 'shuffle funds', 'move my position', 'one-shot rotation'. Sets force=true so dwell/cooldown gates are skipped (the user asked explicitly), but the firewall is NEVER skipped. Do NOT use to preview without executing — use zetta-stream-analyze. Do NOT use to fund/bridge in — use zetta-stream-fund. Do NOT use to start the autonomous loop — use zetta-stream-monitor."
license: MIT
metadata:
  author: zetta-stream
  version: "0.1.0"
---

# Zetta-Stream Action — Execute one rotation now

Forces a rotation tick **now**, regardless of dwell/cooldown gates. The pipeline is
identical to the autonomous loop's but `force=true` short-circuits the timing gates.
The firewall, signal verification, and on-chain audit are unchanged.

## Architecture

```
Claude parses NL → RotateRequest
         ↓
   POST /rotate to agent (:7777)
         ↓
   queryYieldFeed()        → x402 session (cached sessionId)
         ↓
   scoreAndGate(force=true) → Decision { target, netBps, confidence, reason }
         ↓ (if target == HOLD with force=true → still surface; do NOT execute)
   intent-builder           → Call[] (4-6 steps: withdraw + approve + swap + supply/mint)
         ↓
   firewall.run             → planner → simulator → risk-scan → verdict
         ↓ APPROVED
   batch-executor           → EIP-7702 on Arbitrum (Multicall fallback if probe fails)
         ↓
   ZettaStreamLog.logRotation(...)        on X Layer
         ↓ if netYieldBps > 0
   ZettaStreamMedal.mintTo(rotationId,…)  on X Layer
```

## Input schema

```json
{
  "owner": "0x<EOA>",
  "force": true,
  "options": {
    "force_fallback": false,   // force Multicall path even if 7702 available
    "tag": "[DEMO]",           // reason prefix written into the audit entry
    "minNetBps": 0             // override YIELD_MIN_SPREAD_BPS for this single call
  }
}
```

## Prerequisites

1. Wallet logged in (`onchainos wallet status` shows `loggedIn: true`)
2. `ZETTA_STREAM_LOG_ADDRESS` set on X Layer
3. `ZETTA_STREAM_DELEGATE_ADDRESS` set on Arbitrum
4. `ZETTA_STREAM_MEDAL_ADDRESS` set on X Layer
5. `DEMO_EOA_ADDRESS` has called `authorizeAgent(<TEE-EVM>)` on `ZettaStreamLog`
6. Open x402 session (run `zetta-stream-fund target=x402` first if `state.x402.sessionId` is empty)
7. `SILENT_MODE=true` in `.env`

## Command Index

| # | Command | Purpose |
|---|---|---|
| 1 | `POST http://localhost:7777/rotate` | Force one rotation tick |
| 2 | `onchainos security tx-scan` | Per-call risk check (agent-internal) |
| 3 | `onchainos swap quote` | USDC ↔ token leg (only when needed by intent-builder) |
| 4 | `onchainos wallet contract-call --force` | TEE-sign each inner call (Aave / UniV4) |
| 5 | `onchainos wallet contract-call` | Write `logRotation` on X Layer |
| 6 | `onchainos wallet contract-call` | Mint `ZettaStreamMedal` (if netYieldBps > 0) |

## Main flow

### Step 1 — Build the request

The user's NL maps to a single `RotateRequest`. Examples:

| User says | RotateRequest |
|---|---|
| "rotate now" | `{owner:"0x…", force:true}` |
| "flip to UniV4 now" | `{owner:"0x…", force:true, options:{tag:"[FORCE-UNIV4]"}}` |
| "rebalance, ignore the cooldown" | `{owner:"0x…", force:true}` |

### Step 2 — POST /rotate

```bash
curl -X POST http://localhost:7777/rotate \
  -H 'Content-Type: application/json' \
  -d '{"owner":"0x...","force":true}'
```

Response:

```json
{
  "decision": {
    "target": "UNIV4" | "AAVE" | "HOLD",
    "netYieldBps": 85,
    "confidence": 73,
    "reason": "uni fee apr +110bps after IL"
  },
  "verdict": "APPROVED" | "REJECTED" | "HOLD",
  "exec": {
    "mode": "EIP7702" | "MULTICALL_FALLBACK",
    "batchTxHash": "0x..." ,
    "callCount": 5,
    "gasSavedBps": 42
  },
  "audit": { "rotationId": 17, "auditTx": "0x..." },
  "medal": { "tokenId": 9, "mintTx": "0x..." }   // optional, only if netYieldBps > 0
}
```

### Step 3 — Present the result

If `verdict === "HOLD"`: explain that the scorer found no profitable rotation right
now, and quote the `decision.netYieldBps` so the user knows the magnitude.

If `verdict === "REJECTED"`: summarize the firewall reason. Common cases: target not on
the Delegate allowlist (config issue), or simulator reverted (insufficient balance,
slippage). Point at the X Layer audit entry.

If `verdict === "APPROVED"` and execution succeeded:
- Batch tx on Arbitrum: `https://arbiscan.io/tx/<exec.batchTxHash>`
- Audit entry on X Layer: `https://www.oklink.com/xlayer/tx/<audit.auditTx>`
- (If minted) Medal NFT on X Layer: `https://www.oklink.com/xlayer/tx/<medal.mintTx>`
- Mode badge (`EIP-7702` is the headline; `Multicall fallback` is fine but call it out)
- `gasSavedBps` rendered as a percentage of notional

### Step 4 — Confirm audit landed

```bash
curl http://localhost:7777/state | jq '.rotation'
```

The reported `lastRotatedAt` and `rotationCount` should reflect the new entry.

## Critical rules

| Rule | Detail |
|------|--------|
| **Never skip the firewall** — `force` skips dwell/cooldown only, never the simulator + risk-scan |
| **Never sign EIP-7702 from a user-controlled key** — only `DEMO_EOA_PRIVATE_KEY` |
| **One batch per rotation** — intent-builder caps at 6 inner calls; if the route needs more, surface as REJECTED |
| **`--force` required** — after `SILENT_MODE=true`, or the CLI will prompt and break flow |
| **Log entry is last** — write `logRotation` after the batch; on failure, audit reflects the actual state |
| **Medal only on profit** — never mint if `netYieldBps <= 0`; the contract enforces this too |

## Error reference

| Condition | Cause | Fix |
|-----------|-------|-----|
| `verdict=REJECTED, reason="target not allowed"` | Aave/UniV4 spender not in Delegate allowlist | Run `setAllowed(<addr>, true)` from factory key |
| `verdict=REJECTED, reason="sim revert at step N"` | Slippage / balance / approval missing | Re-fund position; check `state.balances` |
| `mode=MULTICALL_FALLBACK` unexpectedly | Pectra probe failed on Arbitrum | Set `FORCE_7702=true` to re-probe; check viem version ≥ 2.21 |
| `medal absent on profit` | Medal contract not deployed or owner mismatch | Verify `ZETTA_STREAM_MEDAL_ADDRESS` and that owner == agent EOA |
| `HTTP 402 from /rotate` | x402 session expired mid-flight | Run `zetta-stream-fund target=x402` to refresh session |

## Cross-skill workflows

### A. Preview then execute
> "analyze this rotation; if safe, run it"
```
1. zetta-stream-analyze  → score + show firewall findings
2. zetta-stream-action   → execute now
```

### B. Fund + execute in one message
> "open x402 and rotate"
```
1. zetta-stream-fund     → opens x402 session
2. zetta-stream-action   → executes one rotation
```

### C. Manual override during autonomous loop
> "stop monitoring and rotate one final time"
```
1. zetta-stream-monitor stop  → halts the autonomous loop
2. zetta-stream-action        → final manual rotation
```
