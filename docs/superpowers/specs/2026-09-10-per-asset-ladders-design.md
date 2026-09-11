# Per-Asset Ladders Design

**Goal:** Replace the global reserve price curve with per-asset entry-price ladders.

**Behavior:** Each strategy leg owns its own ladder rows. A row has a user-visible entry price and a max spend amount. The contract stores row spend caps as cumulative mUSDC caps and row prices as basis points relative to the first row's strategy price. A fill only advances the filled asset's ladder; sibling assets keep their own ladder positions.

**Contract:** `createReserve` stores only reserve token and total budget. `addLeg` and `updateLeg` accept `spendCaps[]` and `priceBps[]`; the last spend cap is the leg max spend. Quote capacity is capped by remaining reserve budget, maker reserve-token balance, remaining leg max spend, and remaining current ladder row. Quote price uses the current row's `priceBps`.

**UI:** Remove the global Price Curve page. The add/edit strategy modal exposes three ladder rows per asset: entry price and max spend. Maker cards show each active ladder. Taker fills any active asset.

**Scripts:** Demo and Sepolia scripts seed mock assets with three row ladders. ETH and WBTC use the example values from the user request.
