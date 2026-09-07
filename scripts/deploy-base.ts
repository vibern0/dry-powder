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
  const mETH = await MockERC20.deploy("Mock Ether", "mETH", 18);
  const mWBTC = await MockERC20.deploy("Mock Wrapped Bitcoin", "mWBTC", 8);
  const mLINK = await MockERC20.deploy("Mock Chainlink", "mLINK", 18);
  await Promise.all([
    mUSDC.waitForDeployment(),
    mETH.waitForDeployment(),
    mWBTC.waitForDeployment(),
    mLINK.waitForDeployment()
  ]);

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
      mETH: await mETH.getAddress(),
      mWBTC: await mWBTC.getAddress(),
      mLINK: await mLINK.getAddress()
    }
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
