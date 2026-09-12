import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HeroSummary, isStrategyDraftUnchanged, isStrategyListLoading, isTakerFillPending, selectMakerSessionForAccount, selectMakerSessionForPage } from "./App";
import { initialDemo, summarizeReserve } from "./demoModel";
import type { MakerSession } from "./onchain/client";

describe("hero summary", () => {
  it("shows taker mUSDC balance instead of the reserve overview on the taker page", () => {
    const html = renderToStaticMarkup(
      <HeroSummary
        page="taker"
        reserveActive
        summary={summarizeReserve(initialDemo)}
        takerMusdcBalance={2500}
      />
    );

    expect(html).toContain("mUSDC balance");
    expect(html).toContain("$2,500");
    expect(html).not.toContain("Reserve overview");
  });
});

describe("maker session selection", () => {
  it("creates a connected account session instead of reusing another maker", () => {
    const current: MakerSession = {
      maker: "0x000000000000000000000000000000000000dEaD",
      reserveId: `0x${"1".padStart(64, "0")}`
    };
    const connected = "0x000000000000000000000000000000000000bEEF";
    const connectedSession: MakerSession = {
      maker: connected,
      reserveId: `0x${"2".padStart(64, "0")}`
    };

    const selected = selectMakerSessionForAccount(current, connected, () => connectedSession);

    expect(selected).toBe(connectedSession);
  });

  it("keeps the public maker session on the taker page", () => {
    const publicSession: MakerSession = {
      maker: "0x000000000000000000000000000000000000dEaD",
      reserveId: `0x${"1".padStart(64, "0")}`
    };
    const connected = "0x000000000000000000000000000000000000bEEF";
    const connectedSession: MakerSession = {
      maker: connected,
      reserveId: `0x${"2".padStart(64, "0")}`
    };

    const selected = selectMakerSessionForPage("taker", connectedSession, connected, () => connectedSession, () => publicSession);

    expect(selected).toBe(publicSession);
  });
});

describe("strategy draft comparison", () => {
  it("detects unchanged ladders so existing strategies are not rewritten", () => {
    const wbtc = initialDemo.legs.find((leg) => leg.key === "wbtc")!;

    expect(isStrategyDraftUnchanged({
      asset: "wbtc",
      enabled: true,
      ladder: wbtc.ladder.map((row) => ({
        entryPrice: String(row.entryPrice),
        maxSpend: String(row.maxSpend)
      }))
    }, initialDemo.legs)).toBe(true);

    expect(isStrategyDraftUnchanged({
      asset: "wbtc",
      enabled: true,
      ladder: wbtc.ladder.map((row, index) => ({
        entryPrice: String(row.entryPrice),
        maxSpend: index === 0 ? "1234" : String(row.maxSpend)
      }))
    }, initialDemo.legs)).toBe(false);
  });
});

describe("taker fill loading state", () => {
  it("marks the fill section busy while quotes or fills are running", () => {
    expect(isTakerFillPending("quote")).toBe(true);
    expect(isTakerFillPending("fill")).toBe(true);
    expect(isTakerFillPending("refresh")).toBe(false);
    expect(isTakerFillPending(null)).toBe(false);
  });
});

describe("strategy list loading state", () => {
  it("shows list loading only while strategy data is refreshing", () => {
    expect(isStrategyListLoading("refresh", false)).toBe(true);
    expect(isStrategyListLoading("connect", true)).toBe(true);
    expect(isStrategyListLoading("quote", false)).toBe(false);
    expect(isStrategyListLoading("fill", false)).toBe(false);
    expect(isStrategyListLoading(null, false)).toBe(false);
  });
});
