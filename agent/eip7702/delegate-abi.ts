/**
 * ABI for BatchCallDelegate.sol — the dual-use contract deployed on X Layer.
 * Used by batch-executor.ts for both EIP-7702 and Multicall-fallback paths.
 */
export const batchCallDelegateAbi = [
  {
    type: "function",
    name: "executeBatch",
    stateMutability: "payable",
    inputs: [
      {
        name: "calls",
        type: "tuple[]",
        components: [
          { name: "to", type: "address" },
          { name: "value", type: "uint256" },
          { name: "data", type: "bytes" },
        ],
      },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "previewValue",
    stateMutability: "pure",
    inputs: [
      {
        name: "calls",
        type: "tuple[]",
        components: [
          { name: "to", type: "address" },
          { name: "value", type: "uint256" },
          { name: "data", type: "bytes" },
        ],
      },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "event",
    name: "BatchExecuted",
    inputs: [
      { name: "caller", type: "address", indexed: true },
      { name: "count", type: "uint256", indexed: false },
      { name: "totalValue", type: "uint256", indexed: false },
    ],
  },
  {
    type: "error",
    name: "CallFailed",
    inputs: [
      { name: "index", type: "uint256" },
      { name: "reason", type: "bytes" },
    ],
  },
] as const;

export interface BatchCall {
  to: `0x${string}`;
  value: bigint;
  data: `0x${string}`;
}
