import fs from "node:fs";
import path from "node:path";
import { ethers, network } from "hardhat";
import { BytesLike, Signer, Wallet } from "ethers";

const OFFICIAL_AQUA_REGISTRY = "0x1111113ccf1426a8e30e2bff5e005d929bf6a90a";
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
  };
  transactions: Record<string, string>;
}

interface StrategyRecord {
  key: "eth" | "wbtc" | "link";
  label: string;
  asset: string;
  assetAmount: bigint;
  reserveAmount: bigint;
  salt: bigint;
  decimals: number;
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
  const deployer = await getDeploymentSigner();
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
  const mETH = await MockERC20.connect(deployer).deploy("Mock Ether", "mETH", 18);
  await mETH.waitForDeployment();
  const mWBTC = await MockERC20.connect(deployer).deploy("Mock Wrapped Bitcoin", "mWBTC", 8);
  await mWBTC.waitForDeployment();
  const mLINK = await MockERC20.connect(deployer).deploy("Mock Chainlink", "mLINK", 18);
  await mLINK.waitForDeployment();

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
      mETH: await mETH.getAddress(),
      mWBTC: await mWBTC.getAddress(),
      mLINK: await mLINK.getAddress()
    },
    transactions: {
      weth: weth.deploymentTransaction()?.hash ?? "",
      dryPowderRouter: router.deploymentTransaction()?.hash ?? "",
      mUSDC: mUSDC.deploymentTransaction()?.hash ?? "",
      mETH: mETH.deploymentTransaction()?.hash ?? "",
      mWBTC: mWBTC.deploymentTransaction()?.hash ?? "",
      mLINK: mLINK.deploymentTransaction()?.hash ?? ""
    }
  });

  return [
    "Sepolia Dry Powder deploy",
    `Aqua: ${OFFICIAL_AQUA_REGISTRY}`,
    `DryPowderRouter: ${await router.getAddress()}`,
    `mUSDC: ${await mUSDC.getAddress()}`,
    `mETH: ${await mETH.getAddress()}`,
    `mWBTC: ${await mWBTC.getAddress()}`,
    `mLINK: ${await mLINK.getAddress()}`
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
  return [
    { key: "eth", label: "ETH", asset: deployment.tokens.mETH, assetAmount: ethers.parseEther("10"), reserveAmount: usdc("27000"), salt: 1n, decimals: 18 },
    { key: "wbtc", label: "WBTC", asset: deployment.tokens.mWBTC, assetAmount: ethers.parseUnits("0.125", 8), reserveAmount: usdc("10000"), salt: 2n, decimals: 8 },
    { key: "link", label: "LINK", asset: deployment.tokens.mLINK, assetAmount: ethers.parseEther("500"), reserveAmount: usdc("10000"), salt: 3n, decimals: 18 }
  ];
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
  const mETH = await ethers.getContractAt("MockERC20", deployment.tokens.mETH);
  const mWBTC = await ethers.getContractAt("MockERC20", deployment.tokens.mWBTC);
  const mLINK = await ethers.getContractAt("MockERC20", deployment.tokens.mLINK);
  return { router, aqua, mUSDC, mETH, mWBTC, mLINK };
}

export async function setupSepoliaDemo(): Promise<string[]> {
  requireSepolia();
  const deployment = loadDeployment();
  const signer = await getDeploymentSigner();
  const taker = await getTaker();
  const { router, aqua, mUSDC, mETH, mWBTC, mLINK } = await contracts(deployment);

  await (await mUSDC.connect(signer).mint(deployment.maker, usdc("10000"))).wait();
  await (await mETH.connect(signer).mint(taker.address, ethers.parseEther("100"))).wait();
  await (await mWBTC.connect(signer).mint(taker.address, ethers.parseUnits("2", 8))).wait();
  await (await mLINK.connect(signer).mint(taker.address, ethers.parseEther("100000"))).wait();
  await (await mUSDC.connect(signer).approve(deployment.aqua, ethers.MaxUint256)).wait();

  await (await router.connect(signer).createReserve(
    RESERVE_ID,
    deployment.tokens.mUSDC,
    usdc("10000"),
    [usdc("4000"), usdc("7500"), usdc("10000")],
    [10000, 9500, 9000]
  )).wait();
  await (await router.connect(signer).addLeg(RESERVE_ID, deployment.tokens.mETH, usdc("6000"))).wait();
  await (await router.connect(signer).addLeg(RESERVE_ID, deployment.tokens.mWBTC, usdc("6000"))).wait();
  await (await router.connect(signer).addLeg(RESERVE_ID, deployment.tokens.mLINK, usdc("4000"))).wait();
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
  const [eth, wbtc, link] = strategyInputs(deployment);
  return [
    "Sepolia Dry Powder quotes",
    await reserveLine("Current reserve", deployment),
    await quoteLine("ETH quote", eth, usdc("2700"), deployment),
    await quoteLine("WBTC quote", wbtc, usdc("800"), deployment),
    await quoteLine("LINK quote", link, usdc("200"), deployment)
  ];
}

export async function fillSepoliaEth(): Promise<string[]> {
  requireSepolia();
  const deployment = loadDeployment();
  const taker = await getTaker();
  const { router, mUSDC, mETH } = await contracts(deployment);
  const [eth] = strategyInputs(deployment);
  const strategy = buildStrategy(deployment, eth);
  const beforeMaker = await mUSDC.balanceOf(deployment.maker);
  const beforeTaker = await mUSDC.balanceOf(taker.address);

  await (await mETH.connect(taker).approve(deployment.dryPowderRouter, ethers.MaxUint256)).wait();
  await (await router.connect(taker).swap(strategy.order, usdc("4000"), strategy.exactOutTraits)).wait();

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
  const [, wbtc, link] = strategyInputs(deployment);
  return [
    "Sepolia Dry Powder sibling repricing",
    await reserveLine("Current reserve", deployment),
    await quoteLine("WBTC quote after ETH fill", wbtc, usdc("760"), deployment),
    await quoteLine("LINK quote after ETH fill", link, usdc("190"), deployment)
  ];
}

export async function printLines(lines: Promise<string[]> | string[]) {
  for (const line of await lines) {
    console.log(line);
  }
}
