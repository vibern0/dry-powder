import { describe, expect, it } from "vitest";
import { encodeAbiParameters, keccak256, parseUnits } from "viem";
import { AQUA_ADDRESS, DRY_POWDER_ROUTER, TOKENS } from "./onchain/constants";
import { assertHasSepoliaGas, buildSetupPlan, buildStrategy, createReserveId, formatEthBalance, usdc } from "./onchain/strategy";

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
    expect(strategy.shipTokens).toEqual([TOKENS.mUSDC, TOKENS.mETH]);
    expect(strategy.shipAmounts).toEqual([parseUnits("27000", 6), parseUnits("10", 18)]);
  });

  it("uses the Aqua SDK to build ship transactions", () => {
    const reserveId = createReserveId("0x000000000000000000000000000000000000dEaD", "demo-1");
    const plan = buildSetupPlan("0x000000000000000000000000000000000000dEaD", reserveId);

    expect(plan.shipTransactions).toHaveLength(3);
    expect(plan.shipTransactions[0].to).toBe(AQUA_ADDRESS);
    expect(plan.shipTransactions[0].value).toBe(0n);
    expect(plan.shipTransactions[0].data.startsWith("0xf50b870f")).toBe(true);
    expect(plan.reserveThresholds).toEqual([usdc("4000"), usdc("7500"), usdc("10000")]);
  });

  it("uses the Aqua SDK to build dock transactions for strategy removal", () => {
    const reserveId = createReserveId("0x000000000000000000000000000000000000dEaD", "demo-1");
    const plan = buildSetupPlan("0x000000000000000000000000000000000000dEaD", reserveId);

    expect(plan.dockTransactions).toHaveLength(3);
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
});
