# Deployments

## Ethereum Sepolia

- Chain ID: `11155111`
- Aqua registry: `0x1111113ccf1426a8e30e2bff5e005d929bf6a90a`
- DryPowderRouter: `0xbf5E9Ec40cD683EB02215759708751E61A655A9B`
- WETHMock: `0xE095Fd1D7Ec2954Bf19dDe5575866e5b4f76d0E3`
- mUSDC: `0x5b9d76B3517D04AAD311E5197eEEb801c8C133D4`
- mETH: `0x2782E69ab9456CD1505f3598eaAb18BF63146683`
- mWBTC: `0xc847B5a5A8916C40c77d71Ef3312356991414c36`
- mLINK: `0x406A43BfE9fFA7204a3d5503d3D6379D4ADC0353`

Transactions:

- WETHMock: `0x67c0b1c30827a746b68dea6cb68ee6e7ebb5279471f623a02d7c965b4a1a26b8`
- DryPowderRouter: `0x0be4d6e9ed1981c1766c314719512d1ca74e4c1af21dd366e284aff68d38f18e`
- mUSDC: `0x8b89a6b8b3553fea94ebee256fe78ce132d6b2566637c2c91a9110fca7d83ffa`
- mETH: `0xc40a65860a34c682f1bac7aa4ab00317f7c1acd51131635f9590dc2b6c2df9cb`
- mWBTC: `0xd2030ea559c706666abede67bdb3a423e483a2b10961b9c056787a7fb3a86bee`
- mLINK: `0x763122564721b79b2e93220eee6fc8ef6e24e81199a69f78a32e0febd04ab22b`

Demo status:

- `pn sepolia:setup` succeeded.
- `pn sepolia:quote` returned initial ETH, WBTC, and LINK quotes.
- `pn sepolia:fill` filled the ETH leg for `4000.0 mUSDC`.
- `pn sepolia:reprice` showed WBTC and LINK sibling repricing at the `95%` tranche.

Note: maker and taker were the same wallet for this first Sepolia run.
