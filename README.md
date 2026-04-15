# Zetta-Stream — Intent-Based Autonomous Yield Stream Gateway

> *Your USDC, auto-shuffled between Aave V3 and Uniswap V4 by an AI agent, every rotation byte-scanned in TEE before it signs, every decision immutably logged on X Layer, every profitable rotation minted as a collectible Medal.*

Built for the **OKX Onchain OS Hackathon**. Zetta-Stream is not another DeFi app — it's the **minimum viable autonomous yield OS**: four primitives (x402 V2 + EIP-7702 + TEE + MCP) structurally fused into a self-driving rotator that a user can command in one English sentence.

## What it does

You say it in English. Zetta-Stream does the rest.

> **"Open an x402 yield session and fund 200 USDC"** → single $0.001 payment on X Layer returns a `sessionId` good for 1000 queries / 5 min. OKX cross-chain router bridges USDC into Arbitrum.
>
> **"Preview a rotation right now"** → fetches the live yield signal, runs the deterministic scorer (`net_bps = (gross_spread − IL_penalty − gas_cost) × confidence/100`), dry-runs through the TEE firewall. No tx.
>
> **"Rotate now"** → composes a 4-6 call batch (`aave.withdraw → usdc.approve → univ4.mint`), wraps it in an EIP-7702 Type-4 auth tuple, TEE-signs every inner call, broadcasts on Arbitrum, logs to X Layer, mints a Medal if profit > 0 bps.
>
> **"Turn on the autonomous stream"** → a 15s-tick loop pulls signals, gates on dwell + cooldown + confidence + spread, and rotates hands-free until you stop it.

## Four technical pillars (→ four hackathon scoring dims)

| Pillar | Skill | OKX / External Products |
|---|---|---|
| **A. Intent Firewall** (TEE simulate + allowlist + risk-scan) | `zetta-stream-analyze` + `zetta-stream-action` | `okx-security` + `okx-agentic-wallet` + `ZettaStreamDelegate` allowlist |
| **B. Dynamic Account Upgrade** (EIP-7702 → Multicall fallback) | `zetta-stream-action` | `okx-agentic-wallet` + `ZettaStreamDelegate` |
| **C. Yield Intelligence** (x402 V2 reusable session) | `zetta-stream-fund` + `zetta-stream-monitor` | `okx-x402-payment` + Aave V3 + Uniswap V4 feeds |
| **D. Cross-chain Audit Backbone** (Arbitrum exec ↔ X Layer audit) | `zetta-stream-fund` + `zetta-stream-action` | `okx-dex-swap` cross-chain + X Layer |

## On-chain evidence (all verifiable on OKLink — X Layer chainId 196)

| Artifact | Address / TX |
|---|---|
| **`ZettaStreamLog`** (audit ledger) | [`0xC830736987Aa94ce20D7188C5640a130a2723d10`](https://www.oklink.com/xlayer/address/0xC830736987Aa94ce20D7188C5640a130a2723d10) |
| **`ZettaStreamMedal`** (ERC-721 profit badge, on-chain SVG) | [`0xb8E1cd1914c08e4Fd06Ec695D78572527D9CBCA3`](https://www.oklink.com/xlayer/address/0xb8E1cd1914c08e4Fd06Ec695D78572527D9CBCA3) |
| Agent EOA | [`0xFE31162dF10e9D6ff92eE0057f8E9652Bd5f210C`](https://www.oklink.com/xlayer/address/0xFE31162dF10e9D6ff92eE0057f8E9652Bd5f210C) |
| Deploy `ZettaStreamLog` | [`0xc0b0b320…2dd80`](https://www.oklink.com/xlayer/tx/0xc0b0b320ca0261f25e17ada9e676d78694dc057884493a2368c2f97fac12dd80) |
| Deploy `ZettaStreamMedal` | [`0x2d7dd71f…ba24c`](https://www.oklink.com/xlayer/tx/0x2d7dd71f8776b0fdd08701af1e19e00ea7d7097638c6c13cc719425c4ddba24c) |
| Genesis rotation log (AAVE→UNIV4, +85 bps) | [`0x02737799…2ac97`](https://www.oklink.com/xlayer/tx/0x0273779900d7e4c21060fe6a2afd90b6f7df4f635fc8620b3e0e7ea39932ac97) |
| Genesis Medal mint (`tokenId=0`, +85 bps) | [`0x1e53c5c0…321a1`](https://www.oklink.com/xlayer/tx/0x1e53c5c030a84ef3804a430aaa428234a97dc76a2d61ae06c6bb4a1b325321a1) |
| **`ZettaStreamDelegate`** (Arbitrum chainId 42161, EIP-7702 target + allowlist) | [`0xC830736987Aa94ce20D7188C5640a130a2723d10`](https://arbiscan.io/address/0xC830736987Aa94ce20D7188C5640a130a2723d10) |
| Deploy `ZettaStreamDelegate` on Arbitrum | [`0x89e92fee…fdc9d`](https://arbiscan.io/tx/0x89e92feecb288ea9320c4264d4f55ae2230d374a6c7415c87dd653cb07ffdc9d) |

## Architecture (two-chain split)

```
src/ (Next.js dashboard)        agent/ (Node 22 + tsx)         contracts/ (Foundry)

  app/page.tsx ◀──SSE──         decision/                       X Layer (196)
  app/audit/page.tsx            ├─ scorer · rotator             ├─ ZettaStreamLog.sol
  app/medals/page.tsx           └─ intent-builder               └─ ZettaStreamMedal.sol
                                clients/
                                ├─ aave-v3
                                └─ uniswap-v4                   Arbitrum (42161)
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

## Deterministic scoring formula (no ML)

Every rotation is traceable back to this integer-only bps math:

```
gross_spread_bps = (target_apr − current_apr) × 10000
il_penalty_bps   = target == UNIV4 ? round(ilRisk × 400) : 0    // up to 400 bps
gas_cost_bps     = round(ESTIMATED_GAS_USD / NOTIONAL_USD × 10000)
confidence_mult  = signal.confidence / 100
net_bps          = round((gross_spread − il_penalty − gas_cost) × confidence_mult)
```

Four hard gates must pass before any rotation fires in the autonomous loop:
1. `net_bps ≥ YIELD_MIN_SPREAD_BPS` (default 30)
2. `now − lastRotatedAt ≥ COOLDOWN_SECONDS` (default 1800)
3. same target persisted across ≥3 consecutive ticks (dwell, default 180s)
4. `confidence ≥ MIN_CONFIDENCE_APPROVE` (default 60)

The manual `zetta-stream-action` skill sets `force=true` to skip gates 3 and 4 — never 1, and **never** the firewall.

## Quickstart

```bash
pnpm install

# 1. Generate a throwaway agent EOA (writes to .env)
pnpm wallet:generate

# 2. Fund the EOA on X Layer (~1 OKB), Arbitrum (~0.005 ETH), Arbitrum USDC (~50)

# 3. Login to the TEE wallet
onchainos wallet login you@example.com
onchainos wallet verify <code>

# 4. Deploy all three contracts (X Layer: Log+Medal, Arbitrum: Delegate)
pnpm contracts:test     # 31/31 should pass
pnpm contracts:deploy   # auto-updates .env with new addresses

# 5. Run the stack
pnpm dev:all            # agent(:7777) + x402-mock(:8402) + dashboard(:3000)
```

## Skills-first demo (what judges see)

```
0. pnpm dev:all   # agent + mock + dashboard
1. "Open an x402 yield session and fund 200 USDC"
   → zetta-stream-fund → X Layer payment tx + sessionId
2. "Preview a rotation right now"
   → zetta-stream-analyze → {target:UNIV4, netBps:85, confidence:78} + firewall SAFE
3. "Rotate now"
   → zetta-stream-action → 7702 batch on Arbitrum (Aave withdraw → UniV4 mint)
   → X Layer audit tx + Medal mint tx (netBps > 0)
4. "Turn on the autonomous stream for 10 minutes"
   → zetta-stream-monitor → SSE feed to dashboard; 2-3 automatic rotations
     driven by /debug/set-yield scripted signals
5. "Show my rotation history"
   → ZettaStreamLog.recent(10) → OKLink links; Medal gallery on dashboard
```

## Honest disclosures

- **Execution chain split**: Uniswap V4 mainnet liquidity is concentrated on Arbitrum + Base, where Pectra is also live. We run the EIP-7702 batch on **Arbitrum**; X Layer handles audit + Medal. This cross-chain split is intentional and advertised as the cross-chain prize's anchor, not a workaround.
- **viem `signAuthorization` needs a local private key**: the demo EOA signs the 7702 authorization tuple. Every inner call in the batch is TEE-signed via `onchainos wallet contract-call`. When OKX exposes TEE authorization-signing, we remove `DEMO_EOA_PRIVATE_KEY`.
- **x402 V2 session layer**: the stock `okx-x402-payment` skill is single-shot. Our `mock-server.ts` issues a `sessionId` after one real payment so 100+ subsequent queries amortize — this is a real hackathon composition, explicitly documented.
- **Medal NFT metadata**: fully on-chain `data:application/json;base64,…` blob with an embedded SVG. No IPFS, no off-chain dependency.

## Tests

- `pnpm contracts:test` → **31/31 forge tests** (Log 16, Delegate 6, Medal 6, TestVault 3)
- `pnpm test` → **33/33 vitest** (scorer 7 + rotator 7 + intent-builder 5 + firewall 6 + crosschain 4 + log-encoder 4)
- `pnpm typecheck` → zero TS errors
- `pnpm verify` → **14/14 health checks** (env + X Layer contracts + Arbitrum contract + balances + live services)

## Delivery roadmap

| Day | Work |
|---|---|
| ✅ **Day 1 AM** | Fork IntentHub scaffold · 4 skills stubbed · 3 contracts + tests passing |
| ✅ **Day 1 PM** | X Layer deploy (Log + Medal) · genesis rotation + medal written on-chain · decision engine (scorer + rotator + intent-builder) · `/analyze` endpoint wired · x402 mock `/yield/feed` live · Arbitrum Delegate deployed |
| ✅ **Day 2** | Real `clients/aave-v3.ts` encoders (supply/withdraw/readReserve) · real `clients/uniswap-v4.ts` PositionManager with Actions-based `modifyLiquidities` · intent-builder now emits valid Aave+UniV4 calldata · 5 new intent-builder tests |
| ✅ **Day 3** | `monitor/loop.ts` rewired signal-driven · `run-rotation.ts` orchestrator (signal→score→gate→intent→exec→audit→medal) · `medal/medal-mint.ts` wrapper · `POST /rotate` + `POST /monitor/{start,stop}` + `GET /state` endpoints · SSE event types extended (signal / rotation / medal) |
| ✅ **Day 4** | Live dashboard hero (3-Z logo + video bg + real-time X Layer stats) · `/audit` rotation ledger page · `/medals` ERC-721 gallery (renders on-chain SVGs) · `scripts/verify.ts` end-to-end health checker · `pnpm dev:all` concurrent stack |

## License

MIT
