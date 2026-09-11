import type { Address } from "viem";
import { TOKENS } from "./onchain/constants";

export type AssetConfig = {
  key: string;
  symbol: string;
  name: string;
  token: Address;
  decimals: number;
  maxSpend: string;
  maxPrice: string;
  ladder: Array<{ entryPrice: string; maxSpend: string }>;
  assetAmount: string;
  reserveAmount: string;
  fillAmount: string;
  takerMintAmount: string;
  salt: bigint;
  allocationColor: string;
};

export const assetCatalog = [
  {
    key: "eth",
    symbol: "ETH",
    name: "Ether accumulation",
    token: TOKENS.mETH,
    decimals: 18,
    maxSpend: "10000",
    maxPrice: "1800",
    ladder: [
      { entryPrice: "1800", maxSpend: "2000" },
      { entryPrice: "1600", maxSpend: "4000" },
      { entryPrice: "1200", maxSpend: "4000" }
    ],
    assetAmount: "10",
    reserveAmount: "18000",
    fillAmount: "2000",
    takerMintAmount: "100",
    salt: 1n,
    allocationColor: "#4f7cff"
  },
  {
    key: "wbtc",
    symbol: "WBTC",
    name: "Bitcoin accumulation",
    token: TOKENS.mWBTC,
    decimals: 8,
    maxSpend: "10000",
    maxPrice: "65000",
    ladder: [
      { entryPrice: "65000", maxSpend: "4000" },
      { entryPrice: "60000", maxSpend: "3000" },
      { entryPrice: "45000", maxSpend: "3000" }
    ],
    assetAmount: "0.15384615",
    reserveAmount: "10000",
    fillAmount: "4000",
    takerMintAmount: "2",
    salt: 2n,
    allocationColor: "#f4b455"
  },
  {
    key: "link",
    symbol: "LINK",
    name: "Chainlink accumulation",
    token: TOKENS.mLINK,
    decimals: 18,
    maxSpend: "4000",
    maxPrice: "20",
    ladder: [
      { entryPrice: "20", maxSpend: "1400" },
      { entryPrice: "19", maxSpend: "1300" },
      { entryPrice: "18", maxSpend: "1300" }
    ],
    assetAmount: "500",
    reserveAmount: "10000",
    fillAmount: "200",
    takerMintAmount: "100000",
    salt: 3n,
    allocationColor: "#34c7dd"
  },
  {
    key: "arb",
    symbol: "ARB",
    name: "Arbitrum accumulation",
    token: TOKENS.mARB,
    decimals: 18,
    maxSpend: "3000",
    maxPrice: "1.20",
    ladder: [
      { entryPrice: "1.20", maxSpend: "1000" },
      { entryPrice: "1.14", maxSpend: "1000" },
      { entryPrice: "1.08", maxSpend: "1000" }
    ],
    assetAmount: "10000",
    reserveAmount: "12000",
    fillAmount: "300",
    takerMintAmount: "25000",
    salt: 4n,
    allocationColor: "#2fb7f6"
  },
  {
    key: "op",
    symbol: "OP",
    name: "Optimism accumulation",
    token: TOKENS.mOP,
    decimals: 18,
    maxSpend: "2700",
    maxPrice: "1.90",
    ladder: [
      { entryPrice: "1.90", maxSpend: "900" },
      { entryPrice: "1.80", maxSpend: "900" },
      { entryPrice: "1.70", maxSpend: "900" }
    ],
    assetAmount: "7000",
    reserveAmount: "13300",
    fillAmount: "250",
    takerMintAmount: "20000",
    salt: 5n,
    allocationColor: "#ff4f4f"
  },
  {
    key: "bnb",
    symbol: "BNB",
    name: "BNB accumulation",
    token: TOKENS.mBNB,
    decimals: 18,
    maxSpend: "2500",
    maxPrice: "650",
    ladder: [
      { entryPrice: "650", maxSpend: "900" },
      { entryPrice: "617", maxSpend: "800" },
      { entryPrice: "585", maxSpend: "800" }
    ],
    assetAmount: "20",
    reserveAmount: "13000",
    fillAmount: "500",
    takerMintAmount: "100",
    salt: 6n,
    allocationColor: "#f3cc30"
  },
  {
    key: "sol",
    symbol: "SOL",
    name: "Solana accumulation",
    token: TOKENS.mSOL,
    decimals: 18,
    maxSpend: "3500",
    maxPrice: "180",
    ladder: [
      { entryPrice: "180", maxSpend: "1200" },
      { entryPrice: "171", maxSpend: "1200" },
      { entryPrice: "162", maxSpend: "1100" }
    ],
    assetAmount: "80",
    reserveAmount: "14400",
    fillAmount: "450",
    takerMintAmount: "1000",
    salt: 7n,
    allocationColor: "#31d0aa"
  }
] as const satisfies AssetConfig[];

export type AssetKey = typeof assetCatalog[number]["key"];

export const assetByKey = Object.fromEntries(assetCatalog.map((asset) => [asset.key, asset])) as unknown as Record<AssetKey, AssetConfig>;
