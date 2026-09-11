import { describe, expect, it } from "vitest";
import {
  applyFill,
  applyLegSnapshot,
  disableStrategySetAsset,
  enableStrategySetAsset,
  getStrategyDraftDefaults,
  getStrategyDraftSpendTotal,
  getStrategySetDraftDefaults,
  getStrategySetExposure,
  getInitialFillAmount,
  initialDemo,
  isStrategySetOvercommitted,
  selectActiveStrategyKeys,
  selectLadderRow,
  summarizeReserve
} from "./demoModel";

describe("demo model", () => {
  it("shows the initial overcommitted reserve", () => {
    const summary = summarizeReserve(initialDemo, 30000);

    expect(summary.totalBudget).toBe(10000);
    expect(summary.totalLegCaps).toBe(35700);
    expect(summary.remaining).toBe(10000);
    expect(summary.exposure).toBe(1.19);
  });

  it("measures reserve exposure against available mUSDC balance", () => {
    const summary = summarizeReserve({
      reserve: { totalBudget: 10000, spent: 0 },
      legs: [
        { ...initialDemo.legs[0], maxSpend: 10000 },
        { ...initialDemo.legs[1], maxSpend: 10000 }
      ],
      eventLog: []
    }, 30000);

    expect(summary.remaining).toBe(10000);
    expect(summary.totalLegCaps).toBe(20000);
    expect(summary.exposure).toBeCloseTo(0.67, 2);
  });

  it("seeds a customizable seven asset catalog for the UI", () => {
    expect(initialDemo.legs.map((leg) => leg.symbol)).toEqual(["ETH", "WBTC", "LINK", "ARB", "OP", "BNB", "SOL"]);
  });

  it("advances only the filled asset ladder", () => {
    const filled = applyFill(initialDemo, "eth", 2000);

    expect(filled.reserve.spent).toBe(2000);
    expect(filled.legs.find((leg) => leg.key === "eth")?.currentMaxPrice).toBe(1600);
    expect(filled.legs.find((leg) => leg.key === "wbtc")?.currentMaxPrice).toBe(65000);
    expect(selectLadderRow(filled.legs.find((leg) => leg.key === "eth")!).maxSpend).toBe(4000);
  });

  it("returns asset-specific strategy draft defaults", () => {
    expect(getStrategyDraftDefaults("wbtc")).toEqual({
      asset: "wbtc",
      ladder: [
        { entryPrice: "65000", maxSpend: "4000" },
        { entryPrice: "60000", maxSpend: "3000" },
        { entryPrice: "45000", maxSpend: "3000" }
      ]
    });
    expect(getStrategyDraftDefaults("sol")).toEqual({
      asset: "sol",
      ladder: [
        { entryPrice: "180", maxSpend: "1200" },
        { entryPrice: "171", maxSpend: "1200" },
        { entryPrice: "162", maxSpend: "1100" }
      ]
    });
  });

  it("starts fills with the selected asset default amount", () => {
    expect(getInitialFillAmount("eth")).toBe("2000");
    expect(getInitialFillAmount("wbtc")).toBe("4000");
  });

  it("sums the draft max spend across all strategy tiers", () => {
    expect(getStrategyDraftSpendTotal({
      asset: "eth",
      ladder: [
        { entryPrice: "1800", maxSpend: "2000" },
        { entryPrice: "1600", maxSpend: "2500.50" },
        { entryPrice: "1400", maxSpend: "" }
      ]
    })).toBe(4500.5);
  });

  it("builds a strategy set draft from active assets", () => {
    const draft = getStrategySetDraftDefaults(["eth", "wbtc"]);

    expect(draft.assets.find((asset) => asset.asset === "eth")?.enabled).toBe(true);
    expect(draft.assets.find((asset) => asset.asset === "wbtc")?.enabled).toBe(true);
    expect(draft.assets.find((asset) => asset.asset === "link")?.enabled).toBe(false);
  });

  it("keeps active spend values but clears inactive asset spend defaults", () => {
    const draft = getStrategySetDraftDefaults(["eth"]);

    expect(draft.assets.find((asset) => asset.asset === "eth")?.ladder.map((row) => row.maxSpend)).toEqual(["2000", "4000", "4000"]);
    expect(draft.assets.find((asset) => asset.asset === "wbtc")?.ladder.map((row) => row.maxSpend)).toEqual(["", "", ""]);
  });

  it("adds and removes assets from the visible strategy set without default spend", () => {
    const draft = getStrategySetDraftDefaults(["eth"]);
    const withWbtc = enableStrategySetAsset(draft, "wbtc");
    const withoutEth = disableStrategySetAsset(withWbtc, "eth");

    expect(withWbtc.assets.find((asset) => asset.asset === "wbtc")?.enabled).toBe(true);
    expect(withWbtc.assets.find((asset) => asset.asset === "wbtc")?.ladder.map((row) => row.maxSpend)).toEqual(["", "", ""]);
    expect(withoutEth.assets.find((asset) => asset.asset === "eth")?.enabled).toBe(false);
  });

  it("sums only enabled assets in the strategy set exposure", () => {
    const draft = getStrategySetDraftDefaults(["eth", "link"]);
    const exposure = getStrategySetExposure(draft, 10000);

    expect(exposure.virtualCap).toBe(14000);
    expect(exposure.ratio).toBe(1.4);
  });

  it("flags strategy sets above 1.5x virtual exposure", () => {
    const belowLimit = getStrategySetDraftDefaults(["eth", "link"]);
    const aboveLimit = getStrategySetDraftDefaults(["eth", "wbtc"]);

    expect(isStrategySetOvercommitted(belowLimit, 10000)).toBe(false);
    expect(isStrategySetOvercommitted(aboveLimit, 10000)).toBe(true);
  });

  it("keeps every existing and shipped onchain leg active after refresh", () => {
    const legs = Object.fromEntries(
      initialDemo.legs.map((leg) => [leg.key, { exists: leg.key === "eth" || leg.key === "wbtc" }])
    ) as Record<string, { exists: boolean }>;
    const shipped = { eth: true, wbtc: true, link: false };

    expect(selectActiveStrategyKeys(["eth", "wbtc", "link"], legs, shipped)).toEqual(["eth", "wbtc"]);
  });

  it("does not mark unshipped legs fillable", () => {
    const legs = Object.fromEntries(
      initialDemo.legs.map((leg) => [leg.key, { exists: leg.key === "eth" || leg.key === "wbtc" }])
    ) as Record<string, { exists: boolean }>;
    const shipped = { eth: false, wbtc: true, link: false };

    expect(selectActiveStrategyKeys(["eth", "wbtc", "link"], legs, shipped)).toEqual(["wbtc"]);
  });

  it("rebuilds an edited ladder from onchain cumulative caps and price bps", () => {
    const wbtc = initialDemo.legs.find((leg) => leg.key === "wbtc")!;
    const hydrated = applyLegSnapshot(wbtc, {
      maxSpend: 16000000000n,
      spent: 0n,
      spendCaps: [4000000000n, 7000000000n, 16000000000n],
      priceBps: [10000n, 9231n, 6923n]
    });

    expect(hydrated.maxSpend).toBe(16000);
    expect(hydrated.ladder.map((row) => row.maxSpend)).toEqual([4000, 3000, 9000]);
    expect(hydrated.ladder.map((row) => row.entryPrice)).toEqual([65000, 60000, 45000]);
  });
});
