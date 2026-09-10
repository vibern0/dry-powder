import type { Address } from "viem";

export const SEPOLIA_CHAIN_ID = 11155111;
export const AQUA_ADDRESS = "0x1111113ccf1426a8e30e2bff5e005d929bf6a90a" as Address;
export const DRY_POWDER_ROUTER = "0xbf5E9Ec40cD683EB02215759708751E61A655A9B" as Address;

export const TOKENS = {
  mUSDC: "0x5b9d76B3517D04AAD311E5197eEEb801c8C133D4",
  mETH: "0x2782E69ab9456CD1505f3598eaAb18BF63146683",
  mWBTC: "0xc847B5a5A8916C40c77d71Ef3312356991414c36",
  mLINK: "0x406A43BfE9fFA7204a3d5503d3D6379D4ADC0353"
} as const satisfies Record<string, Address>;

export const DRY_POWDER_OPCODE = 0x34;
export const SALT_OPCODE = 0x1e;
export const LIMIT_SWAP_OPCODE = 0x15;
export const USE_AQUA_INSTEAD_OF_SIGNATURE = 1n << 254n;
export const ORDER_DATA_SLICES_INDEXES_BIT_OFFSET = 160n;
export const TOKENS_PREFIX_LENGTH = 40;
export const USE_TRANSFER_FROM_AND_AQUA_PUSH = 0x0040;
export const IS_A_TO_B = 0x0080;

export const ROUTER_ABI = [
  {
    type: "function",
    name: "createReserve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "reserveId", type: "bytes32" },
      { name: "reserveToken", type: "address" },
      { name: "totalBudget", type: "uint256" },
      { name: "thresholds", type: "uint256[]" },
      { name: "multipliersBps", type: "uint256[]" }
    ],
    outputs: []
  },
  {
    type: "function",
    name: "addLeg",
    stateMutability: "nonpayable",
    inputs: [
      { name: "reserveId", type: "bytes32" },
      { name: "token", type: "address" },
      { name: "maxSpend", type: "uint256" }
    ],
    outputs: []
  },
  {
    type: "function",
    name: "updateLeg",
    stateMutability: "nonpayable",
    inputs: [
      { name: "reserveId", type: "bytes32" },
      { name: "token", type: "address" },
      { name: "maxSpend", type: "uint256" }
    ],
    outputs: []
  },
  {
    type: "function",
    name: "removeLeg",
    stateMutability: "nonpayable",
    inputs: [
      { name: "reserveId", type: "bytes32" },
      { name: "token", type: "address" }
    ],
    outputs: []
  },
  {
    type: "function",
    name: "activateReserve",
    stateMutability: "nonpayable",
    inputs: [{ name: "reserveId", type: "bytes32" }],
    outputs: []
  },
  {
    type: "function",
    name: "getReserve",
    stateMutability: "view",
    inputs: [
      { name: "maker", type: "address" },
      { name: "reserveId", type: "bytes32" }
    ],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "reserveToken", type: "address" },
          { name: "totalBudget", type: "uint256" },
          { name: "spent", type: "uint256" },
          { name: "active", type: "bool" },
          { name: "exists", type: "bool" }
        ]
      }
    ]
  },
  {
    type: "function",
    name: "getLeg",
    stateMutability: "view",
    inputs: [
      { name: "maker", type: "address" },
      { name: "reserveId", type: "bytes32" },
      { name: "token", type: "address" }
    ],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "maxSpend", type: "uint256" },
          { name: "spent", type: "uint256" },
          { name: "exists", type: "bool" }
        ]
      }
    ]
  },
  {
    type: "function",
    name: "quote",
    stateMutability: "view",
    inputs: [
      {
        name: "order",
        type: "tuple",
        components: [
          { name: "maker", type: "address" },
          { name: "traits", type: "uint256" },
          { name: "data", type: "bytes" }
        ]
      },
      { name: "amount", type: "uint256" },
      { name: "takerTraitsAndData", type: "bytes" }
    ],
    outputs: [
      { name: "amountIn", type: "uint256" },
      { name: "amountOut", type: "uint256" },
      { name: "orderHash", type: "bytes32" }
    ]
  },
  {
    type: "function",
    name: "swap",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "order",
        type: "tuple",
        components: [
          { name: "maker", type: "address" },
          { name: "traits", type: "uint256" },
          { name: "data", type: "bytes" }
        ]
      },
      { name: "amount", type: "uint256" },
      { name: "takerTraitsAndData", type: "bytes" }
    ],
    outputs: [
      { name: "amountIn", type: "uint256" },
      { name: "amountOut", type: "uint256" },
      { name: "orderHash", type: "bytes32" }
    ]
  }
] as const;

export const MOCK_ERC20_ABI = [
  {
    type: "function",
    name: "mint",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" }
    ],
    outputs: []
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" }
    ],
    outputs: [{ name: "", type: "bool" }]
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }]
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" }
    ],
    outputs: [{ name: "", type: "uint256" }]
  }
] as const;
