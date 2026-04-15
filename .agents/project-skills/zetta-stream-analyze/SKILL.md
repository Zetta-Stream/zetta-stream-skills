---
name: zetta-stream-analyze
description: "Use this skill when the user wants to PREVIEW a yield rotation without executing — pull the latest x402 signal, run the deterministic scorer, build the rotation intent, and dry-run it through the TEE intent firewall (planner + simulator + risk-scan + verdict) so the user can see decision + findings + projected net APY before deciding to execute. Triggers: 'preview the yield stream', 'should I rotate now?', 'score the current signal', 'dry-run a rotation', 'what would the agent do?', 'is rotating safe right now?', 'show me the verdict'. Read-only — never broadcasts. Do NOT use to actually rotate — use zetta-stream-action. Do NOT use to bridge funds in — use zetta-stream-fund."
license: MIT
metadata:
  author: zetta-stream
  version: "0.1.0"
---

# Zetta-Stream Analyze — Score + dry-run, no execution

Read-only preview of what `zetta-stream-action` *would* do right now. Same pipeline,
but stops before the batch broadcast. Useful for:

- Sanity-checking the autonomous agent before turning it loose
- Hand-tuning the decision thresholds (`YIELD_MIN_SPREAD_BPS`, `MIN_CONFIDENCE_APPROVE`)
- Demoing the firewall to judges without spending gas

## Architecture

```
Claude parses NL → AnalyzeRequest
         ↓
   POST /analyze (:7777)
         ↓
   queryYieldFeed()           → x402 session cached
         ↓
   scoreAndGate(preview=true) → Decision { target, netBps, confidence, reason }
         ↓
   intent-builder             → Call[] (no broadcast)
         ↓
   firewall.run(dry=true)     → planner → simulator → risk-scan → verdict
         ↓
   ── return JSON, no tx, no audit, no medal ──
```

## Input schema

```json
{
  "owner": "0x<EOA>",
  "options": {
    "withFindings": true,
    "withSim": true,
    "tag": "[PREVIEW]"
  }
}
```

## Command Index

| # | Command | Purpose |
|---|---|---|
| 1 | `POST http://localhost:7777/analyze` | Run scorer + firewall preview |
| 2 | `GET  http://localhost:7777/state`   | Check current position + state.rotation |

## Main flow

### Step 1 — POST /analyze

```bash
curl -X POST http://localhost:7777/analyze \
  -H 'Content-Type: application/json' \
  -d '{"owner":"0x..."}'
```

Response:

```json
{
  "signal": {
    "aavePoolApy": 0.031,
    "uniFeeApr": 0.042,
    "ilRisk": 0.18,
    "confidence": 73,
    "ts": 1744660800
  },
  "decision": {
    "target": "UNIV4" | "AAVE" | "HOLD",
    "currentPosition": "AAVE",
    "grossSpreadBps": 110,
    "ilPenaltyBps": 72,
    "gasCostBps": 25,
    "netYieldBps": 85,
    "confidence": 73,
    "reason": "uni fee apr +110bps after IL",
    "score": 92
  },
  "firewall": {
    "verdict": "APPROVED" | "REJECTED" | "WARN",
    "callCount": 5,
    "findings": [{ "step": 2, "level": "WARN", "msg": "..." }]
  }
}
```

### Step 2 — Present a recommendation

Lead with the verdict + headline number. Examples:

- **APPROVED, target=UNIV4, netBps=85**: "Looks good — projected +85bps net after IL and gas. The firewall cleared all 5 calls. Want me to execute? (`zetta-stream-action`)"
- **HOLD, netBps=12**: "Below the 30bps threshold. Hold the current Aave position. I'll keep watching."
- **REJECTED**: explain the finding (e.g. "sim revert at step 3 — insufficient USDC balance"). Suggest a fix (fund via `zetta-stream-fund`).

### Step 3 — Optional drill-down

If `withFindings=true` was set, summarize the per-step findings as a short table. Don't dump raw JSON to the user; keep prose.

## Critical rules

| Rule | Detail |
|------|--------|
| **Never broadcasts** — endpoint MUST stop before batch-executor |
| **Never charges x402** — uses cached session; if no session, return `signal=null` and recommend `zetta-stream-fund target=x402` |
| **Same scorer** — preview and execute share `decision/scorer.ts` so the user can trust the projection |
| **State unchanged** — `/analyze` does not advance `state.rotation.lastRotatedAt` |

## Error reference

| Condition | Cause | Fix |
|-----------|-------|-----|
| `signal=null` | No active x402 session | Run `zetta-stream-fund target=x402` |
| `verdict=REJECTED, reason="target not allowed"` | Aave/UniV4 spender not allowlisted | Add via `setAllowed` from factory |
| `confidence < MIN_CONFIDENCE_APPROVE` | Signal too noisy | Wait one tick or lower `MIN_CONFIDENCE_APPROVE` for demo |
