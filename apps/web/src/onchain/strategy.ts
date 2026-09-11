import { Address as OneInchAddress, AquaProtocolContract, HexString } from "@1inch/aqua-sdk";
import {
  concatHex,
  encodeAbiParameters,
  keccak256,
  getAddress,
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
import { assetCatalog, type AssetKey } from "../assets";

export type LegKey = AssetKey;

export type Order = {
  maker: Address;
  traits: bigint;
  data: Hex;
};

export type StrategyInput = {
  key: LegKey;
  label: string;
  asset: Address;
  assetAmount: bigint;
  reserveAmount: bigint;
  salt: bigint;
  decimals: number;
  fillAmount: bigint;
  maxSpend: bigint;
  takerMintAmount: bigint;
  ladder: StrategyLadderInput[];
};

export type StrategyPlanInput = {
  ladder?: StrategyLadderInput[];
};

export type StrategyLadderInput = {
  entryPrice: string;
  maxSpend: string;
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

export type FillIntent = {
  key: LegKey;
  label: string;
  approvalToken: Address;
  order: Order;
  exactOutTraits: Hex;
  fillAmount: bigint;
  message: string;
};

export type StrategyPlan = {
  leg: { token: Address; maxSpend: bigint; spendCaps: bigint[]; priceBps: bigint[] };
  strategy: BuiltStrategy;
  shipTransaction: { to: Address; data: Hex; value: bigint };
  dockTransaction: { to: Address; data: Hex; value: bigint };
};

export function usdc(amount: string) {
  return parseUnits(amount, 6);
}

export const strategyInputs = Object.fromEntries(
  assetCatalog.map((asset) => [asset.key, {
    key: asset.key,
    label: asset.symbol,
    asset: asset.token,
    assetAmount: parseUnits(asset.assetAmount, asset.decimals),
    reserveAmount: usdc(asset.reserveAmount),
    salt: asset.salt,
    decimals: asset.decimals,
    fillAmount: usdc(asset.fillAmount),
    maxSpend: usdc(asset.maxSpend),
    takerMintAmount: parseUnits(asset.takerMintAmount, asset.decimals),
    ladder: asset.ladder.map((row) => ({ ...row }))
  }])
) as unknown as Record<LegKey, StrategyInput>;

export const strategyKeys = assetCatalog.map((asset) => asset.key);

export function formatEthBalance(balance: bigint) {
  const integer = balance / 10n ** 18n;
  const fractional = ((balance % 10n ** 18n) / 10n ** 12n).toString().padStart(6, "0");
  return `${integer}.${fractional} ETH`;
}

export function assertHasSepoliaGas(balance: bigint) {
  if (balance === 0n) {
    throw new Error("Connected Sepolia account has 0 ETH for gas. Check that MetaMask is using the funded Sepolia account.");
  }
}

export function roleForAccount(account: Address, maker: Address | null) {
  if (!maker || getAddress(account) === getAddress(maker)) return "maker";
  return "taker";
}

export function createReserveId(maker: Address, nonce: string): Hex {
  return keccak256(stringToBytes(`dry-powder:web-demo:${maker}:${nonce}`));
}

export function buildStrategy(key: LegKey, maker: Address, reserveId: Hex, overrides: StrategyPlanInput = {}): BuiltStrategy {
  const baseInput = strategyInputs[key];
  if (!baseInput) throw new Error(`Unknown strategy asset: ${key}`);
  const ladder = overrides.ladder ?? baseInput.ladder;
  const input = {
    ...baseInput,
    reserveAmount: quoteReserveAmount(baseInput.assetAmount, baseInput.decimals, ladder[0].entryPrice)
  };
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

export function buildFillIntent(key: LegKey, maker: Address, reserveId: Hex, reserveAmount: string): FillIntent {
  const strategy = buildStrategy(key, maker, reserveId);

  return {
    key,
    label: strategy.input.label,
    approvalToken: strategy.input.asset,
    order: strategy.order,
    exactOutTraits: strategy.exactOutTraits,
    fillAmount: usdc(reserveAmount),
    message: `Executing ${strategy.input.label} fill`
  };
}

export function buildStrategyPlan(maker: Address, reserveId: Hex, key: LegKey, overrides: StrategyPlanInput = {}): StrategyPlan {
  const strategy = buildStrategy(key, maker, reserveId, overrides);
  const aqua = new AquaProtocolContract(new OneInchAddress(AQUA_ADDRESS));
  const leg = buildLegLadder(strategy.input.asset, overrides.ladder ?? strategy.input.ladder);

  const shipTransaction = aqua.ship({
    app: new OneInchAddress(DRY_POWDER_ROUTER),
    strategy: new HexString(strategy.strategyBytes),
    amountsAndTokens: strategy.shipTokens.map((token, index) => ({
      token: new OneInchAddress(token),
      amount: strategy.shipAmounts[index]
    }))
  });
  const dockTransaction = aqua.dock({
    app: new OneInchAddress(DRY_POWDER_ROUTER),
    strategyHash: new HexString(strategy.strategyHash),
    tokens: strategy.shipTokens.map((token) => new OneInchAddress(token))
  });

  return {
    leg,
    strategy,
    shipTransaction: { ...shipTransaction, to: getAddress(shipTransaction.to) },
    dockTransaction: { ...dockTransaction, to: getAddress(dockTransaction.to) }
  };
}

function quoteReserveAmount(assetAmount: bigint, assetDecimals: number, maxPrice: string) {
  return (assetAmount * usdc(maxPrice)) / 10n ** BigInt(assetDecimals);
}

export function buildSetupPlan(maker: Address, reserveId: Hex) {
  const plans = strategyKeys.map((key) => buildStrategyPlan(maker, reserveId, key));

  return {
    totalBudget: usdc("10000"),
    legs: plans.map((plan) => plan.leg),
    strategies: plans.map((plan) => plan.strategy),
    shipTransactions: plans.map((plan) => plan.shipTransaction),
    dockTransactions: plans.map((plan) => plan.dockTransaction)
  };
}

export function buildLegLadder(token: Address, ladder: StrategyLadderInput[]) {
  let cumulativeMaxSpend = 0n;
  const firstPrice = Number(ladder[0]?.entryPrice ?? "0");
  const spendCaps = ladder.map((row) => {
    cumulativeMaxSpend += usdc(row.maxSpend);
    return cumulativeMaxSpend;
  });
  const priceBps = ladder.map((row, index) => index === 0 ? 10000n : BigInt(Math.round((Number(row.entryPrice) / firstPrice) * 10000)));

  return {
    token,
    maxSpend: cumulativeMaxSpend,
    spendCaps,
    priceBps
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
