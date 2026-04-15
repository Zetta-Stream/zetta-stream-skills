# ZettaStream — Web3's Agentic Kernel

> One sentence in, auditable on-chain outcome out.
> TEE-simulated · EIP-7702 batched · x402-intel-fed · X Layer-audited.

Built for the **OKX Onchain OS Hackathon**. Not a DeFi app — an *operating system* layer
other agents can build on.

## What it does

You say it in English. ZettaStream does the rest.

> "approve 100 USDC to this vault and deposit" → **REJECTED** (phishing spender)
>
> "swap 0.1 OKB to USDC then stake" → **EXECUTED** in one batched X Layer tx, ~58% gas saved
>
> "watch ETH; when it drops below $3,400, move 500 USDC from X Layer to Base Aave" → runs autonomously for hours; fires cross-chain batch on trigger

Every decision — approved, rejected, executed — lands on
[`ZettaStreamLog`](https://www.oklink.com/xlayer) on X Layer (chainId 196). Open the
contract; the audit trail is the product.

## Four technical pillars

| Pillar | Skill | OKX Products |
|---|---|---|
| Intent Firewall (TEE simulate + risk-scan before sign) | `zetta-stream-analyze` + `zetta-stream-action` | `okx-security` + `okx-agentic-wallet` |
| EIP-7702 Dynamic Account Upgrade (batch exec, Multicall fallback) | `zetta-stream-action` | `okx-agentic-wallet` + `BatchCallDelegate.sol` |
| x402 V2 Reusable Intelligence Sessions | `zetta-stream-fund` + `zetta-stream-monitor` | `okx-x402-payment` + `okx-dex-market` |
| AggLayer-style Cross-chain Router | `zetta-stream-fund` + `zetta-stream-action` | `okx-dex-swap` (cross-chain) |

## Quickstart

```bash
pnpm install

# 1. Login to the TEE wallet (one-time, OTP)
onchainos wallet login you@example.com
onchainos wallet verify <code>

# 2. Deploy the two contracts to X Layer
cp .env.example .env     # fill DEPLOYER_PRIVATE_KEY
pnpm contracts:test
pnpm contracts:deploy

# 3. Paste the two addresses back into .env (ZETTA_STREAM_LOG_ADDRESS, BATCH_CALL_DELEGATE_ADDRESS)

# 4. Run the agent + mock x402 server
pnpm agent:mock-x402 &    # :4402 session gateway
pnpm agent:monitor        # :7777 API + 24/7 loop

# 5. Open the dashboard
pnpm dev                  # http://localhost:3000/firewall
```

## Architecture (60-second read)

```
            ┌─ User (NL) ──────────────────────────┐
            │                                      ▼
            │      Claude harness (trigger phrases match SKILL.md)
            │                                      │
            │                                      ▼
            │      zetta-stream-action skill ──▶ POST /intent {kind, steps}
            │                                      │
            │                  ┌───────────────────┤
            │                  ▼                   ▼
            │        planner.ts            simulator.ts
            │        (OKX DEX quote,       (viem eth_call +
            │         Aave/UniV3 ABI)       stateOverride)
            │                  │                   │
            │                  └─────────┬─────────┘
            │                            ▼
            │                   risk-scan.ts
            │                   (okx-security tx-scan + dapp-scan)
            │                            │
            │                            ▼
            │                        verdict
            │                  ┌────────┼────────┐
            │             REJECTED   APPROVED    WARN
            │                  │        │         │
            │                  │        ▼         ▼
            │                  │   batch-executor.ts
            │                  │   (7702 → Multicall fallback)
            │                  │        │
            │                  ▼        ▼
            │        ZettaStreamLog.logIntent(...)   ← X Layer (196)
            │        ZettaStreamLog.logDelegation(...)  ← X Layer (196)
            └────────────────────────────────────────────┘
```

## Live artifacts (all X Layer · chainId 196)

| Thing | Address / TX |
|---|---|
| `ZettaStreamLog` (audit) | [`0x928a7ffDda4Ba5Ed154094cAbd08064617728E6a`](https://www.oklink.com/xlayer/address/0x928a7ffDda4Ba5Ed154094cAbd08064617728E6a) |
| `BatchCallDelegate` (7702/Multicall) | [`0x5b7c73a3482Fd63E1953037D763570d13d8d26D2`](https://www.oklink.com/xlayer/address/0x5b7c73a3482Fd63E1953037D763570d13d8d26D2) |
| `TestVault` (scenario 2 target) | [`0x21edDBa0e33B9869EbF374C7c5Ee54650816DB8b`](https://www.oklink.com/xlayer/address/0x21edDBa0e33B9869EbF374C7c5Ee54650816DB8b) |
| Agent EOA | `0x13A7D19aD9de11fe1c6Eb9a9A093BB535A88f143` |
| OKX DEX swap (0.04 OKB → 3.33 USDC) | [`0x2f1de916…afec62`](https://www.oklink.com/xlayer/tx/0x2f1de9167247b04302132b1d9a18aa64cc798d6be890de5ff6e572d578afec62) |
| First batched tx (3 deposits, ~75% gas saved) | [`0x710cbfb6…cba43`](https://www.oklink.com/xlayer/tx/0x710cbfb6b8cab3597256d5912a533730da9bb5102de973abdc28244c2efcba43) |
| Second batched tx (~85% gas saved) | [`0x74557c1c…d7e38`](https://www.oklink.com/xlayer/tx/0x74557c1c2ae38da397d0d9bef211a5d575223dd4d964ee3b38145385565d7e38) |
| Pectra/EIP-7702 probe result | `supports7702=false` (X Layer runs reth v1.10.2) → **Multicall fallback active** |
| Live audit entries at last check | **8** on ZettaStreamLog · see [entries](https://www.oklink.com/xlayer/address/0x928a7ffDda4Ba5Ed154094cAbd08064617728E6a) |

## Honest disclosures

- **X Layer Pectra/EIP-7702**: production support uncertain. Code path 1 tries type-0x04
  authorization tx; if the RPC rejects it (`pectra-probe.ts`), path 2 falls back to a
  standard tx calling `BatchCallDelegate.executeBatch` as a Multicall. UX and gas-savings
  report are identical.
- **viem `signAuthorization` needs a local private key**: the demo EOA's key signs
  the 7702 authorization element. Every inner call inside the batch is TEE-signed via
  `onchainos wallet contract-call`. When OKX exposes TEE-based authorization signing,
  we'll remove `DEMO_EOA_PRIVATE_KEY`.
- **x402 facilitator**: real `onchainos payment x402-pay` TEE path works for single
  payments. Our `mock-server.ts` layers `sessionId` issuance on top so one payment
  amortizes across thousands of sub-second queries — this is a real hackathon composition,
  not a workaround.

## Demo scenarios

Run any of them with `pnpm agent:demo -- scenario=<name>`.

1. **phishing** (60s) — malicious vault flagged → REJECTED verdict written to X Layer; no execute tx
2. **gas-save** (75s) — 3-step batch (SWAP+APPROVE+STAKE) as one X Layer tx; ~58% gas vs 3 independent txs
3. **x402-cross** (90s) — x402 session (1 payment → 1,200+ queries); ETH threshold trigger; XL→Base Aave batch

## License

MIT
