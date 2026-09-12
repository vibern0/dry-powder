import type { Address } from "viem";

export const SEPOLIA_CHAIN_ID = 11155111;
export const AQUA_ADDRESS = "0x1111113CCf1426A8E30e2bfF5E005d929bF6a90a" as Address;
export const DRY_POWDER_ROUTER = "0x5d1e7bCc9a9AD87FE2Cba803EDe1cE59232471E9" as Address;
export const DRY_POWDER_ROUTER_DEPLOYMENT_BLOCK = 11_680_000n;

export const TOKENS = {
  mUSDC: "0xb189B7E78dC904CBA4B634679103e785A6f8EC70",
  mETH: "0xf392324D1e4018eD623AF5efb941AE2936c0Bdad",
  mWBTC: "0xC048c28F581943b191B61bA05fda3101948d4dd7",
  mLINK: "0x235e2E846a9FB5D5E4e8548e204ba4fCadBb96a4",
  mARB: "0xbd626DE1Ad9b03108E5E42cC19c85cf664E07691",
  mOP: "0xcA7813d6D5fcb52DBd767D8b758953734Ac7D385",
  mBNB: "0x8A4b5e0d1FD4f8AF315DE11cEcDd3001337daD78",
  mSOL: "0x18d35f66E15009DB7B21Bdbd8a93048215b9d5e3"
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
    type: "event",
    name: "LegAdded",
    inputs: [
      { name: "maker", type: "address", indexed: true },
      { name: "reserveId", type: "bytes32", indexed: true },
      { name: "token", type: "address", indexed: true },
      { name: "maxSpend", type: "uint256", indexed: false }
    ]
  },
  {
    type: "function",
    name: "createReserve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "reserveId", type: "bytes32" },
      { name: "reserveToken", type: "address" },
      { name: "totalBudget", type: "uint256" }
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
      { name: "spendCaps", type: "uint256[]" },
      { name: "priceBps", type: "uint256[]" }
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
      { name: "spendCaps", type: "uint256[]" },
      { name: "priceBps", type: "uint256[]" }
    ],
    outputs: []
  },
  {
    type: "function",
    name: "getLegSpendCaps",
    stateMutability: "view",
    inputs: [
      { name: "maker", type: "address" },
      { name: "reserveId", type: "bytes32" },
      { name: "token", type: "address" }
    ],
    outputs: [{ name: "", type: "uint256[]" }]
  },
  {
    type: "function",
    name: "getLegPriceBps",
    stateMutability: "view",
    inputs: [
      { name: "maker", type: "address" },
      { name: "reserveId", type: "bytes32" },
      { name: "token", type: "address" }
    ],
    outputs: [{ name: "", type: "uint256[]" }]
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
