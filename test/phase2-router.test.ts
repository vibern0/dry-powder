import { expect } from "chai";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { ethers } from "hardhat";
import { buildAquaOrder, buildCustomInstruction, buildLimitProgram, buildTakerTraits, OrderStruct } from "./utils/swapVm";

const DRY_POWDER_OPCODE = 0x34;
const RESERVE_ID = ethers.id("phase2:reserve");

async function deployRouterFixture() {
  const [owner, maker, taker] = await ethers.getSigners();

  const Aqua = await ethers.getContractFactory("Aqua");
  const aqua = await Aqua.deploy();

  const WETHMock = await ethers.getContractFactory("WETHMock");
  const weth = await WETHMock.deploy();

  const DryPowderRouter = await ethers.getContractFactory("DryPowderRouter");
  const router = await DryPowderRouter.deploy(
    await aqua.getAddress(),
    await weth.getAddress(),
    owner.address,
    "DryPowderRouter",
    "1"
  );

  const MockERC20 = await ethers.getContractFactory("MockERC20");
  const mUSDC = await MockERC20.deploy("Mock USDC", "mUSDC", 6);
  const mETH = await MockERC20.deploy("Mock Ether", "mETH", 18);

  await mUSDC.mint(maker.address, ethers.parseUnits("10000", 6));
  await mETH.mint(taker.address, ethers.parseEther("10"));
  await mUSDC.connect(maker).approve(await aqua.getAddress(), ethers.MaxUint256);

  return { owner, maker, taker, aqua, router, mUSDC, mETH };
}

async function buildEthForUsdcOrder(
  fixture: Awaited<ReturnType<typeof deployRouterFixture>>,
  prefixProgram = "0x"
): Promise<{ order: OrderStruct; takerTraits: string }> {
  const { maker, mETH, mUSDC } = fixture;
  const mEthAddress = await mETH.getAddress();
  const mUsdcAddress = await mUSDC.getAddress();
  const tokenA = BigInt(mEthAddress) < BigInt(mUsdcAddress) ? mEthAddress : mUsdcAddress;
  const tokenB = tokenA === mEthAddress ? mUsdcAddress : mEthAddress;
  const direction = BigInt(mEthAddress) < BigInt(mUsdcAddress);
  const program = ethers.hexlify(ethers.concat([prefixProgram, buildLimitProgram(direction)]));

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

async function shipAndApprove(
  fixture: Awaited<ReturnType<typeof deployRouterFixture>>,
  order: OrderStruct,
  takerTraits: string
) {
  const { maker, taker, aqua, router, mUSDC, mETH } = fixture;

  await aqua.connect(maker).ship(
    await router.getAddress(),
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["tuple(address maker, uint256 traits, bytes data)"],
      [order]
    ),
    [await mUSDC.getAddress(), await mETH.getAddress()],
    [ethers.parseUnits("2700", 6), ethers.parseEther("1")]
  );
  await mETH.connect(taker).approve(await router.getAddress(), ethers.parseEther("1"));

  const quote = await router.quote.staticCall(order, ethers.parseEther("1"), takerTraits);
  expect(quote[0]).to.equal(ethers.parseEther("1"));
  expect(quote[1]).to.equal(ethers.parseUnits("2700", 6));
}

describe("Phase 2 DryPowderRouter", function () {
  it("deploys with an explicit custom Dry Powder opcode", async function () {
    const { router } = await loadFixture(deployRouterFixture);

    expect(await router.DRY_POWDER_OPCODE()).to.equal(DRY_POWDER_OPCODE);
  });

  it("preserves official limit swap behavior through delegated opcodes", async function () {
    const fixture = await loadFixture(deployRouterFixture);
    const { maker, taker, router, mUSDC } = fixture;
    const { order, takerTraits } = await buildEthForUsdcOrder(fixture);

    await shipAndApprove(fixture, order, takerTraits);

    await expect(router.connect(taker).swap(order, ethers.parseEther("1"), takerTraits))
      .to.changeTokenBalances(
        mUSDC,
        [maker, taker],
        [-ethers.parseUnits("2700", 6), ethers.parseUnits("2700", 6)]
      );
  });

  it("reaches the Dry Powder opcode and then continues into official limit swap execution", async function () {
    const fixture = await loadFixture(deployRouterFixture);
    const { maker, taker, router, mUSDC, mETH } = fixture;
    const dryPowderInstruction = buildCustomInstruction(DRY_POWDER_OPCODE, RESERVE_ID);
    const { order, takerTraits } = await buildEthForUsdcOrder(fixture, dryPowderInstruction);

    await shipAndApprove(fixture, order, takerTraits);

    const tx = router.connect(taker).swap(order, ethers.parseEther("1"), takerTraits);

    await expect(tx)
      .to.emit(router, "DryPowderOpcodeReached")
      .withArgs(maker.address, RESERVE_ID, await mETH.getAddress(), await mUSDC.getAddress());
    await expect(tx)
      .to.changeTokenBalances(
        mUSDC,
        [maker, taker],
        [-ethers.parseUnits("2700", 6), ethers.parseUnits("2700", 6)]
      );
  });
});
