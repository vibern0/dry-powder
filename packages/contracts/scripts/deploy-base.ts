import { ethers } from "hardhat";

async function main() {
  const [owner, maker] = await ethers.getSigners();

  const Aqua = await ethers.getContractFactory("Aqua");
  const aqua = await Aqua.deploy();
  await aqua.waitForDeployment();

  const WETHMock = await ethers.getContractFactory("WETHMock");
  const weth = await WETHMock.deploy();
  await weth.waitForDeployment();

  const DryPowderRouter = await ethers.getContractFactory("DryPowderRouter");
  const swapVM = await DryPowderRouter.deploy(
    await aqua.getAddress(),
    await weth.getAddress(),
    owner.address,
    "DryPowderRouter",
    "1"
  );
  await swapVM.waitForDeployment();

  const MockERC20 = await ethers.getContractFactory("MockERC20");
  const mUSDC = await MockERC20.deploy("Mock USDC", "mUSDC", 6);
  const assetSpecs = [
    ["mETH", "Mock Ether", "mETH", 18],
    ["mWBTC", "Mock Wrapped Bitcoin", "mWBTC", 8],
    ["mLINK", "Mock Chainlink", "mLINK", 18],
    ["mARB", "Mock Arbitrum", "mARB", 18],
    ["mOP", "Mock Optimism", "mOP", 18],
    ["mBNB", "Mock BNB", "mBNB", 18],
    ["mSOL", "Mock Solana", "mSOL", 18]
  ] as const;
  const assets: Record<string, any> = {};
  for (const [key, name, symbol, decimals] of assetSpecs) {
    const token = await MockERC20.deploy(name, symbol, decimals);
    await token.waitForDeployment();
    assets[key] = token;
  }
  await mUSDC.waitForDeployment();

  await mUSDC.mint(maker.address, ethers.parseUnits("10000", 6));
  await mUSDC.connect(maker).approve(await aqua.getAddress(), ethers.MaxUint256);

  console.log(JSON.stringify({
    owner: owner.address,
    maker: maker.address,
    aqua: await aqua.getAddress(),
    swapVM: await swapVM.getAddress(),
    dryPowderOpcode: Number(await swapVM.DRY_POWDER_OPCODE()),
    weth: await weth.getAddress(),
    tokens: {
      mUSDC: await mUSDC.getAddress(),
      ...Object.fromEntries(await Promise.all(Object.entries(assets).map(async ([key, token]) => [key, await token.getAddress()])))
    }
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
