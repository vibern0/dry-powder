# Dry Powder Project Plan

> **Tracking rule:** Keep every item in one of three states: `TODO`, `IN PROGRESS`, or `DONE`.
> Move only one phase to `IN PROGRESS` at a time unless tasks are truly independent.

**Goal:** Build a working MVP that proves one shared stablecoin reserve can safely coordinate three Aqua strategies across ETH, WBTC, and LINK.

**Current Status:** `IN PROGRESS`

**MVP Boundary:** No backend infra is required. Build the core with Solidity, Hardhat, TypeScript, official Aqua/SwapVM contracts, tests, and demo scripts. A web UI is optional after the invariant is proven.

---

## Status Legend

```text
TODO         Not started.
IN PROGRESS  Actively being worked on.
DONE         Implemented, tested, and documented enough for the next phase.
```

---

## Phase 0: Project Foundation

**Status:** `DONE`

**Purpose:** Create the local development base and verify the official 1inch stack works before adding Dry Powder logic.

**Tasks:**

- [x] Choose foundation: `1inch/swap-vm-template` or clean Hardhat project importing official `1inch/swap-vm` and `1inch/aqua`.
- [x] Set up `Solidity 0.8.30`, Hardhat, TypeScript, viem or ethers, and test scripts.
- [x] Deploy official Aqua, SwapVM/router dependencies, WETH/mock dependencies, and mock ERC20 assets locally.
- [x] Add mock tokens: `mUSDC`, `mETH`, `mWBTC`, `mLINK`.
- [x] Confirm maker can approve Aqua and hold `10,000 mUSDC`.
- [x] Confirm a basic official SwapVM limit order can quote and settle through Aqua.

**Done Means:**

- [x] `hardhat test` passes for official baseline deploy and settlement.
- [x] Local scripts can deploy the base contracts repeatably.
- [x] No Dry Powder-specific code exists yet except placeholders or empty files.

---

## Phase 1: Dry Powder Storage and Reserve Lifecycle

**Status:** `DONE`

**Purpose:** Add shared reserve state keyed by `maker + reserveId`.

**Tasks:**

- [x] Create `DryPowderStorage.sol` with namespaced storage.
- [x] Define `Reserve` state: reserve token, total budget, spent amount, thresholds, multipliers, active flag.
- [x] Define `Leg` state: max spend, spent amount, exists flag.
- [x] Implement `createReserve(...)`.
- [x] Implement `addLeg(...)`.
- [x] Implement `activateReserve(...)`.
- [x] Enforce reserve immutability after activation.
- [x] Add lifecycle events: `ReserveCreated`, `LegAdded`, `ReserveActivated`.
- [x] Add unit tests for validation, maker ownership, activation, and immutability.

**Done Means:**

- [x] Maker can create one inactive reserve with `10,000 mUSDC`.
- [x] Maker can add ETH, WBTC, and LINK legs with overcommitted allocations.
- [x] Activated reserve cannot be reconfigured.
- [x] Tests prove two makers with the same `reserveId` do not collide.

---

## Phase 2: Custom Router and Opcode Wiring

**Status:** `TODO`

**Purpose:** Create a custom SwapVM router that can dispatch the Dry Powder opcode and otherwise use normal limit-order opcodes.

**Tasks:**

- [ ] Create `DryPowderRouter.sol`.
- [ ] Inherit from official SwapVM base contracts and limit-order opcode support.
- [ ] Recheck the current official opcode table before choosing the custom opcode value.
- [ ] Add a `DRY_POWDER_OPCODE` constant or explicit enum entry in the forked opcode list.
- [ ] Implement dispatch so Dry Powder handles only its opcode and delegates everything else to existing limit opcodes.
- [ ] Add tests proving non-Dry-Powder limit opcodes still work through the custom router.

**Done Means:**

- [ ] Router deploys cleanly.
- [ ] Existing limit swap behavior still works.
- [ ] Dry Powder opcode can be reached by a program without breaking normal SwapVM execution.

---

## Phase 3: Dry Powder Opcode Core

**Status:** `TODO`

**Purpose:** Enforce shared reserve capacity and dynamic reservation pricing during quote and swap.

**Tasks:**

- [ ] Create `DryPowder.sol`.
- [ ] Parse opcode args as `bytes32 reserveId`.
- [ ] Load reserve by `ctx.query.maker` and `reserveId`.
- [ ] Require active reserve.
- [ ] Require `ctx.query.tokenOut == reserve.reserveToken`.
- [ ] Require `ctx.query.tokenIn` is an existing leg asset.
- [ ] Calculate global remaining reserve.
- [ ] Calculate leg remaining allocation.
- [ ] Read maker reserve-token wallet balance.
- [ ] Optionally cap by Aqua allowance if clean to implement.
- [ ] Calculate current tranche multiplier and tranche remaining capacity.
- [ ] Set capacity to the minimum of all limits.
- [ ] Apply price multiplier to `ctx.swap.balanceOut`.
- [ ] Scale `ctx.swap.balanceIn` and `ctx.swap.balanceOut` down to capacity while preserving maker-favorable rounding.
- [ ] Call `ctx.runLoop()` so downstream `LimitSwap` determines final amounts.
- [ ] During quote/static context, do not mutate state.
- [ ] During swap/non-static context, update `reserve.spent` and `leg.spent`.
- [ ] Emit `ReserveConsumed`.

**Done Means:**

- [ ] Quote reflects reserve state but does not change storage.
- [ ] Swap updates exact consumed USDC amount.
- [ ] Wrong-direction swaps revert.
- [ ] Unregistered assets revert.
- [ ] Capacity never exceeds global remaining, leg remaining, wallet balance, or tranche remaining.

---

## Phase 4: Aqua Strategy Shipping

**Status:** `TODO`

**Purpose:** Ship three independent Aqua strategies that share one Dry Powder reserve.

**Tasks:**

- [ ] Build program structure: `StaticBalances -> DryPowder -> LimitSwap`.
- [ ] Create ETH accumulation strategy: taker gives `mETH`, maker pays `mUSDC`.
- [ ] Create WBTC accumulation strategy: taker gives `mWBTC`, maker pays `mUSDC`.
- [ ] Create LINK accumulation strategy: taker gives `mLINK`, maker pays `mUSDC`.
- [ ] Ship approximately `10,000 virtual mUSDC` to each strategy.
- [ ] Verify exact Aqua token registration behavior for zero asset-side virtual balances.
- [ ] If required, ship tiny non-zero asset-side balances only to register both token slots.
- [ ] Confirm all three strategies have different order/strategy hashes but the same `maker + reserveId`.

**Done Means:**

- [ ] Three Aqua strategies are shipped and independently quotable.
- [ ] Total virtual USDC exposure is around `30,000`.
- [ ] Actual maker reserve remains `10,000 mUSDC`.
- [ ] All three strategies use the same Dry Powder reserve state.

---

## Phase 5: Invariant and Tranche Tests

**Status:** `TODO`

**Purpose:** Prove the core financial behavior and safety properties.

**Tasks:**

- [ ] Test initial prices: ETH `$2,700`, WBTC `$80,000`, LINK `$20`.
- [ ] Fill one leg and prove sibling quotes update.
- [ ] Test first tranche boundary: capacity stops at `$4,000`.
- [ ] Test second tranche price multiplier: `95%`.
- [ ] Test second boundary: capacity stops at `$7,500`.
- [ ] Test final tranche price multiplier: `90%`.
- [ ] Test aggregate spending can never exceed `$10,000`.
- [ ] Test leg caps: ETH `<= $6,000`, WBTC `<= $6,000`, LINK `<= $4,000`.
- [ ] Test maker wallet balance cap after manual reserve-token transfer.
- [ ] Test quote state does not mutate and swap state does mutate.
- [ ] If time permits, test sibling-strategy reentrancy/concurrency behavior.

**Done Means:**

- [ ] Tests prove aggregate spending is bounded by the shared reserve.
- [ ] Tests prove sibling repricing after a fill.
- [ ] Tests prove tranche boundaries are piecewise, not blended.
- [ ] Tests prove quote and swap behavior differ only by state mutation.

---

## Phase 6: Demo Scripts

**Status:** `TODO`

**Purpose:** Create a repeatable demonstration for judging, recording, or local review.

**Tasks:**

- [ ] Add deploy script for local environment.
- [ ] Add setup script for maker, tokens, approvals, reserve, legs, activation, and strategy shipping.
- [ ] Add quote script showing all three initial strategy quotes.
- [ ] Add fill script for one leg.
- [ ] Add sibling repricing script showing ETH fill changes WBTC and LINK capacity/prices.
- [ ] Add full demo script that runs the story end to end.
- [ ] Print concise before/after reserve state after each fill.

**Done Means:**

- [ ] One command can run the local demo from clean deploy to sibling repricing.
- [ ] Demo output clearly shows real token transfers.
- [ ] Demo output clearly shows shared reserve spending and tranche movement.

---

## Phase 7: Optional Web Demo

**Status:** `TODO`

**Purpose:** Add visual polish only after the contracts and scripts prove the MVP.

**Tasks:**

- [ ] Decide whether a web UI is worth the extra scope.
- [ ] If yes, build a static/local web app using viem or ethers.
- [ ] Show reserve budget, spent amount, tranche, and remaining capacity.
- [ ] Show ETH, WBTC, and LINK leg states.
- [ ] Add buttons for quote and fill using the already deployed local contracts.
- [ ] Keep execution possible from scripts so the frontend is not required.

**Done Means:**

- [ ] UI demonstrates the same story as the scripts.
- [ ] No backend server, database, indexer, auth, keeper, or production infra is introduced.
- [ ] The MVP still works without the UI.

---

## Phase 8: Final Polish and Submission

**Status:** `TODO`

**Purpose:** Package the project so another developer or judge can understand and run it.

**Tasks:**

- [ ] Update `README.md` with setup, test, deploy, and demo commands.
- [ ] Add an architecture summary linking Aqua, SwapVM, Dry Powder reserve state, and strategy programs.
- [ ] Document the no-backend architecture decision.
- [ ] Document MVP exclusions from `PROJECT.md`.
- [ ] Record or script the quote-to-fill-to-sibling-repricing demo.
- [ ] Run full test suite.
- [ ] Run demo script from a clean local deploy.
- [ ] Review code for unused dependencies, dead scripts, and misleading comments.

**Done Means:**

- [ ] Fresh checkout can install, test, and run the demo from documented commands.
- [ ] Project clearly proves the shared-reserve invariant.
- [ ] Optional frontend, if present, is clearly secondary to the protocol demo.

---

## Global Done Criteria

- [ ] Official Aqua/SwapVM contracts are used directly.
- [ ] MVP includes `1 maker`, `1 reserve token`, `3 target assets`, `3 Aqua strategies`, `1 shared reserve`, and `3 reserve-utilization tranches`.
- [ ] MVP includes a custom SwapVM opcode/instruction.
- [ ] MVP uses real Aqua `ship`, `pull`, and `push` settlement behavior.
- [ ] MVP uses real token transfers.
- [ ] Demo proves `quote -> fill -> sibling repricing`.
- [ ] Aggregate reserve spend never exceeds the actual configured reserve budget.
- [ ] No backend infra is required.
