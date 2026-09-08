import { expect } from "chai";
import { execFileSync } from "node:child_process";

describe("Phase 6 demo scripts", function () {
  it("runs the full local demo from setup through sibling repricing", function () {
    this.timeout(120000);

    const output = execFileSync("npm", ["run", "demo"], {
      cwd: process.cwd(),
      encoding: "utf8"
    });

    expect(output).to.include("Dry Powder demo");
    expect(output).to.include("Initial reserve: spent 0.0 / 10000.0 mUSDC");
    expect(output).to.include("ETH quote: 1.000000000000000001 mETH -> 2700.0 mUSDC");
    expect(output).to.include("WBTC quote after ETH fill: 0.01000001 mWBTC -> 760.0 mUSDC");
    expect(output).to.include("LINK quote after ETH fill: 10.000000000000000001 mLINK -> 190.0 mUSDC");
    expect(output).to.include("After ETH fill: spent 4000.0 / 10000.0 mUSDC");
    expect(output).to.include("Maker mUSDC: 6000.0");
    expect(output).to.include("Taker mUSDC: 4000.0");
  });
});
