import { describe, expect, it } from "vitest";
import { applyFill, getStrategyDraftDefaults, initialDemo, selectLadderRow, summarizeReserve } from "./demoModel";

describe("demo model", () => {
  it("shows the initial overcommitted reserve", () => {
    const summary = summarizeReserve(initialDemo);

    expect(summary.totalBudget).toBe(10000);
    expect(summary.totalLegCaps).toBe(35700);
    expect(summary.remaining).toBe(10000);
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
});
