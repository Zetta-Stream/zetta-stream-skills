/**
 * Front-end-only mock of the ZettaStream firewall → execute pipeline.
 * Drives the /firewall page when the agent backend isn't running — plays back
 * a realistic event timeline and returns a verdict shaped like the real API.
 *
 * All tx hashes below are REAL X Layer txs from actual scenario runs, so the
 * OKLink links in the UI open genuine on-chain records. Where a scenario never
 * reached EXECUTED end-to-end on mainnet (e.g. x402-cross, which needs Base
 * infra), plausible-looking mock hashes are used and labeled as such.
 */

export type ScenarioId = "phishing" | "gas-save" | "x402-cross";

export type MockEventType =
  | "intent"
  | "plan"
  | "sim"
  | "scan"
  | "poll"
  | "fire"
  | "verdict"
  | "error"
  | "heartbeat";

export interface MockEvent {
  type: MockEventType;
  t?: number;
  [k: string]: unknown;
}

export interface MockVerdict {
  intentHash: string;
  verdict: "APPROVED" | "REJECTED" | "WARN" | "EXECUTED";
  confidence: number;
  reason: string;
  plan?: { callCount: number; labels: string[] };
  hash?: string;
  auditTx?: string;
  mode?: "EIP7702" | "MULTICALL_FALLBACK";
  gasSavedPct?: number;
  findings?: Array<{
    level: "info" | "warn" | "block";
    step: number;
    message: string;
  }>;
  txHashes?: string[];
  mocked?: boolean;
}

// Real X Layer tx hashes from the actual runs — clicking the OKLink link in
// the UI opens the genuine on-chain record.
const REAL = {
  phishingAudit: "0x0270fe102a8968cb4a5326d1cfb348636a93bf0ceeac306343a56f3254a0deb5",
  gasSaveBatch: "0x825bf3071fb9d51f126d61afdb88d42a8685107103b242a5f372b516b93e62ee",
  gasSaveAudit: "0xbbd645d41b5621bfb71ba4196ea5817fc6902d84641d295319ec93a9dcbe8196",
  x402Audit: "0x51a8304e9bdc841d1ccf8576f830e5338e3c25c0214ed7ab8d0cbcc7a30e9c27",
};

// Plausible-looking mock hashes for legs we haven't run end-to-end yet.
const MOCK = {
  x402Bridge: "0x8f2b31ce4f19a22b6e1a87e1c9d3e2f4a8c7b5d6e8f0a1b2c3d4e5f678901234a",
  x402AaveDeposit: "0xa1b2c3d4e5f60718293a4b5c6d7e8f9012345678901234567890abcdef123456",
};

const IH = {
  phishing: "0xed4508f1c11f4efac7fc736666f596f4c964691871da5c65033b135780d1aecf",
  gasSave: "0x4f5d45dba1b60b0911ef6e039e4181489145d22464e93b6e8ce1f4a3bf8692dc",
  x402: "0xc1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f67890123456789abcdef0123456789abc",
};

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// --------------------- Final verdicts per scenario ---------------------

const RESULTS: Record<ScenarioId, MockVerdict> = {
  phishing: {
    intentHash: IH.phishing,
    verdict: "REJECTED",
    confidence: 95,
    reason:
      "target 0xbadc0ffee… has no contract bytecode — likely phishing / bad address",
    plan: {
      callCount: 2,
      labels: ["approve USDC → 0xbadc0ffee…", "deposit 1 USDC → 0xbadc0ffee…"],
    },
    auditTx: REAL.phishingAudit,
    txHashes: [],
    findings: [
      { level: "info", step: 0, message: "approve USDC → 0xbadc0ffee… (sim ok — approve sets storage)" },
      { level: "block", step: 1, message: "deposit → 0xbadc0ffee…: target has no bytecode — likely phishing" },
      { level: "info", step: 0, message: "tx-scan step 0: safe" },
    ],
    mocked: false,
  },
  "gas-save": {
    intentHash: IH.gasSave,
    verdict: "EXECUTED",
    confidence: 92,
    reason: "all checks clean · 3 deposits batched into one X Layer tx · 85.45% gas saved",
    plan: {
      callCount: 3,
      labels: [
        "deposit 0.1 USDC → TEST_VAULT",
        "deposit 0.2 USDC → TEST_VAULT",
        "deposit 0.3 USDC → TEST_VAULT",
      ],
    },
    hash: REAL.gasSaveBatch,
    auditTx: REAL.gasSaveAudit,
    mode: "MULTICALL_FALLBACK",
    gasSavedPct: 85.45,
    txHashes: [REAL.gasSaveBatch],
    findings: [
      { level: "info", step: 0, message: "deposit 0.1 USDC → TEST_VAULT (sim ok)" },
      { level: "info", step: 1, message: "deposit 0.2 USDC → TEST_VAULT (sim ok)" },
      { level: "info", step: 2, message: "deposit 0.3 USDC → TEST_VAULT (sim ok)" },
      { level: "info", step: 0, message: "tx-scan step 0: safe" },
      { level: "info", step: 1, message: "tx-scan step 1: safe" },
      { level: "info", step: 2, message: "tx-scan step 2: safe" },
    ],
    mocked: false,
  },
  "x402-cross": {
    intentHash: IH.x402,
    verdict: "EXECUTED",
    confidence: 88,
    reason:
      "x402 session → 1,247 sub-100ms price polls · ETH crossed $3,400 · batched XLayer→Base Aave deposit",
    plan: {
      callCount: 3,
      labels: [
        "bridge 1 USDC XLayer→Base (Stargate, score 87)",
        "approve 1 USDC → Aave V3 Pool (Base)",
        "deposit 1 USDC → Aave V3 Pool (Base)",
      ],
    },
    hash: MOCK.x402Bridge,
    auditTx: REAL.x402Audit,
    mode: "MULTICALL_FALLBACK",
    gasSavedPct: 62.3,
    txHashes: [MOCK.x402Bridge, MOCK.x402AaveDeposit],
    findings: [
      { level: "info", step: 0, message: "x402 session opened via okx-x402-payment TEE — $0.001 USDC / 1000 queries" },
      { level: "info", step: 0, message: "1,247 price polls @ avg 94ms latency" },
      { level: "info", step: 0, message: "trigger fired: ETH $3,399.82 < $3,400" },
      { level: "info", step: 0, message: "bridge (DEX op — sim skipped; scan is the gate)" },
      { level: "info", step: 1, message: "approve 1 USDC → Aave V3 Pool (sim ok on Base)" },
      { level: "info", step: 2, message: "deposit 1 USDC → Aave V3 Pool (sim ok on Base)" },
      { level: "info", step: 1, message: "dapp-scan Aave V3 Pool: safe" },
    ],
    mocked: true, // bridge + Aave legs not yet run end-to-end
  },
};

// --------------------- Event timelines per scenario ---------------------

type TimelineEntry = { delay: number; event: MockEvent };

const TIMELINES: Record<ScenarioId, TimelineEntry[]> = {
  phishing: [
    { delay: 80, event: { type: "intent", intentHash: IH.phishing, kind: "BATCH", steps: 2 } },
    { delay: 220, event: { type: "plan", step: 0, label: "approve USDC → 0xbadc0ffee…" } },
    { delay: 140, event: { type: "plan", step: 1, label: "deposit 1 USDC → 0xbadc0ffee…" } },
    { delay: 180, event: { type: "sim", step: 0, result: "ok" } },
    { delay: 160, event: { type: "sim", step: 1, result: "block", note: "target has no bytecode" } },
    { delay: 300, event: { type: "scan", step: 0, action: "safe" } },
    { delay: 260, event: { type: "verdict", intentHash: IH.phishing, verdict: "REJECTED", confidence: 95 } },
  ],
  "gas-save": [
    { delay: 90, event: { type: "intent", intentHash: IH.gasSave, kind: "BATCH", steps: 3 } },
    { delay: 140, event: { type: "plan", step: 0, label: "deposit 0.1 USDC → TEST_VAULT" } },
    { delay: 100, event: { type: "plan", step: 1, label: "deposit 0.2 USDC → TEST_VAULT" } },
    { delay: 90, event: { type: "plan", step: 2, label: "deposit 0.3 USDC → TEST_VAULT" } },
    { delay: 180, event: { type: "sim", step: 0, result: "ok" } },
    { delay: 90, event: { type: "sim", step: 1, result: "ok" } },
    { delay: 90, event: { type: "sim", step: 2, result: "ok" } },
    { delay: 260, event: { type: "scan", step: 0, action: "safe" } },
    { delay: 180, event: { type: "scan", step: 1, action: "safe" } },
    { delay: 180, event: { type: "scan", step: 2, action: "safe" } },
    { delay: 320, event: { type: "fire", mode: "MULTICALL_FALLBACK", note: "Pectra probe: reth v1.10.2 → fallback" } },
    {
      delay: 520,
      event: {
        type: "verdict",
        intentHash: IH.gasSave,
        verdict: "EXECUTED",
        confidence: 92,
        hash: REAL.gasSaveBatch,
      },
    },
  ],
  "x402-cross": [
    { delay: 90, event: { type: "intent", intentHash: IH.x402, kind: "MONITOR+BATCH", steps: 3 } },
    { delay: 220, event: { type: "poll", symbol: "ETH", price: 3452.14, latencyMs: 87 } },
    { delay: 140, event: { type: "poll", symbol: "ETH", price: 3441.8, latencyMs: 92 } },
    { delay: 130, event: { type: "poll", symbol: "ETH", price: 3420.5, latencyMs: 89 } },
    { delay: 140, event: { type: "poll", symbol: "ETH", price: 3411.27, latencyMs: 94 } },
    { delay: 140, event: { type: "poll", symbol: "ETH", price: 3402.86, latencyMs: 88 } },
    { delay: 160, event: { type: "poll", symbol: "ETH", price: 3399.82, latencyMs: 91 } },
    { delay: 80, event: { type: "fire", condition: "ETH < 3400", price: 3399.82 } },
    { delay: 240, event: { type: "plan", step: 0, label: "bridge 1 USDC XLayer→Base (Stargate 87)" } },
    { delay: 140, event: { type: "plan", step: 1, label: "approve USDC → Aave V3 Pool" } },
    { delay: 110, event: { type: "plan", step: 2, label: "deposit 1 USDC → Aave V3 Pool" } },
    { delay: 260, event: { type: "scan", step: 0, action: "safe" } },
    { delay: 200, event: { type: "scan", step: 1, action: "safe", note: "spender Aave V3 Base" } },
    { delay: 220, event: { type: "scan", step: 2, action: "safe" } },
    {
      delay: 420,
      event: {
        type: "verdict",
        intentHash: IH.x402,
        verdict: "EXECUTED",
        confidence: 88,
        hash: MOCK.x402Bridge,
      },
    },
  ],
};

// --------------------- Runners ---------------------

export async function runMockScenario(
  id: ScenarioId,
  onEvent: (ev: MockEvent) => void,
  opts?: { speed?: number },
): Promise<MockVerdict> {
  const speed = opts?.speed ?? 1;
  for (const { delay, event } of TIMELINES[id]) {
    await sleep(delay / speed);
    onEvent({ ...event, t: Date.now() });
  }
  return RESULTS[id];
}

/** Inspect the pasted IntentJSON and route to the best-fitting scenario. */
function classify(raw: string): ScenarioId {
  if (/badc0ffee/i.test(raw)) return "phishing";
  if (/BRIDGE|dstChainId|AAVE_V3_POOL|watch|monitor/i.test(raw)) return "x402-cross";
  return "gas-save";
}

export async function runMockAnalyze(
  rawIntent: string,
  onEvent: (ev: MockEvent) => void,
): Promise<MockVerdict> {
  const id = classify(rawIntent);
  const result = await runMockScenario(id, onEvent);
  // Analyze is read-only — strip execution fields
  return { ...result, verdict: result.verdict === "EXECUTED" ? "APPROVED" : result.verdict, hash: undefined, mode: undefined, txHashes: [], auditTx: undefined };
}

export async function runMockIntent(
  rawIntent: string,
  onEvent: (ev: MockEvent) => void,
): Promise<MockVerdict> {
  const id = classify(rawIntent);
  return runMockScenario(id, onEvent);
}
