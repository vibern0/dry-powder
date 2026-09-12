import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HeroSummary } from "./App";
import { initialDemo, summarizeReserve } from "./demoModel";

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
