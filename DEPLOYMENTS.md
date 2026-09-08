# Deployments

## Ethereum Sepolia

- Chain ID: `11155111`
- Aqua registry: `0x1111113ccf1426a8e30e2bff5e005d929bf6a90a`
- DryPowderRouter: `0xbaeECF2112476D996887CcDD12429663e6B1256c`
- WETHMock: `0x36360e728DbA55B039e9A6e2764341902FfB576c`
- mUSDC: `0xf8E3d9C37E0fD7DCa9bfe73D418B9203e3910D49`
- mETH: `0x9AaBcA389CE123634Cf511d085e3e68f42ec4FE1`
- mWBTC: `0xa2da0281b907c712c1FfdD77414aEBd1a43d094E`
- mLINK: `0x8F68237Ce63272ceE37987Ae1e19cBd3aAe65C20`

Transactions:

- WETHMock: `0x7f8f2cf8bf80c5affbf0a4890583983ece1faa18df08c6f8401b3ea87e569235`
- DryPowderRouter: `0x920ea7cf2dcb58b7c855ad4ecb77c4e7865eff8d4c072ae87f1947c5ca9d17d4`
- mUSDC: `0x05e73b309c98f600cc4627f573f4accf8c5b93f17c25848905d2cfc00cdda730`
- mETH: `0x4dd68800f2980d0e5394cf4c91c81df603eaf2514ad4aa62bcd2a3c29b34e438`
- mWBTC: `0x5f53290b242ecf00c9b77536045e65d2cb6a820e900dbf39f399fe68a41a6e67`
- mLINK: `0x975b9cc06eb2e931e1f3ee89b28578d52028a950b02209247ca4238feb6d63fc`

Demo status:

- `pn sepolia:setup` succeeded.
- `pn sepolia:quote` returned initial ETH, WBTC, and LINK quotes.
- `pn sepolia:fill` filled the ETH leg for `4000.0 mUSDC`.
- `pn sepolia:reprice` showed WBTC and LINK sibling repricing at the `95%` tranche.

Note: maker and taker were the same wallet for this first Sepolia run.
