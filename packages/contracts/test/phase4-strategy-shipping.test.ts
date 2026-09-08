import { expect } from "chai";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { ethers } from "hardhat";
import { buildDryPowderStrategy, shipDryPowderStrategy } from "./utils/dryPowderStrategies";

const RESERVE_ID = ethers.id("phase4:reserve");

async function deployStrategyFixture() {
  const [owner, maker, taker] = await ethers.getSigners();

  const Aqua = await ethers.getContractFactory("Aqua");
  const aqua = await Aqua.deploy();
  const WETHMock = await ethers.getContractFactory("WETHMock");
  const weth = await WETHMock.deploy();
  const DryPowderRouter = await ethers.getContractFactory("DryPowderRouter");
  const router = await DryPowderRouter.deploy(await aqua.getAddress(), await weth.getAddress(), owner.address, "DryPowderRouter", "1");

  const MockERC20 = await ethers.getContractFactory("MockERC20");
  const mUSDC = await MockERC20.deploy("Mock USDC", "mUSDC", 6);
  const mETH = await MockERC20.deploy("Mock Ether", "mETH", 18);
  const mWBTC = await MockERC20.deploy("Mock Wrapped Bitcoin", "mWBTC", 8);
  const mLINK = await MockERC20.deploy("Mock Chainlink", "mLINK", 18);

  await mUSDC.mint(maker.address, ethers.parseUnits("10000", 6));
  await mETH.mint(taker.address, ethers.parseEther("10"));
  await mWBTC.mint(taker.address, ethers.parseUnits("1", 8));
  await mLINK.mint(taker.address, ethers.parseEther("1000"));
  await mUSDC.connect(maker).approve(await aqua.getAddress(), ethers.MaxUint256);

  await router.connect(maker).createReserve(
    RESERVE_ID,
    await mUSDC.getAddress(),
    ethers.parseUnits("10000", 6),
    [ethers.parseUnits("4000", 6), ethers.parseUnits("7500", 6), ethers.parseUnits("10000", 6)],
    [10000, 9500, 9000]
  );
  await router.connect(maker).addLeg(RESERVE_ID, await mETH.getAddress(), ethers.parseUnits("6000", 6));
  await router.connect(maker).addLeg(RESERVE_ID, await mWBTC.getAddress(), ethers.parseUnits("6000", 6));
  await router.connect(maker).addLeg(RESERVE_ID, await mLINK.getAddress(), ethers.parseUnits("4000", 6));
  await router.connect(maker).activateReserve(RESERVE_ID);

  return { owner, maker, taker, aqua, router, mUSDC, mETH, mWBTC, mLINK };
}

describe("Phase 4 Aqua strategy shipping", function () {
  it("ships three independent Aqua strategies that share one Dry Powder reserve", async function () {
    const fixture = await loadFixture(deployStrategyFixture);
    const { maker, taker, aqua, router, mUSDC, mETH, mWBTC, mLINK } = fixture;
    const reserveToken = await mUSDC.getAddress();
    const reserveAmount = ethers.parseUnits("10000", 6);

    const strategies = [
      buildDryPowderStrategy({
        maker: maker.address,
        reserveId: RESERVE_ID,
        asset: await mETH.getAddress(),
        reserveToken,
        assetAmount: 3_703_703_703_703_703_704n,
        reserveAmount,
        salt: 1n
      }),
      buildDryPowderStrategy({
        maker: maker.address,
        reserveId: RESERVE_ID,
        asset: await mWBTC.getAddress(),
        reserveToken,
        assetAmount: ethers.parseUnits("0.125", 8),
        reserveAmount,
        salt: 2n
      }),
      buildDryPowderStrategy({
        maker: maker.address,
        reserveId: RESERVE_ID,
        asset: await mLINK.getAddress(),
        reserveToken,
        assetAmount: ethers.parseEther("500"),
        reserveAmount,
        salt: 3n
      })
    ];

    for (const strategy of strategies) {
      await shipDryPowderStrategy({ aqua, router, maker, strategy });
    }

    const hashes = await Promise.all(strategies.map((strategy) => router.hash(strategy.order)));
    expect(new Set(hashes).size).to.equal(3);

    for (const strategy of strategies) {
      expect(strategy.reserveId).to.equal(RESERVE_ID);
      const quote = await router.quote.staticCall(strategy.order, ethers.parseUnits("4000", 6), strategy.takerTraits);
      expect(quote[1]).to.equal(ethers.parseUnits("4000", 6));
    }

    expect(await mUSDC.balanceOf(maker.address)).to.equal(ethers.parseUnits("10000", 6));
    expect((await aqua.rawBalances(maker.address, await router.getAddress(), hashes[0], reserveToken))[0]).to.equal(reserveAmount);
    expect((await aqua.rawBalances(maker.address, await router.getAddress(), hashes[1], reserveToken))[0]).to.equal(reserveAmount);
    expect((await aqua.rawBalances(maker.address, await router.getAddress(), hashes[2], reserveToken))[0]).to.equal(reserveAmount);

    await mETH.connect(taker).approve(await router.getAddress(), ethers.MaxUint256);
    await mWBTC.connect(taker).approve(await router.getAddress(), ethers.MaxUint256);
    await mLINK.connect(taker).approve(await router.getAddress(), ethers.MaxUint256);
  });
});
