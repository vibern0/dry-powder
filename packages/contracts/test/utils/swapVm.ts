import { BytesLike, ethers } from "ethers";

interface MakerOrderArgs {
  maker: string;
  tokenA: string;
  tokenB: string;
  program: BytesLike;
  useAquaInsteadOfSignature?: boolean;
}

interface TakerTraitsArgs {
  isExactIn?: boolean;
  isAToB?: boolean;
  useTransferFromAndAquaPush?: boolean;
  threshold?: bigint;
}

export interface OrderStruct {
  maker: string;
  traits: bigint;
  data: string;
}

const USE_AQUA_INSTEAD_OF_SIGNATURE = 1n << 254n;
const ORDER_DATA_SLICES_INDEXES_BIT_OFFSET = 160n;
const TOKENS_PREFIX_LENGTH = 40;

const IS_EXACT_IN = 0x0001;
const USE_TRANSFER_FROM_AND_AQUA_PUSH = 0x0040;
const IS_A_TO_B = 0x0080;

const OPCODE_LIMIT_SWAP = 0x15;

function instruction(opcode: number, args: string): string {
  const body = args.startsWith("0x") ? args.slice(2) : args;
  return opcode.toString(16).padStart(2, "0") +
    (body.length / 2).toString(16).padStart(2, "0") +
    body;
}

export function buildCustomInstruction(opcode: number, args: string): string {
  return "0x" + instruction(opcode, args);
}

export function buildLimitProgram(direction: boolean): string {
  const directionArg = direction ? "80" : "00";

  return "0x" +
    instruction(OPCODE_LIMIT_SWAP, directionArg);
}

export function buildAquaOrder(args: MakerOrderArgs): OrderStruct {
  if (BigInt(args.tokenA) >= BigInt(args.tokenB)) {
    throw new Error("tokenA must be lower than tokenB");
  }

  const index0 = TOKENS_PREFIX_LENGTH;
  const orderDataIndexes =
    BigInt(index0) |
    (BigInt(index0) << 16n) |
    (BigInt(index0) << 32n) |
    (BigInt(index0) << 48n);

  let traits = orderDataIndexes << ORDER_DATA_SLICES_INDEXES_BIT_OFFSET;
  if (args.useAquaInsteadOfSignature) {
    traits |= USE_AQUA_INSTEAD_OF_SIGNATURE;
  }

  return {
    maker: args.maker,
    traits,
    data: ethers.hexlify(ethers.concat([
      ethers.zeroPadValue(args.tokenA, 20),
      ethers.zeroPadValue(args.tokenB, 20),
      args.program
    ]))
  };
}

export function buildTakerTraits(args: TakerTraitsArgs): string {
  let flags = 0;
  if (args.isExactIn) flags |= IS_EXACT_IN;
  if (args.useTransferFromAndAquaPush) flags |= USE_TRANSFER_FROM_AND_AQUA_PUSH;
  if (args.isAToB) flags |= IS_A_TO_B;

  const thresholdBytes = args.threshold === undefined
    ? new Uint8Array(0)
    : ethers.getBytes(ethers.zeroPadValue(ethers.toBeHex(args.threshold), 32));

  const indexes = BigInt(thresholdBytes.length);
  return ethers.hexlify(ethers.concat([
    ethers.zeroPadValue(ethers.toBeHex(indexes), 20),
    ethers.zeroPadValue(ethers.toBeHex(flags), 2),
    thresholdBytes
  ]));
}
