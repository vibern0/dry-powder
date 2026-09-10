import { ArrowRight, Check, Coins, Droplets, Gauge, RotateCcw, Trash2, Wallet } from "lucide-react";
import { useMemo, useState } from "react";
import { formatUsd, initialDemo, selectTranche, summarizeReserve, type DemoState, type Leg, type LegKey } from "./demoModel";
import {
  addStrategy,
  approveAqua,
  connectWallet,
  createFreshMakerSession,
  editStrategy,
  executeFillForMaker,
  getOrCreateMakerSession,
  hasInjectedWallet,
  mintMakerReserveTokens,
  mintTakerAssetTokens,
  quoteStrategies,
  readOnchainSnapshot,
  removeStrategy,
  switchToSepolia,
  useConnectedAccountAsMaker,
  type StepKey,
  type MakerSession,
  type TransactionUpdate,
  type WalletState
} from "./onchain/client";
import { SEPOLIA_CHAIN_ID } from "./onchain/constants";
import { roleForAccount, strategyInputs } from "./onchain/strategy";

type DemoPage = "maker" | "taker";

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
  const [newStrategyAsset, setNewStrategyAsset] = useState<LegKey>("eth");
  const [editMaxSpend, setEditMaxSpend] = useState<Record<LegKey, string>>({ eth: "6000", wbtc: "6000", link: "4000" });
  const [fillAsset, setFillAsset] = useState<LegKey>("eth");
  const [fillAmount, setFillAmount] = useState("4000");
  const [error, setError] = useState<string | null>(null);
  const reserveCreated = Boolean(completed.createReserve);
  const strategiesActive = activeLegKeys.length > 0;
  const visibleState = strategiesActive ? { ...state, legs: state.legs.filter((leg) => activeLegKeys.includes(leg.key)) } : { ...state, legs: [] };
  const summary = useMemo(() => summarizeReserve(visibleState), [visibleState]);
  const tranche = selectTranche(state.reserve);
  const wrongNetwork = wallet && wallet.chainId !== SEPOLIA_CHAIN_ID;
  const role = wallet ? roleForAccount(wallet.account, makerSession?.maker ?? null) : "maker";
  const reserveId = makerSession?.reserveId;
  const strategyKeys = Object.keys(strategyInputs) as LegKey[];
  const availableStrategyKeys = strategyKeys.filter((key) => !activeLegKeys.includes(key));
  const fillableStrategyKeys = activeLegKeys.length ? activeLegKeys : strategyKeys;

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
    setState(applySnapshot(snapshot.reserve.spent, snapshot.legs));
    const nextActiveLegKeys = strategyKeys.filter((key) => snapshot.legs[key].exists && snapshot.shipped[key]);
    const nextAvailableLegKeys = strategyKeys.filter((key) => !nextActiveLegKeys.includes(key));
    setActiveLegKeys(nextActiveLegKeys);
    setFillAsset((current) => nextActiveLegKeys.includes(current) || nextActiveLegKeys.length === 0 ? current : nextActiveLegKeys[0]);
    setNewStrategyAsset((current) => nextActiveLegKeys.includes(current) ? nextAvailableLegKeys[0] ?? current : current);
    setEditMaxSpend({
      eth: formatTokenAmount(snapshot.legs.eth.maxSpend),
      wbtc: formatTokenAmount(snapshot.legs.wbtc.maxSpend),
      link: formatTokenAmount(snapshot.legs.link.maxSpend)
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

  async function addSelectedStrategy() {
    if (!wallet || !makerSession || !isMakerRole) return;
    await run("addStrategy", async () => {
      await addStrategy(wallet.account, makerSession.reserveId, newStrategyAsset, pushEvent);
      await loadSnapshot(makerSession);
    });
  }

  async function updateSelectedStrategy(key: LegKey) {
    if (!wallet || !makerSession || !isMakerRole) return;
    await run("editStrategy", async () => {
      await editStrategy(wallet.account, makerSession.reserveId, key, editMaxSpend[key], pushEvent);
      await loadSnapshot(makerSession);
    });
  }

  async function deleteSelectedStrategy(key: LegKey) {
    if (!wallet || !makerSession || !isMakerRole) return;
    await run("removeStrategy", async () => {
      await removeStrategy(wallet.account, makerSession.reserveId, key, pushEvent);
      setQuotes(null);
      setCompleted((previous) => ({ ...previous, fill: false }));
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
            A maker advertises more virtual liquidity than they own, while one Dry Powder reserve decides which
            opportunity deserves scarce mUSDC next.
          </p>

          {error ? <div className="error-banner">{error}</div> : null}
        </div>

        <ReserveCard summary={summary} tranche={tranche} active={Boolean(makerSession) && reserveCreated} />
      </section>

      <section className="workspace-grid">
        <div className="setup-column">
          <PanelTitle icon={<Wallet size={18} />} title={page === "maker" ? "Maker Page" : "Taker Page"} />
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
          {page === "maker" ? (
            <div className="step-list">
              {setupSteps.map((step) => (
                <button className="step-row" key={step.key} onClick={() => runSetupStep(step.key)} disabled={!wallet || Boolean(wrongNetwork) || !isMakerRole || pending !== null || isStepDisabled(step.key, completed)}>
                  <span className="step-icon">
                    {completed[step.key] ? <Check size={14} /> : pending === step.key ? "·" : ""}
                  </span>
                  <span>{pending === step.key ? "Confirm in wallet..." : step.label}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="step-list">
              <button className="step-row" onClick={() => runSetupStep("mintTaker")} disabled={!wallet || Boolean(wrongNetwork) || !isTakerRole || pending !== null}>
                <span className="step-icon">{completed.mintTaker ? <Check size={14} /> : pending === "mintTaker" ? "·" : ""}</span>
                <span>{pending === "mintTaker" ? "Confirm in wallet..." : "Mint taker assets"}</span>
              </button>
              <label className="field-label" htmlFor="fill-asset">Fill asset</label>
              <select id="fill-asset" className="select-input" value={fillAsset} onChange={(event) => setFillAsset(event.target.value as LegKey)} disabled={!strategiesActive}>
                {fillableStrategyKeys.map((key) => (
                  <option value={key} key={key}>{strategyInputs[key].label}</option>
                ))}
              </select>
              <label className="field-label" htmlFor="fill-amount">mUSDC amount</label>
              <input id="fill-amount" className="text-input" value={fillAmount} onChange={(event) => setFillAmount(event.target.value)} inputMode="decimal" />
              <button className="step-row" onClick={() => runSetupStep("quote")} disabled={!wallet || Boolean(wrongNetwork) || !strategiesActive || pending !== null}>
                <span className="step-icon">{pending === "quote" ? "·" : ""}</span>
                <span>{pending === "quote" ? "Confirm in wallet..." : "Quote all strategies"}</span>
              </button>
              <button className="step-row primary-step" onClick={() => runSetupStep("fill")} disabled={!wallet || Boolean(wrongNetwork) || !isTakerRole || !strategiesActive || pending !== null || !fillAmount}>
                <span className="step-icon">{completed.fill ? <Check size={14} /> : pending === "fill" ? "·" : ""}</span>
                <span>{pending === "fill" ? "Confirm in wallet..." : `Execute ${strategyInputs[fillAsset].label} fill`}</span>
              </button>
            </div>
          )}

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

        <div className="legs-column">
          <PanelTitle icon={<Coins size={18} />} title="Aqua Strategies" />
          <div className="strategy-actions">
            {page === "maker" ? (
              <>
                <select className="compact-select" value={newStrategyAsset} onChange={(event) => setNewStrategyAsset(event.target.value as LegKey)} disabled={!wallet || Boolean(wrongNetwork) || !isMakerRole || availableStrategyKeys.length === 0 || pending !== null}>
                  {availableStrategyKeys.map((key) => (
                    <option value={key} key={key}>{strategyInputs[key].label}</option>
                  ))}
                </select>
                <button className="secondary-action" onClick={addSelectedStrategy} disabled={!wallet || Boolean(wrongNetwork) || !isMakerRole || pending !== null || availableStrategyKeys.length === 0}>
                  {pending === "addStrategy" ? "Adding..." : "+ Add"}
                </button>
              </>
            ) : null}
            <button className="secondary-action" onClick={() => runSetupStep("quote")} disabled={!wallet || Boolean(wrongNetwork) || !strategiesActive || pending !== null}>
              {pending === "quote" ? "Quoting..." : "Quote all"}
            </button>
            <button className="secondary-action" onClick={refresh} disabled={!wallet || Boolean(wrongNetwork) || pending !== null}>
              {pending === "refresh" ? "Refreshing..." : "Refresh"}
            </button>
          </div>
          {strategiesActive ? (
            <div className="leg-grid">
              {visibleState.legs.map((leg) => (
                <LegCard
                  key={leg.key}
                  leg={leg}
                  quote={quotes?.[leg.key]}
                  active={leg.key === fillAsset && Boolean(completed.fill)}
                  editable={page === "maker"}
                  maxSpendValue={editMaxSpend[leg.key]}
                  pending={pending}
                  onMaxSpendChange={(value) => setEditMaxSpend((previous) => ({ ...previous, [leg.key]: value }))}
                  onEdit={() => updateSelectedStrategy(leg.key)}
                  onDelete={() => deleteSelectedStrategy(leg.key)}
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
      </section>
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

function applySnapshot(spent: bigint, legs: Record<LegKey, { maxSpend: bigint; spent: bigint }>): DemoState {
  const spentNumber = Number(spent) / 1_000_000;
  const reserve = { ...initialDemo.reserve, spent: spentNumber };
  const activeTranche = selectTranche(reserve);
  return {
    ...initialDemo,
    reserve,
    legs: initialDemo.legs.map((leg) => ({
      ...leg,
      maxSpend: Number(legs[leg.key].maxSpend) / 1_000_000,
      spent: Number(legs[leg.key].spent) / 1_000_000,
      currentMaxPrice: (leg.baseMaxPrice * activeTranche.multiplierBps) / 10000
    })),
    eventLog: initialDemo.eventLog
  };
}

function ReserveCard({ summary, tranche, active }: { summary: ReturnType<typeof summarizeReserve>; tranche: ReturnType<typeof selectTranche>; active: boolean }) {
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
            <span>Overcommit</span>
            <strong>--</strong>
          </div>
          <div>
            <span>Active price</span>
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
        <strong>{tranche.label}</strong>
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
          <span>Overcommit</span>
          <strong>{summary.overcommitment.toFixed(1)}x</strong>
        </div>
        <div>
          <span>Active price</span>
          <strong>{(tranche.multiplierBps / 100).toFixed(0)}%</strong>
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
  active,
  editable,
  maxSpendValue,
  pending,
  onMaxSpendChange,
  onEdit,
  onDelete
}: {
  leg: Leg;
  quote?: string;
  active: boolean;
  editable: boolean;
  maxSpendValue: string;
  pending: StepKey | "connect" | "switch" | "refresh" | null;
  onMaxSpendChange: (value: string) => void;
  onEdit: () => void;
  onDelete: () => void;
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
      <div className="leg-meter">
        <span style={{ width: `${utilization}%`, background: leg.allocationColor }} />
      </div>
      <div className="leg-bottom">
        <span>{formatUsd(leg.spent)} spent</span>
        <strong>{formatUsd(leg.maxSpend)} cap</strong>
      </div>
      {editable ? (
        <div className="card-actions">
          <input className="mini-input" aria-label={`${leg.symbol} max spend`} value={maxSpendValue} onChange={(event) => onMaxSpendChange(event.target.value)} inputMode="decimal" />
          <button className="mini-action" onClick={onEdit} disabled={pending !== null || !maxSpendValue}>Edit</button>
          <button className="mini-action danger" onClick={onDelete} disabled={pending !== null}>
            <Trash2 size={14} />
          </button>
        </div>
      ) : null}
    </article>
  );
}

function formatTokenAmount(value: bigint) {
  return (Number(value) / 1_000_000).toString();
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
