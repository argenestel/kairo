# Interactive charts — completion report

Continued the stopped Grok job. Kept its custom SVG rendering and existing marked step/BookPanel integrations; added no dependencies.

## Changed files

- `src/charts/PriceChart.tsx`: interactive real-sample crosshair with USD price and full UTC date/time; labeled future scenarios; pan, wheel/pinch zoom, keyboard pan/zoom/reset; unique SVG IDs; strike/expiry/cone markers and empty-history state.
- `src/charts/history.ts`: exact oracle values and publication timestamps, bounded newest-first multicall samples across the requested time window, previous proxy phase support, cache and request deduplication; real Solana account samples only; RPC timeout/failure handling.
- `src/charts/feeds.ts`: current deployment manifests and chain configuration, current Base KeeperFeed hub, honest keeper-reported demo labels for stock/ETF/commodity feeds even when the manifest calls their interface Chainlink.
- `src/charts/usePriceHistory.ts`: lazy history loader, polling (EVM 30 s / Solana 5 s), cancellation of stale component updates and visible refresh-failure state.
- `src/charts/cone.ts`, `src/charts/index.ts`: separate lightweight cone geometry from the dynamically loaded oracle code.
- `src/charts/DepthChart.tsx`: cumulative step depth, contract-size axis, hover/touch/keyboard inspection.
- `src/components/Payoff.tsx`: exact YES ≥ strike / NO < strike boundary; pointer capture, keyboard precedence over hover, snapping, always-visible spot/strike markers, win-threshold explanation and bounded tooltip.
- `src/charts/charts.css`: both modes use existing tokens; chart-heavy steps scroll inside the available body area; expiry spacing no longer hides the plot behind Continue; tooltip containment and no accidental text selection.
- `src/charts/qa.mjs`: reusable Chromium interaction/regression suite, screenshots at `docs/screens/charts-*.png`.
- `.omx/state/charts/ralph-progress.json`: visual verdict record.

No implementation changes to step files, package dependencies, reading pages, chains, UwU or mascots. Existing integrations were retained.

## Simplifications and decisions

Deleted real-history price pinning, synthetic Solana prehistory, UI spot ticks inserted as oracle prints, and the hundreds-of-serial-reads fallback. Retained custom SVG rather than adding a chart library. Dense EVM feeds are sampled to approximately 220 points per phase/window; this is real historical round data, not generated candles. Solana history starts with actual samples gathered in the current tab session. The simulator explains the strike as the win threshold: a binary ticket has no separate continuous breakeven price.

The Chainlink phase/round handling follows [Chainlink historical data documentation](https://docs.chain.link/data-feeds/historical-data); batching follows [viem multicall documentation](https://viem.sh/docs/contract/multicall).

## Verification

- `pnpm typecheck`: passed (also run by build).
- `pnpm build`: passed, TypeScript and Vite production bundle clean of errors. History is a separate ~7.5 kB lazy chunk.
- `CHART_QA_URL=http://127.0.0.1:4181 node src/charts/qa.mjs`: desktop 1440×900 and mobile 390×844, Serious and UwU. Price hover/pan/wheel/pinch/resize, marker/cone presence, simulator drag/touch/keyboard/snapping/tooltip containment, exact NO boundary, depth/ladder/probability and no horizontal overflow. All four combinations passed without browser exceptions. Loader fixtures returned 146 unchanged round points using 12 multicalls; missing feeds returned no fabricated prices, and RPC failure caused only the two metadata reads. YES won at the strike; NO lost at equality and won strictly below.
- Read-only RPC checks through the actual loader: Base ETH 96 points, Arbitrum ETH 220 points, Pyth SOL publication sample, Base TSLA KeeperFeed print ($382.70). A deliberately incorrect UI spot of 999999 did not alter any real point.
- 28 new chart screenshots saved: six chart views × two modes × two viewports, plus four live Base captures.
- Solana memory persistence check passed: 1 → 2 real publication samples; original price/timestamp retained, with no synthetic prehistory.
- Live Base price charts captured and checked on desktop/mobile in both modes: `charts-live-base-{serious,uwu}-{desktop,mobile}.png`.
- No lint script is configured; TypeScript static checks and the browser regression suite are the available project checks.

## Remaining limits

- KeeperFeed stocks currently have only one observed round after deployment; the chart shows the actual print and collects subsequent updates, rather than manufacturing session history.
- Solana history is held in tab memory and builds as Pyth publishes new timestamps. It does not survive a full reload.
- Public RPC availability and oracle publication cadence determine freshness; unavailable history is clearly labeled and retried.
- Existing viem (~588 kB) and Solana (~696 kB) vendor chunks still trigger Vite's >500 kB warning. Changing their shared bundling is outside this job's ownership.
- Screenshots verify charts and responsive interactions. No wallet transaction was sent and no gas was spent.
