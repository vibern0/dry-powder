import { ArrowRight, Check, Coins, Droplets, Gauge, Plus, RotateCcw, Settings, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  applyLegSnapshot,
  disableStrategySetAsset,
  enableStrategySetAsset,
  formatUsd,
  getFillAmountDefault,
  getStrategyDraftSpendTotal,
  getStrategySetDraftDefaults,
  getStrategySetExposure,
  initialDemo,
  isStrategySetOvercommitted,
  selectActiveStrategyKeys,
  selectLadderRow,
  summarizeReserve,
  type DemoState,
  type Leg,
  type LegKey,
  type StrategySetDraft
} from "./demoModel";
import {
  addStrategy,
  approveAqua,
  connectWallet,
  createFreshMakerSession,
  editStrategy,
  executeFillForMaker,
  forgetWalletConnection,
  getOrCreateMakerSession,
  hasInjectedWallet,
  mintMakerReserveTokens,
  mintTakerAssetTokens,
  quoteStrategies,
  readOnchainSnapshot,
  reconnectWallet,
  removeStrategy,
  switchToSepolia,
  useConnectedAccountAsMaker,
  type StepKey,
  type MakerSession,
  type TransactionUpdate,
  type WalletState
} from "./onchain/client";
import { SEPOLIA_CHAIN_ID, TOKENS } from "./onchain/constants";
import { roleForAccount, strategyInputs, strategyKeys } from "./onchain/strategy";
import { restoreWalletSession } from "./onchain/walletRestore";

type DemoPage = "maker" | "taker" | "setup";

const setupSteps: Array<{ key: StepKey; label: string }> = [
  { key: "mint", label: "Mint maker mUSDC" },
  { key: "approveAqua", label: "Approve Aqua" }
];

const txRows = [
  ["Network", "Sepolia"],
  ["Aqua registry", "0x1111...6a90a"],
  ["Router", "0xbf5E...5A9B"],
  ["Mode", "Live Sepolia"]
];

const firstStrategyKey = strategyKeys[0];

export function App() {
  const [state, setState] = useState<DemoState>(initialDemo);
  const [wallet, setWallet] = useState<WalletState | null>(null);
  const [makerSession, setMakerSession] = useState<MakerSession | null>(null);
  const [completed, setCompleted] = useState<Partial<Record<StepKey, boolean>>>({});
  const [pending, setPending] = useState<StepKey | "connect" | "switch" | "refresh" | null>(null);
  const [eventLog, setEventLog] = useState<TransactionUpdate[]>([]);
  const [quotes, setQuotes] = useState<Record<LegKey, string> | null>(null);
  const [page, setPage] = useState<DemoPage>("maker");
  const [activeLegKeys, setActiveLegKeys] = useState<LegKey[]>([]);
  const [strategyModalOpen, setStrategyModalOpen] = useState(false);
  const [strategyDraft, setStrategyDraft] = useState<StrategySetDraft>(() => getStrategySetDraftDefaults([]));
  const [fillAsset, setFillAsset] = useState<LegKey>(firstStrategyKey);
  const [fillAmount, setFillAmount] = useState("4000");
  const [makerReserveBalance, setMakerReserveBalance] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reserveCreated = Boolean(completed.createReserve);
  const strategiesActive = activeLegKeys.length > 0;
  const visibleState = strategiesActive ? { ...state, legs: state.legs.filter((leg) => activeLegKeys.includes(leg.key)) } : { ...state, legs: [] };
  const summary = useMemo(
    () => summarizeReserve(visibleState, makerReserveBalance ?? visibleState.reserve.totalBudget),
    [makerReserveBalance, visibleState]
  );
  const wrongNetwork = wallet && wallet.chainId !== SEPOLIA_CHAIN_ID;
  const role = wallet ? roleForAccount(wallet.account, makerSession?.maker ?? null) : "maker";
  const reserveId = makerSession?.reserveId;
  const fillableStrategyKeys = activeLegKeys.length ? activeLegKeys : strategyKeys;

  useEffect(() => {
    if (!hasInjectedWallet()) return;

    let active = true;

    void restoreWalletSession({
      reconnectWallet,
      forgetWalletConnection,
      getOrCreateMakerSession,
      loadSnapshot,
      onWalletRestored: (next, session) => {
        if (!active) return;
        setWallet(next);
        setMakerSession(session);
        setEventLog([{ step: "quote", message: `Wallet restored as ${roleForAccount(next.account, session.maker)}: ${shortAddress(next.account)}` }]);
      },
      onSnapshotError: (caught) => {
        if (!active) return;
        setError(caught instanceof Error ? caught.message : "Could not refresh on-chain snapshot.");
      }
    });

    return () => {
      active = false;
    };
  }, []);

  async function connect() {
    await run("connect", async () => {
      const next = await connectWallet();
      const session = makerSession ?? getOrCreateMakerSession(next.account);
      setWallet(next);
      setMakerSession(session);
      if (next.chainId === SEPOLIA_CHAIN_ID) await loadSnapshot(session);
      setEventLog([{ step: "quote", message: `Wallet connected as ${roleForAccount(next.account, session.maker)}: ${shortAddress(next.account)}` }]);
    });
  }

  function disconnect() {
    forgetWalletConnection();
    setWallet(null);
    setQuotes(null);
    setError(null);
    setPending(null);
    setEventLog([{ step: "quote", message: "Wallet disconnected locally. Maker session preserved." }]);
  }

  async function switchNetwork() {
    await run("switch", async () => {
      await switchToSepolia();
      const next = await connectWallet();
      setWallet(next);
      const session = makerSession ?? getOrCreateMakerSession(next.account);
      setMakerSession(session);
      if (next.chainId === SEPOLIA_CHAIN_ID) await loadSnapshot(session);
    });
  }

  async function rotateReserve() {
    if (!wallet || !isMakerRole) return;
    const next = createFreshMakerSession(wallet.account);
    setMakerSession(next);
    setState(initialDemo);
    setMakerReserveBalance(null);
    setCompleted({});
    setQuotes(null);
    setActiveLegKeys([]);
    setEventLog([{ step: "quote", message: "Fresh reserve id ready for another demo run." }]);
  }

  function setConnectedAsMaker() {
    if (!wallet) return;
    const session = useConnectedAccountAsMaker(wallet.account);
    setMakerSession(session);
    setState(initialDemo);
    setMakerReserveBalance(null);
    setCompleted({});
    setQuotes(null);
    setActiveLegKeys([]);
    setEventLog([{ step: "quote", message: `Maker set to ${shortAddress(wallet.account)}.` }]);
  }

  async function refresh() {
    if (!makerSession) return;
    await run("refresh", async () => {
      await loadSnapshot(makerSession);
    });
  }

  async function loadSnapshot(target: MakerSession) {
    const snapshot = await readOnchainSnapshot(target.maker, target.reserveId);
    setState(applySnapshot(snapshot.reserve, snapshot.legs));
    setMakerReserveBalance(formatTokenAmount(snapshot.balances[TOKENS.mUSDC]));
    const nextActiveLegKeys = selectActiveStrategyKeys(strategyKeys, snapshot.legs);
    setActiveLegKeys(nextActiveLegKeys);
    setFillAsset((current) => {
      if (nextActiveLegKeys.includes(current) || nextActiveLegKeys.length === 0) return current;
      const nextAsset = nextActiveLegKeys[0];
      setFillAmount(getFillAmountDefault(nextAsset));
      return nextAsset;
    });
    setCompleted((previous) => ({
      ...previous,
      createReserve: snapshot.reserve.exists,
      addStrategy: nextActiveLegKeys.length > 0,
      removeStrategy: false
    }));
  }

  async function runSetupStep(step: StepKey) {
    if (!wallet || !makerSession) return;
    const actions: Record<StepKey, () => Promise<void>> = {
      mint: () => mintMakerReserveTokens(wallet.account, pushEvent),
      mintTaker: () => mintTakerAssetTokens(wallet.account, pushEvent),
      approveAqua: () => approveAqua(wallet.account, pushEvent),
      createReserve: async () => {},
      activateReserve: async () => {},
      addStrategy: async () => {},
      editStrategy: async () => {},
      removeStrategy: async () => {},
      quote: async () => {
        const nextQuotes = await quoteStrategies(makerSession.maker, makerSession.reserveId, activeLegKeys);
        setQuotes(Object.fromEntries(nextQuotes.map((quote) => [quote.key, quote.label])) as Record<LegKey, string>);
        pushEvent({ step: "quote", message: "Quotes refreshed from DryPowderRouter." });
      },
      fill: async () => {
        await executeFillForMaker(wallet.account, makerSession.maker, makerSession.reserveId, fillAsset, fillAmount, pushEvent);
        setCompleted((previous) => ({ ...previous, fill: true }));
        await refresh();
      }
    };

    await run(step, async () => {
      await actions[step]();
      setCompleted((previous) => ({
        ...previous,
        [step]: true
      }));
    });
  }

  function openStrategyModal() {
    const legByKey = new Map(state.legs.map((leg) => [leg.key, leg]));
    setStrategyDraft((current) => ({
      assets: getStrategySetDraftDefaults(activeLegKeys).assets.map((defaultDraft) => {
        const activeLeg = legByKey.get(defaultDraft.asset);
        if (activeLegKeys.includes(defaultDraft.asset) && activeLeg) {
          return {
            ...defaultDraft,
            enabled: true,
            ladder: activeLeg.ladder.map((row) => ({
              entryPrice: String(row.entryPrice),
              maxSpend: String(row.maxSpend)
            }))
          };
        }
        const currentDraft = current.assets.find((assetDraft) => assetDraft.asset === defaultDraft.asset);
        const hasCurrentSpend = currentDraft?.ladder.some((row) => row.maxSpend) ?? false;
        return activeLegKeys.includes(defaultDraft.asset) && currentDraft && hasCurrentSpend ? { ...currentDraft, enabled: true } : defaultDraft;
      })
    }));
    setStrategyModalOpen(true);
  }

  function updateFillAsset(asset: LegKey) {
    setFillAsset(asset);
    setFillAmount(getFillAmountDefault(asset));
  }

  async function setSelectedStrategy(draft: StrategySetDraft) {
    if (!wallet || !makerSession || !isMakerRole) return;
    await run("addStrategy", async () => {
      const enabledKeys = draft.assets.filter((asset) => asset.enabled).map((asset) => asset.asset);
      const activeKeySet = new Set(activeLegKeys);
      for (const key of activeLegKeys) {
        if (!enabledKeys.includes(key)) await removeStrategy(wallet.account, makerSession.reserveId, key, pushEvent);
      }
      for (const assetDraft of draft.assets) {
        if (!assetDraft.enabled) continue;
        if (activeKeySet.has(assetDraft.asset)) {
          await editStrategy(wallet.account, makerSession.reserveId, assetDraft.asset, assetDraft.ladder, pushEvent);
        } else {
          await addStrategy(wallet.account, makerSession.reserveId, assetDraft.asset, pushEvent, {
            ladder: assetDraft.ladder
          });
        }
      }
      const nextFillAsset = enabledKeys[0] ?? firstStrategyKey;
      setFillAsset(nextFillAsset);
      setFillAmount(getFillAmountDefault(nextFillAsset));
      setQuotes(null);
      setCompleted((previous) => ({ ...previous, fill: false }));
      setStrategyModalOpen(false);
      await loadSnapshot(makerSession);
    });
  }

  function pushEvent(update: TransactionUpdate) {
    setEventLog((previous) => [update, ...previous].slice(0, 8));
  }

  async function run(active: typeof pending, action: () => Promise<void>) {
    try {
      setError(null);
      setPending(active);
      await action();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Transaction failed.");
    } finally {
      setPending(null);
    }
  }

  const isMakerRole = role === "maker";
  const isTakerRole = role === "taker";

  return (
    <main className="app-shell">
      <TopNav
        wallet={wallet}
        pending={pending}
        page={page}
        canResetReserve={Boolean(wallet) && isMakerRole && pending === null}
        onPageChange={setPage}
        onResetReserve={rotateReserve}
        onConnect={connect}
        onDisconnect={disconnect}
      />

      <section className="hero-grid">
        <div className="story-panel">
          <div className="kicker">
            <Droplets size={16} />
            Dry Powder for Aqua
          </div>
          <h1>Shared capital, coordinated across strategies.</h1>
          <p>
            Dry Powder keeps mUSDC flexible, deploying shared reserves to the best opportunity instead of leaving
            capital fragmented across idle quotes.
          </p>

          {error ? <div className="error-banner">{error}</div> : null}
        </div>

        <ReserveCard summary={summary} active={Boolean(makerSession) && reserveCreated} />
      </section>

      {page === "setup" ? (
      <section className="setup-page-grid">
        <div className="setup-column">
          <PanelTitle icon={<Settings size={18} />} title="Wallet & Network" />
          {!wallet ? (
            <button className="wide-action" onClick={connect} disabled={!hasInjectedWallet() || pending !== null}>
              {pending === "connect" ? "Connecting..." : hasInjectedWallet() ? "Connect wallet" : "No wallet found"}
            </button>
          ) : wrongNetwork ? (
            <button className="wide-action" onClick={switchNetwork} disabled={pending !== null}>
              {pending === "switch" ? "Switching..." : "Switch to Sepolia"}
            </button>
          ) : (
            <div className={wallet.gasBalance === 0n ? "wallet-chip warning" : "wallet-chip"}>
              {role} · {shortAddress(wallet.account)} · {wallet.gasBalanceLabel}
            </div>
          )}
          <RolePanel wallet={wallet} makerSession={makerSession} onSync={connect} onUseAsMaker={setConnectedAsMaker} pending={pending} />
          <div className="step-list">
            {setupSteps.map((step) => (
              <button className="step-row" key={step.key} onClick={() => runSetupStep(step.key)} disabled={!wallet || Boolean(wrongNetwork) || !isMakerRole || pending !== null || isStepDisabled(step.key, completed)}>
                <span className="step-icon">
                  {completed[step.key] ? <Check size={14} /> : pending === step.key ? "·" : ""}
                </span>
                <span>{pending === step.key ? "Confirm in wallet..." : step.label}</span>
              </button>
            ))}
            <button className="step-row" onClick={() => runSetupStep("mintTaker")} disabled={!wallet || Boolean(wrongNetwork) || !isTakerRole || pending !== null}>
              <span className="step-icon">{completed.mintTaker ? <Check size={14} /> : pending === "mintTaker" ? "·" : ""}</span>
              <span>{pending === "mintTaker" ? "Confirm in wallet..." : "Mint taker assets"}</span>
            </button>
          </div>

          <div className="network-card">
            {txRows.map(([label, value]) => (
              <div className="network-row" key={label}>
                <span>{label}</span>
                <strong>{value}</strong>
              </div>
            ))}
            <div className="network-row">
              <span>Reserve id</span>
              <strong>{reserveId ? shortHash(reserveId) : "not set"}</strong>
            </div>
          </div>
        </div>
        <ActivityPanel eventLog={eventLog} />
      </section>
      ) : (
      <section className="workspace-grid content-grid">

        <div className="legs-column">
          <PanelTitle icon={<Coins size={18} />} title={page === "maker" ? "Maker Strategies" : "Taker Fills"} />
          <div className="strategy-actions">
            {page === "maker" ? (
              <button className="secondary-action" onClick={openStrategyModal} disabled={!wallet || Boolean(wrongNetwork) || !isMakerRole || pending !== null}>
                <Settings size={15} />
                {pending === "addStrategy" ? "Setting..." : "Set strategy"}
              </button>
            ) : null}
            <button className="secondary-action" onClick={refresh} disabled={!wallet || Boolean(wrongNetwork) || pending !== null}>
              {pending === "refresh" ? "Refreshing..." : "Refresh"}
            </button>
          </div>
          {page === "taker" ? (
            <div className="fill-panel">
              <label>
                <span>Fill asset</span>
                <select className="select-input" value={fillAsset} onChange={(event) => updateFillAsset(event.target.value as LegKey)} disabled={!strategiesActive}>
                  {fillableStrategyKeys.map((key) => (
                    <option value={key} key={key}>{strategyInputs[key].label}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>mUSDC amount</span>
                <input className="text-input" value={fillAmount} onChange={(event) => setFillAmount(event.target.value)} inputMode="decimal" />
              </label>
              <button className="secondary-action" onClick={() => runSetupStep("quote")} disabled={!wallet || Boolean(wrongNetwork) || !strategiesActive || pending !== null}>
                {pending === "quote" ? "Quoting..." : "Refresh quotes"}
              </button>
              <button className="secondary-action primary-inline" onClick={() => runSetupStep("fill")} disabled={!wallet || Boolean(wrongNetwork) || !isTakerRole || !strategiesActive || pending !== null || !fillAmount}>
                {pending === "fill" ? "Confirming..." : `Fill ${strategyInputs[fillAsset].label}`}
              </button>
            </div>
          ) : null}
          {strategiesActive ? (
            <div className="leg-grid">
              {visibleState.legs.map((leg) => (
                <LegCard
                  key={leg.key}
                  leg={leg}
                  quote={quotes?.[leg.key]}
                  active={leg.key === fillAsset && Boolean(completed.fill)}
                />
              ))}
            </div>
          ) : (
            <EmptyPanel
              title={reserveCreated ? "No Aqua strategies active" : "No Aqua strategies yet"}
              detail={page === "maker" ? "Use Add to create and ship one strategy at a time." : "Ask the maker to add a strategy, then quote and fill it here."}
            />
          )}
        </div>

        <ActivityPanel eventLog={eventLog} />
      </section>
      )}
      {strategyModalOpen ? (
        <StrategyModal
          draft={strategyDraft}
          makerReserveBalance={makerReserveBalance ?? summary.totalBudget}
          pending={pending}
          onChange={setStrategyDraft}
          onClose={() => setStrategyModalOpen(false)}
          onSubmit={setSelectedStrategy}
        />
      ) : null}
    </main>
  );
}

function TopNav({
  wallet,
  pending,
  page,
  canResetReserve,
  onPageChange,
  onResetReserve,
  onConnect,
  onDisconnect
}: {
  wallet: WalletState | null;
  pending: StepKey | "connect" | "switch" | "refresh" | null;
  page: DemoPage;
  canResetReserve: boolean;
  onPageChange: (page: DemoPage) => void;
  onResetReserve: () => void;
  onConnect: () => void;
  onDisconnect: () => void;
}) {
  return (
    <nav className="top-nav">
      <div className="brand-lockup">
        <img className="brand-mark" src="/logo.png" alt="" aria-hidden="true" />
        <span>Dry Powder</span>
      </div>
      <div className="nav-links" aria-label="Demo pages">
        <button className={page === "maker" ? "selected-pill" : ""} onClick={() => onPageChange("maker")}>Maker</button>
        <button className={page === "taker" ? "selected-pill" : ""} onClick={() => onPageChange("taker")}>Taker</button>
        <button className={page === "setup" ? "selected-pill" : ""} onClick={() => onPageChange("setup")}>Setup</button>
      </div>
      <div className="nav-actions">
        <button className="icon-action" onClick={onResetReserve} aria-label="Create fresh reserve id" title="Create fresh reserve id" disabled={!canResetReserve}>
          <RotateCcw size={18} />
        </button>
        <button className="connect-preview" onClick={wallet ? onDisconnect : onConnect} disabled={pending !== null || (!wallet && !hasInjectedWallet())}>
          {wallet ? `Disconnect ${shortAddress(wallet.account)}` : pending === "connect" ? "Connecting..." : "Connect wallet"}
        </button>
      </div>
    </nav>
  );
}

function RolePanel({
  wallet,
  makerSession,
  pending,
  onSync,
  onUseAsMaker
}: {
  wallet: WalletState | null;
  makerSession: MakerSession | null;
  pending: StepKey | "connect" | "switch" | "refresh" | null;
  onSync: () => void;
  onUseAsMaker: () => void;
}) {
  if (!wallet) {
    return (
      <div className="role-panel">
        <span>Maker</span>
        <strong>{makerSession ? `${shortAddress(makerSession.maker)} preserved` : "Connect the maker wallet first."}</strong>
      </div>
    );
  }

  const role = roleForAccount(wallet.account, makerSession?.maker ?? null);

  return (
    <div className="role-panel">
      <div>
        <span>Maker</span>
        <strong>{makerSession ? shortAddress(makerSession.maker) : "not set"}</strong>
      </div>
      <div>
        <span>Connected</span>
        <strong>{role} · {shortAddress(wallet.account)}</strong>
      </div>
      <button className="mini-action" onClick={onSync} disabled={pending !== null}>
        Sync wallet
      </button>
      {role === "taker" ? (
        <button className="mini-action muted" onClick={onUseAsMaker} disabled={pending !== null}>
          Use connected as maker
        </button>
      ) : null}
    </div>
  );
}

function applySnapshot(reserveSnapshot: { totalBudget: bigint; spent: bigint }, legs: Record<LegKey, { maxSpend: bigint; spent: bigint; spendCaps?: readonly bigint[]; priceBps?: readonly bigint[] }>): DemoState {
  return {
    ...initialDemo,
    reserve: {
      totalBudget: Number(reserveSnapshot.totalBudget) / 1_000_000,
      spent: Number(reserveSnapshot.spent) / 1_000_000
    },
    legs: initialDemo.legs.map((leg) => applyLegSnapshot(leg, legs[leg.key])),
    eventLog: initialDemo.eventLog
  };
}

function ActivityPanel({ eventLog }: { eventLog: TransactionUpdate[] }) {
  return (
    <div className="events-column">
      <PanelTitle icon={<Gauge size={18} />} title="Quote Story" />
      <div className="event-list">
        {(eventLog.length ? eventLog.map(formatEvent) : ["Connect wallet to begin the live Sepolia demo."]).map((event) => (
          <div className="event-row" key={event}>
            <ArrowRight size={15} />
            <span>{event}</span>
          </div>
        ))}
      </div>
      <div className="next-card">
        <span>Integration</span>
        <strong>viem wallet writes, DryPowderRouter reads, Aqua SDK ship and dock calldata.</strong>
      </div>
    </div>
  );
}

function StrategyModal({
  draft,
  makerReserveBalance,
  pending,
  onChange,
  onClose,
  onSubmit
}: {
  draft: StrategySetDraft;
  makerReserveBalance: number;
  pending: StepKey | "connect" | "switch" | "refresh" | null;
  onChange: (draft: StrategySetDraft) => void;
  onClose: () => void;
  onSubmit: (draft: StrategySetDraft) => void;
}) {
  const exposure = getStrategySetExposure(draft, makerReserveBalance);
  const overcommitted = isStrategySetOvercommitted(draft, makerReserveBalance);
  const incomplete = draft.assets.some((asset) => asset.enabled && asset.ladder.some((row) => !row.entryPrice || !row.maxSpend));
  const disabled = pending !== null || incomplete || overcommitted;
  const selectedAssets = draft.assets.filter((asset) => asset.enabled);
  const availableAssets = draft.assets.filter((asset) => !asset.enabled);
  const [assetToAdd, setAssetToAdd] = useState<LegKey | "">(availableAssets[0]?.asset ?? "");

  function addAsset() {
    const asset = availableAssets.some((assetDraft) => assetDraft.asset === assetToAdd) ? assetToAdd : availableAssets[0]?.asset;
    if (!asset) return;
    onChange(enableStrategySetAsset(draft, asset));
    setAssetToAdd(availableAssets.find((assetDraft) => assetDraft.asset !== asset)?.asset ?? "");
  }

  function removeAsset(asset: LegKey) {
    onChange(disableStrategySetAsset(draft, asset));
    setAssetToAdd((current) => current || asset);
  }

  function updateRow(asset: LegKey, index: number, field: "entryPrice" | "maxSpend", value: string) {
    onChange({
      ...draft,
      assets: draft.assets.map((assetDraft) => assetDraft.asset === asset ? {
        ...assetDraft,
        ladder: assetDraft.ladder.map((row, rowIndex) => rowIndex === index ? { ...row, [field]: value } : row)
      } : assetDraft)
    });
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <form
        className="strategy-modal"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(draft);
        }}
      >
        <div className="modal-header">
          <div>
            <span>Strategy</span>
            <h2>Set strategy</h2>
          </div>
          <button type="button" className="icon-action" onClick={onClose} aria-label="Close strategy form" disabled={pending !== null}>
            <X size={18} />
          </button>
        </div>
        <div className="strategy-summary-strip" aria-label="Strategy funding summary">
          <div>
            <span>mUSDC balance</span>
            <strong>{formatUsd(makerReserveBalance)}</strong>
          </div>
          <div>
            <span>Virtual cap</span>
            <strong>{formatUsd(exposure.virtualCap)}</strong>
          </div>
          <div>
            <span>Exposure</span>
            <strong>{Number.isFinite(exposure.ratio) ? `${exposure.ratio.toFixed(2)}x` : "--"}</strong>
          </div>
        </div>
        {overcommitted ? (
          <div className="strategy-warning">
            Virtual exposure is above 1.5x mUSDC balance. Set strategy is disabled to avoid excessive reverting fills.
          </div>
        ) : null}
        <div className="strategy-set-toolbar">
          <span>{selectedAssets.length} selected</span>
          {availableAssets.length ? (
            <div className="asset-add-control">
              <select className="select-input" value={assetToAdd || (availableAssets[0]?.asset ?? "")} onChange={(event) => setAssetToAdd(event.target.value as LegKey)} disabled={pending !== null}>
                {availableAssets.map((assetDraft) => (
                  <option value={assetDraft.asset} key={assetDraft.asset}>{strategyInputs[assetDraft.asset].label}</option>
                ))}
              </select>
              <button type="button" className="icon-action" onClick={addAsset} aria-label="Add asset" title="Add asset" disabled={pending !== null}>
                <Plus size={17} />
              </button>
            </div>
          ) : null}
        </div>
        <div className="strategy-set-editor">
          {selectedAssets.length === 0 ? (
            <div className="empty-strategy-set">Add an asset to set entries.</div>
          ) : null}
          {selectedAssets.map((assetDraft) => {
            const assetTotal = getStrategyDraftSpendTotal(assetDraft);
            return (
              <section className="strategy-asset-row" key={assetDraft.asset}>
                <div className="strategy-asset-header">
                  <div className="strategy-asset-meta">
                    <strong>{strategyInputs[assetDraft.asset].label}</strong>
                    <span>{formatUsd(assetTotal)}</span>
                  </div>
                  <button type="button" className="icon-action asset-remove" onClick={() => removeAsset(assetDraft.asset)} aria-label={`Remove ${strategyInputs[assetDraft.asset].label}`} disabled={pending !== null}>
                    <Trash2 size={16} />
                  </button>
                </div>
                <div className="entry-list">
                  {assetDraft.ladder.map((row, index) => (
                    <div className="entry-row" key={`${assetDraft.asset}-${index}`}>
                      <span>Entry {index + 1}</span>
                      <input
                        className="text-input"
                        value={row.entryPrice}
                        onChange={(event) => updateRow(assetDraft.asset, index, "entryPrice", event.target.value)}
                        inputMode="decimal"
                        aria-label={`${strategyInputs[assetDraft.asset].label} entry ${index + 1} price`}
                        placeholder="Entry"
                      />
                      <input
                        className="text-input"
                        value={row.maxSpend}
                        onChange={(event) => updateRow(assetDraft.asset, index, "maxSpend", event.target.value)}
                        inputMode="decimal"
                        aria-label={`${strategyInputs[assetDraft.asset].label} entry ${index + 1} max spend`}
                        placeholder="Spend"
                      />
                    </div>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
        <div className="modal-actions">
          <button type="button" className="secondary-action" onClick={onClose} disabled={pending !== null}>Cancel</button>
          <button type="submit" className="primary-action" disabled={disabled}>{pending === "addStrategy" ? "Setting..." : "Set strategy"}</button>
        </div>
      </form>
    </div>
  );
}

function ReserveCard({ summary, active }: { summary: ReturnType<typeof summarizeReserve>; active: boolean }) {
  if (!active) {
    return (
      <div className="reserve-card empty-reserve">
        <div className="reserve-header">
          <span>Reserve overview</span>
          <strong>Empty</strong>
        </div>
        <div className="reserve-main">
          <span>--</span>
          <small>No reserve created for this wallet session.</small>
        </div>
        <div className="reserve-bar empty" aria-label="Reserve utilization" />
        <div className="reserve-stats">
          <div>
            <span>Remaining</span>
            <strong>--</strong>
          </div>
          <div>
            <span>Virtual caps</span>
            <strong>--</strong>
          </div>
          <div>
            <span>Exposure</span>
            <strong>--</strong>
          </div>
        </div>
      </div>
    );
  }

  const spentPercent = (summary.spent / summary.totalBudget) * 100;
  const remainingPercent = 100 - spentPercent;

  return (
    <div className="reserve-card">
      <div className="reserve-header">
        <span>Reserve overview</span>
        <strong>Live</strong>
      </div>
      <div className="reserve-main">
        <span>{formatUsd(summary.spent)}</span>
        <small>spent of {formatUsd(summary.totalBudget)} mUSDC</small>
      </div>
      <div className="reserve-bar" aria-label="Reserve utilization">
        <span style={{ width: `${spentPercent}%` }} />
        <i style={{ left: "40%" }} />
        <i style={{ left: "75%" }} />
      </div>
      <div className="reserve-stats">
        <div>
          <span>Remaining</span>
          <strong>{formatUsd(summary.remaining)}</strong>
        </div>
        <div>
          <span>Virtual caps</span>
          <strong>{formatUsd(summary.totalLegCaps)}</strong>
        </div>
        <div>
          <span>Exposure</span>
          <strong>{Number.isFinite(summary.exposure) ? `${summary.exposure.toFixed(2)}x` : "--"}</strong>
        </div>
      </div>
      <div className="remaining-band" style={{ width: `${remainingPercent}%` }} />
    </div>
  );
}

function EmptyPanel({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="empty-panel">
      <Coins size={22} />
      <strong>{title}</strong>
      <span>{detail}</span>
    </div>
  );
}

function isStepDisabled(step: StepKey, completed: Partial<Record<StepKey, boolean>>) {
  if (step === "createReserve") return Boolean(completed.createReserve);
  return false;
}

function LegCard({
  leg,
  quote,
  active
}: {
  leg: Leg;
  quote?: string;
  active: boolean;
}) {
  const utilization = (leg.spent / leg.maxSpend) * 100;
  const changed = leg.currentMaxPrice !== leg.baseMaxPrice;

  return (
    <article className={active ? "leg-card active" : "leg-card"}>
      <div className="leg-top">
        <div className="token-pair" style={{ "--asset-color": leg.allocationColor } as React.CSSProperties}>
          <span>{leg.symbol.slice(0, 1)}</span>
        </div>
        <div>
          <h2>{leg.symbol}</h2>
          <p>{leg.name}</p>
        </div>
      </div>
      <div className="leg-price">
        <span>Max price</span>
        <strong>{formatUsd(leg.currentMaxPrice)}</strong>
      </div>
      {quote ? <div className="live-quote">{quote}</div> : null}
      {changed ? <div className="repriced">Repriced from {formatUsd(leg.baseMaxPrice)}</div> : <div className="repriced muted">Initial quote</div>}
      <div className="card-ladder">
        {leg.ladder.map((row, index) => (
          <div className={selectLadderRow(leg) === row ? "active" : ""} key={`${leg.key}-${index}`}>
            <span>{formatUsd(row.entryPrice)}</span>
            <strong>{formatUsd(row.maxSpend)}</strong>
          </div>
        ))}
      </div>
      <div className="leg-meter">
        <span style={{ width: `${utilization}%`, background: leg.allocationColor }} />
      </div>
      <div className="leg-bottom">
        <span>{formatUsd(leg.spent)} spent</span>
        <strong>{formatUsd(leg.maxSpend)} cap</strong>
      </div>
    </article>
  );
}

function formatTokenAmount(value: bigint) {
  return Number(value) / 1_000_000;
}

function shortAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function shortHash(hash: string) {
  return `${hash.slice(0, 10)}...${hash.slice(-6)}`;
}

function formatEvent(event: TransactionUpdate) {
  return event.hash ? `${event.message}: ${shortHash(event.hash)}` : event.message;
}

function PanelTitle({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="panel-title">
      {icon}
      <h2>{title}</h2>
    </div>
  );
}
