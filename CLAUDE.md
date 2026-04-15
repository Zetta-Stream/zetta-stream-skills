# CLAUDE.md

Guidance for Claude Code sessions working on **Zetta-Stream** — an Intent-Based
Autonomous Yield Stream Gateway for the OKX Onchain OS Hackathon.

## Project Overview

**Zetta-Stream** is a self-driving DeFi rotator. An AI agent purchases yield signals
via **x402 V2** ($0.001 / query, reusable session), scores APY spread + IL risk + gas,
and atomically rotates a user's USDC between **Aave V3** and **Uniswap V4 concentrated
LP** using an **EIP-7702 Type-4 batch transaction** (the EOA is temporarily upgraded
into a smart account). Every call is byte-scanned by a **TEE-gated intent firewall**
before signing. Each rotation is logged on **X Layer (chainId 196)** to
`ZettaStreamLog`; profitable rotations mint a `ZettaStreamMedal` ERC-721.

Four pillars (each maps to a hackathon scoring dimension):
- **A. Intent Firewall** — TEE simulation + `okx-security` byte-code scan + allowlist on the Delegate
- **B. Dynamic Account Upgrade** — EIP-7702 batch tx on Arbitrum; auto-fallback to Multicall when Pectra is unavailable
- **C. High-frequency Yield Intelligence** — reusable x402 V2 sessions feeding the deterministic scorer
- **D. Cross-chain Audit Backbone** — execution on Arbitrum, immutable audit + medals on X Layer

The product surface is **4 Claude skills** under `.agents/project-skills/`:

- `zetta-stream-analyze` — preview a rotation: score signal + dry-run firewall, no execute
- `zetta-stream-fund` — open an x402 yield session OR bridge USDC into the execution chain
- `zetta-stream-action` — execute one rotation now (force=true, skip dwell/cooldown)
- `zetta-stream-monitor` — start/stop the autonomous loop (`60s tick → score → maybe rotate`)

## Architecture (two-chain split)

```
src/ (Next.js dashboard)        agent/ (Node 22 + tsx)         contracts/ (Foundry)

  app/page.tsx ◀──SSE──         decision/                       X Layer (chainId 196)
  app/audit/page.tsx            ├─ scorer · rotator             ├─ ZettaStreamLog.sol
  app/medals/page.tsx           └─ intent-builder               └─ ZettaStreamMedal.sol
                                clients/
                                ├─ aave-v3
                                └─ uniswap-v4                   Arbitrum (chainId 42161)
                                firewall/                       └─ ZettaStreamDelegate.sol
                                ├─ planner · simulator             (allowlist + executeBatch)
                                ├─ risk-scan · verdict
                                eip7702/
                                ├─ pectra-probe · authorize
                                ├─ batch-executor
                                └─ gas-compare
                                x402/
                                ├─ session-client · query
                                └─ mock-server (:8402)
                                medal/medal-mint
                                monitor/loop · trigger
                                api/server (:7777)
                                lib/okx-cli · viem-clients · log-encoder

               ┌────────── 10+ OKX skills ──────────┐
               │  .agents/skills/okx-*               │
               │  .agents/project-skills/zetta-stream-* │
               └─────────────────────────────────────┘
```

## Data Flow

```
User NL → Claude harness → zetta-stream-{analyze,fund,action,monitor}
                            ↓
                        POST /analyze | /fund | /rotate | /monitor/start
                            ↓
                        queryYieldFeed() ── x402 session reuse ──► aavePoolApy + uniFeeApr + ilRisk + confidence
                            ↓
                        scoreAndGate(signal, state)         (deterministic bps formula)
                            ↓ HOLD or target ∈ {AAVE, UNIV4}
                        intent-builder → Call[]              (withdraw → swap → supply / mint-LP)
                            ↓
                        firewall.run(intent)                 (planner → simulator → risk-scan → verdict)
                            ↓ APPROVED
                        batch-executor                       (EIP-7702 → Multicall fallback)
                            ↓
                        ZettaStreamLog.logRotation(...)      (X Layer)
                            ↓ if netYieldBps > 0
                        ZettaStreamMedal.mintTo(...)         (X Layer)
                            ↓
                        SSE: signal → decision → exec → audit → medal
```

## Commands

```bash
# Install
pnpm install

# Wallet (one-time)
onchainos wallet login <email>
onchainos wallet verify <code>
onchainos wallet status

# Contracts
pnpm contracts:test                       # forge test -vvv
pnpm contracts:deploy:log                 # deploys ZettaStreamLog to X Layer
pnpm contracts:deploy:medal               # deploys ZettaStreamMedal to X Layer
pnpm contracts:deploy:delegate            # deploys ZettaStreamDelegate to Arbitrum

# Agent
pnpm agent:demo -- scenario=rotate-up      # synthetic UniV4 spike → rotate to UNIV4
pnpm agent:demo -- scenario=rotate-down    # synthetic Aave spike → rotate back to AAVE
pnpm agent:monitor                         # autonomous loop + SSE on :7777
pnpm agent:mock-x402                       # x402 yield-feed mock server on :8402

# Frontend
pnpm dev                                   # Next.js dashboard at :3000
pnpm dev:all                               # agent + mock + dashboard concurrently
pnpm typecheck
```

## Key Files (read these first when onboarding)

- `agent/index.ts` — entry point
- `agent/lib/okx-cli.ts` — every `onchainos` invocation funnels through here
- `agent/x402/session-client.ts` — x402 V2 reusable session lifecycle
- `agent/decision/scorer.ts` — deterministic net-APY formula (the core innovation)
- `agent/decision/intent-builder.ts` — composes Aave + UniV4 sub-calls into a 4-6 step batch
- `agent/firewall/planner.ts` — `RotationIntent` → `Call[]` with on-chain encodings
- `agent/eip7702/batch-executor.ts` — dual-path executor (7702 → Multicall fallback)
- `agent/clients/aave-v3.ts` — Aave V3 supply / withdraw / readReserveData
- `agent/clients/uniswap-v4.ts` — V4 PositionManager mint / decreaseLiquidity / readPosition
- `contracts/src/ZettaStreamLog.sol` — immutable rotation ledger on X Layer
- `contracts/src/ZettaStreamDelegate.sol` — EIP-7702 target with target allowlist on Arbitrum
- `contracts/src/ZettaStreamMedal.sol` — ERC-721 profit badge on X Layer
- `.agents/project-skills/zetta-stream-action/SKILL.md` — the Claude trigger surface

## Conventions

- **File naming**: kebab-case everywhere
- **Path aliases**: `@/components`, `@/hooks`, `@/services`, `@agent/*`, `@contracts/*`
- **TypeScript strict**, no `any`. Parse external data with `zod`.
- **No private keys in the runtime process** — all signing goes through
  `onchainos wallet contract-call` (TEE). The only exceptions are:
  - `DEPLOYER_PRIVATE_KEY` — used once for `forge script`, never by the agent
  - `DEMO_EOA_PRIVATE_KEY` — used by viem's `signAuthorization` because the current
    TEE CLI does not expose EIP-7702 authorization signing. Disclosed in README.
- **Fail-safe security** — every `wallet contract-call` is prefaced by `security tx-scan`.
- **`--force`** only after explicit `SILENT_MODE=true`. Document in README.
- **Chain flags**: `--chain 196` for X Layer (audit + medal), `--chain 42161` for Arbitrum (execution); `--network eip155:196` / `eip155:42161` for x402.
- **Skill routing**: Claude matches NL to one of the 4 `zetta-stream-*` skills via the
  `description` field's trigger phrases. Skills receive structured JSON and forward to
  the agent's HTTP endpoints (`/analyze`, `/fund`, `/rotate`, `/monitor/{start,stop}`).

## Env

Copy `.env.example` to `.env`. Critical vars:

X Layer (audit + medal):
- `XLAYER_RPC_URL=https://rpc.xlayer.tech` / `XLAYER_CHAIN_ID=196`
- `ZETTA_STREAM_LOG_ADDRESS` (from `pnpm contracts:deploy:log`)
- `ZETTA_STREAM_MEDAL_ADDRESS` (from `pnpm contracts:deploy:medal`)

Execution chain (Arbitrum):
- `EXEC_CHAIN_RPC_URL=https://arb1.arbitrum.io/rpc` / `EXEC_CHAIN_ID=42161`
- `ZETTA_STREAM_DELEGATE_ADDRESS` (from `pnpm contracts:deploy:delegate`)
- `AAVE_V3_POOL=0x794a61358D6845594F94dc1DB02A252b5b4814aD`
- `UNI_V4_POSITION_MANAGER`, `UNI_V4_POOL_KEY_TOKEN0/1/FEE/TICKSPACING/HOOKS`

Agent + tuning:
- `DEMO_EOA_ADDRESS` / `DEMO_EOA_PRIVATE_KEY` (`cast wallet new`, fund on Arbitrum)
- `X402_FACILITATOR_URL=http://localhost:8402` / `X402_PAYTO_ADDRESS` / `X402_PAYMENT_AMOUNT=100000`
- `DWELL_SECONDS=180` `COOLDOWN_SECONDS=1800` `YIELD_MIN_SPREAD_BPS=30` `MIN_CONFIDENCE_APPROVE=60`
- `SILENT_MODE=true` `FORCE_7702=false` `LOCAL_SIGN_FALLBACK=false` `DEMO_MODE=true`

## Demo Mode

When `DEMO_MODE=true`:
- `/api/debug/set-yield/{key}/{value}` — overrides `aavePoolApy` / `uniFeeApr` / `ilRisk` / `confidence`
- `/api/debug/fake-session` — issues a sessionId without payment
- `/api/debug/replay-rotation` — replays one of the canned demo scenarios
- Dashboard surfaces "Replay" buttons + a yield-curve overlay

## Known Limits (v0.1)

- **EIP-7702 on X Layer**: chainId 196 likely lacks Pectra at hackathon time. Execution
  runs on Arbitrum (Pectra-live) where `pectra-probe.ts` returns `true`; X Layer is
  used only for audit + medal contracts. Multicall fallback is wired anyway.
- **TEE + EIP-7702**: viem's `signAuthorization` requires a local account. Authorization
  is signed by `DEMO_EOA_PRIVATE_KEY`; every inner batched call still goes through TEE
  via `onchainos wallet contract-call`.
- **x402 yield mock**: real Aave / Uni subgraphs rate-limit. `mock-server.ts` caches
  500ms and proxies to `onchainos gateway call` when available, falling back to a
  deterministic stub. Real `okx-x402-payment` skill is single-shot; our session
  layer (1 payment → 100+ queries / 5min TTL) sits on top.
- **NL parsing**: no local parser. Claude harness + SKILL.md trigger phrases handle
  NL→JSON conversion. Demo commands are tuned to trigger reliably.
