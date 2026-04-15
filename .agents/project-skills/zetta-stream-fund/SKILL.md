---
name: zetta-stream-fund
description: "Use this skill when the user wants to PREPARE the agent for action — either by opening a reusable x402 data session (one payment amortized across thousands of sub-second queries) OR by bridging assets from another chain into X Layer via OKX DEX cross-chain routing. Triggers: 'fund the agent', 'open x402 session', 'prepay data feed', 'set up market data feed', 'bridge USDC to X Layer', 'move funds from Base', 'prepare the agent', 'start a data session', 'subscribe to price feed'. Do NOT use to execute an actual intent — use zetta-stream-action. Do NOT use to preview an intent — use zetta-stream-analyze. Do NOT use to start autonomous monitoring — use zetta-stream-monitor."
license: MIT
metadata:
  author: zetta-stream
  version: "0.1.0"
---

# ZettaStream Fund — Open an x402 session or bridge into X Layer

Two modes in one skill — they share the pattern "one TEE signature unlocks many
downstream operations":

1. **`target: "x402"`** — pay once via `onchainos payment x402-pay`; receive a
   sessionId valid for N queries / T minutes. Downstream skills fetch data at
   <100ms / $0.001 amortized cost.
2. **`target: "bridge"`** — cross-chain route via `onchainos swap execute` with
   different `--chain`/`--chain-index` source/dest; pick the best path via
   agent-internal scorer.

## Architecture

```
                    ┌─────────────────────────────┐
                    │   target: "x402"            │
                    │                             │
                    │   1. Call /x402/prepay      │
                    │   2. onchainos payment      │
                    │      x402-pay               │
                    │   3. POST /session/open     │
                    │      to mock-server (:4402) │
                    │   4. Cache sessionId        │
                    └─────────────────────────────┘

                    ┌─────────────────────────────┐
                    │   target: "bridge"          │
                    │                             │
                    │   1. okx-dex-swap quote     │
                    │      (cross-chain)          │
                    │   2. scorer picks best      │
                    │   3. onchainos swap execute │
                    │   4. wait for arrival tx    │
                    └─────────────────────────────┘
```

## Input schema

```json
{
  "target": "x402" | "bridge",

  // -- x402 mode --
  "asset": "0x<USDG-or-USDC>",       // optional, default X402_ASSET_ADDRESS
  "amount_usd": "0.001",              // optional, default 0.001 per query
  "session_ttl_seconds": 300,         // optional
  "max_queries": 1000,                // optional

  // -- bridge mode --
  "from_chain": "base",
  "to_chain": "xlayer",
  "token_symbol": "USDC",
  "amount": "500"
}
```

## Prerequisites

1. Wallet logged in
2. Mock x402 server running (`pnpm agent:mock-x402` on :4402) — OR a real facilitator URL
3. For bridge: `onchainos` session valid on both source and dest chain
4. Balance sufficient on source chain

## Command Index

| # | Command | Purpose |
|---|---|---|
| 1 | `POST :7777/fund` | Entry for both modes |
| 2 | `onchainos payment x402-pay` | Sign one x402 payment |
| 3 | `POST :4402/session/open` | Exchange payment proof for sessionId |
| 4 | `onchainos swap execute --chain <src>` | Cross-chain bridge |

## Main Flow — x402 mode

### Step 1 — Submit request

```bash
curl -X POST http://localhost:7777/fund \
  -d '{"target":"x402","amount_usd":"0.001","max_queries":1000}'
```

### Step 2 — Agent calls facilitator

Agent first sends an unauthenticated `GET :4402/price/ETH` and receives:

```
HTTP/1.1 402 Payment Required
Content-Type: application/json
Body: <base64-encoded x402 payload>
```

### Step 3 — TEE signs payment

```bash
onchainos payment x402-pay \
  --network eip155:196 \
  --amount 1000 \
  --pay-to $X402_PAYTO_ADDRESS \
  --asset $X402_ASSET_ADDRESS \
  --max-timeout-seconds 300
```

Returns `{ signature, authorization }`.

### Step 4 — Exchange for session

```bash
curl -X POST :4402/session/open \
  -d '{"signature":"...","authorization":{...},"maxQueries":1000}'
```

Returns `{ sessionId, ttlSeconds, maxQueries, price: "0.001 USDC" }`. The agent caches
this in `.agent-state.json`.

### Step 5 — Report to user

> "Opened session `s_abc123` — 1000 queries over 5 min for $0.001 USDC.
> ETH price now: $3,412.21 (queried 12ms ago)."

## Main Flow — bridge mode

### Step 1 — Quote cross-chain routes

```bash
onchainos swap quote \
  --from-chain-index 8453 --to-chain-index 196 \
  --from-token <USDC-base> --to-token <USDC-xlayer> \
  --readable-amount 500
```

### Step 2 — Score candidate routes

Agent's `crosschain/scorer.ts` normalizes `{destApy, bridgeFeeUsd, slippageBps, gasUsd}`
and picks the highest-scoring.

### Step 3 — Execute the selected route

```bash
onchainos swap execute \
  --chain base \
  --from-chain-index 8453 --to-chain-index 196 \
  --from-token <USDC-base> --to-token <USDC-xlayer> \
  --readable-amount 500 --slippage auto --mev-protection
```

Agent waits for `txStatus == 2` on both sides (source + dest).

### Step 4 — Report to user

> "Bridged 500 USDC Base → X Layer. Route: Stargate (score 87/100). Cost:
> bridge fee 0.23 USDC, slippage 6 bps, total time 4m22s.
> Dest tx: https://oklink.com/xlayer/tx/0x..."

## Critical Rules

| Rule | Detail |
|------|--------|
| **x402 payment is always TEE-signed** — never local-signed for demo |
| **One session at a time** per asset — reuse before re-paying |
| **Bridge requires both-side confirmation** — don't mark complete until dest tx landed |
| **On session expiry** — next `query.ts` call auto-re-opens (transparent to user) |
| **Score-before-execute** — never pick the first returned route blindly |

## Error Reference

| Condition | Cause | Fix |
|-----------|-------|-----|
| `HTTP 402 on every replay` | Mock server down | Start `pnpm agent:mock-x402` |
| `authorization expired` | Re-paid too late | Session cache must validate `validBefore` |
| `chain not supported for swap` | Asset/chain pair invalid | Check `onchainos wallet chains` |
| `route score all < 0` | No profitable path | Report to user; bridge aborted |

## Cross-Skill Workflows

### A. Fund → Execute
```
1. zetta-stream-fund    (target=bridge)   → 500 USDC now on X Layer
2. zetta-stream-action  (deposit to Aave) → Aave position opened
```

### B. Fund → Monitor
```
1. zetta-stream-fund    (target=x402)     → session open
2. zetta-stream-monitor (use sessionId)   → cheap continuous polling
```
