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

**Status:** `DONE`

**Purpose:** Create a custom SwapVM router that can dispatch the Dry Powder opcode and otherwise use normal limit-order opcodes.

**Tasks:**

- [x] Create `DryPowderRouter.sol`.
- [x] Inherit from official SwapVM base contracts and limit-order opcode support.
- [x] Recheck the current official opcode table before choosing the custom opcode value.
- [x] Add a `DRY_POWDER_OPCODE` constant or explicit enum entry in the forked opcode list.
- [x] Implement dispatch so Dry Powder handles only its opcode and delegates everything else to existing limit opcodes.
- [x] Add tests proving non-Dry-Powder limit opcodes still work through the custom router.
- [x] Keep Dry Powder on a separate limit-order-style router instead of the official all-opcodes `SwapVMRouter`; use `AquaSwapVMRouter` only for Aqua AMM opcode deployments.

**Done Means:**

- [x] Router deploys cleanly.
- [x] Existing limit swap behavior still works.
- [x] Dry Powder opcode can be reached by a program without breaking normal SwapVM execution.

---

## Phase 3: Dry Powder Opcode Core

**Status:** `DONE`

**Purpose:** Enforce shared reserve capacity and dynamic reservation pricing during quote and swap.

**Tasks:**

- [x] Create `DryPowder.sol`.
- [x] Parse opcode args as `bytes32 reserveId`.
- [x] Load reserve by `ctx.query.maker` and `reserveId`.
- [x] Require active reserve.
- [x] Require `ctx.query.tokenOut == reserve.reserveToken`.
- [x] Require `ctx.query.tokenIn` is an existing leg asset.
- [x] Calculate global remaining reserve.
- [x] Calculate leg remaining allocation.
- [x] Read maker reserve-token wallet balance.
- [x] Optionally cap by Aqua allowance if clean to implement.
- [x] Calculate current tranche multiplier and tranche remaining capacity.
- [x] Set capacity to the minimum of all limits.
- [x] Apply price multiplier to `ctx.swap.balanceOut`.
- [x] Scale `ctx.swap.balanceIn` and `ctx.swap.balanceOut` down to capacity while preserving maker-favorable rounding.
- [x] Apply the same maker-favorable limit math before downstream transfer.
- [x] During quote/static context, do not mutate state.
- [x] During swap/non-static context, update `reserve.spent` and `leg.spent`.
- [x] Emit `ReserveConsumed`.

**Done Means:**

- [x] Quote reflects reserve state but does not change storage.
- [x] Swap updates exact consumed USDC amount.
- [x] Wrong-direction swaps revert.
- [x] Unregistered assets revert.
- [x] Capacity never exceeds global remaining, leg remaining, wallet balance, or tranche remaining.

---

## Phase 4: Aqua Strategy Shipping

**Status:** `DONE`

**Purpose:** Ship three independent Aqua strategies that share one Dry Powder reserve.

**Tasks:**

- [x] Build program structure: `Aqua virtual balances -> DryPowder -> LimitSwap`.
- [x] Create ETH accumulation strategy: taker gives `mETH`, maker pays `mUSDC`.
- [x] Create WBTC accumulation strategy: taker gives `mWBTC`, maker pays `mUSDC`.
- [x] Create LINK accumulation strategy: taker gives `mLINK`, maker pays `mUSDC`.
- [x] Ship approximately `10,000 virtual mUSDC` to each strategy.
- [x] Verify exact Aqua token registration behavior for zero asset-side virtual balances.
- [x] If required, ship tiny non-zero asset-side balances only to register both token slots.
- [x] Confirm all three strategies have different order/strategy hashes but the same `maker + reserveId`.

**Done Means:**

- [x] Three Aqua strategies are shipped and independently quotable.
- [x] Total virtual USDC exposure is around `30,000`.
- [x] Actual maker reserve remains `10,000 mUSDC`.
- [x] All three strategies use the same Dry Powder reserve state.

---

## Phase 5: Invariant and Tranche Tests

**Status:** `DONE`

**Purpose:** Prove the core financial behavior and safety properties.

**Tasks:**

- [x] Test initial prices: ETH `$2,700`, WBTC `$80,000`, LINK `$20`.
- [x] Fill one leg and prove sibling quotes update.
- [x] Test first tranche boundary: capacity stops at `$4,000`.
- [x] Test second tranche price multiplier: `95%`.
- [x] Test second boundary: capacity stops at `$7,500`.
- [x] Test final tranche price multiplier: `90%`.
- [x] Test aggregate spending can never exceed `$10,000`.
- [x] Test leg caps: ETH `<= $6,000`, WBTC `<= $6,000`, LINK `<= $4,000`.
- [x] Test maker wallet balance cap after manual reserve-token transfer.
- [x] Test quote state does not mutate and swap state does mutate.
- [x] If time permits, test sibling-strategy reentrancy/concurrency behavior.

**Done Means:**

- [x] Tests prove aggregate spending is bounded by the shared reserve.
- [x] Tests prove sibling repricing after a fill.
- [x] Tests prove tranche boundaries are piecewise, not blended.
- [x] Tests prove quote and swap behavior differ only by state mutation.

---

## Phase 6: Demo Scripts

**Status:** `DONE`

**Purpose:** Create a repeatable demonstration for judging, recording, or local review.

**Tasks:**

- [x] Add deploy script for local environment.
- [x] Add setup script for maker, tokens, approvals, reserve, legs, activation, and strategy shipping.
- [x] Add quote script showing all three initial strategy quotes.
- [x] Add fill script for one leg.
- [x] Add sibling repricing script showing ETH fill changes WBTC and LINK capacity/prices.
- [x] Add full demo script that runs the story end to end.
- [x] Print concise before/after reserve state after each fill.

**Done Means:**

- [x] One command can run the local demo from clean deploy to sibling repricing.
- [x] Demo output clearly shows real token transfers.
- [x] Demo output clearly shows shared reserve spending and tranche movement.

---

## Phase 7: Sepolia Testnet Deploy

**Status:** `DONE`

**Purpose:** Prioritize a public testnet deployment that proves Dry Powder can run against Aqua onchain before any UI polish.

**Tasks:**

- [x] Reduce `DryPowderRouter` deployed bytecode under the public EVM `24,576` byte limit.
- [x] Add Ethereum Sepolia network config without reading or modifying `.env`.
- [x] Add deployment script that uses the official Aqua registry at `0x1111113CCf1426A8E30e2bfF5E005d929bF6a90a`.
- [x] Deploy `DryPowderRouter` and mock demo tokens to Sepolia.
- [x] Add/setup Sepolia scripts for maker balances, approvals, reserve creation, legs, activation, and strategy shipping.
- [x] Add Sepolia quote/fill/reprice scripts that exercise ETH, WBTC, and LINK demo strategies.
- [ ] Optionally verify deployed contracts on Etherscan.
- [x] Record deployed addresses and transaction hashes.

**Done Means:**

- [x] Sepolia deployment succeeds from a clean checkout with documented env var names.
- [x] Sepolia demo proves shared reserve spending and sibling repricing using onchain transactions.
- [x] No `.env` contents are read, printed, committed, or modified.

---

## Phase 8: Optional Web Demo

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

## Phase 9: Final Polish and Submission

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

## Future TODO: Partial and Multi-Tier Fills

**Status:** `TODO`

**Purpose:** Make maker and taker strategy views show live remaining capacity per asset ladder row, and support taker fills that can consume less than, exactly, or more than one row's remaining amount.

**Tasks:**

- [ ] Update maker and taker strategy cards so each asset row displays the remaining amount after partial fills. For example, if WBTC has `$5,000` available at `$60,000` and a taker buys only `$300`, both views should show `$4,700` remaining at `$60,000`.
- [ ] Treat taker fill amount as an arbitrary requested spend instead of assuming it consumes 100% of the currently quoted row.
- [ ] Support multi-row execution when a taker requests more than the current row can fill. For example, if a taker requests `$8,000`, and WBTC has `$4,700` remaining at `$60,000`, fill `$4,700` at `$60,000` and continue filling the remainder from lower-price rows until the request is filled or the ladder/reserve capacity is exhausted.
- [ ] Define the exact quote and swap semantics for blended fills across multiple prices, including maker-favorable rounding and what happens when the remaining reserve or maker wallet balance cannot satisfy the full taker request.
- [ ] Add tests for partial row depletion, exact row depletion, multi-row fills, and insufficient remaining ladder capacity.

**Done Means:**

- [ ] Every asset ladder row shows the correct remaining amount after each fill in both maker and taker views.
- [ ] Takers can request arbitrary fill amounts without relying on fixed demo amounts.
- [ ] Multi-row fills consume rows in order and record the exact reserve amount spent per row.

---

## Future TODO: Taker Swap UX

**Status:** `TODO`

**Purpose:** Make the taker page feel like a normal swap interface instead of a demo-only fill button, while preserving Dry Powder's strategy quote behavior underneath. In the launched product, thousands of makers can publish strategies saying which assets they want to buy and at what ladder prices. Takers only sell assets into those maker strategies; the UI should not expose a separate "buy" mode because the maker is the buyer.

**Tasks:**

- [ ] Replace the taker "fill" interaction with a regular swap-style flow where the taker selects the asset they are selling into the maker strategy.
- [ ] Keep the taker action framed as selling the selected asset for mUSDC, never as buying the maker's target asset.
- [ ] Show the taker's balance for the selected asset before they enter or submit a swap amount.
- [ ] When the taker enters a sell amount, estimate the amount of mUSDC they will receive from the selected strategy.
- [ ] Recalculate the estimated receive amount when the selected asset, sell amount, ladder state, reserve capacity, or maker wallet balance changes.
- [ ] Connect this estimate to the partial and multi-tier fill behavior above, so a sell amount can quote across the current row and lower-price rows when needed.
- [ ] Make insufficient balance and insufficient strategy capacity visible before submission.
- [ ] Add a product-level test scenario with many maker strategies available and a taker selecting one asset to sell, confirming the UI shows only `sell asset -> receive mUSDC` and routes to the correct maker strategy quote.

**Done Means:**

- [ ] The taker page presents `sell asset amount -> estimated mUSDC received` like a standard swap.
- [ ] The selected asset balance is visible and accurate for the connected taker wallet.
- [ ] The quoted receive amount matches the actual swap path, including partial rows and multi-row fills.
- [ ] Tests prove takers cannot switch into a buy-side flow; all taker actions sell assets into maker buy strategies.

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
