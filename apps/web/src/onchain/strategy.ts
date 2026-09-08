import { Address as OneInchAddress, AquaProtocolContract, HexString } from "@1inch/aqua-sdk";
import {
  concatHex,
  encodeAbiParameters,
  keccak256,
  numberToHex,
  padHex,
  parseUnits,
  stringToBytes,
  type Address,
  type Hex
} from "viem";
import {
  AQUA_ADDRESS,
  DRY_POWDER_OPCODE,
  DRY_POWDER_ROUTER,
  IS_A_TO_B,
  LIMIT_SWAP_OPCODE,
  ORDER_DATA_SLICES_INDEXES_BIT_OFFSET,
  SALT_OPCODE,
  TOKENS,
  TOKENS_PREFIX_LENGTH,
  USE_AQUA_INSTEAD_OF_SIGNATURE,
  USE_TRANSFER_FROM_AND_AQUA_PUSH
} from "./constants";

export type LegKey = "eth" | "wbtc" | "link";

export type Order = {
  maker: Address;
  traits: bigint;
  data: Hex;
};

type StrategyInput = {
  key: LegKey;
  label: string;
  asset: Address;
  assetAmount: bigint;
  reserveAmount: bigint;
  salt: bigint;
  decimals: number;
  fillAmount: bigint;
};

export type BuiltStrategy = {
  input: StrategyInput;
  order: Order;
  exactOutTraits: Hex;
  strategyBytes: Hex;
  strategyHash: Hex;
  shipTokens: Address[];
  shipAmounts: bigint[];
};

export const strategyInputs: Record<LegKey, StrategyInput> = {
  eth: {
    key: "eth",
    label: "ETH",
    asset: TOKENS.mETH,
    assetAmount: parseUnits("10", 18),
    reserveAmount: usdc("27000"),
    salt: 1n,
    decimals: 18,
    fillAmount: usdc("4000")
  },
  wbtc: {
    key: "wbtc",
    label: "WBTC",
    asset: TOKENS.mWBTC,
    assetAmount: parseUnits("0.125", 8),
    reserveAmount: usdc("10000"),
    salt: 2n,
    decimals: 8,
    fillAmount: usdc("800")
  },
  link: {
    key: "link",
    label: "LINK",
    asset: TOKENS.mLINK,
    assetAmount: parseUnits("500", 18),
    reserveAmount: usdc("10000"),
    salt: 3n,
    decimals: 18,
    fillAmount: usdc("200")
  }
};

export function usdc(amount: string) {
  return parseUnits(amount, 6);
}

export function createReserveId(maker: Address, nonce: string): Hex {
  return keccak256(stringToBytes(`dry-powder:web-demo:${maker}:${nonce}`));
}

export function buildStrategy(key: LegKey, maker: Address, reserveId: Hex): BuiltStrategy {
  const input = strategyInputs[key];
  const tokenA = BigInt(input.asset) < BigInt(TOKENS.mUSDC) ? input.asset : TOKENS.mUSDC;
  const tokenB = tokenA === input.asset ? TOKENS.mUSDC : input.asset;
  const direction = BigInt(input.asset) < BigInt(TOKENS.mUSDC);
  const program = concatHex([
    buildCustomInstruction(SALT_OPCODE, padHex(numberToHex(input.salt), { size: 8 })),
    buildCustomInstruction(DRY_POWDER_OPCODE, reserveId),
    buildLimitProgram(direction)
  ]);
  const order: Order = {
    maker,
    traits: buildAquaTraits(),
    data: concatHex([padHex(tokenA, { size: 20 }), padHex(tokenB, { size: 20 }), program])
  };
  const strategyBytes = encodeAbiParameters(
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
    [order]
  );

  return {
    input,
    order,
    exactOutTraits: buildExactOutTakerTraits(direction),
    strategyBytes,
    strategyHash: keccak256(strategyBytes),
    shipTokens: [TOKENS.mUSDC, input.asset],
    shipAmounts: [input.reserveAmount, input.assetAmount]
  };
}

export function buildSetupPlan(maker: Address, reserveId: Hex) {
  const strategies = (Object.keys(strategyInputs) as LegKey[]).map((key) => buildStrategy(key, maker, reserveId));
  const aqua = new AquaProtocolContract(new OneInchAddress(AQUA_ADDRESS));

  return {
    totalBudget: usdc("10000"),
    reserveThresholds: [usdc("4000"), usdc("7500"), usdc("10000")],
    multipliersBps: [10000n, 9500n, 9000n],
    legs: [
      { token: TOKENS.mETH, maxSpend: usdc("6000") },
      { token: TOKENS.mWBTC, maxSpend: usdc("6000") },
      { token: TOKENS.mLINK, maxSpend: usdc("4000") }
    ],
    strategies,
    shipTransactions: strategies.map((strategy) =>
      aqua.ship({
        app: new OneInchAddress(DRY_POWDER_ROUTER),
        strategy: new HexString(strategy.strategyBytes),
        amountsAndTokens: strategy.shipTokens.map((token, index) => ({
          token: new OneInchAddress(token),
          amount: strategy.shipAmounts[index]
        }))
      })
    )
  };
}

function buildAquaTraits() {
  const index0 = TOKENS_PREFIX_LENGTH;
  const orderDataIndexes =
    BigInt(index0) |
    (BigInt(index0) << 16n) |
    (BigInt(index0) << 32n) |
    (BigInt(index0) << 48n);

  return (orderDataIndexes << ORDER_DATA_SLICES_INDEXES_BIT_OFFSET) | USE_AQUA_INSTEAD_OF_SIGNATURE;
}

function buildCustomInstruction(opcode: number, args: Hex): Hex {
  return instruction(opcode, args);
}

function buildLimitProgram(direction: boolean): Hex {
  return instruction(LIMIT_SWAP_OPCODE, direction ? "0x80" : "0x00");
}

function instruction(opcode: number, args: Hex): Hex {
  const body = args.slice(2);
  const length = body.length / 2;
  return `0x${opcode.toString(16).padStart(2, "0")}${length.toString(16).padStart(2, "0")}${body}`;
}

function buildExactOutTakerTraits(isAToB: boolean): Hex {
  let flags = USE_TRANSFER_FROM_AND_AQUA_PUSH;
  if (isAToB) flags |= IS_A_TO_B;

  return concatHex([padHex(numberToHex(0), { size: 20 }), padHex(numberToHex(flags), { size: 2 })]);
}
