import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Address, EIP1193Provider } from "viem";

const viemMocks = vi.hoisted(() => ({
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

import { connectWallet, editStrategy, forgetWalletConnection, readOnchainSnapshot, reconnectWallet } from "./client";
import { createReserveId, strategyKeys } from "./strategy";

const account = "0x000000000000000000000000000000000000dEaD" as Address;

describe("wallet connection session", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});

describe("strategy updates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
