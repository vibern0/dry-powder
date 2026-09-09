import { ABI } from "@1inch/aqua-sdk";
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
import { buildFillIntent, buildSetupPlan, buildStrategy, createReserveId, strategyInputs, usdc, type LegKey } from "./strategy";
import { assertHasSepoliaGas, formatEthBalance } from "./strategy";

export type StepKey =
  | "mint"
  | "mintTaker"
  | "approveAqua"
  | "createReserve"
  | "addLegs"
  | "activateReserve"
  | "shipStrategies"
  | "removeStrategies"
  | "quote"
  | "fill";

export type WalletState = {
  account: Address;
  chainId: number;
  gasBalance: bigint;
  gasBalanceLabel: string;
};

export type MakerSession = {
  maker: Address;
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
    ...(await readGasBalance(account))
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

export function getOrCreateMakerSession(account: Address): MakerSession {
  const stored = getStoredMakerSession();
  if (stored) return stored;
  const session = {
    maker: account,
    reserveId: getOrCreateReserveId(account)
  };
  saveMakerSession(session);
  return session;
}

export function createFreshMakerSession(account: Address): MakerSession {
  const reserveId = createReserveId(account, Date.now().toString());
  window.localStorage.setItem(reserveStorageKey(account), reserveId);
  const session = { maker: account, reserveId };
  saveMakerSession(session);
  return session;
}

export function useConnectedAccountAsMaker(account: Address): MakerSession {
  const session = {
    maker: account,
    reserveId: getOrCreateReserveId(account)
  };
  saveMakerSession(session);
  return session;
}

export async function mintMakerReserveTokens(account: Address, onUpdate: SendUpdate) {
  const { publicClient, walletClient } = makeClients(account);
  assertHasSepoliaGas(await publicClient.getBalance({ address: account }));
  const hash = await walletClient.writeContract({
    account,
    chain: sepolia,
    address: TOKENS.mUSDC,
    abi: MOCK_ERC20_ABI,
    functionName: "mint",
    args: [account, usdc("10000")]
  });
  onUpdate({ step: "mint", message: "Minting 10,000 maker mUSDC", hash });
  await publicClient.waitForTransactionReceipt({ hash });
}

export async function mintTakerAssetTokens(account: Address, onUpdate: SendUpdate) {
  const { publicClient, walletClient } = makeClients(account);
  assertHasSepoliaGas(await publicClient.getBalance({ address: account }));
  const mints = [
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
    onUpdate({ step: "mint", message: `Minting taker ${mint.label}`, hash });
    await publicClient.waitForTransactionReceipt({ hash });
  }
}

export async function approveAqua(account: Address, onUpdate: SendUpdate) {
  await approveToken(account, TOKENS.mUSDC, AQUA_ADDRESS, "approveAqua", "Approving mUSDC for Aqua", onUpdate);
}

export async function createReserve(account: Address, reserveId: Hex, onUpdate: SendUpdate) {
  const { publicClient, walletClient } = makeClients(account);
  assertHasSepoliaGas(await publicClient.getBalance({ address: account }));
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
  assertHasSepoliaGas(await publicClient.getBalance({ address: account }));
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
  assertHasSepoliaGas(await publicClient.getBalance({ address: account }));
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

export async function createReserveBatch(account: Address, reserveId: Hex, onUpdate: SendUpdate) {
  await createReserve(account, reserveId, onUpdate);
  await addLegs(account, reserveId, onUpdate);
  await activateReserve(account, reserveId, onUpdate);
}

export async function shipStrategies(account: Address, reserveId: Hex, onUpdate: SendUpdate) {
  const { publicClient, walletClient } = makeClients(account);
  assertHasSepoliaGas(await publicClient.getBalance({ address: account }));
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

export async function removeStrategies(account: Address, reserveId: Hex, onUpdate: SendUpdate) {
  const { publicClient, walletClient } = makeClients(account);
  assertHasSepoliaGas(await publicClient.getBalance({ address: account }));
  const plan = buildSetupPlan(account, reserveId);
  for (const [index, transaction] of plan.dockTransactions.entries()) {
    const hash = await walletClient.sendTransaction({
      account,
      chain: sepolia,
      to: transaction.to,
      data: transaction.data,
      value: transaction.value
    });
    onUpdate({ step: "removeStrategies", message: `Removing Aqua strategy ${index + 1} of 3`, hash });
    await publicClient.waitForTransactionReceipt({ hash });
  }
}

export async function quoteStrategies(maker: Address, reserveId: Hex) {
  const { publicClient } = makeClients();
  const keys: LegKey[] = ["eth", "wbtc", "link"];
  const quotes = await Promise.all(
    keys.map(async (key) => {
      const strategy = buildStrategy(key, maker, reserveId);
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

export async function executeFillForMaker(taker: Address, maker: Address, reserveId: Hex, key: LegKey, reserveAmount: string, onUpdate: SendUpdate) {
  const fill = buildFillIntent(key, maker, reserveId, reserveAmount);
  await approveToken(taker, fill.approvalToken, DRY_POWDER_ROUTER, "fill", `Approving taker m${fill.label} for router`, onUpdate);

  const { publicClient, walletClient } = makeClients(taker);
  const hash = await walletClient.writeContract({
    account: taker,
    chain: sepolia,
    address: DRY_POWDER_ROUTER,
    abi: ROUTER_ABI,
    functionName: "swap",
    args: [fill.order, fill.fillAmount, fill.exactOutTraits]
  });
  onUpdate({ step: "fill", message: fill.message, hash });
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
  const shipped = await areStrategiesShipped(publicClient, account, reserveId);

  return {
    reserve,
    legs: { eth: ethLeg, wbtc: wbtcLeg, link: linkLeg },
    balances: { mUSDC, mETH, mWBTC, mLINK },
    shipped
  };
}

async function approveToken(account: Address, token: Address, spender: Address, step: StepKey, message: string, onUpdate: SendUpdate) {
  const { publicClient, walletClient } = makeClients(account);
  assertHasSepoliaGas(await publicClient.getBalance({ address: account }));
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

async function readGasBalance(account: Address) {
  const publicClient = createPublicClient({ chain: sepolia, transport: custom(getProvider()) });
  const gasBalance = await publicClient.getBalance({ address: account });
  return { gasBalance, gasBalanceLabel: formatEthBalance(gasBalance) };
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

  return createFreshMakerSession(account).reserveId;
}

function getStoredMakerSession(): MakerSession | null {
  const stored = window.localStorage.getItem("dry-powder.maker-session");
  if (!stored) return null;

  try {
    const parsed = JSON.parse(stored) as MakerSession;
    if (parsed.maker?.startsWith("0x") && parsed.reserveId?.startsWith("0x") && parsed.reserveId.length === 66) {
      return parsed;
    }
  } catch {
    return null;
  }

  return null;
}

function saveMakerSession(session: MakerSession) {
  window.localStorage.setItem("dry-powder.maker-session", JSON.stringify(session));
}

async function areStrategiesShipped(publicClient: PublicClient, account: Address, reserveId: Hex) {
  const strategies = (["eth", "wbtc", "link"] as const).map((key) => buildStrategy(key, account, reserveId));
  const balances = await Promise.all(
    strategies.map((strategy) =>
      publicClient.readContract({
        address: AQUA_ADDRESS,
        abi: ABI.AQUA_ABI,
        functionName: "rawBalances",
        args: [account, DRY_POWDER_ROUTER, strategy.strategyHash, TOKENS.mUSDC]
      })
    )
  );

  return balances.every(([, tokensCount]) => tokensCount > 0 && tokensCount !== 255);
}

function reserveStorageKey(account: Address) {
  return `dry-powder.reserve-id.${account.toLowerCase()}`;
}
