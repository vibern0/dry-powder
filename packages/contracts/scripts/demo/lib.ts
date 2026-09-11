import { ethers } from "hardhat";
import { BytesLike, Signer } from "ethers";

interface OrderStruct {
  maker: string;
  traits: bigint;
  data: string;
}

interface DemoStrategy {
  symbol: string;
  asset: any;
  assetAmount: bigint;
  reserveAmount: bigint;
  order: OrderStruct;
  exactOutTraits: string;
}

interface DemoEnvironment {
  owner: Signer;
  maker: Signer;
  taker: Signer;
  aqua: any;
  router: any;
  mUSDC: any;
  tokens: Record<string, any>;
  reserveId: string;
  strategies: Record<string, DemoStrategy>;
}

const assetSpecs = [
  { key: "eth", symbol: "ETH", mockSymbol: "mETH", name: "Mock Ether", decimals: 18, assetAmount: "10", reserveAmount: "18000", quoteOut: "1800", takerMint: "100", salt: 1n, ladder: [{ spend: "2000", priceBps: 10000 }, { spend: "4000", priceBps: 8889 }, { spend: "4000", priceBps: 6667 }] },
  { key: "wbtc", symbol: "WBTC", mockSymbol: "mWBTC", name: "Mock Wrapped Bitcoin", decimals: 8, assetAmount: "0.15384615", reserveAmount: "10000", quoteOut: "650", takerMint: "2", salt: 2n, ladder: [{ spend: "4000", priceBps: 10000 }, { spend: "3000", priceBps: 9231 }, { spend: "3000", priceBps: 6923 }] },
  { key: "link", symbol: "LINK", mockSymbol: "mLINK", name: "Mock Chainlink", decimals: 18, assetAmount: "500", reserveAmount: "10000", quoteOut: "200", takerMint: "100000", salt: 3n, ladder: [{ spend: "1400", priceBps: 10000 }, { spend: "1300", priceBps: 9500 }, { spend: "1300", priceBps: 9000 }] },
  { key: "arb", symbol: "ARB", mockSymbol: "mARB", name: "Mock Arbitrum", decimals: 18, assetAmount: "10000", reserveAmount: "12000", quoteOut: "300", takerMint: "25000", salt: 4n, ladder: [{ spend: "1000", priceBps: 10000 }, { spend: "1000", priceBps: 9500 }, { spend: "1000", priceBps: 9000 }] },
  { key: "op", symbol: "OP", mockSymbol: "mOP", name: "Mock Optimism", decimals: 18, assetAmount: "7000", reserveAmount: "13300", quoteOut: "250", takerMint: "20000", salt: 5n, ladder: [{ spend: "900", priceBps: 10000 }, { spend: "900", priceBps: 9500 }, { spend: "900", priceBps: 9000 }] },
  { key: "bnb", symbol: "BNB", mockSymbol: "mBNB", name: "Mock BNB", decimals: 18, assetAmount: "20", reserveAmount: "13000", quoteOut: "500", takerMint: "100", salt: 6n, ladder: [{ spend: "900", priceBps: 10000 }, { spend: "800", priceBps: 9500 }, { spend: "800", priceBps: 9000 }] },
  { key: "sol", symbol: "SOL", mockSymbol: "mSOL", name: "Mock Solana", decimals: 18, assetAmount: "80", reserveAmount: "14400", quoteOut: "450", takerMint: "1000", salt: 7n, ladder: [{ spend: "1200", priceBps: 10000 }, { spend: "1200", priceBps: 9500 }, { spend: "1100", priceBps: 9000 }] }
] as const;

function spendCaps(asset: typeof assetSpecs[number]) {
  let total = 0n;
  return asset.ladder.map((row) => {
    total += usdc(row.spend);
    return total;
  });
}

const DRY_POWDER_OPCODE = 0x34;
const SALT_OPCODE = 0x1e;
const LIMIT_SWAP_OPCODE = 0x15;
const USE_AQUA_INSTEAD_OF_SIGNATURE = 1n << 254n;
const ORDER_DATA_SLICES_INDEXES_BIT_OFFSET = 160n;
const TOKENS_PREFIX_LENGTH = 40;
const USE_TRANSFER_FROM_AND_AQUA_PUSH = 0x0040;
const IS_A_TO_B = 0x0080;
const RESERVE_ID = ethers.id("demo:reserve");

const usdc = (amount: string) => ethers.parseUnits(amount, 6);

function instruction(opcode: number, args: string): string {
  const body = args.startsWith("0x") ? args.slice(2) : args;
  return opcode.toString(16).padStart(2, "0") +
    (body.length / 2).toString(16).padStart(2, "0") +
    body;
}

function buildCustomInstruction(opcode: number, args: string): string {
  return "0x" + instruction(opcode, args);
}

function buildLimitProgram(direction: boolean): string {
  return "0x" + instruction(LIMIT_SWAP_OPCODE, direction ? "80" : "00");
}

function buildAquaOrder(args: { maker: string; tokenA: string; tokenB: string; program: BytesLike }): OrderStruct {
  const index0 = TOKENS_PREFIX_LENGTH;
  const orderDataIndexes =
    BigInt(index0) |
    (BigInt(index0) << 16n) |
    (BigInt(index0) << 32n) |
    (BigInt(index0) << 48n);

  return {
    maker: args.maker,
    traits: (orderDataIndexes << ORDER_DATA_SLICES_INDEXES_BIT_OFFSET) | USE_AQUA_INSTEAD_OF_SIGNATURE,
    data: ethers.hexlify(ethers.concat([
      ethers.zeroPadValue(args.tokenA, 20),
      ethers.zeroPadValue(args.tokenB, 20),
      args.program
    ]))
  };
}

function buildExactOutTakerTraits(isAToB: boolean): string {
  let flags = USE_TRANSFER_FROM_AND_AQUA_PUSH;
  if (isAToB) flags |= IS_A_TO_B;

  return ethers.hexlify(ethers.concat([
    ethers.zeroPadValue(ethers.toBeHex(0), 20),
    ethers.zeroPadValue(ethers.toBeHex(flags), 2)
  ]));
}

async function buildStrategy(args: {
  maker: string;
  symbol: string;
  asset: any;
  reserveToken: any;
  assetAmount: bigint;
  reserveAmount: bigint;
  salt: bigint;
}): Promise<DemoStrategy> {
  const asset = await args.asset.getAddress();
  const reserveToken = await args.reserveToken.getAddress();
  const tokenA = BigInt(asset) < BigInt(reserveToken) ? asset : reserveToken;
  const tokenB = tokenA === asset ? reserveToken : asset;
  const direction = BigInt(asset) < BigInt(reserveToken);
  const program = ethers.hexlify(ethers.concat([
    buildCustomInstruction(SALT_OPCODE, ethers.zeroPadValue(ethers.toBeHex(args.salt), 8)),
    buildCustomInstruction(DRY_POWDER_OPCODE, RESERVE_ID),
    buildLimitProgram(direction)
  ]));

  return {
    symbol: args.symbol,
    asset: args.asset,
    assetAmount: args.assetAmount,
    reserveAmount: args.reserveAmount,
    order: buildAquaOrder({ maker: args.maker, tokenA, tokenB, program }),
    exactOutTraits: buildExactOutTakerTraits(direction)
  };
}

async function deployLocal(): Promise<Omit<DemoEnvironment, "reserveId" | "strategies">> {
  const [owner, maker, taker] = await ethers.getSigners();

  const Aqua = await ethers.getContractFactory("Aqua");
  const aqua = await Aqua.deploy();
  const WETHMock = await ethers.getContractFactory("WETHMock");
  const weth = await WETHMock.deploy();
  const DryPowderRouter = await ethers.getContractFactory("DryPowderRouter");
  const router = await DryPowderRouter.deploy(await aqua.getAddress(), await weth.getAddress(), await owner.getAddress(), "DryPowderRouter", "1");

  const MockERC20 = await ethers.getContractFactory("MockERC20");
  const mUSDC = await MockERC20.deploy("Mock USDC", "mUSDC", 6);
  const tokens = Object.fromEntries(await Promise.all(assetSpecs.map(async (asset) => {
    const token = await MockERC20.deploy(asset.name, asset.mockSymbol, asset.decimals);
    return [asset.key, token];
  }))) as Record<string, any>;

  return { owner, maker, taker, aqua, router, mUSDC, tokens };
}

export async function setupDemoEnvironment(): Promise<DemoEnvironment> {
  const env = await deployLocal();
  const makerAddress = await env.maker.getAddress();
  const takerAddress = await env.taker.getAddress();

  await env.mUSDC.mint(makerAddress, usdc("10000"));
  await env.mUSDC.connect(env.maker).approve(await env.aqua.getAddress(), ethers.MaxUint256);
  for (const asset of assetSpecs) {
    await env.tokens[asset.key].mint(takerAddress, ethers.parseUnits(asset.takerMint, asset.decimals));
    await env.tokens[asset.key].connect(env.taker).approve(await env.router.getAddress(), ethers.MaxUint256);
  }

  await env.router.connect(env.maker).createReserve(RESERVE_ID, await env.mUSDC.getAddress(), usdc("10000"));
  for (const asset of assetSpecs) {
    await env.router.connect(env.maker).addLeg(
      RESERVE_ID,
      await env.tokens[asset.key].getAddress(),
      spendCaps(asset),
      asset.ladder.map((row) => row.priceBps)
    );
  }
  await env.router.connect(env.maker).activateReserve(RESERVE_ID);

  const strategies = Object.fromEntries(await Promise.all(assetSpecs.map(async (asset) => [asset.key, await buildStrategy({
      maker: makerAddress,
      symbol: asset.symbol,
      asset: env.tokens[asset.key],
      reserveToken: env.mUSDC,
      assetAmount: ethers.parseUnits(asset.assetAmount, asset.decimals),
      reserveAmount: usdc(asset.reserveAmount),
      salt: asset.salt
    })]))) as Record<string, DemoStrategy>;

  for (const strategy of Object.values(strategies)) {
    await env.aqua.connect(env.maker).ship(
      await env.router.getAddress(),
      ethers.AbiCoder.defaultAbiCoder().encode(["tuple(address maker, uint256 traits, bytes data)"], [strategy.order]),
      [await env.mUSDC.getAddress(), await strategy.asset.getAddress()],
      [strategy.reserveAmount, strategy.assetAmount]
    );
  }

  return { ...env, reserveId: RESERVE_ID, strategies };
}

function format(amount: bigint, decimals: number): string {
  return ethers.formatUnits(amount, decimals);
}

async function reserveLine(env: DemoEnvironment, label: string): Promise<string> {
  const reserve = await env.router.getReserve(await env.maker.getAddress(), env.reserveId);
  return `${label}: spent ${format(reserve.spent, 6)} / ${format(reserve.totalBudget, 6)} mUSDC`;
}

async function balanceLines(env: DemoEnvironment): Promise<string[]> {
  return [
    `Maker mUSDC: ${format(await env.mUSDC.balanceOf(await env.maker.getAddress()), 6)}`,
    `Taker mUSDC: ${format(await env.mUSDC.balanceOf(await env.taker.getAddress()), 6)}`
  ];
}

async function quoteLine(
  env: DemoEnvironment,
  label: string,
  strategy: DemoStrategy,
  desiredOut: bigint,
  assetDecimals: number,
  assetSymbol: string
): Promise<string> {
  const quote = await env.router.quote.staticCall(strategy.order, desiredOut, strategy.exactOutTraits);
  return `${label}: ${format(quote[0], assetDecimals)} ${assetSymbol} -> ${format(quote[1], 6)} mUSDC`;
}

async function quoteLines(
  env: DemoEnvironment,
  suffix: string,
  assets: readonly typeof assetSpecs[number][]
): Promise<string[]> {
  return Promise.all(assets.map((asset) => {
    return quoteLine(env, `${asset.symbol} ${suffix}`, env.strategies[asset.key], usdc(asset.quoteOut), asset.decimals, asset.mockSymbol);
  }));
}

export async function runSetupDemo(): Promise<string[]> {
  const env = await setupDemoEnvironment();
  return [
    "Dry Powder setup",
    `Router: ${await env.router.getAddress()}`,
    `Aqua: ${await env.aqua.getAddress()}`,
    await reserveLine(env, "Initial reserve")
  ];
}

export async function runQuoteDemo(): Promise<string[]> {
  const env = await setupDemoEnvironment();
  return [
    "Dry Powder quotes",
    ...(await quoteLines(env, "quote", assetSpecs))
  ];
}

export async function runFillDemo(): Promise<string[]> {
  const env = await setupDemoEnvironment();
  const before = await reserveLine(env, "Before ETH fill");
  await env.router.connect(env.taker).swap(env.strategies.eth.order, usdc("2000"), env.strategies.eth.exactOutTraits);
  return [
    "Dry Powder fill",
    before,
    "Filled ETH leg for 2000.0 mUSDC",
    await reserveLine(env, "After ETH fill"),
    ...(await balanceLines(env))
  ];
}

export async function runRepriceDemo(): Promise<string[]> {
  const env = await setupDemoEnvironment();
  await env.router.connect(env.taker).swap(env.strategies.eth.order, usdc("2000"), env.strategies.eth.exactOutTraits);
  return [
    "Dry Powder sibling repricing",
    await reserveLine(env, "After ETH fill"),
    ...(await quoteLines(env, "quote after ETH fill", assetSpecs.filter((asset) => asset.key !== "eth")))
  ];
}

export async function runFullDemo(): Promise<string[]> {
  const env = await setupDemoEnvironment();
  const lines = [
    "Dry Powder demo",
    await reserveLine(env, "Initial reserve"),
    ...(await quoteLines(env, "quote", assetSpecs)),
    "Fill ETH leg: 2000.0 mUSDC"
  ];

  await env.router.connect(env.taker).swap(env.strategies.eth.order, usdc("2000"), env.strategies.eth.exactOutTraits);
  lines.push(
    await reserveLine(env, "After ETH fill"),
    ...(await quoteLines(env, "quote after ETH fill", assetSpecs.filter((asset) => asset.key !== "eth"))),
    ...(await balanceLines(env))
  );

  return lines;
}

export async function printLines(lines: Promise<string[]> | string[]): Promise<void> {
  for (const line of await lines) {
    console.log(line);
  }
}
