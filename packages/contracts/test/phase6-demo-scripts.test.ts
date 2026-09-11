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
    expect(output).to.include("ETH quote: 1.000000000000000001 mETH -> 1800.0 mUSDC");
    expect(output).to.include("WBTC quote: 0.01 mWBTC -> 650.0 mUSDC");
    expect(output).to.include("SOL quote: 2.500000000000000001 mSOL -> 450.0 mUSDC");
    expect(output).to.include("WBTC quote after ETH fill: 0.01 mWBTC -> 650.0 mUSDC");
    expect(output).to.include("LINK quote after ETH fill: 10.0 mLINK -> 200.0 mUSDC");
    expect(output).to.include("After ETH fill: spent 2000.0 / 10000.0 mUSDC");
    expect(output).to.include("Maker mUSDC: 8000.0");
    expect(output).to.include("Taker mUSDC: 2000.0");
  });
});
