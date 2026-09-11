# Per-Asset Ladders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build per-asset entry price ladders for contracts, scripts, and web UI.

**Architecture:** Move reserve-level tranches out of storage and quote logic. Store leg-level cumulative spend caps and relative price bps, with UI converting user absolute prices into contract values.

**Tech Stack:** Solidity 0.8.30, Hardhat, TypeScript, React, Vitest, viem.

**Spec:** `docs/superpowers/specs/2026-09-10-per-asset-ladders-design.md`

## Global Constraints

- Never lowercase Ethereum addresses; use checksummed EIP-55 addresses.
- Each asset has independent ladder rules.
- ETH example rows: `1800/2000`, `1600/4000`, `1200/4000`.
- WBTC example rows: `65000/4000`, `60000/3000`, `45000/3000`.

---

### Task 1: Contract Ladder Storage And Quote Logic

**Files:**
- Modify: `packages/contracts/contracts/DryPowderStorage.sol`
- Modify: `packages/contracts/contracts/DryPowder.sol`
- Test: `packages/contracts/test/phase3-dry-powder-opcode.test.ts`

**Interfaces:**
- Produces: `addLeg(bytes32,address,uint256[],uint256[])`, `updateLeg(bytes32,address,uint256[],uint256[])`, `getLegSpendCaps(address,bytes32,address)`, `getLegPriceBps(address,bytes32,address)`

- [ ] Write failing tests for per-leg ETH ladder quote progression.
- [ ] Update storage structs and validators.
- [ ] Update Dry Powder quote to use the active leg row.
- [ ] Run `npm run test -w @dry-powder/contracts`.

### Task 2: Web Strategy Builders

**Files:**
- Modify: `apps/web/src/assets.ts`
- Modify: `apps/web/src/demoModel.ts`
- Modify: `apps/web/src/onchain/strategy.ts`
- Modify: `apps/web/src/onchain/client.ts`
- Test: `apps/web/src/demoModel.test.ts`
- Test: `apps/web/src/onchain.test.ts`

**Interfaces:**
- Produces: `StrategyDraft.ladder`, `buildStrategyPlan(...).leg.spendCaps`, `buildStrategyPlan(...).leg.priceBps`

- [ ] Write failing web tests for WBTC and ETH ladder defaults.
- [ ] Convert absolute ladder prices to relative bps.
- [ ] Update ABI calls and snapshot reads.
- [ ] Run `npm run test -w @dry-powder/web`.

### Task 3: UI Simplification

**Files:**
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/styles.css`

**Interfaces:**
- Consumes: `StrategyDraft.ladder`

- [ ] Remove global Price Curve nav/page.
- [ ] Add three ladder rows to add strategy modal.
- [ ] Show active ladders on maker cards.
- [ ] Run `npm run build -w @dry-powder/web`.

### Task 4: Scripts And Full Verification

**Files:**
- Modify: `packages/contracts/scripts/demo/lib.ts`
- Modify: `packages/contracts/scripts/sepolia/lib.ts`
- Modify: `packages/contracts/scripts/deploy-base.ts`
- Test: `packages/contracts/test/phase6-demo-scripts.test.ts`

**Interfaces:**
- Consumes: contract ladder methods.

- [ ] Update demo script seeded ladders.
- [ ] Update Sepolia deploy/setup helpers.
- [ ] Run `npm run build`.
- [ ] Run `npm run test`.
