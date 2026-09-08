import { ArrowRight, Check, Coins, Droplets, ExternalLink, Gauge, Play, RotateCcw, Wallet } from "lucide-react";
import { useMemo, useState } from "react";
import { applyFill, formatUsd, initialDemo, selectTranche, summarizeReserve, type DemoState, type Leg } from "./demoModel";

const steps = [
  "Mint mock mUSDC",
  "Approve Aqua",
  "Create reserve",
  "Add legs",
  "Activate",
  "Ship strategies"
];

const txRows = [
  ["Network", "Sepolia"],
  ["Aqua registry", "0x1111...6a90a"],
  ["Router", "0xbaeE...256c"],
  ["Mode", "Visual preview"]
];

export function App() {
  const [state, setState] = useState<DemoState>(initialDemo);
  const [filled, setFilled] = useState(false);
  const summary = useMemo(() => summarizeReserve(state), [state]);
  const tranche = selectTranche(state.reserve);

  function runFill() {
    if (filled) return;
    setState(applyFill(state, "eth", 4000));
    setFilled(true);
  }

  function reset() {
    setState(initialDemo);
    setFilled(false);
  }

  return (
    <main className="app-shell">
      <TopNav />

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
            <button className="primary-action" onClick={runFill} disabled={filled}>
              <Play size={18} />
              {filled ? "ETH fill complete" : "Preview ETH fill"}
            </button>
            <button className="icon-action" onClick={reset} aria-label="Reset demo">
              <RotateCcw size={18} />
            </button>
          </div>
        </div>

        <ReserveCard summary={summary} tranche={tranche} />
      </section>

      <section className="workspace-grid">
        <div className="setup-column">
          <PanelTitle icon={<Wallet size={18} />} title="Setup Flow" />
          <div className="step-list">
            {steps.map((step) => (
              <div className="step-row" key={step}>
                <span className="step-icon">
                  <Check size={14} />
                </span>
                <span>{step}</span>
              </div>
            ))}
          </div>

          <div className="network-card">
            {txRows.map(([label, value]) => (
              <div className="network-row" key={label}>
                <span>{label}</span>
                <strong>{value}</strong>
              </div>
            ))}
          </div>
        </div>

        <div className="legs-column">
          <PanelTitle icon={<Coins size={18} />} title="Aqua Strategies" />
          <div className="leg-grid">
            {state.legs.map((leg) => (
              <LegCard key={leg.key} leg={leg} active={leg.key === "eth" && filled} />
            ))}
          </div>
        </div>

        <div className="events-column">
          <PanelTitle icon={<Gauge size={18} />} title="Quote Story" />
          <div className="event-list">
            {state.eventLog.map((event) => (
              <div className="event-row" key={event}>
                <ArrowRight size={15} />
                <span>{event}</span>
              </div>
            ))}
          </div>
          <div className="next-card">
            <span>Next integration</span>
            <strong>Replace preview state with viem reads and writes.</strong>
            <ExternalLink size={16} />
          </div>
        </div>
      </section>
    </main>
  );
}

function TopNav() {
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
      <button className="connect-preview">Connect wallet</button>
    </nav>
  );
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

function LegCard({ leg, active }: { leg: Leg; active: boolean }) {
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

function PanelTitle({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="panel-title">
      {icon}
      <h2>{title}</h2>
    </div>
  );
}
