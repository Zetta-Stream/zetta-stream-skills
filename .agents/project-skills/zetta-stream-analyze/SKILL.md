---
name: zetta-stream-analyze
description: "Use this skill when the user wants to PREVIEW or SCORE an on-chain intent WITHOUT executing it — run a read-only simulation against current state, pass each call through okx-security tx-scan and dapp-scan, and return a verdict (APPROVED / REJECTED / WARN) with a confidence score 0-100, a state-diff breakdown, and a risk findings list. Triggers: 'is this intent safe', 'simulate this transaction', 'preview this swap', 'check for phishing', 'score this route', 'would this rug me', 'dry-run my plan', 'what would happen if I ran this', 'analyze before executing'. This skill NEVER broadcasts — it only reads. Use zetta-stream-action to actually execute an approved plan. Use zetta-stream-monitor to register conditional auto-execution. Use zetta-stream-fund for funding/bridging."
license: MIT
metadata:
  author: zetta-stream
  version: "0.1.0"
---

# ZettaStream Analyze — Read-only firewall diagnostic

Answers "what would happen if I ran this?" — without touching mainnet state.

## Architecture

```
IntentJSON (from Claude)
      ↓
POST /analyze (agent :7777)
      ↓
planner.ts         → Call[] (same path as zetta-stream-action)
      ↓
simulator.ts       → eth_call + stateOverride; per-step state diffs
      ↓
risk-scan.ts       → okx-security tx-scan / dapp-scan (no signing)
      ↓
verdict.ts         → { verdict, confidence, reason, findings[] }
      ↓
Response to caller (NO on-chain write)
```

## Input schema

Same as `zetta-stream-action` but with optional `options.dry_run: true` (implied).

```json
{
  "kind": "BATCH" | "SWAP" | ...,
  "owner": "0x<EOA>",
  "steps": [ ... ]
}
```

## Prerequisites

1. Wallet logged in
2. X Layer RPC reachable (`XLAYER_RPC_URL` set)
3. (optional) `okx-security` reachable for per-call scan

## Command Index

| # | Command | Purpose |
|---|---|---|
| 1 | `POST http://localhost:7777/analyze` | Submit IntentJSON, get verdict + findings |
| 2 | `onchainos security tx-scan` | Per-call scan (agent-internal) |
| 3 | `onchainos security dapp-scan` | Spender scan for APPROVE steps (agent-internal) |
| 4 | `onchainos swap quote` | Quote for SWAP steps (plan-time) |

## Main Flow

### Step 1 — Parse NL into IntentJSON (same as zetta-stream-action)

### Step 2 — POST /analyze

```bash
curl -X POST http://localhost:7777/analyze \
  -H 'Content-Type: application/json' \
  -d '{"kind":"BATCH","owner":"0x...","steps":[...]}'
```

Response:

```json
{
  "intentHash": "0xabc...",
  "verdict": "APPROVED" | "REJECTED" | "WARN",
  "confidence": 92,
  "reason": "all checks clean",
  "findings": [
    {"level": "info", "step": 0, "type": "sim_ok", "message": "swap returns 187.32 USDC"},
    {"level": "warn", "step": 1, "type": "dapp_scan", "message": "spender 0x... is new (no reputation yet)"}
  ],
  "stateDiff": [
    {"step": 0, "address": "0x<EOA>", "before": {"USDC": 0}, "after": {"USDC": 187320000}},
    ...
  ],
  "baseline": { "independentTxGas": 213500 },
  "estimated": { "batchTxGas": 92400, "gasSavedPct": 56.7 }
}
```

### Step 3 — Explain the verdict to the user

Translate `findings` into plain language. Highlight any WARN or BLOCK items with
OKLink / Etherscan links for the offending contracts.

For REJECTED phishing: show the chain of events that would have drained their balance
(read `stateDiff` to construct the story). Say what a safer variant would look like.

## Risk scoring (verdict.ts decision table)

| tx-scan | sim result | verdict | confidence |
|---|---|---|---|
| any `block` | — | **REJECTED** | 95+ |
| any call reverts | — | **REJECTED** | 90 |
| any `warn` | sim pass | **WARN** | 60-80 |
| all `safe` | sim pass | **APPROVED** | 90+ |
| scan unavailable | sim pass | **WARN** | 50 (reason: "scan unavailable, heuristic fallback") |

## Critical Rules

| Rule | Detail |
|------|--------|
| **No writes ever** — analyze is 100% read-only |
| **Fresh state every run** — no caching of sim results across calls |
| **Failures are REJECT** — timeouts / errors bias to REJECT, never to APPROVE |
| **Findings are typed** — every finding has level ∈ {info,warn,block} + type + message |

## Error Reference

| Condition | Cause | Fix |
|-----------|-------|-----|
| `sim revert: insufficient balance` | Owner doesn't hold enough | Check wallet balances first |
| `sim revert: ERC20: approval required` | Sequence missing an APPROVE step | Insert APPROVE before SPEND |
| `scan 429` | okx-security rate limited | Wait and retry; heuristic fallback kicks in |
| `quote not available` | OKX DEX has no route for the pair | Try an alternate route via zetta-stream-fund |

## Cross-Skill Workflows

### A. Analyze then execute
```
1. zetta-stream-analyze   → verdict + findings
2. (if APPROVED)
3. zetta-stream-action    → broadcast
```

### B. Analyze to compare routes
```
1. zetta-stream-analyze for route A   → score A
2. zetta-stream-analyze for route B   → score B
3. Pick the higher-scored → zetta-stream-action
```
