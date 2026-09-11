import { assetByKey, assetCatalog, type AssetKey } from "./assets";

export type LegKey = AssetKey;

export type StrategyDraft = {
  asset: LegKey;
  ladder: StrategyLadderRow[];
};

export type StrategySetAssetDraft = StrategyDraft & {
  enabled: boolean;
};

export type StrategySetDraft = {
  assets: StrategySetAssetDraft[];
};

export type StrategyLadderRow = {
  entryPrice: string;
  maxSpend: string;
};

export type Tranche = {
  label: string;
  ceiling: number;
  multiplierBps: number;
};

export type Reserve = {
  totalBudget: number;
  spent: number;
};

export type Leg = {
  key: LegKey;
  symbol: string;
  name: string;
  maxSpend: number;
  spent: number;
  baseMaxPrice: number;
  currentMaxPrice: number;
  ladder: Array<{ entryPrice: number; maxSpend: number; cumulativeMaxSpend: number }>;
  allocationColor: string;
};

export type DemoState = {
  reserve: Reserve;
  legs: Leg[];
  eventLog: string[];
};

export const initialDemo: DemoState = {
  reserve: {
    totalBudget: 10000,
    spent: 0
  },
  legs: [
    ...assetCatalog.map((asset) => ({
      key: asset.key,
      symbol: asset.symbol,
      name: asset.name,
      maxSpend: Number(asset.maxSpend),
      spent: 0,
      baseMaxPrice: Number(asset.ladder[0].entryPrice),
      currentMaxPrice: Number(asset.ladder[0].entryPrice),
      ladder: toDemoLadder(asset.ladder),
      allocationColor: asset.allocationColor
    }))
  ],
  eventLog: [
    "Reserve ready: 10,000 mUSDC shared across 16,000 mUSDC of leg caps.",
    "Each Aqua strategy owns its own entry ladder against the shared reserve."
  ]
};

export function summarizeReserve(state: DemoState, exposureBalance = state.reserve.totalBudget) {
  const totalLegCaps = state.legs.reduce((sum, leg) => sum + leg.maxSpend, 0);
  const exposure = exposureBalance > 0 ? totalLegCaps / exposureBalance : Infinity;
  return {
    totalBudget: state.reserve.totalBudget,
    spent: state.reserve.spent,
    remaining: state.reserve.totalBudget - state.reserve.spent,
    totalLegCaps,
    exposure,
    overcommitment: exposure
  };
}

export function applyFill(state: DemoState, legKey: LegKey, reserveAmount: number): DemoState {
  const nextSpent = Math.min(state.reserve.totalBudget, state.reserve.spent + reserveAmount);
  const reserve = { ...state.reserve, spent: nextSpent };

  return {
    reserve,
    legs: state.legs.map((leg) => {
      const spent = leg.key === legKey ? Math.min(leg.maxSpend, leg.spent + reserveAmount) : leg.spent;
      const activeRow = selectLadderRow({ ...leg, spent });
      return {
        ...leg,
        spent,
        currentMaxPrice: activeRow.entryPrice
      };
    }),
    eventLog: [
      `${legKey.toUpperCase()} fill consumed ${formatUsd(reserveAmount)} of shared mUSDC reserve.`,
      `${legKey.toUpperCase()} ladder advanced independently.`,
      ...state.eventLog
    ]
  };
}

export function selectLadderRow(leg: Leg) {
  return leg.ladder.find((row) => leg.spent < row.cumulativeMaxSpend) ?? leg.ladder[leg.ladder.length - 1];
}

export function formatUsd(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value >= 1000 ? 0 : 2
  }).format(value);
}

export function getStrategyDraftDefaults(asset: LegKey): StrategyDraft {
  const config = assetByKey[asset];
  if (!config) throw new Error(`Unknown strategy asset: ${asset}`);

  return {
    asset,
    ladder: config.ladder.map((row) => ({ ...row }))
  };
}

export function getStrategyDraftSpendTotal(draft: StrategyDraft): number {
  return draft.ladder.reduce((sum, row) => {
    const maxSpend = Number(row.maxSpend);
    return Number.isFinite(maxSpend) ? sum + maxSpend : sum;
  }, 0);
}

export function getStrategySetDraftDefaults(activeAssets: LegKey[]): StrategySetDraft {
  return {
    assets: assetCatalog.map((asset) => {
      const enabled = activeAssets.includes(asset.key);
      const draft = getStrategyDraftDefaults(asset.key);
      return {
        ...draft,
        ladder: enabled ? draft.ladder : draft.ladder.map((row) => ({ ...row, maxSpend: "" })),
        enabled
      };
    })
  };
}

export function getStrategySetExposure(draft: StrategySetDraft, reserveBalance: number) {
  const virtualCap = draft.assets.reduce((sum, assetDraft) => assetDraft.enabled ? sum + getStrategyDraftSpendTotal(assetDraft) : sum, 0);
  return {
    virtualCap,
    ratio: reserveBalance > 0 ? virtualCap / reserveBalance : Infinity
  };
}

export function isStrategySetOvercommitted(draft: StrategySetDraft, reserveBalance: number) {
  return getStrategySetExposure(draft, reserveBalance).ratio > 1.5;
}

export function getFillAmountDefault(asset: LegKey): string {
  return assetByKey[asset]?.fillAmount ?? "";
}

function toDemoLadder(ladder: StrategyLadderRow[]) {
  let cumulativeMaxSpend = 0;
  return ladder.map((row) => {
    cumulativeMaxSpend += Number(row.maxSpend);
    return {
      entryPrice: Number(row.entryPrice),
      maxSpend: Number(row.maxSpend),
      cumulativeMaxSpend
    };
  });
}
