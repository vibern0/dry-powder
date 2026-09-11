import { expect } from "chai";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { ethers } from "hardhat";
import { buildAquaOrder, buildCustomInstruction, buildLimitProgram, buildTakerTraits, OrderStruct } from "./utils/swapVm";

const DRY_POWDER_OPCODE = 0x34;
const SALT_OPCODE = 0x1e;
const RESERVE_ID = ethers.id("phase3:reserve");

function usdc(amount: string) {
  return ethers.parseUnits(amount, 6);
}

function singleCap(amount: string) {
  return [usdc(amount)];
}

async function deployDryPowderFixture() {
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
  const mLINK = await MockERC20.deploy("Mock Chainlink", "mLINK", 18);

  await mUSDC.mint(maker.address, ethers.parseUnits("10000", 6));
  await mETH.mint(taker.address, ethers.parseEther("100"));
  await mLINK.mint(taker.address, ethers.parseEther("100000"));
  await mUSDC.connect(maker).approve(await aqua.getAddress(), ethers.MaxUint256);

  return { owner, maker, taker, aqua, router, mUSDC, mETH, mLINK };
}

async function createActiveReserve(fixture: Awaited<ReturnType<typeof deployDryPowderFixture>>, legMaxSpend = "6000") {
  const { router, mUSDC, mETH } = fixture;
  await router.connect(fixture.maker).createReserve(RESERVE_ID, await mUSDC.getAddress(), usdc("10000"));
  await router.connect(fixture.maker).addLeg(RESERVE_ID, await mETH.getAddress(), singleCap(legMaxSpend), [10000]);
  await router.connect(fixture.maker).activateReserve(RESERVE_ID);
}

async function buildOrder(
  fixture: Awaited<ReturnType<typeof deployDryPowderFixture>>,
  tokenIn: string,
  tokenOut: string,
  virtualIn: bigint,
  virtualOut: bigint,
  isExactIn = true,
  salt?: bigint
): Promise<{ order: OrderStruct; takerTraits: string }> {
  const { maker } = fixture;
  const tokenA = BigInt(tokenIn) < BigInt(tokenOut) ? tokenIn : tokenOut;
  const tokenB = tokenA === tokenIn ? tokenOut : tokenIn;
  const direction = BigInt(tokenIn) < BigInt(tokenOut);
  const saltInstruction = salt === undefined
    ? "0x"
    : buildCustomInstruction(SALT_OPCODE, ethers.zeroPadValue(ethers.toBeHex(salt), 8));
  const program = ethers.hexlify(ethers.concat([
    saltInstruction,
    buildCustomInstruction(DRY_POWDER_OPCODE, RESERVE_ID),
    buildLimitProgram(direction)
  ]));

  const order = buildAquaOrder({ maker: maker.address, tokenA, tokenB, program, useAquaInsteadOfSignature: true });
  const takerTraits = buildTakerTraits({
    isExactIn,
    isAToB: direction,
    useTransferFromAndAquaPush: true
  });

  return { order, takerTraits };
}

async function shipOrder(
  fixture: Awaited<ReturnType<typeof deployDryPowderFixture>>,
  order: OrderStruct,
  tokenIn: string,
  tokenOut: string,
  virtualIn: bigint,
  virtualOut: bigint
) {
  const { maker, taker, aqua, router, mETH, mLINK } = fixture;
  await aqua.connect(maker).ship(
    await router.getAddress(),
    ethers.AbiCoder.defaultAbiCoder().encode(["tuple(address maker, uint256 traits, bytes data)"], [order]),
    [tokenOut, tokenIn],
    [virtualOut, virtualIn]
  );
  const inputToken = tokenIn === await mETH.getAddress() ? mETH : mLINK;
  await inputToken.connect(taker).approve(await router.getAddress(), virtualIn);
}

async function quoteEthForUsdc(
  fixture: Awaited<ReturnType<typeof deployDryPowderFixture>>,
  amount: bigint,
  isExactIn: boolean,
  virtualEth = "10",
  virtualUsdc = "27000",
  salt?: bigint
) {
  const tokenIn = await fixture.mETH.getAddress();
  const tokenOut = await fixture.mUSDC.getAddress();
  const { order, takerTraits } = await buildOrder(
    fixture,
    tokenIn,
    tokenOut,
    ethers.parseEther(virtualEth),
    ethers.parseUnits(virtualUsdc, 6),
    isExactIn,
    salt
  );
  await shipOrder(fixture, order, tokenIn, tokenOut, ethers.parseEther(virtualEth), ethers.parseUnits(virtualUsdc, 6));
  return fixture.router.quote.staticCall(order, amount, takerTraits);
}

function expectWithinOneBaseUnit(actual: bigint, expected: bigint) {
  expect(actual).to.be.gte(expected);
  expect(actual).to.be.lte(expected + 1n);
}

describe("Phase 3 Dry Powder opcode", function () {
  it("uses per-leg ladder rows instead of a global reserve price curve", async function () {
    const fixture = await loadFixture(deployDryPowderFixture);
    const tokenIn = await fixture.mETH.getAddress();
    const tokenOut = await fixture.mUSDC.getAddress();
    await fixture.router.connect(fixture.maker).createReserve(RESERVE_ID, tokenOut, usdc("10000"));
    await fixture.router.connect(fixture.maker).addLeg(
      RESERVE_ID,
      tokenIn,
      [usdc("4000"), usdc("7000"), usdc("10000")],
      [10000, 9230, 6923]
    );
    await fixture.router.connect(fixture.maker).activateReserve(RESERVE_ID);

    const { order, takerTraits } = await buildOrder(fixture, tokenIn, tokenOut, ethers.parseEther("0.153846153846153846"), usdc("10000"), false);
    await shipOrder(fixture, order, tokenIn, tokenOut, ethers.parseEther("0.153846153846153846"), usdc("10000"));

    const firstQuote = await fixture.router.quote.staticCall(order, usdc("4000"), takerTraits);
    expect(firstQuote[1]).to.equal(usdc("4000"));
    await fixture.router.connect(fixture.taker).swap(order, usdc("4000"), takerTraits);

    const secondQuote = await fixture.router.quote.staticCall(order, usdc("3000"), takerTraits);
    expect(secondQuote[1]).to.equal(usdc("3000"));
  });

  it("caps quote by the current tranche and does not mutate state", async function () {
    const fixture = await loadFixture(deployDryPowderFixture);
    await createActiveReserve(fixture, "10000");

    const quote = await quoteEthForUsdc(fixture, ethers.parseUnits("4000", 6), false);

    expect(quote[1]).to.equal(ethers.parseUnits("4000", 6));
    const reserve = await fixture.router.getReserve(fixture.maker.address, RESERVE_ID);
    const leg = await fixture.router.getLeg(fixture.maker.address, RESERVE_ID, await fixture.mETH.getAddress());
    expect(reserve.spent).to.equal(0);
    expect(leg.spent).to.equal(0);
  });

  it("updates reserve and leg spent by exact consumed reserve token on swap", async function () {
    const fixture = await loadFixture(deployDryPowderFixture);
    await createActiveReserve(fixture, "10000");
    const tokenIn = await fixture.mETH.getAddress();
    const tokenOut = await fixture.mUSDC.getAddress();
    const { order, takerTraits } = await buildOrder(fixture, tokenIn, tokenOut, ethers.parseEther("10"), ethers.parseUnits("27000", 6), false);
    await shipOrder(fixture, order, tokenIn, tokenOut, ethers.parseEther("10"), ethers.parseUnits("27000", 6));

    await expect(fixture.router.connect(fixture.taker).swap(order, ethers.parseUnits("4000", 6), takerTraits))
      .to.emit(fixture.router, "ReserveConsumed")
      .withArgs(fixture.maker.address, RESERVE_ID, tokenIn, ethers.parseUnits("4000", 6));

    expect((await fixture.router.getReserve(fixture.maker.address, RESERVE_ID)).spent).to.equal(ethers.parseUnits("4000", 6));
    expect((await fixture.router.getLeg(fixture.maker.address, RESERVE_ID, tokenIn)).spent).to.equal(ethers.parseUnits("4000", 6));
  });

  it("keeps a single-row leg at its entry price after previous spending", async function () {
    const fixture = await loadFixture(deployDryPowderFixture);
    await createActiveReserve(fixture, "10000");
    const tokenIn = await fixture.mETH.getAddress();
    const tokenOut = await fixture.mUSDC.getAddress();
    const { order, takerTraits } = await buildOrder(fixture, tokenIn, tokenOut, ethers.parseEther("10"), ethers.parseUnits("27000", 6), false);
    await shipOrder(fixture, order, tokenIn, tokenOut, ethers.parseEther("10"), ethers.parseUnits("27000", 6));
    await fixture.router.connect(fixture.taker).swap(order, ethers.parseUnits("4000", 6), takerTraits);

    const secondQuote = await quoteEthForUsdc(fixture, ethers.parseEther("1"), true, "1", "2700", 2n);

    expect(secondQuote[1]).to.equal(ethers.parseUnits("2700", 6));
  });

  it("caps quote by leg remaining and maker wallet balance", async function () {
    const legFixture = await loadFixture(deployDryPowderFixture);
    await createActiveReserve(legFixture, "3000");
    expect((await quoteEthForUsdc(legFixture, ethers.parseUnits("3000", 6), false))[1]).to.equal(ethers.parseUnits("3000", 6));

    const walletFixture = await loadFixture(deployDryPowderFixture);
    await walletFixture.mUSDC.connect(walletFixture.maker).transfer(walletFixture.owner.address, ethers.parseUnits("7500", 6));
    await createActiveReserve(walletFixture);
    expect((await quoteEthForUsdc(walletFixture, ethers.parseUnits("2500", 6), false))[1]).to.equal(ethers.parseUnits("2500", 6));
  });

  it("rejects missing reserves, inactive reserves, wrong direction, and unregistered legs", async function () {
    const fixture = await loadFixture(deployDryPowderFixture);
    const tokenIn = await fixture.mETH.getAddress();
    const tokenOut = await fixture.mUSDC.getAddress();
    const { order, takerTraits } = await buildOrder(fixture, tokenIn, tokenOut, ethers.parseEther("1"), ethers.parseUnits("2700", 6));
    await shipOrder(fixture, order, tokenIn, tokenOut, ethers.parseEther("1"), ethers.parseUnits("2700", 6));
    await expect(fixture.router.quote.staticCall(order, ethers.parseEther("1"), takerTraits))
      .to.be.revertedWithCustomError(fixture.router, "ReserveNotFound");

    await fixture.router.connect(fixture.maker).createReserve(RESERVE_ID, tokenOut, usdc("10000"));
    await fixture.router.connect(fixture.maker).addLeg(RESERVE_ID, tokenIn, singleCap("6000"), [10000]);
    await expect(fixture.router.quote.staticCall(order, ethers.parseEther("1"), takerTraits))
      .to.be.revertedWithCustomError(fixture.router, "ReserveInactive");
    await fixture.router.connect(fixture.maker).activateReserve(RESERVE_ID);

    const wrongDirection = await buildOrder(fixture, tokenOut, tokenIn, ethers.parseUnits("2700", 6), ethers.parseEther("1"));
    await shipOrder(fixture, wrongDirection.order, tokenOut, tokenIn, ethers.parseUnits("2700", 6), ethers.parseEther("1"));
    await expect(fixture.router.quote.staticCall(wrongDirection.order, ethers.parseUnits("2700", 6), wrongDirection.takerTraits))
      .to.be.revertedWithCustomError(fixture.router, "DryPowderWrongDirection");

    const linkIn = await fixture.mLINK.getAddress();
    const unregistered = await buildOrder(fixture, linkIn, tokenOut, ethers.parseEther("1000"), ethers.parseUnits("20000", 6));
    await shipOrder(fixture, unregistered.order, linkIn, tokenOut, ethers.parseEther("1000"), ethers.parseUnits("20000", 6));
    await expect(fixture.router.quote.staticCall(unregistered.order, ethers.parseEther("1000"), unregistered.takerTraits))
      .to.be.revertedWithCustomError(fixture.router, "DryPowderLegNotFound");
  });
});
