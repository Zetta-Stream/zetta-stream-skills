/**
 * Scripted demo scenarios. Each produces an IntentJSON that the agent runs through
 * the full firewall → execute pipeline. Used by `pnpm agent:demo -- scenario=<name>`.
 */
import { getConfig } from "../config.js";

export type Intent = {
  kind: string;
  owner: string;
  steps: Array<{
    op: string;
    chainId?: number;
    token?: string;
    to?: string;
    amount?: string;
    spender?: string;
    params?: Record<string, unknown>;
  }>;
  options?: Record<string, unknown>;
};

export type Scenario = {
  id: "phishing" | "gas-save" | "x402-cross";
  title: string;
  narration: string;
  intent: Intent;
  expect: "REJECTED" | "EXECUTED";
};

export function getScenario(id: Scenario["id"]): Scenario {
  const cfg = getConfig();
  const owner = cfg.DEMO_EOA_ADDRESS || "0x0000000000000000000000000000000000000000";

  const scenarios: Record<Scenario["id"], Scenario> = {
    phishing: {
      id: "phishing",
      title: "Intent Firewall rejects a phishing vault",
      narration:
        'User says "approve 100 USDC to this vault and deposit: " but the vault address is flagged by okx-security. ZettaStream simulates, sees owner balance draining to attacker, writes a REJECTED entry to X Layer. No execute tx is broadcast.',
      intent: {
        kind: "BATCH",
        owner,
        steps: [
          {
            op: "APPROVE",
            chainId: 196,
            token: "USDC",
            amount: "1",
            spender: cfg.PHISHING_VAULT_ADDRESS || "0xbadc0ffeebadc0ffeebadc0ffeebadc0ffeebadc",
          },
          {
            op: "DEPOSIT",
            chainId: 196,
            to: cfg.PHISHING_VAULT_ADDRESS || "0xbadc0ffeebadc0ffeebadc0ffeebadc0ffeebadc",
            token: "USDC",
            amount: "1",
          },
        ],
        options: { tag: "[DEMO]" },
      },
      expect: "REJECTED",
    },

    "gas-save": {
      id: "gas-save",
      title: "3 actions → 1 atomic batch (~70% gas saved)",
      narration:
        'User says "stake 0.1, then 0.2, then 0.3 USDC into the test vault — as one tx". ZettaStream simulates all 3; risk-scan is clean; it picks Multicall (or EIP-7702) fallback. Single X Layer tx executes the three deposits atomically. gas-compare vs 3 independent EOA txs shows ~70% savings (eliminating 2 tx overheads).',
      intent: {
        kind: "BATCH",
        owner,
        steps: [
          { op: "DEPOSIT", chainId: 196, to: "TEST_VAULT", token: "USDC", amount: "0.1" },
          { op: "DEPOSIT", chainId: 196, to: "TEST_VAULT", token: "USDC", amount: "0.2" },
          { op: "DEPOSIT", chainId: 196, to: "TEST_VAULT", token: "USDC", amount: "0.3" },
        ],
        options: { tag: "[DEMO]" },
      },
      expect: "EXECUTED",
    },

    "x402-cross": {
      id: "x402-cross",
      title: "x402 session + cross-chain trigger → Aave deposit on Base",
      narration:
        'User says "watch ETH price; when it drops below $3,400, move 1 USDC from X Layer to Base Aave". Agent opens x402 session (1 payment), polls every 500ms; fires intent on threshold; cross-chain scorer picks XLayer→Base route; batched via 7702.',
      intent: {
        kind: "BATCH",
        owner,
        steps: [
          {
            op: "BRIDGE",
            chainId: 196,
            token: "USDC",
            amount: "1",
            params: { dstChainId: 8453 },
          },
          { op: "APPROVE", chainId: 8453, token: "USDC", amount: "1", spender: "AAVE_V3_POOL" },
          { op: "DEPOSIT", chainId: 8453, to: "AAVE_V3_POOL", token: "USDC", amount: "1" },
        ],
        options: { tag: "[DEMO]" },
      },
      expect: "EXECUTED",
    },
  };

  return scenarios[id];
}

export const ALL_SCENARIOS: Scenario["id"][] = ["phishing", "gas-save", "x402-cross"];
