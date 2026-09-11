import { describe, expect, it, vi } from "vitest";
import type { Address, Hex } from "viem";
import { SEPOLIA_CHAIN_ID } from "./constants";
import { restoreWalletSession } from "./walletRestore";
import type { MakerSession, WalletState } from "./client";

const account = "0x000000000000000000000000000000000000dEaD" as Address;
const session = {
  maker: account,
  reserveId: "0x0000000000000000000000000000000000000000000000000000000000000000" as Hex
} satisfies MakerSession;
const wallet = {
  account,
  chainId: SEPOLIA_CHAIN_ID,
  gasBalance: 1n,
  gasBalanceLabel: "0.000000 ETH"
} satisfies WalletState;

describe("wallet restore flow", () => {
  it("keeps the wallet reconnect session when refreshing the on-chain snapshot fails", async () => {
    const forgetWalletConnection = vi.fn();
    const onSnapshotError = vi.fn();
    const onWalletRestored = vi.fn();

    await restoreWalletSession({
      forgetWalletConnection,
      getOrCreateMakerSession: () => session,
      loadSnapshot: vi.fn().mockRejectedValue(new Error("snapshot unavailable")),
      onSnapshotError,
      onWalletRestored,
      reconnectWallet: vi.fn().mockResolvedValue(wallet)
    });

    expect(onWalletRestored).toHaveBeenCalledWith(wallet, session);
    expect(onSnapshotError).toHaveBeenCalledWith(new Error("snapshot unavailable"));
    expect(forgetWalletConnection).not.toHaveBeenCalled();
  });
});
