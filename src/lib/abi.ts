/**
 * Lightweight ABIs for the three Zetta-Stream contracts. Read-only fragments only —
 * the dashboard never writes from the browser; the agent does that via TEE.
 */
export const zettaStreamLogAbi = [
  {
    type: "function",
    name: "rotationCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "delegationCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "recent",
    stateMutability: "view",
    inputs: [{ name: "n", type: "uint256" }],
    outputs: [
      {
        type: "tuple[]",
        components: [
          { name: "timestamp", type: "uint64" },
          { name: "owner", type: "address" },
          { name: "agent", type: "address" },
          { name: "signalHash", type: "bytes32" },
          { name: "from", type: "uint8" },
          { name: "to", type: "uint8" },
          { name: "confidence", type: "uint8" },
          { name: "netYieldBps", type: "int32" },
          { name: "gasSavedBps", type: "uint32" },
          { name: "batchTxHash", type: "bytes32" },
          { name: "mode", type: "uint8" },
          { name: "reason", type: "string" },
        ],
      },
    ],
  },
] as const;

export const zettaStreamMedalAbi = [
  {
    type: "function",
    name: "totalSupply",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "tokenURI",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ type: "string" }],
  },
  {
    type: "function",
    name: "medals",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [
      { name: "rotationId", type: "uint256" },
      { name: "netYieldBps", type: "int32" },
      { name: "mintedAt", type: "uint64" },
    ],
  },
  {
    type: "function",
    name: "ownerOf",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ type: "address" }],
  },
] as const;

export const POSITION_LABELS = ["IDLE", "AAVE", "UNIV4"] as const;
export const DELEGATION_MODE_LABELS = ["EIP-7702", "Multicall Fallback"] as const;

/// Backward-compat — the legacy /audit page still imports this. Kept so the build
/// doesn't break while the page is rewritten in Day 4.
export const VERDICT_LABELS = ["PENDING", "APPROVED", "REJECTED", "EXECUTED"] as const;
