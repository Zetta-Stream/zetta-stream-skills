---
name: zetta-stream-monitor
description: "Use this skill when the user wants Zetta-Stream's AUTONOMOUS LOOP started or stopped — a recurring tick that pulls a fresh x402 yield signal, scores it, and (if dwell + cooldown + confidence + spread gates all pass) executes a real Aave↔UniV4 rotation through the EIP-7702 batch executor + TEE firewall, logs to ZettaStreamLog on X Layer, and mints a Medal NFT on profitable rotations. Triggers: 'start the autonomous stream', 'turn on zetta', 'begin monitoring yield', 'auto-rotate for the next 24h', 'stop the stream', 'pause monitoring', 'turn zetta off'. The loop runs server-side until stopped. Do NOT use to execute one rotation immediately — use zetta-stream-action. Do NOT use to preview without executing — use zetta-stream-analyze."
license: MIT
metadata:
  author: zetta-stream
  version: "0.1.0"
---

# Zetta-Stream Monitor — Start / stop the autonomous rotation loop

Drives the agent's `monitor/loop.ts` heartbeat. While running, every `POLL_INTERVAL_MS`
the loop fetches a fresh x402 signal, scores it, and rotates the position **if and
only if** all four gates pass:

1. `net_bps >= YIELD_MIN_SPREAD_BPS`
2. `now - state.rotation.lastRotatedAt >= COOLDOWN_SECONDS`
3. Same `decision.target` for `DWELL_SECONDS` across ≥3 consecutive ticks
4. `signal.confidence >= MIN_CONFIDENCE_APPROVE`

This skill is the most "live" surface judges see: the dashboard's SSE stream lights up
with `signal → decision → firewall → exec → audit → medal` events as the loop ticks.

## Architecture

```
POST /monitor/start             POST /monitor/stop
   ↓                                  ↓
state.monitorRunning = true       state.monitorRunning = false
   ↓                                  ↓
loop.ts heartbeat (every POLL_INTERVAL_MS):

  signal      = queryYieldFeed()                       (x402 session)
  decision    = scoreAndGate(signal, state)
  if decision.target == HOLD or gates fail → emit, return
  intent      = intent-builder(decision)
  report      = firewall.run(intent)
  if !APPROVED → log skip, emit, return
  exec        = batch-executor(report.calls)           (7702 / Multicall)
  audit       = logRotation on X Layer
  if exec.netYieldBps > 0 → mint Medal on X Layer
  emit SSE: tick.complete
```

## Input schema

```json
// Start
{
  "owner": "0x<EOA>",
  "durationSeconds": 600
}

// Stop
{ "owner": "0x<EOA>" }
```

## Prerequisites

- Same as `zetta-stream-action` (deployed contracts, authorized agent, x402 session)
- `POLL_INTERVAL_MS` set (default 15000 ms)

## Command Index

| # | Command | Purpose |
|---|---|---|
| 1 | `POST http://localhost:7777/monitor/start` | Start the autonomous loop |
| 2 | `POST http://localhost:7777/monitor/stop`  | Stop it |
| 3 | `GET  http://localhost:7777/sse`           | Live event stream (per tick) |
| 4 | `GET  http://localhost:7777/state`         | Snapshot of `state.rotation` + `monitorRunning` |

## Main flow — start

```bash
curl -X POST http://localhost:7777/monitor/start \
  -H 'Content-Type: application/json' \
  -d '{"owner":"0x...","durationSeconds":600}'
```

Response:

```json
{
  "watcherId": "watcher_abc",
  "startedAt": 1744660800,
  "tickIntervalMs": 15000,
  "sseUrl": "http://localhost:7777/sse"
}
```

Tell the user:
- The loop is running (with auto-stop time, if any)
- The dashboard URL where they can watch ticks: `http://localhost:3000`
- That stopping is one message away

## Main flow — stop

```bash
curl -X POST http://localhost:7777/monitor/stop \
  -H 'Content-Type: application/json' \
  -d '{"owner":"0x..."}'
```

Response:

```json
{
  "stoppedAt": 1744661400,
  "ticksRun": 40,
  "rotationsExecuted": 3,
  "totalNetYieldBps": 215,
  "medalsMinted": 2
}
```

Show the user a tight summary: # of ticks, # of executed rotations, cumulative net
yield in bps, # of medals minted, link to the audit page filtered by this owner.

## Critical rules

| Rule | Detail |
|------|--------|
| **One watcher per owner** — starting twice is idempotent (returns existing watcherId) |
| **Stop is graceful** — finishes the in-flight tick before exiting |
| **Cooldown is a hard gate** — even when monitor is running, no rotation within `COOLDOWN_SECONDS` of the last |
| **Dwell prevents flip-flop** — needs 3 consecutive ticks pointing at the same target to fire |
| **Auto-stop on consecutive failure** — 3 firewall REJECTs in a row pause the loop and surface to the user |

## Error reference

| Condition | Cause | Fix |
|-----------|-------|-----|
| `watcher already running` | Started twice | Idempotent — agent returns existing watcherId |
| `loop paused after 3 rejects` | Persistent firewall block (config / allowlist) | Investigate `state.lastReject` then `monitor/start` again |
| `signal.confidence stuck < threshold` | Mock server set bad fixtures | Use `/debug/set-yield/confidence/80` to unblock the demo |
| `medalsMinted=0 but rotations>0` | All rotations were rebalances at zero or negative net | Expected; only profitable rotations mint |
