# Dry Powder

## Cross-Asset Contingent Capital for 1inch Aqua

### One-line pitch

**Aqua gives every strategy access to the same capital. Dry Powder decides which strategy deserves to consume it.**

Dry Powder lets a maker use one finite stablecoin reserve to simultaneously back multiple cross-asset accumulation strategies.

For example, a maker with only 10,000 USDC can expose:

- up to 10,000 USDC against ETH
- up to 10,000 USDC against WBTC
- up to 10,000 USDC against LINK

without actually having 30,000 USDC.

All three strategies share a single onchain risk budget. Whenever one strategy spends part of the reserve, every sibling strategy immediately sees less capacity and becomes more conservative.

The result is a new Aqua-native financial position:

> A finite pool of dry powder continuously competes across multiple assets and preserves progressively scarcer capital for increasingly attractive opportunities.

---

# 1. Why this project exists

Aqua deliberately allows the same real wallet inventory to back several virtual strategies simultaneously.

`ship()` does not lock tokens. It creates virtual balances per strategy while the actual assets remain in the maker's wallet. Different strategies therefore share the same underlying inventory. citeturn575885search1turn575885search3

For example:

```text
Maker wallet
10,000 USDC real balance

Aqua strategy A
ETH / USDC
10,000 virtual USDC

Aqua strategy B
WBTC / USDC
10,000 virtual USDC

Aqua strategy C
LINK / USDC
10,000 virtual USDC
```

This is one of Aqua's main capital-efficiency properties.

But Aqua does not globally coordinate those independent virtual commitments. The official documentation explicitly describes the resulting overcommitment problem as a first-fill-wins race: one strategy can consume the maker's real inventory while another strategy still reports sufficient virtual balance. citeturn575885search0

Dry Powder adds the missing coordination layer:

```text
                     10,000 USDC
                          │
                    Global Reserve
                          │
         ┌────────────────┼────────────────┐
         │                │                │
       ETH leg          WBTC leg         LINK leg
       $10k              $10k             $10k
     virtual           virtual          virtual

                 but aggregate spending
                 can never exceed $10k
```

More importantly, it does not merely enforce solvency.

It allocates increasingly scarce capital according to a **reservation-price curve**.

---

# 2. Financial behavior of the MVP

The MVP maker owns:

```text
10,000 mUSDC
```

and creates three accumulation legs:

```text
ETH
Base maximum price: 2,700 USDC / ETH
Maximum allocation: 6,000 USDC

WBTC
Base maximum price: 80,000 USDC / WBTC
Maximum allocation: 6,000 USDC

LINK
Base maximum price: 20 USDC / LINK
Maximum allocation: 4,000 USDC
```

Notice:

```text
Sum of leg allocations = $16,000
Actual reserve          = $10,000
```

That overcommitment is intentional.

The portfolio then uses three reserve-utilization tranches.

```text
Reserve spent     Price multiplier

0% – 40%          100%
40% – 75%          95%
75% – 100%         90%
```

Meaning:

### Initially

```text
ETH max price       $2,700
WBTC max price     $80,000
LINK max price         $20
```

### After $4,000 has been spent

The second tranche activates.

```text
ETH max price       $2,565
WBTC max price     $76,000
LINK max price         $19
```

### After $7,500 has been spent

The final tranche activates.

```text
ETH max price       $2,430
WBTC max price     $72,000
LINK max price         $18
```

The economic idea is:

> The less dry powder remains, the more attractive an opportunity must become before the position will deploy it.

A fill against ETH therefore changes the price at which an unrelated WBTC or LINK strategy will execute.

That cross-strategy dependency is the core novelty.

---

# 3. MVP scope

The MVP MUST contain:

```text
1 maker
1 reserve token
3 target assets
3 Aqua strategies
1 shared reserve
3 reserve-utilization tranches
1 custom SwapVM opcode/instruction
real Aqua ship/pull/push settlement
real token transfers
quote → fill → sibling repricing demonstration
```

The MVP MUST NOT contain:

```text
oracle integration
Chainlink
automatic market-price tracking
AI
keepers
portfolio rebalancing
selling accumulated assets
multiple makers sharing one reserve
cross-chain execution
frontend-required execution
governance
yield
borrowing
liquidations
advanced authentication
production-grade permission management
```

Do not expand the scope until the core invariant is proven.

---

# 4. Recommended technology stack

Use the official 1inch SwapVM/Aqua codebase as the foundation.

Recommended stack:

```text
Solidity 0.8.30
Hardhat
TypeScript
viem or ethers, whichever integrates more cleanly with the template
@1inch/aqua-sdk
@1inch/swap-vm-sdk
```

The current SwapVM codebase is Solidity 0.8.30, and 1inch provides a SwapVM template that can deploy Aqua, a router, WETH/mock dependencies and testing helpers locally or on Sepolia. citeturn579631search2turn463688view0

Start from either:

```text
1inch/swap-vm-template
```

or a clean project importing:

```text
1inch/swap-vm
1inch/aqua
```

Do not copy random ETHGlobal competitors' routers.

Use official contracts directly.

The bounty explicitly requires official Aqua/SwapVM contracts, permits modified SwapVM deployments, requires real onchain token transfers in the demo, and accepts local-fork execution. citeturn123359search2

---

# 5. Core architecture

The system should have five conceptual components.

```text
Maker wallet
    │
    │ owns 10k mUSDC
    │
    ▼
Official Aqua
    │
    │ 3 shipped strategies
    │
    ▼
DryPowderRouter
    │
    ├── Reserve state
    ├── custom DryPowder opcode
    └── normal SwapVM instructions
             │
             ├── ETH strategy
             ├── WBTC strategy
             └── LINK strategy
```

Contracts:

```text
DryPowderRouter.sol
DryPowder.sol
DryPowderStorage.sol

MockERC20.sol
```

Optional builder/helper:

```text
DryPowderProgramBuilder.ts
```

---

# 6. The custom router

Create:

```solidity
contract DryPowderRouter
```

The cleanest architecture is to base it on:

```text
SwapVM
+
LimitOpcodes
+
DryPowder custom opcode
```

rather than the normal Aqua AMM opcode set.

Why?

Dry Powder is fundamentally a group of **one-directional accumulation orders**, not a bidirectional AMM.

SwapVM already has:

```text
StaticBalances
LimitSwap
```

for fixed-rate, single-direction positions. The official documentation describes Static Balances + LimitSwap as the standard architecture for fixed-rate partial-fill strategies. citeturn480509view0turn346945view0turn375450view0

Aqua settlement itself is handled in the base `SwapVM` contract when:

```solidity
useAquaInsteadOfSignature == true
```

The core router loads Aqua balances using `AQUA.safeBalances(...)` before executing the program and later settles through Aqua. citeturn657387view2turn371080view0

Therefore Dry Powder does not need to inherit the normal Aqua AMM opcode set merely to use Aqua.

Pseudo-architecture:

```solidity
contract DryPowderRouter is
    SwapVM,
    LimitSwap,
    DryPowder
{
    uint8 constant DRY_POWDER_OPCODE = 0x34;

    function _dispatch(
        Context memory ctx,
        uint256 opcode,
        bytes calldata args
    ) internal override {
        if (opcode == DRY_POWDER_OPCODE) {
            DryPowder.exec(ctx, args);
        } else if (opcode == LIMIT_SWAP_OPCODE) {
            LimitSwap.exec(ctx, args);
        } else if (opcode == SALT_OPCODE) {
            return;
        } else {
            revert UnknownOpcode(opcode);
        }
    }
}
```

`DRY_POWDER_OPCODE = 0x34` is intentionally valid only for this narrow
DryPowder router dispatch surface. It collides with opcode `52` in the
official all-opcodes `SwapVMRouter`, so this custom router must remain
separate from the universal opcode table.

Do not deploy the official all-opcodes `SwapVMRouter` for this project: it is
too large for public-chain deployment under current compiler settings and mixes
AMM and limit-order opcode groups that are conceptually incompatible. Use the
official `AquaSwapVMRouter` for Aqua AMM strategies and a separate limit-order
style router for Dry Powder.

Alternatively add an explicit `DryPowder` enum entry in your fork's `OpcodeList`.

---

# 7. Reserve state

Reserve state belongs in the custom router, not inside individual Aqua strategies.

Use namespaced storage similar to SwapVM's existing stateful instructions.

Suggested structure:

```solidity
struct Reserve {
    address reserveToken;

    uint128 totalBudget;
    uint128 spent;

    uint16 threshold1Bps;
    uint16 threshold2Bps;

    uint16 multiplier0Bps;
    uint16 multiplier1Bps;
    uint16 multiplier2Bps;

    bool active;
}

struct Leg {
    uint128 maxSpend;
    uint128 spent;
    bool exists;
}

struct Layout {
    mapping(
        address maker =>
            mapping(bytes32 reserveId => Reserve)
    ) reserves;

    mapping(
        address maker =>
            mapping(
                bytes32 reserveId =>
                    mapping(address asset => Leg)
            )
    ) legs;
}
```

Reserve identity should always include the maker:

```text
maker + reserveId
```

not only:

```text
reserveId
```

Otherwise two makers could collide.

---

# 8. Reserve creation lifecycle

Implement:

```solidity
createReserve(...)
addLeg(...)
activateReserve(...)
```

### `createReserve`

Example:

```solidity
createReserve(
    reserveId,
    mUSDC,
    10_000e6,
    4000,
    7500,
    10000,
    9500,
    9000
);
```

Validation:

```text
totalBudget > 0

0 < threshold1 < threshold2 < 10000

multiplier0 <= 10000

multiplier0 >= multiplier1
multiplier1 >= multiplier2

multiplier2 > 0
```

Reserve starts inactive.

### `addLeg`

Example:

```solidity
addLeg(
    reserveId,
    mETH,
    6_000e6
);

addLeg(
    reserveId,
    mWBTC,
    6_000e6
);

addLeg(
    reserveId,
    mLINK,
    4_000e6
);
```

Only reserve creator/maker can configure it.

### `activateReserve`

After activation:

```text
reserveToken immutable
totalBudget immutable
thresholds immutable
multipliers immutable
leg asset list immutable
leg maximum allocations immutable
```

Only:

```text
reserve.spent
leg.spent
```

change afterward.

This is important conceptually.

The user is creating a **position**, not an admin-controlled strategy that can silently change after being shipped.

---

# 9. The Aqua strategies

Create three separate SwapVM orders.

Each uses the same:

```text
maker
reserveId
DryPowderRouter
```

but different assets and prices.

Example:

```text
Strategy 1
mETH → mUSDC

Strategy 2
mWBTC → mUSDC

Strategy 3
mLINK → mUSDC
```

Important terminology:

From SwapVM's perspective:

```text
tokenIn = asset received from taker
tokenOut = USDC paid by maker
```

because the maker is **buying** the risky asset.

So the ETH leg means:

```text
taker gives ETH
maker gives USDC
```

The custom instruction MUST reject the opposite direction.

---

# 10. Shipping to Aqua

The maker owns:

```text
10,000 actual mUSDC
```

but ships approximately:

```text
ETH strategy:
10,000 virtual mUSDC

WBTC strategy:
10,000 virtual mUSDC

LINK strategy:
10,000 virtual mUSDC
```

This intentionally creates:

```text
30,000 virtual USDC
10,000 actual USDC
```

which demonstrates Aqua's shared-liquidity model.

Each strategy must include both relevant token slots in Aqua.

Verify exact non-zero/zero-token registration behavior against the current Aqua implementation. If zero virtual balances do not count as active strategy tokens, ship a tiny non-zero asset-side balance purely so both tokens are registered.

The key invariant is:

```text
each individual strategy may advertise up to $10k

but

Dry Powder aggregate spending <= $10k
```

---

# 11. Program structure

Each strategy should conceptually compile to:

```text
StaticBalances
    ↓
DryPowder
    ↓
LimitSwap
```

For ETH:

```text
StaticBalances(
    amountETH,
    amountUSDC
)

DryPowder(
    reserveId
)

LimitSwap(
    ETH → USDC
)
```

`StaticBalances` establishes the maker's base reservation price.

For example:

```text
1 ETH
2700 USDC
```

The official opcode maps these balances to `balanceIn` and `balanceOut` according to token direction. citeturn346945view0

The Dry Powder opcode then modifies those registers based on shared reserve state.

Finally, the existing LimitSwap opcode calculates the exact input/output amounts from the resulting balance ratio. citeturn375450view0

---

# 12. The DryPowder opcode

This is the heart of the project.

Suggested encoded arguments:

```text
bytes32 reserveId
```

That's it.

Everything shared lives in router storage.

Asset is:

```solidity
ctx.query.tokenIn
```

Reserve token must be:

```solidity
ctx.query.tokenOut
```

---

# 13. DryPowder execution algorithm

Pseudo-code:

```solidity
function exec(
    Context memory ctx,
    bytes calldata args
) internal {
    bytes32 reserveId = parse(args);

    Reserve storage reserve =
        store().reserves[ctx.query.maker][reserveId];

    require(reserve.active);

    require(
        ctx.query.tokenOut == reserve.reserveToken,
        WrongDirection()
    );

    Leg storage leg =
        store().legs[
            ctx.query.maker
        ][
            reserveId
        ][
            ctx.query.tokenIn
        ];

    require(leg.exists);

    uint256 globalRemaining =
        reserve.totalBudget - reserve.spent;

    uint256 legRemaining =
        leg.maxSpend - leg.spent;

    uint256 walletBalance =
        IERC20(reserve.reserveToken)
            .balanceOf(ctx.query.maker);

    (
        uint256 multiplier,
        uint256 trancheRemaining
    ) = currentTranche(reserve);

    uint256 capacity = min4(
        globalRemaining,
        legRemaining,
        walletBalance,
        trancheRemaining
    );

    require(capacity > 0);

    applyPriceMultiplier(
        ctx,
        multiplier
    );

    capBalancesToReserveCapacity(
        ctx,
        capacity
    );

    (
        uint256 amountIn,
        uint256 amountOut
    ) = ctx.runLoop();

    require(
        amountOut <= capacity,
        BudgetExceeded()
    );

    if (!ctx.vm.isStaticContext) {
        reserve.spent += uint128(amountOut);
        leg.spent += uint128(amountOut);

        emit ReserveConsumed(
            ctx.query.maker,
            reserveId,
            ctx.query.tokenIn,
            amountOut,
            reserve.spent
        );
    }
}
```

This wrapper pattern is deliberately similar to the official `Decay` opcode:

```text
read state
modify registers
run remaining program
observe final swap amount
write state only if execution is not static
```

That is an established SwapVM pattern. citeturn463688view0

---

# 14. Why `ctx.runLoop()` matters

Do NOT simply update `spent` and then return.

The DryPowder instruction should execute the downstream `LimitSwap` itself:

```solidity
ctx.runLoop()
```

because the state update must reflect the **actual final swap amount**.

Program:

```text
StaticBalances
DryPowder
    └── internally continues VM
           ↓
       LimitSwap
```

After `LimitSwap` determines:

```text
amountIn
amountOut
```

DryPowder can record the exact amount of USDC actually consumed.

The official `Decay` implementation already works this way. citeturn463688view0

---

# 15. Quote behavior vs swap behavior

This MUST be correct.

Current SwapVM sets:

```solidity
ctx.vm.isStaticContext = true
```

during `quote()`.

It sets:

```solidity
ctx.vm.isStaticContext = false
```

during `swap()`. citeturn657387view2turn657387view3

Therefore:

### `quote()`

Dry Powder reads:

```text
reserve.spent
leg.spent
wallet balance
tranche
```

and calculates the quote.

But:

```text
reserve.spent MUST NOT change
leg.spent MUST NOT change
```

### `swap()`

The exact same calculation executes.

After determining the final amount:

```text
reserve.spent += amountOut
leg.spent += amountOut
```

Then SwapVM performs Aqua settlement.

If later settlement fails, the entire transaction reverts, so the Dry Powder storage changes revert as well.

Test this explicitly.

---

# 16. Applying the price multiplier

After `StaticBalances`, suppose:

```text
balanceIn  = 1 ETH
balanceOut = 2700 USDC
```

Effective maker price is:

```text
2700 USDC / ETH
```

At 95%:

```text
balanceOut =
2700 * 9500 / 10000
=
2565 USDC
```

Therefore:

```solidity
ctx.swap.balanceOut =
    ctx.swap.balanceOut
    * multiplierBps
    / 10_000;
```

Since the maker is always paying `tokenOut = reserveToken`, reducing `balanceOut` makes the maker demand more asset for each unit of reserve.

That is exactly the desired behavior.

---

# 17. Tranche-boundary behavior

This is a subtle but important requirement.

Suppose:

```text
total reserve = $10,000

tier 1 ends at $4,000

current spent = $3,900
```

The maker should NOT let a $3,000 trade execute entirely at the generous first-tier price.

Otherwise a taker could consume:

```text
$3,900 → $6,900
```

while still receiving tier-1 pricing.

The current tier only has:

```text
$100
```

remaining.

Therefore:

```text
current-tranche capacity = $100
```

A trade should be limited to that amount.

Afterward:

```text
spent = $4,000
```

and the next quote automatically uses the 95% price tier.

This creates an actual piecewise reserve curve.

---

# 18. Capacity calculation

Effective capacity should be:

```text
minimum of:

global reserve remaining
leg allocation remaining
maker's actual reserve-token balance
current tranche remaining
```

Formally:

```text
capacity =
min(
    totalBudget - reserveSpent,
    legMax - legSpent,
    makerUSDCBalance,
    nextTrancheBoundary - reserveSpent
)
```

This gives four independent safety layers.

### Global budget

Prevents all legs combined from exceeding:

```text
$10k
```

### Leg budget

Prevents excessive concentration.

Example:

```text
ETH ≤ $6k
LINK ≤ $4k
```

### Real wallet balance

Handles the fact that Aqua is self-custodial.

If the maker manually transfers away 5,000 USDC:

```text
configured remaining = $8k
real balance          = $3k

effective capacity    = $3k
```

This helps prevent Aqua's normal first-fill-wins failure mode.

### Tranche capacity

Ensures price changes exactly at reserve thresholds.

---

# 19. Aqua allowance

For the MVP:

```text
maker must approve Aqua for >= totalBudget
```

Prefer:

```text
max approval
```

on test tokens.

You MAY include:

```solidity
IERC20(reserveToken).allowance(
    maker,
    address(AQUA)
)
```

in effective capacity as an additional cap because `AQUA` is a public immutable field on SwapVM. citeturn441730view0

Then:

```text
capacity =
min(
    globalRemaining,
    legRemaining,
    walletBalance,
    aquaAllowance,
    trancheRemaining
)
```

This is slightly stronger.

But allowance handling is not the project thesis, so do not let it delay core implementation.

---

# 20. Scaling static balances to capacity

After applying the tranche multiplier, the position may still advertise more notional reserve than it is currently allowed to consume.

Example:

```text
Static balances:

1 ETH
2700 USDC

current capacity:
1000 USDC
```

Scale both balances proportionally:

```text
old:

1 ETH
2700 USDC

new:

0.370370 ETH
1000 USDC
```

The price remains:

```text
2700 USDC / ETH
```

but the current fill capacity becomes exactly:

```text
1000 USDC
```

Pseudo-code:

```solidity
if (ctx.swap.balanceOut > capacity) {
    uint256 oldBalanceOut =
        ctx.swap.balanceOut;

    ctx.swap.balanceIn =
        Math.ceilDiv(
            ctx.swap.balanceIn * capacity,
            oldBalanceOut
        );

    ctx.swap.balanceOut =
        capacity;
}
```

Review rounding carefully.

Always choose rounding that favors the maker.

---

# 21. Direction safety

The strategy must only allow:

```text
target asset → USDC
```

from the taker's perspective.

Meaning:

```text
maker buys asset
maker spends USDC
```

Never allow:

```text
USDC → target asset
```

Otherwise the maker could accidentally sell previously accumulated assets back through the strategy.

Require:

```solidity
ctx.query.tokenOut ==
    reserve.reserveToken;
```

and:

```solidity
leg[ctx.query.tokenIn].exists;
```

The existing `LimitSwap` direction guard should also be included.

So there are two layers:

```text
DryPowder semantic direction check
+
LimitSwap encoded direction check
```

---

# 22. Important invariant: one shared reserve across different order hashes

Each Aqua strategy has a different:

```text
orderHash
strategyHash
```

That is expected.

Do NOT key Dry Powder state by:

```text
orderHash
```

because then every leg would get an independent budget.

Instead key it by:

```text
maker + reserveId
```

and use:

```text
tokenIn
```

for the leg.

This is the feature.

ETH and BTC are different SwapVM orders but intentionally mutate the same storage record.

---

# 23. Cross-order concurrency

SwapVM currently has an order-level reentrancy guard keyed by `orderHash`, not a reserve-wide lock. citeturn657387view3

Dry Powder should nevertheless remain safe across sibling strategies because reserve consumption is written during VM execution before token settlement.

Example:

```text
ETH swap enters
reserve.spent = $2k

DryPowder executes
reserve.spent becomes $4k

then settlement happens
```

If some callback attempted to execute the BTC sibling strategy during the same transaction:

```text
BTC DryPowder reads $4k
```

not `$2k`.

The sibling therefore sees the updated global budget.

Write a test for this if time permits.

Do not claim formal reentrancy safety until it has been tested.

---

# 24. Events

Add:

```solidity
event ReserveCreated(
    address indexed maker,
    bytes32 indexed reserveId,
    address indexed reserveToken,
    uint256 totalBudget
);

event LegAdded(
    address indexed maker,
    bytes32 indexed reserveId,
    address indexed asset,
    uint256 maxSpend
);

event ReserveActivated(
    address indexed maker,
    bytes32 indexed reserveId
);

event ReserveConsumed(
    address indexed maker,
    bytes32 indexed reserveId,
    address indexed asset,
    uint256 amount,
    uint256 totalSpent
);
```

These make demo/indexing trivial.

---

# 25. Read API

Expose useful view functions:

```solidity
getReserve(
    address maker,
    bytes32 reserveId
)

getLeg(
    address maker,
    bytes32 reserveId,
    address asset
)

currentMultiplier(
    address maker,
    bytes32 reserveId
)

remainingBudget(
    address maker,
    bytes32 reserveId
)

effectiveCapacity(
    address maker,
    bytes32 reserveId,
    address asset
)

currentTranche(
    address maker,
    bytes32 reserveId
)
```

The demo script/UI should never need to reconstruct these values manually.

---

# 26. Test tokens

Deploy four mock tokens.

Prefer realistic decimals:

```text
mUSDC  6
mETH  18
mWBTC  8
mLINK  18
```

This forces the position builder to correctly handle decimal-normalized rates.

However, static balances already encode arbitrary integer ratios.

For example ETH:

```text
1e18 mETH

2700e6 mUSDC
```

BTC:

```text
1e8 mWBTC

80_000e6 mUSDC
```

LINK:

```text
1e18 mLINK

20e6 mUSDC
```

This is preferable to inventing another price fixed-point representation.

---

# 27. Test actors

Use:

```text
maker
takerA
takerB
takerC
```

Initial balances:

```text
maker:
10,000 mUSDC

takerA:
10 mETH

takerB:
1 mWBTC

takerC:
10,000 mLINK
```

Maker approves:

```text
Aqua → mUSDC
```

Takers approve whichever settlement path is required by SwapVM/Aqua.

---

# 28. Mandatory unit tests

The project should not be considered MVP-complete until these pass.

## Reserve configuration

Test:

```text
can create reserve
cannot create duplicate reserve
cannot create zero budget
threshold ordering enforced
multiplier ordering enforced
only maker controls configuration
cannot add leg after activation
cannot activate missing reserve
```

## Pricing

Test:

```text
0 spent → 100% multiplier

3999 spent → 100%

4000 spent → 95%

7499 spent → 95%

7500 spent → 90%
```

Check all three assets.

## Capacity

Test:

```text
global cap

leg cap

wallet balance cap

tranche boundary cap
```

## Direction

Test:

```text
asset → USDC succeeds

USDC → asset reverts

unregistered asset reverts
```

## Quote purity

Critical:

```text
quote ETH

reserve.spent before = 0
reserve.spent after  = 0

leg.spent before = 0
leg.spent after  = 0
```

Run multiple quotes.

State must never move.

## Swap state mutation

Example:

```text
ETH fills $2k

reserve.spent:
0 → 2000

ETH leg spent:
0 → 2000

BTC leg spent:
0

LINK leg spent:
0
```

## Sibling repricing

This is the killer test.

```text
quote BTC
record rate

execute ETH fill taking reserve
past first threshold

quote BTC again

new BTC rate must be worse for taker
```

This single test demonstrates the product.

---

# 29. Mandatory global-budget test

Initial state:

```text
actual USDC = $10k

ETH virtual USDC  = $10k
BTC virtual USDC  = $10k
LINK virtual USDC = $10k
```

Execute:

```text
ETH   consumes $3k
BTC   consumes $3k
LINK  consumes $3k
```

State:

```text
reserve spent = $9k
remaining      = $1k
```

Attempt:

```text
ETH consumes $2k
```

Expected result:

Either:

```text
fill capped to $1k
```

or:

```text
revert because request exceeds capacity
```

depending on final exact-fill semantics.

After successful fills:

```solidity
reserve.spent <= 10_000e6
```

must always hold.

---

# 30. Mandatory Aqua-overcommitment test

Prove why the custom opcode matters.

Create a baseline test using normal Aqua behavior:

```text
maker balance = $10k

strategy A virtual = $10k
strategy B virtual = $10k
```

Without Dry Powder:

```text
strategy A spends $8k

strategy B still reports large
virtual capacity

strategy B attempts $5k

Aqua settlement fails
because wallet has only $2k
```

This behavior is documented by Aqua as the shared-inventory/double-commitment problem. citeturn575885search0

Then run equivalent scenario using Dry Powder:

```text
A spends $8k

B quote now sees only $2k capacity
```

That side-by-side comparison is extremely valuable for judging.

It shows:

> We didn't merely build a trading bot. We fixed a concrete coordination problem created by Aqua's most powerful feature.

---

# 31. Mandatory rollback test

This is security-critical.

Cause settlement to fail after DryPowder computes a swap.

For example:

```text
remove/reduce Aqua allowance
```

Then attempt a swap.

Expected:

```text
transaction reverts

reserve.spent unchanged

leg.spent unchanged
```

This proves state cannot become desynchronized from actual settlement.

---

# 32. Tranche test

Set:

```text
total budget = $10k
spent = $3.9k
next threshold = $4k
```

Current capacity MUST be:

```text
$100
```

Fill exactly:

```text
$100
```

State:

```text
spent = $4k
```

Next quote MUST immediately use:

```text
95% price multiplier
```

This makes the piecewise behavior deterministic.

---

# 33. Property/invariant tests

Even without a formal verifier, write repeated randomized test sequences.

Generate random combinations of:

```text
asset
trade amount
sequence
```

After every successful trade assert:

```text
reserve.spent <= reserve.totalBudget

leg.spent <= leg.maxSpend

reserve.spent never decreases

leg.spent never decreases

maker reserve spend from Dry Powder
matches recorded reserve spend

current multiplier never becomes
more generous as reserve consumption rises
```

For quotes:

```text
state before == state after
```

Run hundreds or thousands of generated sequences.

If time permits, later reproduce core invariants in Foundry.

---

# 34. Phase 1 implementation milestone

Goal:

> Demonstrate shared state independently of real Aqua settlement.

Implement:

```text
DryPowderStorage
createReserve
addLeg
activateReserve
DryPowder math
view functions
```

Write pure/unit tests.

Acceptance gate:

```text
all reserve + tranche math tests pass
```

Do not start Aqua integration before this works.

---

# 35. Phase 2 implementation milestone

Integrate custom router.

Implement:

```text
DryPowderRouter
custom opcode dispatcher
DryPowder instruction encoder
StaticBalances
DryPowder
LimitSwap program
```

Acceptance gate:

```text
quote works
quote does not mutate state
different orders see same reserve state
```

---

# 36. Phase 3 implementation milestone

Integrate Aqua.

Deploy:

```text
official Aqua
DryPowderRouter
mock tokens
```

Ship three strategies.

Acceptance gate:

```text
all 3 strategies appear active
all load through Aqua safeBalances
all successfully quote
```

Aqua's current core model computes the strategy hash from immutable encoded strategy/order data, so make sure the exact bytes shipped are the exact bytes used during execution. citeturn575885search1turn575885search3

---

# 37. Phase 4 implementation milestone

Real settlement.

Execute one complete:

```text
mETH → mUSDC
```

swap.

Verify:

```text
taker ETH decreases
maker ETH increases

maker USDC decreases
taker USDC increases

Aqua virtual balances update

Dry Powder reserve.spent updates
```

Acceptance gate:

```text
real ERC20 transfers visible onchain
```

This directly satisfies a qualification requirement for the bounty. citeturn123359search2

---

# 38. Phase 5 implementation milestone

Cross-strategy behavior.

Sequence:

```text
quote WBTC

execute ETH fill

quote WBTC again
```

Acceptance gate:

```text
WBTC capacity decreases
```

Then cross threshold:

```text
ETH fill pushes spent to 40%
```

Quote WBTC.

Acceptance gate:

```text
WBTC reservation price becomes 5% more conservative
```

This is the moment the project becomes Dry Powder rather than just a global cap.

---

# 39. Phase 6 implementation milestone

Deploy to public testnet.

Prefer:

```text
Sepolia
```

because the current official SwapVM deployment tooling and template already document Sepolia deployments. citeturn579631search0turn579631search2

Deploy:

```text
Aqua official code
DryPowderRouter
mUSDC
mETH
mWBTC
mLINK
```

Mint test balances.

Run complete scenario with real transactions.

Fallback:

```text
local/fork demo
```

is explicitly allowed by the bounty, so never let testnet infrastructure jeopardize submission. citeturn123359search2

---

# 40. Demo script

Create:

```text
scripts/demo.ts
```

It should run the entire demo automatically.

Output should be extremely readable.

Example:

```text
=== DRY POWDER ===

Maker real balance:
10,000 USDC

Aqua virtual liquidity:
ETH    10,000 USDC
WBTC   10,000 USDC
LINK   10,000 USDC

Total advertised:
30,000 USDC

Actual capital:
10,000 USDC

Shared Liquidity Ratio:
3.0x
```

Then:

```text
=== CURRENT RESERVE ===

Spent:       $0
Remaining:   $10,000
Tier:        1
Multiplier:  100%

ETH max:     $2,700
WBTC max:    $80,000
LINK max:    $20
```

Execute:

```text
>>> Taker fills $4,000 ETH leg
```

Then display:

```text
Reserve spent:
$4,000

Reserve remaining:
$6,000

Tier:
2

Multiplier:
95%
```

Then:

```text
ETH max:     $2,565
WBTC max:    $76,000
LINK max:    $19
```

Explicitly highlight:

```text
NO WBTC STRATEGY WAS UPDATED.

Its price changed because ETH consumed
the shared reserve.
```

That sentence matters.

---

# 41. Final demo sequence

The final presentation should be roughly:

### 1. Explain Aqua

```text
I own $10k USDC.

Aqua lets me advertise that same $10k
across multiple strategies.
```

### 2. Show overcommitment

```text
ETH  $10k
BTC  $10k
LINK $10k

Total virtual liquidity: $30k
Real liquidity:          $10k
```

### 3. Explain vanilla Aqua problem

```text
Those virtual balances are independent.

Without coordination, sibling strategies
can race for the same wallet inventory.
```

This behavior is explicitly described in Aqua documentation. citeturn575885search0

### 4. Explain Dry Powder

```text
All three strategies point to one shared
onchain risk budget.
```

### 5. Fill ETH

```text
$4k USDC gets consumed
```

### 6. Show BTC + LINK changed

```text
capacity ↓
reservation price ↓
```

without touching those strategies.

### 7. Exhaust reserve

Attempt enough fills to reach:

```text
$10k spent
```

Then demonstrate:

```text
all 3 strategies have zero deployable capacity
```

even though their Aqua virtual balances may still individually show bookkeeping balances.

### 8. End with thesis

> Aqua shares capital. Dry Powder coordinates it.

---

# 42. Optional minimal frontend

Only start this after contract/test/demo-script completion.

A very small Svelte page is enough.

Layout:

```text
DRY POWDER

Reserve
────────────────
$10,000 total
$4,000 deployed
$6,000 remaining

[████████░░░░░░]

Current tier
40–75%

Price multiplier
95%


Opportunities
────────────────

ETH
Base price       $2,700
Current price    $2,565
Capacity         $6,000

WBTC
Base price       $80,000
Current price    $76,000
Capacity         $6,000

LINK
Base price       $20
Current price    $19
Capacity         $4,000
```

Buttons for demo/testing:

```text
Quote
Simulate fill
Execute fill
```

But the bounty explicitly accepts tests/scripts instead of UI, so frontend is polish rather than dependency. citeturn123359search2

---

# 43. README structure

README should begin with the problem, not implementation.

Suggested structure:

```text
# Dry Powder

One reserve. Many opportunities.

## Problem

Aqua lets virtual strategies overcommit the
same wallet inventory, but sibling strategies
do not coordinate their aggregate consumption.

## Solution

Dry Powder introduces a shared cross-strategy
risk budget.

## Example

$10k USDC backs:
$10k ETH
$10k BTC
$10k LINK

Every fill updates the budget shared by all three.

As capital becomes scarce, reservation prices
become more conservative.

## Why Aqua

The product depends on shared self-custodial
inventory. Without Aqua's capital reuse,
the three opportunities would require either
$30k capital or fragmented $3.33k allocations.

## Custom SwapVM instruction

DryPowder(...)
...
```

Then architecture, tests, deployment and demo.

---

# 44. What NOT to claim

Do not say:

> First shared order budget ever.

OCA/OCO-style grouped orders already exist.

Do not say:

> First strategy to share liquidity across Aqua positions.

That is Aqua's fundamental design and prior projects use it.

Do not say:

> We solve all Aqua overcommitment.

You only coordinate strategies explicitly enrolled in one Dry Powder reserve. External Fusion orders, unrelated Aqua strategies, wallet transfers, etc. may still affect actual wallet inventory.

Instead say:

> Dry Powder introduces explicit cross-strategy capital coordination for a family of intentionally overcommitted Aqua positions.

And:

> Multiple strategies compete for one finite risk budget whose utilization changes their execution capacity and reservation prices.

---

# 45. What IS novel

The novelty thesis should have three layers.

### 1. Shared state across independent strategies

A fill against:

```text
ETH orderHash
```

changes execution of:

```text
BTC orderHash
```

because they share:

```text
maker + reserveId
```

### 2. Solvency-aware intentional overcommitment

The system intentionally creates:

```text
virtual liquidity > real inventory
```

while maintaining:

```text
aggregate Dry Powder spend
<= reserve budget
```

### 3. Capital-scarcity pricing

The shared budget is not merely a cap.

Its utilization alters price:

```text
capital abundant
→ normal reservation price

capital scarce
→ increasingly demanding price
```

That creates a genuine financial position rather than an OCO implementation.

---

# 46. Security assumptions

Explicitly document:

```text
The maker controls their own wallet.

The maker may dock Aqua strategies at any time.

The maker may transfer reserve assets away.

Dry Powder therefore never assumes configured
budget equals current wallet inventory.

Effective capacity is capped by real inventory.
```

Also:

```text
quotes may become stale between quote() and swap()
```

which is normal for Aqua and SwapVM.

Taker thresholds must protect execution.

Aqua documentation explicitly warns that state can change between quote and settlement. citeturn575885search0

---

# 47. Important edge cases

The coding agent should explicitly reason about:

```text
spent == threshold1

spent == threshold2

spent == totalBudget

leg.spent == leg.maxSpend

maker wallet balance == 0

very small balances causing rounding to zero

token decimals

exact-in vs exact-out

StaticBalances token sorting

wrong trade direction

strategy docked between quote and swap

wallet changed between quote and swap

Aqua allowance changed between quote and swap

two sibling trades in consecutive blocks

two sibling trades in same block

state write followed by failed settlement

large trade attempting to cross tranche boundary
```

Do not postpone these until the final day.

---

# 48. Suggested exact default parameters

Use these for tests/demo:

```text
Reserve
$10,000 mUSDC

Tier 1
0–40%
price multiplier 100%

Tier 2
40–75%
price multiplier 95%

Tier 3
75–100%
price multiplier 90%
```

Legs:

```text
ETH

Base:
1 ETH : 2700 USDC

Max allocation:
$6,000


WBTC

Base:
1 BTC : 80,000 USDC

Max allocation:
$6,000


LINK

Base:
1 LINK : 20 USDC

Max allocation:
$4,000
```

Total potential per-leg allocation:

```text
$16,000
```

Actual reserve:

```text
$10,000
```

Virtual USDC shipped across Aqua:

```text
$30,000
```

Those three different figures tell the story nicely.

---

# 49. Suggested development order / commit history

The hackathon explicitly requires proper Git history, so commit incrementally. citeturn123359search2

Suggested sequence:

```text
chore: bootstrap swapvm aqua project

feat: add dry powder reserve storage

test: cover reserve configuration

feat: add tranche calculation

test: cover tranche boundaries

feat: add dry powder swapvm instruction

feat: add custom dry powder router

test: verify quote does not mutate reserve

feat: build fixed rate aqua accumulation strategy

test: enforce single strategy reserve capacity

feat: coordinate budget across strategies

test: verify sibling strategy repricing

test: cover global reserve invariant

test: cover failed settlement rollback

feat: add aqua strategy deployment scripts

feat: add end to end onchain demo

docs: document dry powder architecture

feat: add demo dashboard
```

Don't squash these before submission.

---

# 50. Definition of MVP complete

The project is finished enough to submit when all of these are true:

```text
✓ official Aqua code is used

✓ project uses SwapVM

✓ DryPowder is a real custom SwapVM instruction

✓ three separate Aqua strategies are shipped

✓ all three intentionally share one real reserve

✓ virtual USDC > real USDC is demonstrable

✓ one strategy fill changes sibling capacity

✓ crossing a reserve threshold changes sibling price

✓ aggregate recorded spend can never exceed reserve

✓ quote() does not mutate reserve state

✓ failed settlement does not consume reserve state

✓ real ERC20 transfers execute through Aqua

✓ end-to-end demo works from one command

✓ tests document core invariants

✓ README explains why Aqua is essential

✓ Git history shows incremental development
```

Everything else is optional.

---

# 51. Stretch goals, in priority order

Only after MVP completion:

### Stretch 1 — Continuous reserve curve

Replace:

```text
100%
95%
90%
```

with:

```text
multiplier =
f(reserve utilization)
```

For example linear or convex.

This removes discrete tiers.

### Stretch 2 — Configurable curve opcode

Allow reserve creators to encode:

```text
4 or 5 piecewise points
```

rather than exactly three.

### Stretch 3 — Portfolio-level allocation weights

Instead of simple leg caps:

```text
ETH max 60%
BTC max 60%
LINK max 40%
```

make caps depend on already acquired portfolio composition.

### Stretch 4 — Replenishment

Let realized reserve inflows refill Dry Powder according to a defined policy.

Do not simply set:

```text
spent = 0
```

because that destroys historical accounting.

### Stretch 5 — Oracle-relative pricing

Only after everything else works:

```text
current reservation price =
oracle price
× asset discount
× reserve scarcity multiplier
```

Example:

```text
ETH oracle $3,000

initial hurdle:
90% → $2,700

late reserve hurdle:
81% → $2,430
```

This creates true “buy-the-dip” semantics.

But it introduces quote freshness, oracle dependencies and additional failure modes, which is why it should not be in the MVP.

---

# 52. The conceptual end-state

The larger idea is not merely a dip-buying tool.

It is:

> **Contingent capital allocation on Aqua.**

One finite amount of capital can simultaneously exist at many possible destinations:

```text
ETH
BTC
stablecoin depeg
RWA discount
liquidation opportunity
new market
arbitrage opportunity
```

until one opportunity actually consumes it.

The shared risk-budget primitive determines:

```text
how much capital remains

which strategies may access it

how much each strategy may consume

and how valuable an opportunity must be
before increasingly scarce capital is deployed
```

The hackathon MVP demonstrates this with three simple spot accumulation legs.

Do not overbuild the larger vision.

Prove the primitive first.

---

# 53. Final pitch to judges

Use something close to:

> Aqua's greatest advantage is also a coordination problem: the same wallet can back many strategies, but those strategies don't know how much capital their siblings have already consumed.
>
> Dry Powder turns that shared inventory into a single cross-asset financial position.
>
> I have $10,000 USDC, but I can expose $10,000 of opportunity against ETH, $10,000 against BTC and $10,000 against LINK simultaneously.
>
> A custom stateful SwapVM instruction gives all three strategies one global risk budget.
>
> When ETH consumes $4,000, BTC and LINK instantly lose capacity. And because the remaining dry powder is now more valuable, their reservation prices automatically become more conservative.
>
> So Aqua provides shared capital; Dry Powder provides shared capital allocation.

That is the MVP.
