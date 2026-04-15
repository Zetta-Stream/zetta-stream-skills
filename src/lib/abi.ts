/**
 * Lightweight ABI for ZettaStreamLog read paths (entry / delegation fetchers used
 * by the /audit page). No bytecode — reads via wagmi's useReadContract.
 */
export const zettaStreamLogAbi = [
  {
    type: "function",
    name: "entryCount",
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
          { name: "intentHash", type: "bytes32" },
          { name: "verdict", type: "uint8" },
          { name: "confidence", type: "uint8" },
          { name: "gasSaved", type: "uint32" },
          { name: "txHashes", type: "bytes32[]" },
          { name: "reason", type: "string" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "recentDelegations",
    stateMutability: "view",
    inputs: [{ name: "n", type: "uint256" }],
    outputs: [
      {
        type: "tuple[]",
        components: [
          { name: "timestamp", type: "uint64" },
          { name: "eoa", type: "address" },
          { name: "delegate", type: "address" },
          { name: "chainId", type: "uint256" },
          { name: "authTxHash", type: "bytes32" },
          { name: "mode", type: "uint8" },
          { name: "revoked", type: "bool" },
        ],
      },
    ],
  },
] as const;

export const VERDICT_LABELS = ["PENDING", "APPROVED", "REJECTED", "EXECUTED"] as const;
export const DELEGATION_MODE_LABELS = ["EIP-7702", "Multicall Fallback"] as const;
