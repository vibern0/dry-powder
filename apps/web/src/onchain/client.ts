import { ABI } from "@1inch/aqua-sdk";
import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  custom,
  formatUnits,
  getAddress,
  http,
  maxUint256,
  parseAbiItem,
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
import { AQUA_ADDRESS, DRY_POWDER_ROUTER, DRY_POWDER_ROUTER_DEPLOYMENT_BLOCK, MOCK_ERC20_ABI, ROUTER_ABI, SEPOLIA_CHAIN_ID, TOKENS } from "./constants";
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

export type TakerStrategy = {
  id: string;
  maker: Address;
  reserveId: Hex;
  key: LegKey;
  leg: Awaited<ReturnType<typeof readOnchainSnapshot>>["legs"][LegKey];
};

export type TransactionUpdate = {
  step: StepKey;
  message: string;
  hash?: Hash;
};

type SendUpdate = (update: TransactionUpdate) => void;

const WALLET_CONNECTION_KEY = "dry-powder.wallet-connected";
const LOG_BLOCK_CHUNK_SIZE = 9_999n;
const AQUA_STRATEGY_IMMUTABLE_SELECTOR = "0x879f237b";
const AQUA_DOCK_MISMATCH_SELECTOR = "0xbbe8d44d";
const LEG_ADDED_EVENT = parseAbiItem("event LegAdded(address indexed maker, bytes32 indexed reserveId, address indexed token, uint256 maxSpend)");

declare global {
  interface Window {
    ethereum?: EIP1193Provider;
  }
}

export function hasInjectedWallet() {
  return typeof window !== "undefined" && Boolean(window.ethereum);
}

export async function connectWallet(): Promise<WalletState> {
  const wallet = await readWalletState("eth_requestAccounts");
  window.localStorage.setItem(WALLET_CONNECTION_KEY, "true");
  return wallet;
}

export async function reconnectWallet(): Promise<WalletState | null> {
  if (window.localStorage.getItem(WALLET_CONNECTION_KEY) !== "true") return null;

  const provider = getProvider();
  const accounts = await provider.request({ method: "eth_accounts" }) as Address[];
  if (accounts.length === 0) {
    forgetWalletConnection();
    return null;
  }

  return readWalletState("eth_accounts", accounts);
}

export function forgetWalletConnection() {
  window.localStorage.removeItem(WALLET_CONNECTION_KEY);
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
  const maker = getAddress(account);
  if (stored && getAddress(stored.maker) === maker) return stored;
  const session = {
    maker,
    reserveId: getOrCreateReserveId(maker)
  };
  if (!stored) saveMakerSession(session);
  return session;
}

export function getTakerViewMakerSession(account: Address): MakerSession {
  return getStoredMakerSession() ?? getOrCreateMakerSession(account);
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
  const leg = reserve.exists ? await readLeg(account, reserveId, key) : { exists: false };
  if (leg.exists) {
    await editStrategy(account, reserveId, key, inputs.ladder, onUpdate);
  } else {
    await addLeg(account, reserveId, key, onUpdate, inputs);
  }
  if (!reserve.active) {
    await activateReserve(account, reserveId, onUpdate);
  }
  await ensureStrategyInventory(account, reserveId, key, inputs, onUpdate);
  if (!await isStrategyShipped(account, reserveId, key)) {
    await shipStrategy(account, reserveId, key, onUpdate, inputs);
  }
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
  try {
    await publicClient.call({
      account,
      to: transaction.to,
      data: transaction.data,
      value: transaction.value
    });
  } catch (error) {
    if (isAquaAlreadyShippedError(error)) {
      onUpdate({ step: "addStrategy", message: `${strategyInputs[key].label} Aqua strategy already shipped` });
      return;
    }
    throw error;
  }

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

async function ensureStrategyInventory(account: Address, reserveId: Hex, key: LegKey, inputs: StrategyPlanInput, onUpdate: SendUpdate) {
  const { publicClient, walletClient } = makeClients(account);
  assertHasSepoliaGas(await publicClient.getBalance({ address: account }));
  const strategy = buildStrategyPlan(account, reserveId, key, inputs).strategy;

  for (const [index, token] of strategy.shipTokens.entries()) {
    const amount = strategy.shipAmounts[index];
    const balance = await publicClient.readContract({
      address: token,
      abi: MOCK_ERC20_ABI,
      functionName: "balanceOf",
      args: [account]
    });
    const label = tokenLabel(token, key);

    if (balance < amount) {
      const hash = await walletClient.writeContract({
        account,
        chain: sepolia,
        address: token,
        abi: MOCK_ERC20_ABI,
        functionName: "mint",
        args: [account, amount - balance]
      });
      onUpdate({ step: "addStrategy", message: `Minting maker ${formatUnits(amount - balance, tokenDecimals(token, key))} ${label}`, hash });
      await publicClient.waitForTransactionReceipt({ hash });
    }

    const allowance = await publicClient.readContract({
      address: token,
      abi: MOCK_ERC20_ABI,
      functionName: "allowance",
      args: [account, AQUA_ADDRESS]
    });
    if (allowance < amount) {
      const hash = await walletClient.writeContract({
        account,
        chain: sepolia,
        address: token,
        abi: MOCK_ERC20_ABI,
        functionName: "approve",
        args: [AQUA_ADDRESS, maxUint256]
      });
      onUpdate({ step: "addStrategy", message: `Approving ${label} for Aqua`, hash });
      await publicClient.waitForTransactionReceipt({ hash });
    }
  }
}

export async function removeStrategy(account: Address, reserveId: Hex, key: LegKey, onUpdate: SendUpdate) {
  await dockStrategy(account, reserveId, key, onUpdate);
  await removeLeg(account, reserveId, key, onUpdate);
}

async function dockStrategy(account: Address, reserveId: Hex, key: LegKey, onUpdate: SendUpdate) {
  const { publicClient, walletClient } = makeClients(account);
  assertHasSepoliaGas(await publicClient.getBalance({ address: account }));
  const plan = buildStrategyPlan(account, reserveId, key);
  const dockTokens = await readDockTokens(publicClient, account, reserveId, key);
  const transaction = {
    to: AQUA_ADDRESS,
    data: encodeFunctionData({
      abi: ABI.AQUA_ABI,
      functionName: "dock",
      args: [DRY_POWDER_ROUTER, plan.strategy.strategyHash, dockTokens]
    }),
    value: 0n
  };
  try {
    await publicClient.call({
      account,
      to: transaction.to,
      data: transaction.data,
      value: transaction.value
    });
  } catch (error) {
    if (isAquaDockMismatchError(error)) {
      onUpdate({ step: "removeStrategy", message: `Skipping ${strategyInputs[key].label} Aqua dock; removing router leg only` });
      return;
    }
    throw error;
  }

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

async function readDockTokens(publicClient: PublicClient, account: Address, reserveId: Hex, key: LegKey): Promise<Address[]> {
  const plan = buildStrategyPlan(account, reserveId, key);
  const candidates = [TOKENS.mUSDC, strategyInputs[key].asset];
  const balances = await Promise.all(candidates.map(async (token) => {
    const [, tokensCount] = await publicClient.readContract({
      address: AQUA_ADDRESS,
      abi: ABI.AQUA_ABI,
      functionName: "rawBalances",
      args: [account, DRY_POWDER_ROUTER, plan.strategy.strategyHash, token]
    });
    return { token, tokensCount };
  }));
  const expectedTokensCount = balances.reduce((max, balance) => balance.tokensCount > max ? balance.tokensCount : max, 0);
  const recordedTokens = balances
    .filter((balance) => balance.tokensCount === expectedTokensCount && balance.tokensCount > 0 && balance.tokensCount !== 255)
    .map((balance) => balance.token);

  if (expectedTokensCount > 0 && expectedTokensCount !== 255 && Number(expectedTokensCount) <= candidates.length) {
    return candidates.slice(0, Number(expectedTokensCount));
  }

  return recordedTokens.length === Number(expectedTokensCount) ? recordedTokens : plan.strategy.shipTokens;
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
  const legSpendCaps = await Promise.all(
    strategyKeys.map((key) =>
      publicClient.readContract({
        address: DRY_POWDER_ROUTER,
        abi: ROUTER_ABI,
        functionName: "getLegSpendCaps",
        args: [account, reserveId, strategyInputs[key].asset]
      })
    )
  );
  const legPriceBps = await Promise.all(
    strategyKeys.map((key) =>
      publicClient.readContract({
        address: DRY_POWDER_ROUTER,
        abi: ROUTER_ABI,
        functionName: "getLegPriceBps",
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
    legs: Object.fromEntries(strategyKeys.map((key, index) => [key, {
      ...legValues[index],
      spendCaps: legSpendCaps[index],
      priceBps: legPriceBps[index]
    }])) as Record<LegKey, (typeof legValues)[number] & { spendCaps: bigint[]; priceBps: bigint[] }>,
    balances: Object.fromEntries(balanceTokens.map((token, index) => [token, balanceValues[index]])),
    shipped
  };
}

export async function readMockTokenBalance(account: Address, token: Address) {
  const { publicClient } = makeClients(account);
  return publicClient.readContract({
    address: token,
    abi: MOCK_ERC20_ABI,
    functionName: "balanceOf",
    args: [account]
  });
}

export async function readTakerStrategies(): Promise<TakerStrategy[]> {
  const { publicClient } = makeClients();
  const logs = await readLegAddedLogs(publicClient);
  const entries = uniqueStrategyEntries(logs.flatMap((log) => {
    const maker = log.args.maker;
    const reserveId = log.args.reserveId;
    const token = log.args.token;
    const key = token ? keyForToken(token) : null;
    return maker && reserveId && key ? [{ maker: getAddress(maker), reserveId, key }] : [];
  }));
  const sessions = uniqueSessions(entries.map(({ maker, reserveId }) => ({ maker, reserveId })));
  const snapshots = await Promise.all(
    sessions.map(async (session) => ({
      ...session,
      snapshot: await readOnchainSnapshot(session.maker, session.reserveId)
    }))
  );

  return snapshots.flatMap(({ maker, reserveId, snapshot }) => {
    if (!snapshot.reserve.active || !snapshot.reserve.exists) return [];

    const entryKeys = entries
      .filter((entry) => entry.maker === maker && entry.reserveId === reserveId)
      .map((entry) => entry.key);

    return entryKeys.flatMap((key) => {
      const leg = snapshot.legs[key];
      if (!leg.exists || snapshot.shipped[key] !== true) return [];
      return [{
        id: takerStrategyId(maker, reserveId, key),
        maker,
        reserveId,
        key,
        leg
      }];
    });
  });
}

async function readLegAddedLogs(publicClient: PublicClient) {
  const latest = await publicClient.getBlockNumber();
  const logs = [];

  for (let fromBlock = DRY_POWDER_ROUTER_DEPLOYMENT_BLOCK; fromBlock <= latest; fromBlock += LOG_BLOCK_CHUNK_SIZE + 1n) {
    const toBlock = latest < fromBlock + LOG_BLOCK_CHUNK_SIZE ? latest : fromBlock + LOG_BLOCK_CHUNK_SIZE;
    logs.push(...await publicClient.getLogs({
      address: DRY_POWDER_ROUTER,
      event: LEG_ADDED_EVENT,
      fromBlock,
      toBlock
    }));
  }

  return logs;
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

async function readLeg(account: Address, reserveId: Hex, key: LegKey) {
  const { publicClient } = makeClients(account);
  return publicClient.readContract({
    address: DRY_POWDER_ROUTER,
    abi: ROUTER_ABI,
    functionName: "getLeg",
    args: [account, reserveId, strategyInputs[key].asset]
  });
}

function uniqueSessions(sessions: Array<{ maker: Address; reserveId: Hex }>) {
  const seen = new Set<string>();
  return sessions.filter((session) => {
    const id = `${session.maker.toLowerCase()}:${session.reserveId}`;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function uniqueStrategyEntries(entries: Array<{ maker: Address; reserveId: Hex; key: LegKey }>) {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    const id = takerStrategyId(entry.maker, entry.reserveId, entry.key);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function takerStrategyId(maker: Address, reserveId: Hex, key: LegKey) {
  return `${maker.toLowerCase()}:${reserveId}:${key}`;
}

function keyForToken(token: Address): LegKey | null {
  const normalized = getAddress(token);
  return strategyKeys.find((key) => getAddress(strategyInputs[key].asset) === normalized) ?? null;
}

function tokenLabel(token: Address, strategyKey: LegKey) {
  return getAddress(token) === getAddress(TOKENS.mUSDC) ? "mUSDC" : `m${strategyInputs[strategyKey].label}`;
}

function tokenDecimals(token: Address, strategyKey: LegKey) {
  return getAddress(token) === getAddress(TOKENS.mUSDC) ? 6 : strategyInputs[strategyKey].decimals;
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

async function readWalletState(accountsMethod: "eth_requestAccounts" | "eth_accounts", knownAccounts?: Address[]): Promise<WalletState> {
  const provider = getProvider();
  const accounts = knownAccounts ?? await provider.request({ method: accountsMethod }) as Address[];
  const chainHex = await provider.request({ method: "eth_chainId" }) as Hex;
  const account = accounts[0] ? getAddress(accounts[0]) : undefined;
  if (!account) throw new Error("No wallet account returned.");

  return {
    account,
    chainId: Number.parseInt(chainHex, 16),
    ...(await readGasBalance(account))
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

  const reserveId = createReserveId(getAddress(account), Date.now().toString());
  window.localStorage.setItem(key, reserveId);
  return reserveId;
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
  const plans = strategyKeys.map((key) => buildStrategyPlan(account, reserveId, key));
  const balances = await Promise.all(
    plans.map((plan) =>
      publicClient.readContract({
        address: AQUA_ADDRESS,
        abi: ABI.AQUA_ABI,
        functionName: "rawBalances",
        args: [account, DRY_POWDER_ROUTER, plan.strategy.strategyHash, TOKENS.mUSDC]
      })
    )
  );

  const shipped = await Promise.all(balances.map(async ([, tokensCount], index) => {
    if (tokensCount > 0 && tokensCount !== 255) return true;
    const transaction = plans[index].shipTransaction;
    try {
      await publicClient.call({
        account,
        to: transaction.to,
        data: transaction.data,
        value: transaction.value
      });
      return false;
    } catch (error) {
      if (isAquaAlreadyShippedError(error)) return true;
      return false;
    }
  }));

  return Object.fromEntries(shipped.map((value, index) => [strategyKeys[index], value])) as Record<LegKey, boolean>;
}

async function isStrategyShipped(account: Address, reserveId: Hex, key: LegKey) {
  const { publicClient } = makeClients(account);
  const strategy = buildStrategy(key, account, reserveId);
  const [, tokensCount] = await publicClient.readContract({
    address: AQUA_ADDRESS,
    abi: ABI.AQUA_ABI,
    functionName: "rawBalances",
    args: [account, DRY_POWDER_ROUTER, strategy.strategyHash, TOKENS.mUSDC]
  });

  return tokensCount > 0 && tokensCount !== 255;
}

function isAquaAlreadyShippedError(error: unknown): boolean {
  return errorContains(error, [AQUA_STRATEGY_IMMUTABLE_SELECTOR, "StrategiesMustBeImmutable"]);
}

function isAquaDockMismatchError(error: unknown): boolean {
  return errorContains(error, [AQUA_DOCK_MISMATCH_SELECTOR, "DockingShouldCloseAllTokens"]);
}

function errorContains(error: unknown, needles: string[]): boolean {
  const seen = new Set<unknown>();
  const stack = [error];

  while (stack.length > 0) {
    const value = stack.pop();
    if (!value || seen.has(value)) continue;
    seen.add(value);

    if (typeof value === "string") {
      if (needles.some((needle) => value.includes(needle))) return true;
      continue;
    }

    if (typeof value !== "object") continue;
    for (const property of ["message", "shortMessage", "details", "data", "cause"]) {
      stack.push((value as Record<string, unknown>)[property]);
    }
  }

  return false;
}

function reserveStorageKey(account: Address) {
  return `dry-powder.reserve-id.${getAddress(account)}`;
}
