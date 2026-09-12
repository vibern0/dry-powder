import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Address, EIP1193Provider } from "viem";

const viemMocks = vi.hoisted(() => ({
  call: vi.fn(),
  getBlockNumber: vi.fn(),
  getLogs: vi.fn(),
  getBalance: vi.fn(),
  readContract: vi.fn(),
  sendTransaction: vi.fn(),
  waitForTransactionReceipt: vi.fn(),
  writeContract: vi.fn()
}));

vi.mock("viem", async (importOriginal) => {
  const actual = await importOriginal<typeof import("viem")>();
  return {
    ...actual,
    createPublicClient: () => ({
      call: viemMocks.call,
      getBlockNumber: viemMocks.getBlockNumber,
      getLogs: viemMocks.getLogs,
      getBalance: viemMocks.getBalance,
      readContract: viemMocks.readContract,
      waitForTransactionReceipt: viemMocks.waitForTransactionReceipt
    }),
    createWalletClient: () => ({
      sendTransaction: viemMocks.sendTransaction,
      writeContract: viemMocks.writeContract
    })
  };
});

import { addStrategy, connectWallet, editStrategy, forgetWalletConnection, getOrCreateMakerSession, getTakerViewMakerSession, readOnchainSnapshot, readTakerStrategies, reconnectWallet, removeStrategy } from "./client";
import { createReserveId, strategyKeys } from "./strategy";
import { DRY_POWDER_ROUTER, DRY_POWDER_ROUTER_DEPLOYMENT_BLOCK, TOKENS } from "./constants";

const account = "0x000000000000000000000000000000000000dEaD" as Address;
const otherAccount = "0x000000000000000000000000000000000000bEEF" as Address;

describe("wallet connection session", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    viemMocks.getBlockNumber.mockResolvedValue(DRY_POWDER_ROUTER_DEPLOYMENT_BLOCK);
    viemMocks.call.mockResolvedValue({});
    viemMocks.getBalance.mockResolvedValue(123456789000000000n);
    viemMocks.waitForTransactionReceipt.mockResolvedValue({});
    viemMocks.writeContract.mockResolvedValue(`0x${"1".padStart(64, "0")}`);
    viemMocks.sendTransaction
      .mockResolvedValueOnce(`0x${"2".padStart(64, "0")}`)
      .mockResolvedValueOnce(`0x${"3".padStart(64, "0")}`);

    const storage = new Map<string, string>();

    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        removeItem: (key: string) => storage.delete(key),
        setItem: (key: string, value: string) => storage.set(key, value)
      }
    });
  });

  it("restores an authorized wallet without requesting account access again", async () => {
    setProvider([
      { method: "eth_requestAccounts", result: [account] },
      { method: "eth_chainId", result: "0xaa36a7" },
      { method: "eth_accounts", result: [account] },
      { method: "eth_chainId", result: "0xaa36a7" }
    ]);

    await connectWallet();
    const restored = await reconnectWallet();

    expect(restored).toEqual({
      account,
      chainId: 11155111,
      gasBalance: 123456789000000000n,
      gasBalanceLabel: "0.123456 ETH"
    });
  });

  it("does not restore after the user disconnects locally", async () => {
    setProvider([
      { method: "eth_requestAccounts", result: [account] },
      { method: "eth_chainId", result: "0xaa36a7" },
      { method: "eth_accounts", result: [account] }
    ]);

    await connectWallet();
    forgetWalletConnection();

    await expect(reconnectWallet()).resolves.toBeNull();
  });

  it("does not reuse another maker's session for the connected account", () => {
    const storedReserveId = createReserveId(account, "stored");
    const ownReserveId = createReserveId(otherAccount, "own");
    window.localStorage.setItem("dry-powder.maker-session", JSON.stringify({
      maker: account,
      reserveId: storedReserveId
    }));
    window.localStorage.setItem(`dry-powder.reserve-id.${otherAccount}`, ownReserveId);

    expect(getOrCreateMakerSession(otherAccount)).toEqual({
      maker: otherAccount,
      reserveId: ownReserveId
    });
  });

  it("keeps the saved public maker session available for takers", () => {
    const storedReserveId = createReserveId(account, "stored");
    const ownReserveId = createReserveId(otherAccount, "own");
    window.localStorage.setItem("dry-powder.maker-session", JSON.stringify({
      maker: account,
      reserveId: storedReserveId
    }));
    window.localStorage.setItem(`dry-powder.reserve-id.${otherAccount}`, ownReserveId);

    getOrCreateMakerSession(otherAccount);

    expect(getTakerViewMakerSession(otherAccount)).toEqual({
      maker: account,
      reserveId: storedReserveId
    });
  });
});

describe("strategy updates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    viemMocks.getBlockNumber.mockResolvedValue(DRY_POWDER_ROUTER_DEPLOYMENT_BLOCK);
    viemMocks.call.mockResolvedValue({});
    viemMocks.getBalance.mockResolvedValue(123456789000000000n);
    viemMocks.waitForTransactionReceipt.mockResolvedValue({});
    viemMocks.writeContract.mockResolvedValue(`0x${"1".padStart(64, "0")}`);
    viemMocks.sendTransaction
      .mockResolvedValueOnce(`0x${"2".padStart(64, "0")}`)
      .mockResolvedValueOnce(`0x${"3".padStart(64, "0")}`);

    vi.stubGlobal("window", {
      ethereum: { request: vi.fn() },
      localStorage: {
        getItem: vi.fn(),
        removeItem: vi.fn(),
        setItem: vi.fn()
      }
    });
  });

  it("updates the DryPowder leg without re-shipping Aqua inventory", async () => {
    const reserveId = createReserveId(account, "edit-test");
    const updates: string[] = [];

    await editStrategy(account, reserveId, "eth", [
      { entryPrice: "1700", maxSpend: "2000" },
      { entryPrice: "1500", maxSpend: "2000" },
      { entryPrice: "1300", maxSpend: "2000" }
    ], (update) => updates.push(update.message));

    expect(viemMocks.writeContract).toHaveBeenCalledWith(expect.objectContaining({
      functionName: "updateLeg"
    }));
    expect(viemMocks.sendTransaction).not.toHaveBeenCalled();
    expect(updates).toEqual([
      "Updating ETH max spend"
    ]);
  });

  it("hydrates leg ladder arrays when reading the onchain snapshot", async () => {
    const reserveId = createReserveId(account, "snapshot-test");

    viemMocks.readContract.mockImplementation(({ functionName }: { functionName: string }) => {
      if (functionName === "getReserve") return Promise.resolve({ totalBudget: 10000000000n, spent: 0n, active: true, exists: true });
      if (functionName === "getLeg") return Promise.resolve({ maxSpend: 16000000000n, spent: 0n, exists: true });
      if (functionName === "getLegSpendCaps") return Promise.resolve([4000000000n, 7000000000n, 16000000000n]);
      if (functionName === "getLegPriceBps") return Promise.resolve([10000n, 9231n, 6923n]);
      if (functionName === "balanceOf") return Promise.resolve(30000000000n);
      if (functionName === "rawBalances") return Promise.resolve([0n, 1n]);
      throw new Error(`Unexpected read: ${functionName}`);
    });

    const snapshot = await readOnchainSnapshot(account, reserveId);

    expect(snapshot.legs.wbtc.spendCaps).toEqual([4000000000n, 7000000000n, 16000000000n]);
    expect(snapshot.legs.wbtc.priceBps).toEqual([10000n, 9231n, 6923n]);
    expect(viemMocks.readContract).toHaveBeenCalledWith(expect.objectContaining({
      functionName: "getLegSpendCaps"
    }));
    expect(viemMocks.readContract).toHaveBeenCalledWith(expect.objectContaining({
      functionName: "getLegPriceBps"
    }));
    expect(Object.keys(snapshot.legs)).toHaveLength(strategyKeys.length);
  });

  it("treats Aqua immutable preflight as shipped when raw balance is stale", async () => {
    const reserveId = createReserveId(account, "snapshot-immutable");

    viemMocks.call.mockImplementation(({ data }: { data: string }) => {
      if (data.includes("0000000000000000000000000000000000000000000000000000000000000001")) {
        return Promise.reject(new Error("Custom error: 0x879f237b"));
      }
      return Promise.resolve({});
    });
    viemMocks.readContract.mockImplementation(({ functionName }: { functionName: string }) => {
      if (functionName === "getReserve") return Promise.resolve({ totalBudget: 10000000000n, spent: 0n, active: true, exists: true });
      if (functionName === "getLeg") return Promise.resolve({ maxSpend: 6000000000n, spent: 0n, exists: true });
      if (functionName === "getLegSpendCaps") return Promise.resolve([6000000000n]);
      if (functionName === "getLegPriceBps") return Promise.resolve([10000n]);
      if (functionName === "balanceOf") return Promise.resolve(30000000000n);
      if (functionName === "rawBalances") return Promise.resolve([0n, 0]);
      throw new Error(`Unexpected read: ${functionName}`);
    });

    const snapshot = await readOnchainSnapshot(account, reserveId);

    expect(snapshot.shipped.eth).toBe(true);
  });

  it("discovers shipped strategies across makers for takers", async () => {
    const firstReserveId = createReserveId(account, "first");
    const secondReserveId = createReserveId(otherAccount, "second");

    viemMocks.getLogs.mockResolvedValue([
      { args: { maker: account, reserveId: firstReserveId, token: TOKENS.mETH } },
      { args: { maker: otherAccount, reserveId: secondReserveId, token: TOKENS.mWBTC } }
    ]);
    viemMocks.readContract.mockImplementation(({ functionName, args }: { functionName: string; args: unknown[] }) => {
      if (functionName === "getReserve") return Promise.resolve({ totalBudget: 10000000000n, spent: 0n, active: true, exists: true });
      if (functionName === "getLeg") {
        const token = args[2];
        const exists = token === TOKENS.mETH || token === TOKENS.mWBTC;
        return Promise.resolve({ maxSpend: exists ? 6000000000n : 0n, spent: 0n, exists });
      }
      if (functionName === "getLegSpendCaps") return Promise.resolve([6000000000n]);
      if (functionName === "getLegPriceBps") return Promise.resolve([10000n]);
      if (functionName === "balanceOf") return Promise.resolve(30000000000n);
      if (functionName === "rawBalances") {
        const makerArg = args[0];
        return Promise.resolve([0n, makerArg === account || makerArg === otherAccount ? 1n : 0n]);
      }
      throw new Error(`Unexpected read: ${functionName}`);
    });

    const strategies = await readTakerStrategies();

    expect(strategies.map((strategy) => ({
      maker: strategy.maker,
      reserveId: strategy.reserveId,
      key: strategy.key
    }))).toEqual([
      { maker: account, reserveId: firstReserveId, key: "eth" },
      { maker: otherAccount, reserveId: secondReserveId, key: "wbtc" }
    ]);
  });

  it("chunks taker strategy log reads under the RPC block range limit", async () => {
    viemMocks.getBlockNumber.mockResolvedValue(DRY_POWDER_ROUTER_DEPLOYMENT_BLOCK + 10_500n);
    viemMocks.getLogs.mockResolvedValue([]);

    await readTakerStrategies();

    expect(viemMocks.getLogs).toHaveBeenCalledTimes(2);
    expect(viemMocks.getLogs).toHaveBeenNthCalledWith(1, expect.objectContaining({
      fromBlock: DRY_POWDER_ROUTER_DEPLOYMENT_BLOCK,
      toBlock: DRY_POWDER_ROUTER_DEPLOYMENT_BLOCK + 9_999n
    }));
    expect(viemMocks.getLogs).toHaveBeenNthCalledWith(2, expect.objectContaining({
      fromBlock: DRY_POWDER_ROUTER_DEPLOYMENT_BLOCK + 10_000n,
      toBlock: DRY_POWDER_ROUTER_DEPLOYMENT_BLOCK + 10_500n
    }));
  });

  it("does not require maker-side asset inventory before shipping a buy strategy", async () => {
    const reserveId = createReserveId(account, "new-asset");
    const updates: string[] = [];
    viemMocks.readContract.mockImplementation(({ functionName, address }: { functionName: string; address: Address }) => {
      if (functionName === "getReserve") return Promise.resolve({ totalBudget: 10000000000n, spent: 0n, active: true, exists: true });
      if (functionName === "getLeg") return Promise.resolve({ maxSpend: 0n, spent: 0n, exists: false });
      if (functionName === "balanceOf") return Promise.resolve(address === TOKENS.mUSDC ? 30000000000n : 0n);
      if (functionName === "allowance") return Promise.resolve(address === TOKENS.mUSDC ? 2n ** 256n - 1n : 0n);
      if (functionName === "rawBalances") return Promise.resolve([0n, 0]);
      throw new Error(`Unexpected read: ${functionName}`);
    });

    await addStrategy(account, reserveId, "eth", (update) => updates.push(update.message));

    expect(viemMocks.writeContract).toHaveBeenCalledWith(expect.objectContaining({
      address: DRY_POWDER_ROUTER,
      functionName: "addLeg"
    }));
    expect(viemMocks.writeContract).not.toHaveBeenCalledWith(expect.objectContaining({
      address: TOKENS.mETH
    }));
    expect(viemMocks.sendTransaction).toHaveBeenCalled();
    expect(updates).not.toContain("Minting maker 10 mETH");
    expect(updates).not.toContain("Approving mETH for Aqua");
  });

  it("updates and ships an existing unshipped leg instead of adding it again", async () => {
    const reserveId = createReserveId(account, "existing-unshipped");

    viemMocks.readContract.mockImplementation(({ functionName, address }: { functionName: string; address: Address }) => {
      if (functionName === "getReserve") return Promise.resolve({ totalBudget: 10000000000n, spent: 0n, active: true, exists: true });
      if (functionName === "getLeg") return Promise.resolve({ maxSpend: 6000000000n, spent: 0n, exists: true });
      if (functionName === "balanceOf") return Promise.resolve(address === TOKENS.mUSDC ? 30000000000n : 0n);
      if (functionName === "allowance") return Promise.resolve(address === TOKENS.mUSDC ? 2n ** 256n - 1n : 0n);
      if (functionName === "rawBalances") return Promise.resolve([0n, 0]);
      throw new Error(`Unexpected read: ${functionName}`);
    });

    await addStrategy(account, reserveId, "eth", () => {});

    expect(viemMocks.writeContract).toHaveBeenCalledWith(expect.objectContaining({
      address: DRY_POWDER_ROUTER,
      functionName: "updateLeg"
    }));
    expect(viemMocks.writeContract).not.toHaveBeenCalledWith(expect.objectContaining({
      address: DRY_POWDER_ROUTER,
      functionName: "addLeg"
    }));
    expect(viemMocks.sendTransaction).toHaveBeenCalled();
  });

  it("does not ship an Aqua strategy again when the strategy hash is already active", async () => {
    const reserveId = createReserveId(account, "already-shipped");

    viemMocks.readContract.mockImplementation(({ functionName, address }: { functionName: string; address: Address }) => {
      if (functionName === "getReserve") return Promise.resolve({ totalBudget: 10000000000n, spent: 0n, active: true, exists: true });
      if (functionName === "getLeg") return Promise.resolve({ maxSpend: 6000000000n, spent: 0n, exists: true });
      if (functionName === "balanceOf") return Promise.resolve(address === TOKENS.mUSDC ? 30000000000n : 0n);
      if (functionName === "allowance") return Promise.resolve(address === TOKENS.mUSDC ? 2n ** 256n - 1n : 0n);
      if (functionName === "rawBalances") return Promise.resolve([18000000000n, 1]);
      throw new Error(`Unexpected read: ${functionName}`);
    });

    await addStrategy(account, reserveId, "eth", () => {});

    expect(viemMocks.writeContract).toHaveBeenCalledWith(expect.objectContaining({
      address: DRY_POWDER_ROUTER,
      functionName: "updateLeg"
    }));
    expect(viemMocks.sendTransaction).not.toHaveBeenCalled();
  });

  it("skips Aqua ship when preflight reports the strategy is immutable", async () => {
    const reserveId = createReserveId(account, "immutable-preflight");
    const updates: string[] = [];

    viemMocks.call.mockRejectedValueOnce(new Error("Custom error: 0x879f237b"));
    viemMocks.readContract.mockImplementation(({ functionName, address }: { functionName: string; address: Address }) => {
      if (functionName === "getReserve") return Promise.resolve({ totalBudget: 10000000000n, spent: 0n, active: true, exists: true });
      if (functionName === "getLeg") return Promise.resolve({ maxSpend: 6000000000n, spent: 0n, exists: true });
      if (functionName === "balanceOf") return Promise.resolve(address === TOKENS.mUSDC ? 30000000000n : 0n);
      if (functionName === "allowance") return Promise.resolve(address === TOKENS.mUSDC ? 2n ** 256n - 1n : 0n);
      if (functionName === "rawBalances") return Promise.resolve([0n, 0]);
      throw new Error(`Unexpected read: ${functionName}`);
    });

    await addStrategy(account, reserveId, "eth", (update) => updates.push(update.message));

    expect(viemMocks.writeContract).toHaveBeenCalledWith(expect.objectContaining({
      address: DRY_POWDER_ROUTER,
      functionName: "updateLeg"
    }));
    expect(viemMocks.sendTransaction).not.toHaveBeenCalled();
    expect(updates).toContain("ETH Aqua strategy already shipped");
  });

  it("docks legacy strategies with every token Aqua recorded", async () => {
    const reserveId = createReserveId(account, "legacy-dock");

    viemMocks.readContract.mockImplementation(({ functionName, args }: { functionName: string; args: unknown[] }) => {
      if (functionName === "rawBalances") {
        const token = args[3];
        if (token === TOKENS.mUSDC || token === TOKENS.mETH) return Promise.resolve([1000000000n, 2]);
        return Promise.resolve([0n, 0]);
      }
      throw new Error(`Unexpected read: ${functionName}`);
    });

    await removeStrategy(account, reserveId, "eth", () => {});

    const dockData = viemMocks.sendTransaction.mock.calls[0][0].data.toLowerCase();
    expect(dockData).toContain(TOKENS.mUSDC.slice(2).toLowerCase());
    expect(dockData).toContain(TOKENS.mETH.slice(2).toLowerCase());
  });

  it("docks the asset token when Aqua reports a legacy token count on mUSDC only", async () => {
    const reserveId = createReserveId(account, "legacy-dock-stale-token");

    viemMocks.readContract.mockImplementation(({ functionName, args }: { functionName: string; args: unknown[] }) => {
      if (functionName === "rawBalances") {
        const token = args[3];
        if (token === TOKENS.mUSDC) return Promise.resolve([1000000000n, 2]);
        return Promise.resolve([0n, 0]);
      }
      throw new Error(`Unexpected read: ${functionName}`);
    });

    await removeStrategy(account, reserveId, "eth", () => {});

    const dockData = viemMocks.sendTransaction.mock.calls[0][0].data.toLowerCase();
    expect(dockData).toContain(TOKENS.mUSDC.slice(2).toLowerCase());
    expect(dockData).toContain(TOKENS.mETH.slice(2).toLowerCase());
  });

  it("removes the router leg even when Aqua dock preflight is impossible", async () => {
    const reserveId = createReserveId(account, "undockable-remove");
    const updates: string[] = [];

    viemMocks.call.mockRejectedValueOnce(new Error("Custom error: 0xbbe8d44d"));
    viemMocks.readContract.mockImplementation(({ functionName, args }: { functionName: string; args: unknown[] }) => {
      if (functionName === "rawBalances") {
        const token = args[3];
        if (token === TOKENS.mUSDC) return Promise.resolve([1000000000n, 1]);
        return Promise.resolve([0n, 0]);
      }
      throw new Error(`Unexpected read: ${functionName}`);
    });

    await removeStrategy(account, reserveId, "eth", (update) => updates.push(update.message));

    expect(viemMocks.writeContract).toHaveBeenCalledWith(expect.objectContaining({
      address: DRY_POWDER_ROUTER,
      functionName: "removeLeg"
    }));
    expect(viemMocks.sendTransaction).not.toHaveBeenCalled();
    expect(updates).toContain("Skipping ETH Aqua dock; removing router leg only");
  });
});

function setProvider(responses: Array<{ method: string; result: unknown }>) {
  const requests: string[] = [];
  const provider = {
    request: vi.fn(async ({ method }: { method: string }) => {
      requests.push(method);
      const next = responses.shift();
      if (!next || next.method !== method) {
        throw new Error(`Unexpected ${method}; saw ${requests.join(", ")}`);
      }
      return next.result;
    })
  } as unknown as EIP1193Provider;

  Object.assign(window, { ethereum: provider });
}
