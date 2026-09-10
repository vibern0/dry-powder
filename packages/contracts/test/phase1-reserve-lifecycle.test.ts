import { expect } from "chai";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { ethers } from "hardhat";

const RESERVE_ID = ethers.id("dry-powder:v1");

async function deployLifecycleFixture() {
  const [maker, otherMaker] = await ethers.getSigners();

  const MockERC20 = await ethers.getContractFactory("MockERC20");
  const mUSDC = await MockERC20.deploy("Mock USDC", "mUSDC", 6);
  const mETH = await MockERC20.deploy("Mock Ether", "mETH", 18);
  const mWBTC = await MockERC20.deploy("Mock Wrapped Bitcoin", "mWBTC", 8);
  const mLINK = await MockERC20.deploy("Mock Chainlink", "mLINK", 18);

  const DryPowderStorage = await ethers.getContractFactory("DryPowderStorage");
  const dryPowder = await DryPowderStorage.deploy();

  return { maker, otherMaker, dryPowder, mUSDC, mETH, mWBTC, mLINK };
}

describe("Phase 1 reserve lifecycle", function () {
  it("creates one inactive reserve with a 10,000 mUSDC budget", async function () {
    const { maker, dryPowder, mUSDC } = await loadFixture(deployLifecycleFixture);
    const thresholds = [
      ethers.parseUnits("4000", 6),
      ethers.parseUnits("7500", 6),
      ethers.parseUnits("10000", 6)
    ];
    const multipliers = [10000, 9500, 9000];

    await expect(dryPowder.createReserve(RESERVE_ID, await mUSDC.getAddress(), ethers.parseUnits("10000", 6), thresholds, multipliers))
      .to.emit(dryPowder, "ReserveCreated")
      .withArgs(maker.address, RESERVE_ID, await mUSDC.getAddress(), ethers.parseUnits("10000", 6));

    const reserve = await dryPowder.getReserve(maker.address, RESERVE_ID);
    expect(reserve.reserveToken).to.equal(await mUSDC.getAddress());
    expect(reserve.totalBudget).to.equal(ethers.parseUnits("10000", 6));
    expect(reserve.spent).to.equal(0);
    expect(reserve.active).to.equal(false);
    expect(await dryPowder.getReserveThresholds(maker.address, RESERVE_ID)).to.deep.equal(thresholds);
    expect(await dryPowder.getReserveMultipliersBps(maker.address, RESERVE_ID)).to.deep.equal(multipliers);
  });

  it("adds overcommitted ETH, WBTC, and LINK legs before activation", async function () {
    const { maker, dryPowder, mUSDC, mETH, mWBTC, mLINK } = await loadFixture(deployLifecycleFixture);
    await dryPowder.createReserve(
      RESERVE_ID,
      await mUSDC.getAddress(),
      ethers.parseUnits("10000", 6),
      [ethers.parseUnits("4000", 6), ethers.parseUnits("7500", 6), ethers.parseUnits("10000", 6)],
      [10000, 9500, 9000]
    );

    await expect(dryPowder.addLeg(RESERVE_ID, await mETH.getAddress(), ethers.parseUnits("6000", 6)))
      .to.emit(dryPowder, "LegAdded")
      .withArgs(maker.address, RESERVE_ID, await mETH.getAddress(), ethers.parseUnits("6000", 6));
    await dryPowder.addLeg(RESERVE_ID, await mWBTC.getAddress(), ethers.parseUnits("6000", 6));
    await dryPowder.addLeg(RESERVE_ID, await mLINK.getAddress(), ethers.parseUnits("4000", 6));

    expect((await dryPowder.getLeg(maker.address, RESERVE_ID, await mETH.getAddress())).maxSpend).to.equal(ethers.parseUnits("6000", 6));
    expect((await dryPowder.getLeg(maker.address, RESERVE_ID, await mWBTC.getAddress())).maxSpend).to.equal(ethers.parseUnits("6000", 6));
    expect((await dryPowder.getLeg(maker.address, RESERVE_ID, await mLINK.getAddress())).maxSpend).to.equal(ethers.parseUnits("4000", 6));
  });

  it("activates a reserve and prevents recreating it", async function () {
    const { maker, dryPowder, mUSDC, mETH, mLINK } = await loadFixture(deployLifecycleFixture);
    await dryPowder.createReserve(
      RESERVE_ID,
      await mUSDC.getAddress(),
      ethers.parseUnits("10000", 6),
      [ethers.parseUnits("4000", 6), ethers.parseUnits("7500", 6), ethers.parseUnits("10000", 6)],
      [10000, 9500, 9000]
    );
    await dryPowder.addLeg(RESERVE_ID, await mETH.getAddress(), ethers.parseUnits("6000", 6));

    await expect(dryPowder.activateReserve(RESERVE_ID))
      .to.emit(dryPowder, "ReserveActivated")
      .withArgs(maker.address, RESERVE_ID);

    expect((await dryPowder.getReserve(maker.address, RESERVE_ID)).active).to.equal(true);
    await expect(dryPowder.addLeg(RESERVE_ID, await mLINK.getAddress(), ethers.parseUnits("4000", 6)))
      .to.emit(dryPowder, "LegAdded")
      .withArgs(maker.address, RESERVE_ID, await mLINK.getAddress(), ethers.parseUnits("4000", 6));
    await expect(dryPowder.createReserve(RESERVE_ID, await mUSDC.getAddress(), ethers.parseUnits("10000", 6), [ethers.parseUnits("10000", 6)], [10000]))
      .to.be.revertedWithCustomError(dryPowder, "ReserveAlreadyExists");
  });

  it("adds, updates, and removes legs after reserve activation", async function () {
    const { maker, dryPowder, mUSDC, mETH, mWBTC } = await loadFixture(deployLifecycleFixture);
    await dryPowder.createReserve(
      RESERVE_ID,
      await mUSDC.getAddress(),
      ethers.parseUnits("10000", 6),
      [ethers.parseUnits("10000", 6)],
      [10000]
    );
    await dryPowder.addLeg(RESERVE_ID, await mETH.getAddress(), ethers.parseUnits("6000", 6));
    await dryPowder.activateReserve(RESERVE_ID);

    await expect(dryPowder.addLeg(RESERVE_ID, await mWBTC.getAddress(), ethers.parseUnits("5000", 6)))
      .to.emit(dryPowder, "LegAdded")
      .withArgs(maker.address, RESERVE_ID, await mWBTC.getAddress(), ethers.parseUnits("5000", 6));

    await expect(dryPowder.updateLeg(RESERVE_ID, await mWBTC.getAddress(), ethers.parseUnits("4500", 6)))
      .to.emit(dryPowder, "LegUpdated")
      .withArgs(maker.address, RESERVE_ID, await mWBTC.getAddress(), ethers.parseUnits("4500", 6));

    await expect(dryPowder.removeLeg(RESERVE_ID, await mWBTC.getAddress()))
      .to.emit(dryPowder, "LegRemoved")
      .withArgs(maker.address, RESERVE_ID, await mWBTC.getAddress(), 0);

    expect((await dryPowder.getLeg(maker.address, RESERVE_ID, await mWBTC.getAddress())).exists).to.equal(false);
  });

  it("keeps the same reserveId isolated for different makers", async function () {
    const { maker, otherMaker, dryPowder, mUSDC, mETH, mLINK } = await loadFixture(deployLifecycleFixture);

    await dryPowder.createReserve(RESERVE_ID, await mUSDC.getAddress(), ethers.parseUnits("10000", 6), [ethers.parseUnits("10000", 6)], [10000]);
    await dryPowder.addLeg(RESERVE_ID, await mETH.getAddress(), ethers.parseUnits("6000", 6));

    await dryPowder.connect(otherMaker).createReserve(RESERVE_ID, await mUSDC.getAddress(), ethers.parseUnits("5000", 6), [ethers.parseUnits("5000", 6)], [9700]);
    await dryPowder.connect(otherMaker).addLeg(RESERVE_ID, await mLINK.getAddress(), ethers.parseUnits("4000", 6));

    expect((await dryPowder.getReserve(maker.address, RESERVE_ID)).totalBudget).to.equal(ethers.parseUnits("10000", 6));
    expect((await dryPowder.getReserve(otherMaker.address, RESERVE_ID)).totalBudget).to.equal(ethers.parseUnits("5000", 6));
    expect((await dryPowder.getLeg(maker.address, RESERVE_ID, await mLINK.getAddress())).exists).to.equal(false);
    expect((await dryPowder.getLeg(otherMaker.address, RESERVE_ID, await mLINK.getAddress())).exists).to.equal(true);
  });

  it("rejects invalid lifecycle inputs", async function () {
    const { dryPowder, mUSDC, mETH } = await loadFixture(deployLifecycleFixture);

    await expect(dryPowder.createReserve(ethers.ZeroHash, await mUSDC.getAddress(), 1, [1], [10000]))
      .to.be.revertedWithCustomError(dryPowder, "InvalidReserveId");
    await expect(dryPowder.createReserve(RESERVE_ID, ethers.ZeroAddress, 1, [1], [10000]))
      .to.be.revertedWithCustomError(dryPowder, "InvalidReserveToken");
    await expect(dryPowder.createReserve(RESERVE_ID, await mUSDC.getAddress(), 0, [1], [10000]))
      .to.be.revertedWithCustomError(dryPowder, "InvalidTotalBudget");
    await expect(dryPowder.createReserve(RESERVE_ID, await mUSDC.getAddress(), 1, [1, 2], [10000]))
      .to.be.revertedWithCustomError(dryPowder, "InvalidTranches");

    await dryPowder.createReserve(RESERVE_ID, await mUSDC.getAddress(), 1, [1], [10000]);
    await expect(dryPowder.addLeg(RESERVE_ID, ethers.ZeroAddress, 1))
      .to.be.revertedWithCustomError(dryPowder, "InvalidLegToken");
    await expect(dryPowder.addLeg(RESERVE_ID, await mETH.getAddress(), 0))
      .to.be.revertedWithCustomError(dryPowder, "InvalidLegMaxSpend");
    await dryPowder.addLeg(RESERVE_ID, await mETH.getAddress(), 1);
    await expect(dryPowder.addLeg(RESERVE_ID, await mETH.getAddress(), 1))
      .to.be.revertedWithCustomError(dryPowder, "LegAlreadyExists");
    await expect(dryPowder.activateReserve(ethers.id("missing")))
      .to.be.revertedWithCustomError(dryPowder, "ReserveNotFound");
  });
});
