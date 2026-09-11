import { ABI } from "@1inch/aqua-sdk";
import {
  createPublicClient,
  createWalletClient,
  custom,
  formatUnits,
  getAddress,
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
import { assetCatalog } from "../assets";
import { AQUA_ADDRESS, DRY_POWDER_ROUTER, MOCK_ERC20_ABI, ROUTER_ABI, SEPOLIA_CHAIN_ID, TOKENS } from "./constants";
import { buildFillIntent, buildSetupPlan, buildStrategy, buildStrategyPlan, createReserveId, strategyInputs, strategyKeys, usdc, type LegKey, type StrategyPlanInput } from "./strategy";
import { assertHasSepoliaGas, formatEthBalance } from "./strategy";

export type StepKey =
  | "mint"
  | "mintTaker"
  | "approveAqua"
  | "createReserve"
  | "activateReserve"
  | "addStrategy"
  | "editStrategy"
  | "removeStrategy"
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
  const account = accounts[0] ? getAddress(accounts[0]) : undefined;
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
  const maker = getAddress(account);
  const session = {
    maker,
    reserveId: getOrCreateReserveId(maker)
  };
  saveMakerSession(session);
  return session;
}

export function createFreshMakerSession(account: Address): MakerSession {
  const maker = getAddress(account);
  const reserveId = createReserveId(maker, Date.now().toString());
  window.localStorage.setItem(reserveStorageKey(maker), reserveId);
  const session = { maker, reserveId };
  saveMakerSession(session);
  return session;
}

export function useConnectedAccountAsMaker(account: Address): MakerSession {
  const maker = getAddress(account);
  const session = {
    maker,
    reserveId: getOrCreateReserveId(maker)
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
  const mints = strategyKeys.map((key) => ({
    token: strategyInputs[key].asset,
    amount: strategyInputs[key].takerMintAmount,
    label: `${assetCatalog.find((asset) => asset.key === key)?.takerMintAmount ?? ""} m${strategyInputs[key].label}`
  }));

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
    args: [reserveId, TOKENS.mUSDC, plan.totalBudget]
  });
  onUpdate({ step: "createReserve", message: "Creating Dry Powder reserve", hash });
  await publicClient.waitForTransactionReceipt({ hash });
}

export async function addLeg(account: Address, reserveId: Hex, key: LegKey, onUpdate: SendUpdate, inputs: StrategyPlanInput = {}) {
  const { publicClient, walletClient } = makeClients(account);
  assertHasSepoliaGas(await publicClient.getBalance({ address: account }));
  const plan = buildStrategyPlan(account, reserveId, key, inputs);
  const hash = await walletClient.writeContract({
    account,
    chain: sepolia,
    address: DRY_POWDER_ROUTER,
    abi: ROUTER_ABI,
    functionName: "addLeg",
    args: [reserveId, plan.leg.token, plan.leg.spendCaps, plan.leg.priceBps]
  });
  onUpdate({ step: "addStrategy", message: `Adding ${strategyInputs[key].label} reserve leg`, hash });
  await publicClient.waitForTransactionReceipt({ hash });
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
  for (const key of strategyKeys) {
    await addLeg(account, reserveId, key, onUpdate);
  }
  await activateReserve(account, reserveId, onUpdate);
}

export async function addStrategy(account: Address, reserveId: Hex, key: LegKey, onUpdate: SendUpdate, inputs: StrategyPlanInput = {}) {
  const reserve = await readReserve(account, reserveId);
  if (!reserve.exists) {
    await createReserve(account, reserveId, onUpdate);
  }
  await addLeg(account, reserveId, key, onUpdate, inputs);
  if (!reserve.active) {
    await activateReserve(account, reserveId, onUpdate);
  }
  await shipStrategy(account, reserveId, key, onUpdate, inputs);
}

export async function editStrategy(account: Address, reserveId: Hex, key: LegKey, ladder: StrategyPlanInput["ladder"], onUpdate: SendUpdate) {
  const { publicClient, walletClient } = makeClients(account);
  assertHasSepoliaGas(await publicClient.getBalance({ address: account }));
  const plan = buildStrategyPlan(account, reserveId, key, { ladder });
  const hash = await walletClient.writeContract({
    account,
    chain: sepolia,
    address: DRY_POWDER_ROUTER,
    abi: ROUTER_ABI,
    functionName: "updateLeg",
    args: [reserveId, plan.leg.token, plan.leg.spendCaps, plan.leg.priceBps]
  });
  onUpdate({ step: "editStrategy", message: `Updating ${strategyInputs[key].label} max spend`, hash });
  await publicClient.waitForTransactionReceipt({ hash });
}

export async function shipStrategy(account: Address, reserveId: Hex, key: LegKey, onUpdate: SendUpdate, inputs: StrategyPlanInput = {}) {
  const { publicClient, walletClient } = makeClients(account);
  assertHasSepoliaGas(await publicClient.getBalance({ address: account }));
  const transaction = buildStrategyPlan(account, reserveId, key, inputs).shipTransaction;
  const hash = await walletClient.sendTransaction({
    account,
    chain: sepolia,
    to: transaction.to,
    data: transaction.data,
    value: transaction.value
  });
  onUpdate({ step: "addStrategy", message: `Shipping ${strategyInputs[key].label} Aqua strategy`, hash });
  await publicClient.waitForTransactionReceipt({ hash });
}

export async function removeStrategy(account: Address, reserveId: Hex, key: LegKey, onUpdate: SendUpdate) {
  await dockStrategy(account, reserveId, key, onUpdate);
  await removeLeg(account, reserveId, key, onUpdate);
}

async function dockStrategy(account: Address, reserveId: Hex, key: LegKey, onUpdate: SendUpdate) {
  const { publicClient, walletClient } = makeClients(account);
  assertHasSepoliaGas(await publicClient.getBalance({ address: account }));
  const transaction = buildStrategyPlan(account, reserveId, key).dockTransaction;
  const hash = await walletClient.sendTransaction({
    account,
    chain: sepolia,
    to: transaction.to,
    data: transaction.data,
    value: transaction.value
  });
  onUpdate({ step: "removeStrategy", message: `Docking ${strategyInputs[key].label} Aqua strategy`, hash });
  await publicClient.waitForTransactionReceipt({ hash });
}

async function removeLeg(account: Address, reserveId: Hex, key: LegKey, onUpdate: SendUpdate) {
  const { publicClient, walletClient } = makeClients(account);
  assertHasSepoliaGas(await publicClient.getBalance({ address: account }));
  const plan = buildStrategyPlan(account, reserveId, key);
  const hash = await walletClient.writeContract({
    account,
    chain: sepolia,
    address: DRY_POWDER_ROUTER,
    abi: ROUTER_ABI,
    functionName: "removeLeg",
    args: [reserveId, plan.leg.token]
  });
  onUpdate({ step: "removeStrategy", message: `Removing ${strategyInputs[key].label} reserve leg`, hash });
  await publicClient.waitForTransactionReceipt({ hash });
}

export async function quoteStrategies(maker: Address, reserveId: Hex, keys: LegKey[] = strategyKeys) {
  const { publicClient } = makeClients();
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
  const legValues = await Promise.all(
    strategyKeys.map((key) =>
      publicClient.readContract({
        address: DRY_POWDER_ROUTER,
        abi: ROUTER_ABI,
        functionName: "getLeg",
        args: [account, reserveId, strategyInputs[key].asset]
      })
    )
  );
  const balanceTokens = [TOKENS.mUSDC, ...strategyKeys.map((key) => strategyInputs[key].asset)];
  const balanceValues = await Promise.all(
    balanceTokens.map((token) =>
      publicClient.readContract({
        address: token,
        abi: MOCK_ERC20_ABI,
        functionName: "balanceOf",
        args: [account]
      })
    )
  );
  const shipped = await readShippedStrategies(publicClient, account, reserveId);

  return {
    reserve,
    legs: Object.fromEntries(strategyKeys.map((key, index) => [key, legValues[index]])) as Record<LegKey, (typeof legValues)[number]>,
    balances: Object.fromEntries(balanceTokens.map((token, index) => [token, balanceValues[index]])),
    shipped
  };
}

async function readReserve(account: Address, reserveId: Hex) {
  const { publicClient } = makeClients(account);
  return publicClient.readContract({
    address: DRY_POWDER_ROUTER,
    abi: ROUTER_ABI,
    functionName: "getReserve",
    args: [account, reserveId]
  });
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
      return { maker: getAddress(parsed.maker), reserveId: parsed.reserveId };
    }
  } catch {
    return null;
  }

  return null;
}

function saveMakerSession(session: MakerSession) {
  window.localStorage.setItem("dry-powder.maker-session", JSON.stringify({ ...session, maker: getAddress(session.maker) }));
}

async function readShippedStrategies(publicClient: PublicClient, account: Address, reserveId: Hex) {
  const strategies = strategyKeys.map((key) => buildStrategy(key, account, reserveId));
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

  return Object.fromEntries(balances.map(([, tokensCount], index) => [strategyKeys[index], tokensCount > 0 && tokensCount !== 255])) as Record<LegKey, boolean>;
}

function reserveStorageKey(account: Address) {
  return `dry-powder.reserve-id.${getAddress(account)}`;
}
