import {
  createPublicClient,
  createWalletClient,
  custom,
  formatUnits,
  http,
  maxUint256,
  parseUnits,
  type Address,
  type EIP1193Provider,
  type Hash,
  type Hex,
  type PublicClient,
  type WalletClient
} from "viem";
import { sepolia } from "viem/chains";
import { AQUA_ADDRESS, DRY_POWDER_ROUTER, MOCK_ERC20_ABI, ROUTER_ABI, SEPOLIA_CHAIN_ID, TOKENS } from "./constants";
import { buildSetupPlan, buildStrategy, createReserveId, strategyInputs, usdc, type LegKey } from "./strategy";

export type StepKey = "mint" | "approveAqua" | "createReserve" | "addLegs" | "activateReserve" | "shipStrategies" | "quote" | "fillEth";

export type WalletState = {
  account: Address;
  chainId: number;
  reserveId: Hex;
};

export type TransactionUpdate = {
  step: StepKey;
  message: string;
  hash?: Hash;
};

type SendUpdate = (update: TransactionUpdate) => void;

declare global {
  interface Window {
    ethereum?: EIP1193Provider;
  }
}

export function hasInjectedWallet() {
  return typeof window !== "undefined" && Boolean(window.ethereum);
}

export async function connectWallet(): Promise<WalletState> {
  const provider = getProvider();
  const accounts = await provider.request({ method: "eth_requestAccounts" }) as Address[];
  const chainHex = await provider.request({ method: "eth_chainId" }) as Hex;
  const account = accounts[0];
  if (!account) throw new Error("No wallet account returned.");

  return {
    account,
    chainId: Number.parseInt(chainHex, 16),
    reserveId: getOrCreateReserveId(account)
  };
}

export async function switchToSepolia() {
  const provider = getProvider();
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: `0x${SEPOLIA_CHAIN_ID.toString(16)}` }]
    });
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? (error as { code?: number }).code : undefined;
    if (code !== 4902) throw error;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: `0x${SEPOLIA_CHAIN_ID.toString(16)}`,
          chainName: "Sepolia",
          nativeCurrency: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 },
          rpcUrls: [sepolia.rpcUrls.default.http[0]],
          blockExplorerUrls: [sepolia.blockExplorers.default.url]
        }
      ]
    });
  }
}

export function createFreshWalletReserve(account: Address): Hex {
  const reserveId = createReserveId(account, Date.now().toString());
  window.localStorage.setItem(reserveStorageKey(account), reserveId);
  return reserveId;
}

export async function mintMockTokens(account: Address, onUpdate: SendUpdate) {
  const { publicClient, walletClient } = makeClients(account);
  const mints = [
    { token: TOKENS.mUSDC, amount: usdc("10000"), label: "10,000 mUSDC" },
    { token: TOKENS.mETH, amount: parseAsset("100", "eth"), label: "100 mETH" },
    { token: TOKENS.mWBTC, amount: parseAsset("2", "wbtc"), label: "2 mWBTC" },
    { token: TOKENS.mLINK, amount: parseAsset("100000", "link"), label: "100,000 mLINK" }
  ];

  for (const mint of mints) {
    const hash = await walletClient.writeContract({
      account,
      chain: sepolia,
      address: mint.token,
      abi: MOCK_ERC20_ABI,
      functionName: "mint",
      args: [account, mint.amount]
    });
    onUpdate({ step: "mint", message: `Minting ${mint.label}`, hash });
    await publicClient.waitForTransactionReceipt({ hash });
  }
}

export async function approveAqua(account: Address, onUpdate: SendUpdate) {
  await approveToken(account, TOKENS.mUSDC, AQUA_ADDRESS, "approveAqua", "Approving mUSDC for Aqua", onUpdate);
}

export async function createReserve(account: Address, reserveId: Hex, onUpdate: SendUpdate) {
  const { publicClient, walletClient } = makeClients(account);
  const plan = buildSetupPlan(account, reserveId);
  const hash = await walletClient.writeContract({
    account,
    chain: sepolia,
    address: DRY_POWDER_ROUTER,
    abi: ROUTER_ABI,
    functionName: "createReserve",
    args: [reserveId, TOKENS.mUSDC, plan.totalBudget, plan.reserveThresholds, plan.multipliersBps]
  });
  onUpdate({ step: "createReserve", message: "Creating Dry Powder reserve", hash });
  await publicClient.waitForTransactionReceipt({ hash });
}

export async function addLegs(account: Address, reserveId: Hex, onUpdate: SendUpdate) {
  const { publicClient, walletClient } = makeClients(account);
  const plan = buildSetupPlan(account, reserveId);
  for (const leg of plan.legs) {
    const hash = await walletClient.writeContract({
      account,
      chain: sepolia,
      address: DRY_POWDER_ROUTER,
      abi: ROUTER_ABI,
      functionName: "addLeg",
      args: [reserveId, leg.token, leg.maxSpend]
    });
    onUpdate({ step: "addLegs", message: "Adding strategy leg", hash });
    await publicClient.waitForTransactionReceipt({ hash });
  }
}

export async function activateReserve(account: Address, reserveId: Hex, onUpdate: SendUpdate) {
  const { publicClient, walletClient } = makeClients(account);
  const hash = await walletClient.writeContract({
    account,
    chain: sepolia,
    address: DRY_POWDER_ROUTER,
    abi: ROUTER_ABI,
    functionName: "activateReserve",
    args: [reserveId]
  });
  onUpdate({ step: "activateReserve", message: "Activating reserve", hash });
  await publicClient.waitForTransactionReceipt({ hash });
}

export async function shipStrategies(account: Address, reserveId: Hex, onUpdate: SendUpdate) {
  const { publicClient, walletClient } = makeClients(account);
  const plan = buildSetupPlan(account, reserveId);
  for (const [index, transaction] of plan.shipTransactions.entries()) {
    const hash = await walletClient.sendTransaction({
      account,
      chain: sepolia,
      to: transaction.to,
      data: transaction.data,
      value: transaction.value
    });
    onUpdate({ step: "shipStrategies", message: `Shipping Aqua strategy ${index + 1} of 3`, hash });
    await publicClient.waitForTransactionReceipt({ hash });
  }
}

export async function quoteStrategies(account: Address, reserveId: Hex) {
  const { publicClient } = makeClients(account);
  const keys: LegKey[] = ["eth", "wbtc", "link"];
  const quotes = await Promise.all(
    keys.map(async (key) => {
      const strategy = buildStrategy(key, account, reserveId);
      const [amountIn, amountOut, orderHash] = await publicClient.readContract({
        address: DRY_POWDER_ROUTER,
        abi: ROUTER_ABI,
        functionName: "quote",
        args: [strategy.order, strategy.input.fillAmount, strategy.exactOutTraits]
      });

      return {
        key,
        amountIn,
        amountOut,
        orderHash,
        label: `${formatUnits(amountIn, strategy.input.decimals)} m${strategy.input.label} -> ${formatUnits(amountOut, 6)} mUSDC`
      };
    })
  );

  return quotes;
}

export async function executeEthFill(account: Address, reserveId: Hex, onUpdate: SendUpdate) {
  await approveToken(account, TOKENS.mETH, DRY_POWDER_ROUTER, "fillEth", "Approving mETH for router", onUpdate);

  const { publicClient, walletClient } = makeClients(account);
  const strategy = buildStrategy("eth", account, reserveId);
  const hash = await walletClient.writeContract({
    account,
    chain: sepolia,
    address: DRY_POWDER_ROUTER,
    abi: ROUTER_ABI,
    functionName: "swap",
    args: [strategy.order, usdc("4000"), strategy.exactOutTraits]
  });
  onUpdate({ step: "fillEth", message: "Executing ETH fill", hash });
  await publicClient.waitForTransactionReceipt({ hash });
}

export async function readOnchainSnapshot(account: Address, reserveId: Hex) {
  const { publicClient } = makeClients(account);
  const reserve = await publicClient.readContract({
    address: DRY_POWDER_ROUTER,
    abi: ROUTER_ABI,
    functionName: "getReserve",
    args: [account, reserveId]
  });
  const [ethLeg, wbtcLeg, linkLeg] = await Promise.all(
    ([TOKENS.mETH, TOKENS.mWBTC, TOKENS.mLINK] as const).map((token) =>
      publicClient.readContract({
        address: DRY_POWDER_ROUTER,
        abi: ROUTER_ABI,
        functionName: "getLeg",
        args: [account, reserveId, token]
      })
    )
  );
  const [mUSDC, mETH, mWBTC, mLINK] = await Promise.all(
    ([TOKENS.mUSDC, TOKENS.mETH, TOKENS.mWBTC, TOKENS.mLINK] as const).map((token) =>
      publicClient.readContract({
        address: token,
        abi: MOCK_ERC20_ABI,
        functionName: "balanceOf",
        args: [account]
      })
    )
  );

  return {
    reserve,
    legs: { eth: ethLeg, wbtc: wbtcLeg, link: linkLeg },
    balances: { mUSDC, mETH, mWBTC, mLINK }
  };
}

async function approveToken(account: Address, token: Address, spender: Address, step: StepKey, message: string, onUpdate: SendUpdate) {
  const { publicClient, walletClient } = makeClients(account);
  const hash = await walletClient.writeContract({
    account,
    chain: sepolia,
    address: token,
    abi: MOCK_ERC20_ABI,
    functionName: "approve",
    args: [spender, maxUint256]
  });
  onUpdate({ step, message, hash });
  await publicClient.waitForTransactionReceipt({ hash });
}

function makeClients(account?: Address): { publicClient: PublicClient; walletClient: WalletClient } {
  const provider = getProvider();
  return {
    publicClient: createPublicClient({ chain: sepolia, transport: custom(provider) }),
    walletClient: createWalletClient({ account, chain: sepolia, transport: custom(provider) })
  };
}

function parseAsset(amount: string, key: LegKey) {
  return parseUnits(amount, strategyInputs[key].decimals);
}

function getProvider(): EIP1193Provider {
  if (!window.ethereum) throw new Error("No injected wallet found. Open this page with MetaMask or another EIP-1193 wallet.");
  return window.ethereum;
}

function getOrCreateReserveId(account: Address): Hex {
  const key = reserveStorageKey(account);
  const existing = window.localStorage.getItem(key);
  if (existing?.startsWith("0x") && existing.length === 66) return existing as Hex;

  return createFreshWalletReserve(account);
}

function reserveStorageKey(account: Address) {
  return `dry-powder.reserve-id.${account.toLowerCase()}`;
}
