---
name: zetta-stream-fund
description: "Use this skill when the user wants to FUND Zetta-Stream — either (a) open a reusable x402 V2 session for the yield-signal feed by paying ~$0.001 USDC on X Layer once and receiving a sessionId good for 100+ subsequent queries, OR (b) bridge USDC from X Layer / Base / mainnet into Arbitrum (the execution chain) so the agent has working capital for Aave/UniV4 rotations. Triggers: 'fund zetta', 'open an x402 session', 'pay for the yield feed', 'bridge USDC for zetta', 'deposit into the stream', 'top up the agent', 'move USDC to Arbitrum'. The two targets are mutually exclusive within one call. Do NOT use to actually rotate — use zetta-stream-action. Do NOT use to start the autonomous loop — use zetta-stream-monitor."
license: MIT
metadata:
  author: zetta-stream
  version: "0.1.0"
---

# Zetta-Stream Fund — Open x402 session OR bridge USDC into the agent

Two related setup steps that the user invokes before the first rotation:

1. **`target=x402`** — pays a small fee in USDC on X Layer to open an x402 V2 reusable session. The agent then uses the cached `sessionId` for all subsequent yield-feed queries (TTL 5 min, ~1000 queries amortised over one payment).
2. **`target=bridge`** — moves USDC from a source chain to Arbitrum (the execution chain) using the OKX cross-chain swap router. The agent's working position lives on Arbitrum.

## Architecture

```
target=x402:                        target=bridge:
   POST /fund {target:"x402"}          POST /fund {target:"bridge", from:8453, amount:"200"}
       ↓                                  ↓
   x402 401/402 → sessionRequest      crosschain/quote (OKX)
       ↓                                  ↓
   TEE sign EIP-712 + USDC transfer   firewall.run (planner → sim → scan)
       ↓                                  ↓
   POST /session/open                  EIP-7702 batch on source chain
       ↓                                  ↓
   sessionId stored in state          ZettaStreamLog.logRotation(reason="fund:bridge")
```

## Input schema

```json
// Open x402 session
{ "target": "x402", "owner": "0x<EOA>" }

// Bridge USDC into Arbitrum
{
  "target": "bridge",
  "owner": "0x<EOA>",
  "from": 196 | 8453 | 1,
  "amount": "200"
}
```

## Prerequisites

- Wallet logged in
- `X402_FACILITATOR_URL`, `X402_PAYTO_ADDRESS`, `X402_PAYMENT_AMOUNT` set
- For bridge: `EXEC_CHAIN_RPC_URL`, source-chain RPC, USDC addresses on both chains

## Command Index

| # | Command | Purpose |
|---|---|---|
| 1 | `POST http://localhost:7777/fund` | Single endpoint, dispatches by `target` |
| 2 | `onchainos x402 pay` | TEE pay flow (used internally for `target=x402`) |
| 3 | `onchainos swap quote --cross-chain` | Bridge route (used internally for `target=bridge`) |

## Main flow — `target=x402`

```bash
curl -X POST http://localhost:7777/fund \
  -H 'Content-Type: application/json' \
  -d '{"target":"x402","owner":"0x..."}'
```

Response:

```json
{
  "target": "x402",
  "sessionId": "sess_abc...",
  "ttlSeconds": 300,
  "maxQueries": 1000,
  "paymentTx": "0x..."
}
```

Show the user: "Opened an x402 yield-feed session for ~$0.001 — good for 1000 queries or 5 min, whichever ends first. Tx: `https://www.oklink.com/xlayer/tx/<paymentTx>`."

## Main flow — `target=bridge`

```bash
curl -X POST http://localhost:7777/fund \
  -H 'Content-Type: application/json' \
  -d '{"target":"bridge","owner":"0x...","from":8453,"amount":"200"}'
```

Response:

```json
{
  "target": "bridge",
  "verdict": "APPROVED",
  "exec": { "mode": "EIP7702", "batchTxHash": "0x...", "callCount": 3 },
  "audit": { "rotationId": 4, "auditTx": "0x..." },
  "estimatedArrivalSeconds": 90
}
```

Tell the user when the funds will arrive on Arbitrum and link the source-chain batch tx + the X Layer audit entry.

## Critical rules

| Rule | Detail |
|------|--------|
| **One x402 session at a time** — opening a new one invalidates the cached id |
| **Never log the sessionId** — agent stores it in `.agent-state.json` (gitignored) |
| **Bridge passes through the firewall** — it's a multi-step batch (approve + bridge), not a free pass |
| **Idempotent x402 retry** — if `target=x402` 5xx's, retry once; never double-pay |

## Error reference

| Condition | Cause | Fix |
|-----------|-------|-----|
| `HTTP 402 with no x402 metadata` | Mock server unreachable | Start with `pnpm agent:mock-x402` |
| `bridge verdict=REJECTED` | Source-chain bridge spender not allowlisted on Delegate | `setAllowed` from factory |
| `sessionId expired immediately` | Clock skew between agent host and mock server | NTP-sync, then retry |
| `bridge stuck > 10 min` | Cross-chain message in flight | Show estimated arrival; agent rotates after arrival |
