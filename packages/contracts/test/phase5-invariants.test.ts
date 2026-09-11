import { expect } from "chai";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { ethers } from "hardhat";
import { buildDryPowderStrategy, shipDryPowderStrategy, DryPowderStrategy } from "./utils/dryPowderStrategies";

const RESERVE_ID = ethers.id("phase5:reserve");
const USDC_10K = ethers.parseUnits("10000", 6);
const USDC_7500 = ethers.parseUnits("7500", 6);
const USDC_6000 = ethers.parseUnits("6000", 6);
const USDC_4000 = ethers.parseUnits("4000", 6);
const USDC_2500 = ethers.parseUnits("2500", 6);
const USDC_ONE = ethers.parseUnits("1", 6);
const FULL_PRICE = [10000];

async function deployInvariantFixture() {
  const [owner, maker, taker, recipient] = await ethers.getSigners();

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

  await mUSDC.mint(maker.address, USDC_10K);
  await mETH.mint(taker.address, ethers.parseEther("100"));
  await mWBTC.mint(taker.address, ethers.parseUnits("2", 8));
  await mLINK.mint(taker.address, ethers.parseEther("100000"));
  await mUSDC.connect(maker).approve(await aqua.getAddress(), ethers.MaxUint256);
  await mETH.connect(taker).approve(await router.getAddress(), ethers.MaxUint256);
  await mWBTC.connect(taker).approve(await router.getAddress(), ethers.MaxUint256);
  await mLINK.connect(taker).approve(await router.getAddress(), ethers.MaxUint256);

  await router.connect(maker).createReserve(RESERVE_ID, await mUSDC.getAddress(), USDC_10K);
  await router.connect(maker).addLeg(RESERVE_ID, await mETH.getAddress(), [USDC_4000, USDC_6000], [10000, 9500]);
  await router.connect(maker).addLeg(RESERVE_ID, await mWBTC.getAddress(), [USDC_4000, USDC_6000], [10000, 9500]);
  await router.connect(maker).addLeg(RESERVE_ID, await mLINK.getAddress(), [USDC_4000], FULL_PRICE);
  await router.connect(maker).activateReserve(RESERVE_ID);

  const reserveToken = await mUSDC.getAddress();
  const strategies = {
    eth: buildDryPowderStrategy({
      maker: maker.address,
      reserveId: RESERVE_ID,
      asset: await mETH.getAddress(),
      reserveToken,
      assetAmount: ethers.parseEther("10"),
      reserveAmount: ethers.parseUnits("27000", 6),
      salt: 1n
    }),
    wbtc: buildDryPowderStrategy({
      maker: maker.address,
      reserveId: RESERVE_ID,
      asset: await mWBTC.getAddress(),
      reserveToken,
      assetAmount: ethers.parseUnits("0.125", 8),
      reserveAmount: USDC_10K,
      salt: 2n
    }),
    link: buildDryPowderStrategy({
      maker: maker.address,
      reserveId: RESERVE_ID,
      asset: await mLINK.getAddress(),
      reserveToken,
      assetAmount: ethers.parseEther("500"),
      reserveAmount: USDC_10K,
      salt: 3n
    })
  };

  for (const strategy of Object.values(strategies)) {
    await shipDryPowderStrategy({ aqua, router, maker, strategy });
  }

  return { owner, maker, taker, recipient, aqua, router, mUSDC, mETH, mWBTC, mLINK, strategies };
}

async function quoteExactIn(fixture: Awaited<ReturnType<typeof deployInvariantFixture>>, strategy: DryPowderStrategy, amount: bigint) {
  return fixture.router.quote.staticCall(strategy.order, amount, strategy.exactInTakerTraits);
}

async function quoteExactOut(fixture: Awaited<ReturnType<typeof deployInvariantFixture>>, strategy: DryPowderStrategy, amount: bigint) {
  return fixture.router.quote.staticCall(strategy.order, amount, strategy.takerTraits);
}

async function fillExactOut(fixture: Awaited<ReturnType<typeof deployInvariantFixture>>, strategy: DryPowderStrategy, amount: bigint) {
  return fixture.router.connect(fixture.taker).swap(strategy.order, amount, strategy.takerTraits);
}

function expectWithinOneBaseUnit(actual: bigint, expected: bigint) {
  expect(actual).to.be.gte(expected);
  expect(actual).to.be.lte(expected + 1n);
}

async function expectExactOutOverCapacityReverts(
  fixture: Awaited<ReturnType<typeof deployInvariantFixture>>,
  strategy: DryPowderStrategy,
  amount: bigint
) {
  await expect(quoteExactOut(fixture, strategy, amount)).to.be.reverted;
}

describe("Phase 5 Dry Powder invariants and tranches", function () {
  it("quotes initial ETH, WBTC, and LINK prices", async function () {
    const fixture = await loadFixture(deployInvariantFixture);

    expectWithinOneBaseUnit((await quoteExactOut(fixture, fixture.strategies.eth, ethers.parseUnits("2700", 6)))[0], ethers.parseEther("1"));
    expectWithinOneBaseUnit((await quoteExactOut(fixture, fixture.strategies.wbtc, ethers.parseUnits("800", 6)))[0], ethers.parseUnits("0.01", 8));
    expectWithinOneBaseUnit((await quoteExactOut(fixture, fixture.strategies.link, ethers.parseUnits("200", 6)))[0], ethers.parseEther("10"));
  });

  it("keeps sibling quotes independent after one leg fills", async function () {
    const fixture = await loadFixture(deployInvariantFixture);

    await fillExactOut(fixture, fixture.strategies.eth, USDC_4000);

    expectWithinOneBaseUnit((await quoteExactOut(fixture, fixture.strategies.wbtc, ethers.parseUnits("800", 6)))[0], ethers.parseUnits("0.01", 8));
    expectWithinOneBaseUnit((await quoteExactOut(fixture, fixture.strategies.link, ethers.parseUnits("200", 6)))[0], ethers.parseEther("10"));
  });

  it("enforces per-leg ladder boundaries", async function () {
    const fixture = await loadFixture(deployInvariantFixture);

    expect((await quoteExactOut(fixture, fixture.strategies.eth, USDC_4000))[1]).to.equal(USDC_4000);
    await expectExactOutOverCapacityReverts(fixture, fixture.strategies.eth, USDC_4000 + USDC_ONE);
    await fillExactOut(fixture, fixture.strategies.eth, USDC_4000);

    expectWithinOneBaseUnit((await quoteExactOut(fixture, fixture.strategies.wbtc, ethers.parseUnits("800", 6)))[0], ethers.parseUnits("0.01", 8));
    expect((await quoteExactOut(fixture, fixture.strategies.wbtc, USDC_4000))[1]).to.equal(USDC_4000);
    await expectExactOutOverCapacityReverts(fixture, fixture.strategies.wbtc, USDC_4000 + USDC_ONE);
    await fillExactOut(fixture, fixture.strategies.wbtc, USDC_4000);

    expect((await quoteExactOut(fixture, fixture.strategies.wbtc, ethers.parseUnits("760", 6)))[1]).to.equal(ethers.parseUnits("760", 6));
    expect((await quoteExactOut(fixture, fixture.strategies.link, ethers.parseUnits("2000", 6)))[1]).to.equal(ethers.parseUnits("2000", 6));
    await expectExactOutOverCapacityReverts(fixture, fixture.strategies.link, ethers.parseUnits("2000.000001", 6));
    await fillExactOut(fixture, fixture.strategies.link, ethers.parseUnits("2000", 6));

    expect((await fixture.router.getReserve(fixture.maker.address, RESERVE_ID)).spent).to.equal(USDC_10K);
    await expectExactOutOverCapacityReverts(fixture, fixture.strategies.eth, USDC_ONE);
  });

  it("keeps aggregate spending, leg caps, and wallet balance caps bounded", async function () {
    const aggregateFixture = await loadFixture(deployInvariantFixture);

    await fillExactOut(aggregateFixture, aggregateFixture.strategies.eth, USDC_4000);
    await fillExactOut(aggregateFixture, aggregateFixture.strategies.wbtc, USDC_4000);
    await fillExactOut(aggregateFixture, aggregateFixture.strategies.link, ethers.parseUnits("2000", 6));
    expect((await aggregateFixture.router.getReserve(aggregateFixture.maker.address, RESERVE_ID)).spent).to.equal(USDC_10K);
    await expectExactOutOverCapacityReverts(aggregateFixture, aggregateFixture.strategies.eth, USDC_ONE);

    const ethCapFixture = await loadFixture(deployInvariantFixture);
    await fillExactOut(ethCapFixture, ethCapFixture.strategies.eth, USDC_4000);
    await fillExactOut(ethCapFixture, ethCapFixture.strategies.eth, ethers.parseUnits("2000", 6));
    expect((await ethCapFixture.router.getLeg(ethCapFixture.maker.address, RESERVE_ID, await ethCapFixture.mETH.getAddress())).spent)
      .to.equal(USDC_6000);
    await expectExactOutOverCapacityReverts(ethCapFixture, ethCapFixture.strategies.eth, USDC_ONE);

    const wbtcCapFixture = await loadFixture(deployInvariantFixture);
    await fillExactOut(wbtcCapFixture, wbtcCapFixture.strategies.wbtc, USDC_4000);
    await fillExactOut(wbtcCapFixture, wbtcCapFixture.strategies.wbtc, ethers.parseUnits("2000", 6));
    expect((await wbtcCapFixture.router.getLeg(wbtcCapFixture.maker.address, RESERVE_ID, await wbtcCapFixture.mWBTC.getAddress())).spent)
      .to.equal(USDC_6000);
    await expectExactOutOverCapacityReverts(wbtcCapFixture, wbtcCapFixture.strategies.wbtc, USDC_ONE);

    const linkCapFixture = await loadFixture(deployInvariantFixture);
    await fillExactOut(linkCapFixture, linkCapFixture.strategies.link, USDC_4000);
    expect((await linkCapFixture.router.getLeg(linkCapFixture.maker.address, RESERVE_ID, await linkCapFixture.mLINK.getAddress())).spent)
      .to.equal(USDC_4000);
    await expectExactOutOverCapacityReverts(linkCapFixture, linkCapFixture.strategies.link, USDC_ONE);

    const walletFixture = await loadFixture(deployInvariantFixture);
    await walletFixture.mUSDC.connect(walletFixture.maker).transfer(walletFixture.recipient.address, ethers.parseUnits("7500", 6));
    expect((await quoteExactOut(walletFixture, walletFixture.strategies.eth, USDC_2500))[1]).to.equal(USDC_2500);
    await expectExactOutOverCapacityReverts(walletFixture, walletFixture.strategies.eth, USDC_2500 + USDC_ONE);
  });

  it("does not mutate on quote and mutates only the consumed reserve amount on swap", async function () {
    const fixture = await loadFixture(deployInvariantFixture);

    await quoteExactOut(fixture, fixture.strategies.link, ethers.parseUnits("1000", 6));
    expect((await fixture.router.getReserve(fixture.maker.address, RESERVE_ID)).spent).to.equal(0);
    expect((await fixture.router.getLeg(fixture.maker.address, RESERVE_ID, await fixture.mLINK.getAddress())).spent).to.equal(0);

    await fillExactOut(fixture, fixture.strategies.link, ethers.parseUnits("1000", 6));
    expect((await fixture.router.getReserve(fixture.maker.address, RESERVE_ID)).spent)
      .to.equal(ethers.parseUnits("1000", 6));
    expect((await fixture.router.getLeg(fixture.maker.address, RESERVE_ID, await fixture.mLINK.getAddress())).spent)
      .to.equal(ethers.parseUnits("1000", 6));
  });
});
