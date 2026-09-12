import { describe, expect, it } from "vitest";
import { encodeAbiParameters, formatUnits, getAddress, keccak256, parseUnits } from "viem";
import { AQUA_ADDRESS, DRY_POWDER_ROUTER, TOKENS } from "./onchain/constants";
import { assertHasSepoliaGas, buildFillIntent, buildSetupPlan, buildStrategy, buildStrategyPlan, createReserveId, formatEthBalance, roleForAccount, strategyInputs, usdc } from "./onchain/strategy";

describe("onchain strategy helpers", () => {
  it("creates deterministic reserve ids from maker and nonce", () => {
    const reserveId = createReserveId("0x000000000000000000000000000000000000dEaD", "demo-1");

    expect(reserveId).toBe(keccak256(new TextEncoder().encode("dry-powder:web-demo:0x000000000000000000000000000000000000dEaD:demo-1")));
  });

  it("builds the ETH Aqua order around the Dry Powder opcode", () => {
    const reserveId = createReserveId("0x000000000000000000000000000000000000dEaD", "demo-1");
    const strategy = buildStrategy("eth", "0x000000000000000000000000000000000000dEaD", reserveId);

    const encodedOrder = encodeAbiParameters(
      [
        {
          type: "tuple",
          components: [
            { name: "maker", type: "address" },
            { name: "traits", type: "uint256" },
            { name: "data", type: "bytes" }
          ]
        }
      ],
      [strategy.order]
    );

    expect(strategy.order.maker).toBe("0x000000000000000000000000000000000000dEaD");
    expect(strategy.order.traits >> 254n).toBe(1n);
    expect(strategy.order.data).toContain(reserveId.slice(2));
    expect(strategy.strategyBytes).toBe(encodedOrder);
    expect(strategy.shipTokens).toEqual([TOKENS.mUSDC]);
    expect(strategy.shipAmounts).toEqual([parseUnits("18000", 6)]);
  });

  it("builds taker quotes against the stored maker, not the connected taker", () => {
    const maker = "0x000000000000000000000000000000000000dEaD";
    const taker = "0x000000000000000000000000000000000000bEEF";
    const reserveId = createReserveId(maker, "demo-1");
    const strategy = buildStrategy("eth", maker, reserveId);

    expect(strategy.order.maker).toBe(maker);
    expect(strategy.order.maker).not.toBe(taker);
  });

  it("builds a fill intent for any shipped strategy", () => {
    const maker = "0x000000000000000000000000000000000000dEaD";
    const reserveId = createReserveId(maker, "demo-1");

    const ethFill = buildFillIntent("eth", maker, reserveId, "123");
    const wbtcFill = buildFillIntent("wbtc", maker, reserveId, "456");
    const linkFill = buildFillIntent("link", maker, reserveId, "789");

    expect(ethFill.approvalToken).toBe(TOKENS.mETH);
    expect(wbtcFill.approvalToken).toBe(TOKENS.mWBTC);
    expect(linkFill.approvalToken).toBe(TOKENS.mLINK);
    expect(wbtcFill.order.maker).toBe(maker);
    expect(wbtcFill.fillAmount).toBe(usdc("456"));
    expect(linkFill.message).toBe("Executing LINK fill");
  });

  it("builds strategies for every mocked asset in the catalog", () => {
    const reserveId = createReserveId("0x000000000000000000000000000000000000dEaD", "demo-1");
    const keys = Object.keys(strategyInputs);

    expect(keys).toEqual(["eth", "wbtc", "link", "arb", "op", "bnb", "sol"]);
    expect(buildStrategy("arb", "0x000000000000000000000000000000000000dEaD", reserveId).shipTokens).toEqual([TOKENS.mUSDC]);
    expect(buildFillIntent("sol", "0x000000000000000000000000000000000000dEaD", reserveId, "321").approvalToken).toBe(TOKENS.mSOL);
  });

  it("classifies connected accounts relative to the selected maker", () => {
    const maker = "0x000000000000000000000000000000000000dEaD";

    expect(roleForAccount(maker, maker)).toBe("maker");
    expect(roleForAccount("0x000000000000000000000000000000000000bEEF", maker)).toBe("taker");
    expect(roleForAccount("0x000000000000000000000000000000000000bEEF", null)).toBe("maker");
  });

  it("uses the Aqua SDK to build ship transactions", () => {
    const reserveId = createReserveId("0x000000000000000000000000000000000000dEaD", "demo-1");
    const plan = buildSetupPlan("0x000000000000000000000000000000000000dEaD", reserveId);

    expect(plan.shipTransactions).toHaveLength(7);
    expect(plan.shipTransactions[0].to).toBe(AQUA_ADDRESS);
    expect(plan.shipTransactions[0].value).toBe(0n);
    expect(plan.shipTransactions[0].data.startsWith("0xf50b870f")).toBe(true);
    expect(plan.legs[0].spendCaps).toEqual([usdc("2000"), usdc("6000"), usdc("10000")]);
    expect(plan.legs[0].priceBps).toEqual([10000n, 8889n, 6667n]);
  });

  it("uses a custom per-asset ladder in strategy plan", () => {
    const reserveId = createReserveId("0x000000000000000000000000000000000000dEaD", "demo-1");
    const plan = buildStrategyPlan("0x000000000000000000000000000000000000dEaD", reserveId, "wbtc", {
      ladder: [
        { entryPrice: "65000", maxSpend: "4000" },
        { entryPrice: "60000", maxSpend: "3000" },
        { entryPrice: "45000", maxSpend: "3000" }
      ]
    });

    expect(plan.leg.maxSpend).toBe(usdc("10000"));
    expect(plan.leg.spendCaps).toEqual([usdc("4000"), usdc("7000"), usdc("10000")]);
    expect(plan.leg.priceBps).toEqual([10000n, 9231n, 6923n]);
  });

  it("uses custom first-row entry price when building a strategy plan", () => {
    const reserveId = createReserveId("0x000000000000000000000000000000000000dEaD", "demo-1");
    const plan = buildStrategyPlan("0x000000000000000000000000000000000000dEaD", reserveId, "link", {
      ladder: [
        { entryPrice: "18", maxSpend: "2500" },
        { entryPrice: "16", maxSpend: "1500" }
      ]
    });

    expect(formatUnits(plan.leg.maxSpend, 6)).toBe("4000");
    expect(formatUnits(plan.strategy.input.reserveAmount, 6)).toBe("9000");
  });

  it("uses the Aqua SDK to build dock transactions for strategy removal", () => {
    const reserveId = createReserveId("0x000000000000000000000000000000000000dEaD", "demo-1");
    const plan = buildSetupPlan("0x000000000000000000000000000000000000dEaD", reserveId);

    expect(plan.dockTransactions).toHaveLength(7);
    expect(plan.dockTransactions[0].to).toBe(AQUA_ADDRESS);
    expect(plan.dockTransactions[0].value).toBe(0n);
    expect(plan.dockTransactions[0].data.startsWith("0x28defc17")).toBe(true);
    expect(plan.dockTransactions[0].data).toContain(plan.strategies[0].strategyHash.slice(2));
  });

  it("formats and guards Sepolia gas balance before transactions", () => {
    expect(formatEthBalance(123456789000000000n)).toBe("0.123456 ETH");
    expect(() => assertHasSepoliaGas(0n)).toThrow("Connected Sepolia account has 0 ETH");
    expect(() => assertHasSepoliaGas(500000000000000n)).not.toThrow();
  });

  it("keeps configured addresses checksummed", () => {
    expect(AQUA_ADDRESS).toBe(getAddress(AQUA_ADDRESS));
    expect(DRY_POWDER_ROUTER).toBe(getAddress(DRY_POWDER_ROUTER));
    expect(Object.values(TOKENS).every((token) => token === getAddress(token))).toBe(true);
  });
});
