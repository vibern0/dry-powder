import { Contract, ethers, Signer } from "ethers";
import { buildAquaOrder, buildCustomInstruction, buildLimitProgram, buildTakerTraits, OrderStruct } from "./swapVm";

const DRY_POWDER_OPCODE = 0x34;
const SALT_OPCODE = 0x1e;

export interface DryPowderStrategy {
  reserveId: string;
  asset: string;
  reserveToken: string;
  assetAmount: bigint;
  reserveAmount: bigint;
  order: OrderStruct;
  takerTraits: string;
  exactInTakerTraits: string;
}

export function buildDryPowderStrategy(args: {
  maker: string;
  reserveId: string;
  asset: string;
  reserveToken: string;
  assetAmount: bigint;
  reserveAmount: bigint;
  salt: bigint;
}): DryPowderStrategy {
  const tokenA = BigInt(args.asset) < BigInt(args.reserveToken) ? args.asset : args.reserveToken;
  const tokenB = tokenA === args.asset ? args.reserveToken : args.asset;
  const direction = BigInt(args.asset) < BigInt(args.reserveToken);
  const program = ethers.hexlify(ethers.concat([
    buildCustomInstruction(SALT_OPCODE, ethers.zeroPadValue(ethers.toBeHex(args.salt), 8)),
    buildCustomInstruction(DRY_POWDER_OPCODE, args.reserveId),
    buildLimitProgram(direction)
  ]));

  return {
    reserveId: args.reserveId,
    asset: args.asset,
    reserveToken: args.reserveToken,
    assetAmount: args.assetAmount,
    reserveAmount: args.reserveAmount,
    order: buildAquaOrder({
      maker: args.maker,
      tokenA,
      tokenB,
      program,
      useAquaInsteadOfSignature: true
    }),
    takerTraits: buildTakerTraits({
      isExactIn: false,
      isAToB: direction,
      useTransferFromAndAquaPush: true
    }),
    exactInTakerTraits: buildTakerTraits({
      isExactIn: true,
      isAToB: direction,
      useTransferFromAndAquaPush: true
    })
  };
}

export async function shipDryPowderStrategy(args: {
  aqua: Contract;
  router: Contract;
  maker: Signer;
  strategy: DryPowderStrategy;
}) {
  await args.aqua.connect(args.maker).ship(
    await args.router.getAddress(),
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["tuple(address maker, uint256 traits, bytes data)"],
      [args.strategy.order]
    ),
    [args.strategy.reserveToken, args.strategy.asset],
    [args.strategy.reserveAmount, args.strategy.assetAmount]
  );
}
