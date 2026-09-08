import { describe, expect, it } from "vitest";
import { applyFill, initialDemo, selectTranche, summarizeReserve } from "./demoModel";

describe("demo model", () => {
  it("shows the initial overcommitted reserve and first tranche", () => {
    const summary = summarizeReserve(initialDemo);

    expect(summary.totalBudget).toBe(10000);
    expect(summary.totalLegCaps).toBe(16000);
    expect(summary.remaining).toBe(10000);
    expect(selectTranche(initialDemo.reserve).label).toBe("Full price");
  });

  it("reprices sibling legs after an ETH fill crosses the first threshold", () => {
    const filled = applyFill(initialDemo, "eth", 4000);

    expect(filled.reserve.spent).toBe(4000);
    expect(selectTranche(filled.reserve).multiplierBps).toBe(9500);
    expect(filled.legs.find((leg) => leg.key === "wbtc")?.currentMaxPrice).toBe(76000);
    expect(filled.legs.find((leg) => leg.key === "link")?.currentMaxPrice).toBe(19);
  });
});
