import { ArrowRight, Check, Coins, Droplets, ExternalLink, Gauge, Play, RotateCcw, Wallet } from "lucide-react";
import { useMemo, useState } from "react";
import { formatUsd, initialDemo, selectTranche, summarizeReserve, type DemoState, type Leg, type LegKey } from "./demoModel";
import {
  activateReserve,
  addLegs,
  approveAqua,
  connectWallet,
  createFreshWalletReserve,
  createReserve,
  executeEthFill,
  hasInjectedWallet,
  mintMockTokens,
  quoteStrategies,
  readOnchainSnapshot,
  shipStrategies,
  switchToSepolia,
  type StepKey,
  type TransactionUpdate,
  type WalletState
} from "./onchain/client";
import { SEPOLIA_CHAIN_ID } from "./onchain/constants";

const setupSteps: Array<{ key: StepKey; label: string }> = [
  { key: "mint", label: "Mint mock tokens" },
  { key: "approveAqua", label: "Approve Aqua" },
  { key: "createReserve", label: "Create reserve" },
  { key: "addLegs", label: "Add legs" },
  { key: "activateReserve", label: "Activate" },
  { key: "shipStrategies", label: "Ship strategies" }
];

const txRows = [
  ["Network", "Sepolia"],
  ["Aqua registry", "0x1111...6a90a"],
  ["Router", "0xbaeE...256c"],
  ["Mode", "Live Sepolia"]
];

export function App() {
  const [state, setState] = useState<DemoState>(initialDemo);
  const [wallet, setWallet] = useState<WalletState | null>(null);
  const [completed, setCompleted] = useState<Partial<Record<StepKey, boolean>>>({});
  const [pending, setPending] = useState<StepKey | "connect" | "switch" | "refresh" | null>(null);
  const [eventLog, setEventLog] = useState<TransactionUpdate[]>([]);
  const [quotes, setQuotes] = useState<Record<LegKey, string> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const summary = useMemo(() => summarizeReserve(state), [state]);
  const tranche = selectTranche(state.reserve);
  const wrongNetwork = wallet && wallet.chainId !== SEPOLIA_CHAIN_ID;

  async function connect() {
    await run("connect", async () => {
      const next = await connectWallet();
      setWallet(next);
      setEventLog([{ step: "quote", message: `Wallet connected: ${shortAddress(next.account)}` }]);
    });
  }

  async function switchNetwork() {
    await run("switch", async () => {
      await switchToSepolia();
      const next = await connectWallet();
      setWallet(next);
    });
  }

  async function rotateReserve() {
    if (!wallet) return;
    const reserveId = createFreshWalletReserve(wallet.account);
    setWallet({ ...wallet, reserveId });
    setState(initialDemo);
    setCompleted({});
    setQuotes(null);
    setEventLog([{ step: "quote", message: "Fresh reserve id ready for another demo run." }]);
  }

  async function refresh() {
    if (!wallet) return;
    await run("refresh", async () => {
      const snapshot = await readOnchainSnapshot(wallet.account, wallet.reserveId);
      setState(applySnapshot(snapshot.reserve.spent, snapshot.legs));
    });
  }

  async function runSetupStep(step: StepKey) {
    if (!wallet) return;
    const actions: Record<StepKey, () => Promise<void>> = {
      mint: () => mintMockTokens(wallet.account, pushEvent),
      approveAqua: () => approveAqua(wallet.account, pushEvent),
      createReserve: () => createReserve(wallet.account, wallet.reserveId, pushEvent),
      addLegs: () => addLegs(wallet.account, wallet.reserveId, pushEvent),
      activateReserve: () => activateReserve(wallet.account, wallet.reserveId, pushEvent),
      shipStrategies: () => shipStrategies(wallet.account, wallet.reserveId, pushEvent),
      quote: async () => {
        const nextQuotes = await quoteStrategies(wallet.account, wallet.reserveId);
        setQuotes(Object.fromEntries(nextQuotes.map((quote) => [quote.key, quote.label])) as Record<LegKey, string>);
        pushEvent({ step: "quote", message: "Quotes refreshed from DryPowderRouter." });
      },
      fillEth: async () => {
        await executeEthFill(wallet.account, wallet.reserveId, pushEvent);
        setCompleted((previous) => ({ ...previous, fillEth: true }));
        await refresh();
      }
    };

    await run(step, async () => {
      await actions[step]();
      setCompleted((previous) => ({ ...previous, [step]: true }));
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

  return (
    <main className="app-shell">
      <TopNav wallet={wallet} pending={pending} onConnect={connect} />

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

          <div className="story-actions">
            <button className="primary-action" onClick={() => runSetupStep("fillEth")} disabled={!wallet || Boolean(wrongNetwork) || pending !== null}>
              <Play size={18} />
              {completed.fillEth ? "ETH fill complete" : "Execute ETH fill"}
            </button>
            <button className="icon-action" onClick={rotateReserve} aria-label="Create fresh reserve id" disabled={!wallet || pending !== null}>
              <RotateCcw size={18} />
            </button>
          </div>
          {error ? <div className="error-banner">{error}</div> : null}
        </div>

        <ReserveCard summary={summary} tranche={tranche} />
      </section>

      <section className="workspace-grid">
        <div className="setup-column">
          <PanelTitle icon={<Wallet size={18} />} title="Setup Flow" />
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
              {shortAddress(wallet.account)} · {wallet.gasBalanceLabel}
            </div>
          )}
          <div className="step-list">
            {setupSteps.map((step) => (
              <button className="step-row" key={step.key} onClick={() => runSetupStep(step.key)} disabled={!wallet || Boolean(wrongNetwork) || pending !== null}>
                <span className="step-icon">
                  {completed[step.key] ? <Check size={14} /> : pending === step.key ? "·" : ""}
                </span>
                <span>{pending === step.key ? "Confirm in wallet..." : step.label}</span>
              </button>
            ))}
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
              <strong>{wallet ? shortHash(wallet.reserveId) : "not connected"}</strong>
            </div>
          </div>
        </div>

        <div className="legs-column">
          <PanelTitle icon={<Coins size={18} />} title="Aqua Strategies" />
          <div className="strategy-actions">
            <button className="secondary-action" onClick={() => runSetupStep("quote")} disabled={!wallet || Boolean(wrongNetwork) || pending !== null}>
              {pending === "quote" ? "Quoting..." : "Quote all"}
            </button>
            <button className="secondary-action" onClick={refresh} disabled={!wallet || Boolean(wrongNetwork) || pending !== null}>
              {pending === "refresh" ? "Refreshing..." : "Refresh"}
            </button>
          </div>
          <div className="leg-grid">
            {state.legs.map((leg) => (
              <LegCard key={leg.key} leg={leg} quote={quotes?.[leg.key]} active={leg.key === "eth" && Boolean(completed.fillEth)} />
            ))}
          </div>
        </div>

        <div className="events-column">
          <PanelTitle icon={<Gauge size={18} />} title="Quote Story" />
          <div className="event-list">
            {(eventLog.length ? eventLog.map(formatEvent) : state.eventLog).map((event) => (
              <div className="event-row" key={event}>
                <ArrowRight size={15} />
                <span>{event}</span>
              </div>
            ))}
          </div>
          <div className="next-card">
            <span>Integration</span>
            <strong>viem wallet writes, DryPowderRouter reads, Aqua SDK ship calldata.</strong>
            <ExternalLink size={16} />
          </div>
        </div>
      </section>
    </main>
  );
}

function TopNav({
  wallet,
  pending,
  onConnect
}: {
  wallet: WalletState | null;
  pending: StepKey | "connect" | "switch" | "refresh" | null;
  onConnect: () => void;
}) {
  return (
    <nav className="top-nav">
      <div className="brand-lockup">
        <div className="brand-mark">DP</div>
        <span>Dry Powder</span>
      </div>
      <div className="nav-links" aria-label="Demo sections">
        <span className="selected-pill">Aqua demo</span>
        <span>Reserve</span>
        <span>Strategies</span>
      </div>
      <button className="connect-preview" onClick={onConnect} disabled={Boolean(wallet) || pending !== null || !hasInjectedWallet()}>
        {wallet ? shortAddress(wallet.account) : pending === "connect" ? "Connecting..." : "Connect wallet"}
      </button>
    </nav>
  );
}

function applySnapshot(spent: bigint, legs: { eth: { spent: bigint }; wbtc: { spent: bigint }; link: { spent: bigint } }): DemoState {
  const spentNumber = Number(spent) / 1_000_000;
  const reserve = { ...initialDemo.reserve, spent: spentNumber };
  const activeTranche = selectTranche(reserve);
  return {
    ...initialDemo,
    reserve,
    legs: initialDemo.legs.map((leg) => ({
      ...leg,
      spent: Number(legs[leg.key].spent) / 1_000_000,
      currentMaxPrice: (leg.baseMaxPrice * activeTranche.multiplierBps) / 10000
    })),
    eventLog: initialDemo.eventLog
  };
}

function ReserveCard({ summary, tranche }: { summary: ReturnType<typeof summarizeReserve>; tranche: ReturnType<typeof selectTranche> }) {
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

function LegCard({ leg, quote, active }: { leg: Leg; quote?: string; active: boolean }) {
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
    </article>
  );
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
