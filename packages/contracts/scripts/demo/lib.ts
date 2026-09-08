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
  mETH: any;
  mWBTC: any;
  mLINK: any;
  reserveId: string;
  strategies: {
    eth: DemoStrategy;
    wbtc: DemoStrategy;
    link: DemoStrategy;
  };
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
  const mETH = await MockERC20.deploy("Mock Ether", "mETH", 18);
  const mWBTC = await MockERC20.deploy("Mock Wrapped Bitcoin", "mWBTC", 8);
  const mLINK = await MockERC20.deploy("Mock Chainlink", "mLINK", 18);

  return { owner, maker, taker, aqua, router, mUSDC, mETH, mWBTC, mLINK };
}

export async function setupDemoEnvironment(): Promise<DemoEnvironment> {
  const env = await deployLocal();
  const makerAddress = await env.maker.getAddress();
  const takerAddress = await env.taker.getAddress();

  await env.mUSDC.mint(makerAddress, usdc("10000"));
  await env.mETH.mint(takerAddress, ethers.parseEther("100"));
  await env.mWBTC.mint(takerAddress, ethers.parseUnits("2", 8));
  await env.mLINK.mint(takerAddress, ethers.parseEther("100000"));
  await env.mUSDC.connect(env.maker).approve(await env.aqua.getAddress(), ethers.MaxUint256);
  await env.mETH.connect(env.taker).approve(await env.router.getAddress(), ethers.MaxUint256);
  await env.mWBTC.connect(env.taker).approve(await env.router.getAddress(), ethers.MaxUint256);
  await env.mLINK.connect(env.taker).approve(await env.router.getAddress(), ethers.MaxUint256);

  await env.router.connect(env.maker).createReserve(
    RESERVE_ID,
    await env.mUSDC.getAddress(),
    usdc("10000"),
    [usdc("4000"), usdc("7500"), usdc("10000")],
    [10000, 9500, 9000]
  );
  await env.router.connect(env.maker).addLeg(RESERVE_ID, await env.mETH.getAddress(), usdc("6000"));
  await env.router.connect(env.maker).addLeg(RESERVE_ID, await env.mWBTC.getAddress(), usdc("6000"));
  await env.router.connect(env.maker).addLeg(RESERVE_ID, await env.mLINK.getAddress(), usdc("4000"));
  await env.router.connect(env.maker).activateReserve(RESERVE_ID);

  const strategies = {
    eth: await buildStrategy({
      maker: makerAddress,
      symbol: "ETH",
      asset: env.mETH,
      reserveToken: env.mUSDC,
      assetAmount: ethers.parseEther("10"),
      reserveAmount: usdc("27000"),
      salt: 1n
    }),
    wbtc: await buildStrategy({
      maker: makerAddress,
      symbol: "WBTC",
      asset: env.mWBTC,
      reserveToken: env.mUSDC,
      assetAmount: ethers.parseUnits("0.125", 8),
      reserveAmount: usdc("10000"),
      salt: 2n
    }),
    link: await buildStrategy({
      maker: makerAddress,
      symbol: "LINK",
      asset: env.mLINK,
      reserveToken: env.mUSDC,
      assetAmount: ethers.parseEther("500"),
      reserveAmount: usdc("10000"),
      salt: 3n
    })
  };

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
    await quoteLine(env, "ETH quote", env.strategies.eth, usdc("2700"), 18, "mETH"),
    await quoteLine(env, "WBTC quote", env.strategies.wbtc, usdc("800"), 8, "mWBTC"),
    await quoteLine(env, "LINK quote", env.strategies.link, usdc("200"), 18, "mLINK")
  ];
}

export async function runFillDemo(): Promise<string[]> {
  const env = await setupDemoEnvironment();
  const before = await reserveLine(env, "Before ETH fill");
  await env.router.connect(env.taker).swap(env.strategies.eth.order, usdc("4000"), env.strategies.eth.exactOutTraits);
  return [
    "Dry Powder fill",
    before,
    "Filled ETH leg for 4000.0 mUSDC",
    await reserveLine(env, "After ETH fill"),
    ...(await balanceLines(env))
  ];
}

export async function runRepriceDemo(): Promise<string[]> {
  const env = await setupDemoEnvironment();
  await env.router.connect(env.taker).swap(env.strategies.eth.order, usdc("4000"), env.strategies.eth.exactOutTraits);
  return [
    "Dry Powder sibling repricing",
    await reserveLine(env, "After ETH fill"),
    await quoteLine(env, "WBTC quote after ETH fill", env.strategies.wbtc, usdc("760"), 8, "mWBTC"),
    await quoteLine(env, "LINK quote after ETH fill", env.strategies.link, usdc("190"), 18, "mLINK")
  ];
}

export async function runFullDemo(): Promise<string[]> {
  const env = await setupDemoEnvironment();
  const lines = [
    "Dry Powder demo",
    await reserveLine(env, "Initial reserve"),
    await quoteLine(env, "ETH quote", env.strategies.eth, usdc("2700"), 18, "mETH"),
    await quoteLine(env, "WBTC quote", env.strategies.wbtc, usdc("800"), 8, "mWBTC"),
    await quoteLine(env, "LINK quote", env.strategies.link, usdc("200"), 18, "mLINK"),
    "Fill ETH leg: 4000.0 mUSDC"
  ];

  await env.router.connect(env.taker).swap(env.strategies.eth.order, usdc("4000"), env.strategies.eth.exactOutTraits);
  lines.push(
    await reserveLine(env, "After ETH fill"),
    await quoteLine(env, "WBTC quote after ETH fill", env.strategies.wbtc, usdc("760"), 8, "mWBTC"),
    await quoteLine(env, "LINK quote after ETH fill", env.strategies.link, usdc("190"), 18, "mLINK"),
    ...(await balanceLines(env))
  );

  return lines;
}

export async function printLines(lines: Promise<string[]> | string[]): Promise<void> {
  for (const line of await lines) {
    console.log(line);
  }
}
