/**
 * Gas comparison: batched tx vs baseline of N independent EOA txs.
 *
 * Baseline = 21000 (tx overhead) * N + approximate op gas per step.
 * Actual batch gas comes from the on-chain `gasUsed` of the batched tx.
 *
 * Returns both absolute savings (gwei-scaled for the `gasSaved: uint32` field in
 * ZettaStreamLog) and a percentage for the dashboard gauge.
 */
export interface GasCompareInput {
  /** Number of calls in the batch. */
  callCount: number;
  /** Approximate per-call op gas (excluding tx overhead). */
  perCallOpGas: number;
  /** Actual gasUsed of the single batched tx (from the receipt). */
  actualBatchGas: bigint;
}

export interface GasCompareResult {
  baselineGas: bigint;        // N × (21000 + perCallOpGas)
  actualBatchGas: bigint;
  savedGas: bigint;
  savedPct: number;
  savedGwei: number;          // scaled for ZettaStreamLog.gasSaved (uint32)
}

const TX_OVERHEAD = 21000n;

export function compareGas(input: GasCompareInput): GasCompareResult {
  const n = BigInt(input.callCount);
  const perCall = BigInt(input.perCallOpGas);
  const baseline = n * (TX_OVERHEAD + perCall);
  const actual = input.actualBatchGas;
  const saved = baseline > actual ? baseline - actual : 0n;
  const pct = baseline === 0n ? 0 : Number((saved * 10000n) / baseline) / 100;

  // gwei-scaled for on-chain compact storage: gwei = wei / 1e9; we store gas units,
  // not wei, but using the same scaling gives a compact figure ≤ uint32 max for
  // realistic batches. For batches >= 4 billion gas we truncate to max.
  const savedN = Number(saved);
  const scaled = Math.min(savedN, 0xffffffff);

  return {
    baselineGas: baseline,
    actualBatchGas: actual,
    savedGas: saved,
    savedPct: pct,
    savedGwei: scaled,
  };
}

/**
 * Heuristic op-gas estimates by op kind.
 * Used for the baseline when we don't have per-step simulation results yet.
 */
export const DEFAULT_OP_GAS: Record<string, number> = {
  APPROVE: 46000,
  SWAP: 180000,
  DEPOSIT: 95000,
  WITHDRAW: 90000,
  STAKE: 110000,
  BRIDGE: 220000,
  MINT: 130000,
  RAW: 60000,
};

export function avgOpGas(ops: string[]): number {
  if (ops.length === 0) return 60000;
  const total = ops.reduce((sum, op) => sum + (DEFAULT_OP_GAS[op] ?? 60000), 0);
  return Math.round(total / ops.length);
}
