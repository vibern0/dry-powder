import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Address, EIP1193Provider } from "viem";

vi.mock("viem", async (importOriginal) => {
  const actual = await importOriginal<typeof import("viem")>();
  return {
    ...actual,
    createPublicClient: () => ({
      getBalance: vi.fn().mockResolvedValue(123456789000000000n)
    })
  };
});

import { connectWallet, forgetWalletConnection, reconnectWallet } from "./client";

const account = "0x000000000000000000000000000000000000dEaD" as Address;

describe("wallet connection session", () => {
  beforeEach(() => {
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
