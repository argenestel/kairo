# Vault replacement required for full stock launch

Base has 150 price series but the v2 vault refresh exceeds Base's 16,777,216 transaction gas cap after roughly 85 active series. Padding was capped first; eth_estimateGas subsequently still failed at the raw cap. The Book, oracle, resolver, collateral and series remain live and are preserved.

Bounded change: track whether a series ever posted a held YES ask. Inventory accounting skips orderInfo scans only when none exist. Clear the flag after all tracked orders are cancelled; retain it conservatively on partial cancellation. Existing held-inventory/regression tests must pass, and a 150-market cold-gas regression must pass before replacement.

Archive the original vault manifest, pause old quotes, cancel every old tracked ladder, deploy a Kairo vault on the existing Book/Quoter, configure the same caps/allowlist/keeper, seed 1M test USDC, initialize all price quotes. Original vault assets and shares remain owned by their original holders; no withdrawal or transfer of their assets is required. This is a testnet mint, not ETH value transfer.
