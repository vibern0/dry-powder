import fs from "node:fs";
import path from "node:path";
import { ethers, network } from "hardhat";
import { BytesLike, NonceManager, Signer, Wallet } from "ethers";

const OFFICIAL_AQUA_REGISTRY = "0x1111113CCf1426A8E30e2bfF5E005d929bF6a90a";
const DEPLOYMENT_PATH = path.join(process.cwd(), "deployments", "sepolia.json");
const DRY_POWDER_OPCODE = 0x34;
const SALT_OPCODE = 0x1e;
const LIMIT_SWAP_OPCODE = 0x15;
const USE_AQUA_INSTEAD_OF_SIGNATURE = 1n << 254n;
const ORDER_DATA_SLICES_INDEXES_BIT_OFFSET = 160n;
const TOKENS_PREFIX_LENGTH = 40;
const USE_TRANSFER_FROM_AND_AQUA_PUSH = 0x0040;
const IS_A_TO_B = 0x0080;

export const RESERVE_ID = ethers.id("sepolia:dry-powder-demo");

interface OrderStruct {
  maker: string;
  traits: bigint;
  data: string;
}

interface DeploymentRecord {
  chainId: number;
  network: string;
  deployer: string;
  maker: string;
  aqua: string;
  dryPowderRouter: string;
  weth: string;
  tokens: {
    mUSDC: string;
    mETH: string;
    mWBTC: string;
    mLINK: string;
    mARB: string;
    mOP: string;
    mBNB: string;
    mSOL: string;
  };
  transactions: Record<string, string>;
}

interface StrategyRecord {
  key: string;
  label: string;
  asset: string;
  assetAmount: bigint;
  reserveAmount: bigint;
  salt: bigint;
  decimals: number;
  maxSpend: bigint;
  quoteOut: bigint;
  takerMintAmount: bigint;
  spendCaps: bigint[];
  priceBps: number[];
}

const assetSpecs = [
  { key: "eth", tokenKey: "mETH", label: "ETH", name: "Mock Ether", symbol: "mETH", decimals: 18, assetAmount: "10", reserveAmount: "18000", quoteOut: "1800", takerMint: "100", salt: 1n, ladder: [{ spend: "2000", priceBps: 10000 }, { spend: "4000", priceBps: 8889 }, { spend: "4000", priceBps: 6667 }] },
  { key: "wbtc", tokenKey: "mWBTC", label: "WBTC", name: "Mock Wrapped Bitcoin", symbol: "mWBTC", decimals: 8, assetAmount: "0.15384615", reserveAmount: "10000", quoteOut: "650", takerMint: "2", salt: 2n, ladder: [{ spend: "4000", priceBps: 10000 }, { spend: "3000", priceBps: 9231 }, { spend: "3000", priceBps: 6923 }] },
  { key: "link", tokenKey: "mLINK", label: "LINK", name: "Mock Chainlink", symbol: "mLINK", decimals: 18, assetAmount: "500", reserveAmount: "10000", quoteOut: "200", takerMint: "100000", salt: 3n, ladder: [{ spend: "1400", priceBps: 10000 }, { spend: "1300", priceBps: 9500 }, { spend: "1300", priceBps: 9000 }] },
  { key: "arb", tokenKey: "mARB", label: "ARB", name: "Mock Arbitrum", symbol: "mARB", decimals: 18, assetAmount: "10000", reserveAmount: "12000", quoteOut: "300", takerMint: "25000", salt: 4n, ladder: [{ spend: "1000", priceBps: 10000 }, { spend: "1000", priceBps: 9500 }, { spend: "1000", priceBps: 9000 }] },
  { key: "op", tokenKey: "mOP", label: "OP", name: "Mock Optimism", symbol: "mOP", decimals: 18, assetAmount: "7000", reserveAmount: "13300", quoteOut: "250", takerMint: "20000", salt: 5n, ladder: [{ spend: "900", priceBps: 10000 }, { spend: "900", priceBps: 9500 }, { spend: "900", priceBps: 9000 }] },
  { key: "bnb", tokenKey: "mBNB", label: "BNB", name: "Mock BNB", symbol: "mBNB", decimals: 18, assetAmount: "20", reserveAmount: "13000", quoteOut: "500", takerMint: "100", salt: 6n, ladder: [{ spend: "900", priceBps: 10000 }, { spend: "800", priceBps: 9500 }, { spend: "800", priceBps: 9000 }] },
  { key: "sol", tokenKey: "mSOL", label: "SOL", name: "Mock Solana", symbol: "mSOL", decimals: 18, assetAmount: "80", reserveAmount: "14400", quoteOut: "450", takerMint: "1000", salt: 7n, ladder: [{ spend: "1200", priceBps: 10000 }, { spend: "1200", priceBps: 9500 }, { spend: "1100", priceBps: 9000 }] }
] as const;

function spendCaps(asset: typeof assetSpecs[number]) {
  let total = 0n;
  return asset.ladder.map((row) => {
    total += usdc(row.spend);
    return total;
  });
}

export function requireSepolia() {
  if (network.config.chainId !== 11155111) {
    throw new Error(`Expected Sepolia chainId 11155111, got ${network.config.chainId ?? "unknown"}`);
  }
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing ${name}. Export it in your shell; this script does not read .env.`);
  }
  return value;
}

export async function getTaker(): Promise<Wallet> {
  return new ethers.Wallet(requireEnv("SEPOLIA_TAKER_PRIVATE_KEY"), ethers.provider);
}

export async function getDeploymentSigner(): Promise<Signer> {
  const [deployer] = await ethers.getSigners();
  if (!deployer) {
    throw new Error("Missing Sepolia deployer signer. Export SEPOLIA_DEPLOYER_PRIVATE_KEY.");
  }
  return deployer;
}

export async function assertAquaPresent() {
  const code = await ethers.provider.getCode(OFFICIAL_AQUA_REGISTRY);
  if (code === "0x") {
    throw new Error(`No Aqua bytecode at ${OFFICIAL_AQUA_REGISTRY} on Sepolia. Re-check official Aqua testnet deployment before continuing.`);
  }
}

export function loadDeployment(): DeploymentRecord {
  return JSON.parse(fs.readFileSync(DEPLOYMENT_PATH, "utf8")) as DeploymentRecord;
}

export function saveDeployment(record: DeploymentRecord) {
  fs.mkdirSync(path.dirname(DEPLOYMENT_PATH), { recursive: true });
  fs.writeFileSync(DEPLOYMENT_PATH, `${JSON.stringify(record, null, 2)}\n`);
}

export async function deploySepoliaContracts(): Promise<string[]> {
  requireSepolia();
  await assertAquaPresent();
  const deployer = new NonceManager(await getDeploymentSigner());
  const deployerAddress = await deployer.getAddress();

  const WETHMock = await ethers.getContractFactory("WETHMock");
  const weth = await WETHMock.connect(deployer).deploy();
  await weth.waitForDeployment();

  const DryPowderRouter = await ethers.getContractFactory("DryPowderRouter");
  const router = await DryPowderRouter.connect(deployer).deploy(
    OFFICIAL_AQUA_REGISTRY,
    await weth.getAddress(),
    deployerAddress,
    "DryPowderRouter",
    "1"
  );
  await router.waitForDeployment();

  const MockERC20 = await ethers.getContractFactory("MockERC20");
  const mUSDC = await MockERC20.connect(deployer).deploy("Mock USDC", "mUSDC", 6);
  await mUSDC.waitForDeployment();
  const assetTokens: Record<string, any> = {};
  for (const asset of assetSpecs) {
    const token = await MockERC20.connect(deployer).deploy(asset.name, asset.symbol, asset.decimals);
    await token.waitForDeployment();
    assetTokens[asset.tokenKey] = token;
  }
  const tokenAddresses = Object.fromEntries(await Promise.all(Object.entries(assetTokens).map(async ([key, token]) => [key, await token.getAddress()]))) as Record<string, string>;

  saveDeployment({
    chainId: 11155111,
    network: "sepolia",
    deployer: deployerAddress,
    maker: deployerAddress,
    aqua: OFFICIAL_AQUA_REGISTRY,
    dryPowderRouter: await router.getAddress(),
    weth: await weth.getAddress(),
    tokens: {
      mUSDC: await mUSDC.getAddress(),
      ...tokenAddresses
    } as DeploymentRecord["tokens"],
    transactions: {
      weth: weth.deploymentTransaction()?.hash ?? "",
      dryPowderRouter: router.deploymentTransaction()?.hash ?? "",
      mUSDC: mUSDC.deploymentTransaction()?.hash ?? "",
      ...Object.fromEntries(Object.entries(assetTokens).map(([key, token]) => [key, token.deploymentTransaction()?.hash ?? ""]))
    }
  });

  return [
    "Sepolia Dry Powder deploy",
    `Aqua: ${OFFICIAL_AQUA_REGISTRY}`,
    `DryPowderRouter: ${await router.getAddress()}`,
    `mUSDC: ${await mUSDC.getAddress()}`,
    ...assetSpecs.map((asset) => `${asset.tokenKey}: ${tokenAddresses[asset.tokenKey]}`)
  ];
}

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

export function usdc(amount: string): bigint {
  return ethers.parseUnits(amount, 6);
}

export function strategyInputs(deployment = loadDeployment()): StrategyRecord[] {
  return assetSpecs.map((asset) => ({
    key: asset.key,
    label: asset.label,
    asset: deployment.tokens[asset.tokenKey],
    assetAmount: ethers.parseUnits(asset.assetAmount, asset.decimals),
    reserveAmount: usdc(asset.reserveAmount),
    salt: asset.salt,
    decimals: asset.decimals,
    maxSpend: spendCaps(asset)[asset.ladder.length - 1],
    quoteOut: usdc(asset.quoteOut),
    takerMintAmount: ethers.parseUnits(asset.takerMint, asset.decimals),
    spendCaps: spendCaps(asset),
    priceBps: asset.ladder.map((row) => row.priceBps)
  }));
}

export function buildStrategy(deployment: DeploymentRecord, input: StrategyRecord): { order: OrderStruct; exactOutTraits: string } {
  const tokenA = BigInt(input.asset) < BigInt(deployment.tokens.mUSDC) ? input.asset : deployment.tokens.mUSDC;
  const tokenB = tokenA === input.asset ? deployment.tokens.mUSDC : input.asset;
  const direction = BigInt(input.asset) < BigInt(deployment.tokens.mUSDC);
  const program = ethers.hexlify(ethers.concat([
    buildCustomInstruction(SALT_OPCODE, ethers.zeroPadValue(ethers.toBeHex(input.salt), 8)),
    buildCustomInstruction(DRY_POWDER_OPCODE, RESERVE_ID),
    buildLimitProgram(direction)
  ]));

  return {
    order: buildAquaOrder({ maker: deployment.maker, tokenA, tokenB, program }),
    exactOutTraits: buildExactOutTakerTraits(direction)
  };
}

export async function contracts(deployment = loadDeployment()) {
  const router = await ethers.getContractAt("DryPowderRouter", deployment.dryPowderRouter);
  const aqua = await ethers.getContractAt("Aqua", deployment.aqua);
  const mUSDC = await ethers.getContractAt("MockERC20", deployment.tokens.mUSDC);
  const assetTokens = Object.fromEntries(await Promise.all(assetSpecs.map(async (asset) => [asset.key, await ethers.getContractAt("MockERC20", deployment.tokens[asset.tokenKey])])));
  return { router, aqua, mUSDC, assetTokens };
}

export async function setupSepoliaDemo(): Promise<string[]> {
  requireSepolia();
  const deployment = loadDeployment();
  const signer = new NonceManager(await getDeploymentSigner());
  const taker = await getTaker();
  const { router, aqua, mUSDC, assetTokens } = await contracts(deployment);

  await (await mUSDC.connect(signer).mint(deployment.maker, usdc("10000"))).wait();
  for (const input of strategyInputs(deployment)) {
    await (await assetTokens[input.key].connect(signer).mint(taker.address, input.takerMintAmount)).wait();
  }
  await (await mUSDC.connect(signer).approve(deployment.aqua, ethers.MaxUint256)).wait();

  await (await router.connect(signer).createReserve(RESERVE_ID, deployment.tokens.mUSDC, usdc("10000"))).wait();
  for (const input of strategyInputs(deployment)) {
    await (await router.connect(signer).addLeg(RESERVE_ID, input.asset, input.spendCaps, input.priceBps)).wait();
  }
  await (await router.connect(signer).activateReserve(RESERVE_ID)).wait();

  for (const input of strategyInputs(deployment)) {
    const strategy = buildStrategy(deployment, input);
    await (await aqua.connect(signer).ship(
      deployment.dryPowderRouter,
      ethers.AbiCoder.defaultAbiCoder().encode(["tuple(address maker, uint256 traits, bytes data)"], [strategy.order]),
      [deployment.tokens.mUSDC, input.asset],
      [input.reserveAmount, input.assetAmount]
    )).wait();
  }

  return [
    "Sepolia Dry Powder setup",
    `Maker: ${deployment.maker}`,
    `Taker: ${taker.address}`,
    await reserveLine("Initial reserve", deployment)
  ];
}

export async function reserveLine(label: string, deployment = loadDeployment()): Promise<string> {
  const { router } = await contracts(deployment);
  const reserve = await router.getReserve(deployment.maker, RESERVE_ID);
  return `${label}: spent ${ethers.formatUnits(reserve.spent, 6)} / ${ethers.formatUnits(reserve.totalBudget, 6)} mUSDC`;
}

export async function quoteLine(label: string, input: StrategyRecord, desiredOut: bigint, deployment = loadDeployment()): Promise<string> {
  const { router } = await contracts(deployment);
  const strategy = buildStrategy(deployment, input);
  const quote = await router.quote.staticCall(strategy.order, desiredOut, strategy.exactOutTraits);
  return `${label}: ${ethers.formatUnits(quote[0], input.decimals)} m${input.label} -> ${ethers.formatUnits(quote[1], 6)} mUSDC`;
}

export async function quoteSepoliaDemo(): Promise<string[]> {
  requireSepolia();
  const deployment = loadDeployment();
  const inputs = strategyInputs(deployment);
  return [
    "Sepolia Dry Powder quotes",
    await reserveLine("Current reserve", deployment),
    ...(await Promise.all(inputs.map((input) => quoteLine(`${input.label} quote`, input, input.quoteOut, deployment))))
  ];
}

export async function fillSepoliaEth(): Promise<string[]> {
  requireSepolia();
  const deployment = loadDeployment();
  const taker = await getTaker();
  const { router, mUSDC, assetTokens } = await contracts(deployment);
  const [eth] = strategyInputs(deployment);
  const strategy = buildStrategy(deployment, eth);
  const beforeMaker = await mUSDC.balanceOf(deployment.maker);
  const beforeTaker = await mUSDC.balanceOf(taker.address);

  await (await assetTokens[eth.key].connect(taker).approve(deployment.dryPowderRouter, ethers.MaxUint256)).wait();
  await (await router.connect(taker).swap(strategy.order, usdc("2000"), strategy.exactOutTraits)).wait();

  return [
    "Sepolia Dry Powder ETH fill",
    await reserveLine("After ETH fill", deployment),
    `Maker mUSDC: ${ethers.formatUnits(beforeMaker, 6)} -> ${ethers.formatUnits(await mUSDC.balanceOf(deployment.maker), 6)}`,
    `Taker mUSDC: ${ethers.formatUnits(beforeTaker, 6)} -> ${ethers.formatUnits(await mUSDC.balanceOf(taker.address), 6)}`
  ];
}

export async function repriceSepoliaDemo(): Promise<string[]> {
  requireSepolia();
  const deployment = loadDeployment();
  const inputs = strategyInputs(deployment).filter((input) => input.key !== "eth");
  return [
    "Sepolia Dry Powder sibling repricing",
    await reserveLine("Current reserve", deployment),
    ...(await Promise.all(inputs.map((input) => quoteLine(`${input.label} quote after ETH fill`, input, input.quoteOut, deployment))))
  ];
}

export async function printLines(lines: Promise<string[]> | string[]) {
  for (const line of await lines) {
    console.log(line);
  }
}
