import { expect } from "chai";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { ethers } from "hardhat";
import { buildAquaOrder, buildLimitProgram, buildTakerTraits, OrderStruct } from "./utils/swapVm";

async function deployFoundationFixture() {
  const [owner, maker, taker] = await ethers.getSigners();

  const Aqua = await ethers.getContractFactory("Aqua");
  const aqua = await Aqua.deploy();

  const WETHMock = await ethers.getContractFactory("WETHMock");
  const weth = await WETHMock.deploy();

  const LimitSwapVMRouter = await ethers.getContractFactory("LimitSwapVMRouter");
  const swapVM = await LimitSwapVMRouter.deploy(
    await aqua.getAddress(),
    await weth.getAddress(),
    owner.address,
    "DryPowderLimitSwapVM",
    "1"
  );

  const MockERC20 = await ethers.getContractFactory("MockERC20");
  const mUSDC = await MockERC20.deploy("Mock USDC", "mUSDC", 6);
  const mETH = await MockERC20.deploy("Mock Ether", "mETH", 18);
  const mWBTC = await MockERC20.deploy("Mock Wrapped Bitcoin", "mWBTC", 8);
  const mLINK = await MockERC20.deploy("Mock Chainlink", "mLINK", 18);

  await mUSDC.mint(maker.address, ethers.parseUnits("10000", 6));
  await mETH.mint(taker.address, ethers.parseEther("10"));

  return { owner, maker, taker, aqua, swapVM, mUSDC, mETH, mWBTC, mLINK };
}

async function buildEthForUsdcOrder(fixture: Awaited<ReturnType<typeof deployFoundationFixture>>): Promise<{
  order: OrderStruct;
  takerTraits: string;
}> {
  const { maker, mETH, mUSDC } = fixture;
  const mEthAddress = await mETH.getAddress();
  const mUsdcAddress = await mUSDC.getAddress();
  const tokenA = BigInt(mEthAddress) < BigInt(mUsdcAddress) ? mEthAddress : mUsdcAddress;
  const tokenB = tokenA === mEthAddress ? mUsdcAddress : mEthAddress;
  const direction = BigInt(mEthAddress) < BigInt(mUsdcAddress);
  const program = buildLimitProgram(direction);

  const order = buildAquaOrder({
    maker: maker.address,
    tokenA,
    tokenB,
    program,
    useAquaInsteadOfSignature: true
  });
  const takerTraits = buildTakerTraits({
    isExactIn: true,
    isAToB: direction,
    useTransferFromAndAquaPush: true,
    threshold: ethers.parseUnits("2700", 6)
  });

  return { order, takerTraits };
}

describe("Phase 0 foundation", function () {
  it("deploys official Aqua and SwapVM dependencies, approves Aqua, quotes, and settles a baseline limit order", async function () {
    const fixture = await loadFixture(deployFoundationFixture);
    const { maker, taker, aqua, swapVM, mUSDC, mETH, mWBTC, mLINK } = fixture;

    expect(await mUSDC.balanceOf(maker.address)).to.equal(ethers.parseUnits("10000", 6));
    expect(await mUSDC.decimals()).to.equal(6);
    expect(await mETH.decimals()).to.equal(18);
    expect(await mWBTC.decimals()).to.equal(8);
    expect(await mLINK.decimals()).to.equal(18);

    await mUSDC.connect(maker).approve(await aqua.getAddress(), ethers.MaxUint256);
    expect(await mUSDC.allowance(maker.address, await aqua.getAddress())).to.equal(ethers.MaxUint256);

    const { order, takerTraits } = await buildEthForUsdcOrder(fixture);
    const orderHash = await swapVM.hash(order);

    await aqua.connect(maker).ship(
      await swapVM.getAddress(),
      ethers.AbiCoder.defaultAbiCoder().encode(
        ["tuple(address maker, uint256 traits, bytes data)"],
        [order]
      ),
      [await mUSDC.getAddress(), await mETH.getAddress()],
      [ethers.parseUnits("2700", 6), ethers.parseEther("1")]
    );

    await mETH.connect(taker).approve(await swapVM.getAddress(), ethers.parseEther("1"));

    const quote = await swapVM.quote.staticCall(order, ethers.parseEther("1"), takerTraits);
    expect(quote[0]).to.equal(ethers.parseEther("1"));
    expect(quote[1]).to.equal(ethers.parseUnits("2700", 6));
    expect(quote[2]).to.equal(orderHash);

    await expect(swapVM.connect(taker).swap(order, ethers.parseEther("1"), takerTraits))
      .to.changeTokenBalances(
        mUSDC,
        [maker, taker],
        [-ethers.parseUnits("2700", 6), ethers.parseUnits("2700", 6)]
      );
  });
});
