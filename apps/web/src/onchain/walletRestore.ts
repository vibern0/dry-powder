import { SEPOLIA_CHAIN_ID } from "./constants";
import type { MakerSession, WalletState } from "./client";

type WalletRestoreDependencies = {
  reconnectWallet: () => Promise<WalletState | null>;
  forgetWalletConnection: () => void;
  getOrCreateMakerSession: (account: WalletState["account"]) => MakerSession;
  loadSnapshot: (session: MakerSession) => Promise<void>;
  onWalletRestored: (wallet: WalletState, session: MakerSession) => void;
  onSnapshotError?: (error: unknown) => void;
};

export async function restoreWalletSession({
  reconnectWallet,
  forgetWalletConnection,
  getOrCreateMakerSession,
  loadSnapshot,
  onWalletRestored,
  onSnapshotError
}: WalletRestoreDependencies) {
  let wallet: WalletState | null;
  try {
    wallet = await reconnectWallet();
  } catch {
    forgetWalletConnection();
    return;
  }

  if (!wallet) return;

  const session = getOrCreateMakerSession(wallet.account);
  onWalletRestored(wallet, session);

  if (wallet.chainId !== SEPOLIA_CHAIN_ID) return;

  try {
    await loadSnapshot(session);
  } catch (error) {
    onSnapshotError?.(error);
  }
}
