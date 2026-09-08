export type LegKey = "eth" | "wbtc" | "link";

export type Tranche = {
  label: string;
  ceiling: number;
  multiplierBps: number;
};

export type Reserve = {
  totalBudget: number;
  spent: number;
  tranches: Tranche[];
};

export type Leg = {
  key: LegKey;
  symbol: string;
  name: string;
  maxSpend: number;
  spent: number;
  baseMaxPrice: number;
  currentMaxPrice: number;
  allocationColor: string;
};

export type DemoState = {
  reserve: Reserve;
  legs: Leg[];
  eventLog: string[];
};

const tranches: Tranche[] = [
  { label: "Full price", ceiling: 4000, multiplierBps: 10000 },
  { label: "Selective", ceiling: 7500, multiplierBps: 9500 },
  { label: "Scarce capital", ceiling: 10000, multiplierBps: 9000 }
];

export const initialDemo: DemoState = {
  reserve: {
    totalBudget: 10000,
    spent: 0,
    tranches
  },
  legs: [
    {
      key: "eth",
      symbol: "ETH",
      name: "Ether accumulation",
      maxSpend: 6000,
      spent: 0,
      baseMaxPrice: 2700,
      currentMaxPrice: 2700,
      allocationColor: "#4f7cff"
    },
    {
      key: "wbtc",
      symbol: "WBTC",
      name: "Bitcoin accumulation",
      maxSpend: 6000,
      spent: 0,
      baseMaxPrice: 80000,
      currentMaxPrice: 80000,
      allocationColor: "#f4b455"
    },
    {
      key: "link",
      symbol: "LINK",
      name: "Chainlink accumulation",
      maxSpend: 4000,
      spent: 0,
      baseMaxPrice: 20,
      currentMaxPrice: 20,
      allocationColor: "#34c7dd"
    }
  ],
  eventLog: [
    "Reserve ready: 10,000 mUSDC shared across 16,000 mUSDC of leg caps.",
    "Three Aqua strategies quote against the same Dry Powder reserve."
  ]
};

export function summarizeReserve(state: DemoState) {
  const totalLegCaps = state.legs.reduce((sum, leg) => sum + leg.maxSpend, 0);
  return {
    totalBudget: state.reserve.totalBudget,
    spent: state.reserve.spent,
    remaining: state.reserve.totalBudget - state.reserve.spent,
    totalLegCaps,
    overcommitment: totalLegCaps / state.reserve.totalBudget
  };
}

export function selectTranche(reserve: Reserve): Tranche {
  return reserve.tranches.find((tranche) => reserve.spent < tranche.ceiling) ?? reserve.tranches[reserve.tranches.length - 1];
}

export function applyFill(state: DemoState, legKey: LegKey, reserveAmount: number): DemoState {
  const nextSpent = Math.min(state.reserve.totalBudget, state.reserve.spent + reserveAmount);
  const reserve = { ...state.reserve, spent: nextSpent };
  const activeTranche = selectTranche(reserve);

  return {
    reserve,
    legs: state.legs.map((leg) => {
      const spent = leg.key === legKey ? Math.min(leg.maxSpend, leg.spent + reserveAmount) : leg.spent;
      return {
        ...leg,
        spent,
        currentMaxPrice: (leg.baseMaxPrice * activeTranche.multiplierBps) / 10000
      };
    }),
    eventLog: [
      `ETH fill consumed ${formatUsd(reserveAmount)} of shared mUSDC reserve.`,
      `${activeTranche.label} tranche active: sibling strategies now quote at ${(activeTranche.multiplierBps / 100).toFixed(0)}%.`,
      ...state.eventLog
    ]
  };
}

export function formatUsd(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value >= 1000 ? 0 : 2
  }).format(value);
}
