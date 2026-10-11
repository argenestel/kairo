# Montions ticket printer — completion report

The six-step Montions flow is complete, with an original procedural night sky and meadow, Montions brand assets, binary payoff charts, drag controls, receipt printing, and an honest offline mock mode. No frozen chain interfaces or chain adapters were edited. No git commands, real wallet connections, or chain spending were performed.

## Changed files

- `src/styles/steps.css` (new): wheel lens, direction cards, strike details, timeline, logarithmic amount ruler, payout simulator, wallet and position surfaces; mobile layouts.
- `src/styles/ticket.css` (new): printer, animated receipt, perforations, QR panel, sign/retry control, stamp, and action dock.
- `src/styles/chrome.css`: stable title/sentence spacing, header overflow and progress overlap fixes, readable mobile testnet/settlement footer, small-screen layout.
- `src/App.tsx`: inert underlying content while sheets are open; submission guards for header navigation.
- `src/components/Header.tsx`: guard network changes and reset during submission.
- `src/components/Icons.tsx`: reuse the existing Montions brand mark rather than approximating it.
- `src/components/Sheet.tsx`: stable focus trap/restoration across rerenders, immediate Escape handling, labelled dialog fallback.
- `src/components/Payoff.tsx`: Home/End simulator controls and precise ARIA values for low-price assets.
- `src/components/TicketsDrawer.tsx`: inline retry for failed position loading.
- `src/steps/AssetStep.tsx`: put the initial SOL selection between other assets in the wheel.
- `src/steps/DirectionStep.tsx`: prevent number-key shortcuts from affecting the flow while a dialog is open.
- `src/steps/ExpiryStep.tsx`: explicit Today / All dates timeline zoom.
- `src/steps/AmountStep.tsx`: enforce the $1–$1,000 range for typed amounts as well as drag selection.
- `src/steps/TicketStep.tsx`: preserve the purchase chance on the success receipt; accurate demo wording; average-price slippage guard; explicit Post on X label.
- `src/steps/common.ts`: preserve valid zero probabilities returned by adapters.
- `src/lib/hooks.ts`: associate strike/expiry data with its asset and adapter so stale data cannot become a new asset's defaults.
- `src/lib/timeline.ts`: actual logarithmic amount positions.
- `src/state/chain.tsx`: clear the previous adapter during network loading.
- `src/state/flow.ts`: budget bounds, prevent navigation/reset while signing.
- `src/scene/scene.ts`: quieter aurora and star field for control legibility; existing pause and reduced-motion handling retained.
- `docs/qa/*.mjs`: repeatable Chromium interaction, screenshots, retry, fallback, sharing, and performance checks, with tooling installed outside the application.
- `docs/screens/*.png`: six steps at 1440×900 and 390×844, plus 375×740 amount/receipt, printing, success, error, wallet, Today zoom, and Base fallback evidence.
- `.omx/state/ui-polish/ralph-progress.json`: visual verdict and completion evidence.

## Decisions and simplifications

Completed the two missing imported stylesheets instead of replacing the existing React components. Reused the reducer, chain adapter boundary, drag physics, pricing model, cached quotes, and procedural scene. Used the existing brand mark. Applied bounded fixes to data ownership, focus behavior, and demo language. Added no application dependencies. Preserved the binary product: YES wins at or above the strike; NO wins strictly below; each winning contract pays $1.

The reference video's layout and physical ticket interaction informed the design. Its name, logo, copy, photographs, and vanilla option economics are absent from the app. All 25 frames were viewed in a contact sheet, with the key eight frames also inspected individually.

## Verification

`pnpm build` runs TypeScript checking and Vite production bundling. The initial build failed because `steps.css` and `ticket.css` did not exist; both have been completed. Final build results are recorded below.

Browser checks use `/usr/bin/chromium` and `puppeteer-core` installed into `/tmp/montions-qa`, with npm's cache in `/tmp/montions-npm-cache`. There is no lint script or standalone unit-test runner configured in this package; TypeScript is the configured static check, and the meaningful regression coverage is the browser flow.

Passed browser assertions:

- Asset search; DOGE and BTC precision; switching assets replaces their strike data.
- Above/YES and below/NO via keys 1/2, Enter navigation, drag strike selection.
- Today shortcut and short-date scale; timeline keyboard controls.
- $1 and $1,000 ruler endpoints, typed amount, log mapping.
- Binary payout simulator loss/win endpoints and keyboard controls.
- Demo wallet connection, purchase, success receipt, accurate demo language.
- Position loading, claim settled winning contracts, sell open contracts.
- Test faucet, Escape dismissal, explicit reconnect after reload.
- Inline insufficient-balance failure, faucet, successful retry, and receipt editing.
- X compose URL and clipboard sharing (no posts sent).
- Missing Solana/Base adapters fall back to labelled demo data; chain query and localStorage survive reload.
- All six steps at 375×740 without horizontal overflow; simulator stays above the CTA.
- Reduced-motion canvas is static; hidden-tab canvas stops changing.
- No browser exceptions in the full interaction suite.

A 180-frame desktop scene sample averaged **16.67 ms**, p95 **16.70 ms**, with **0 frames above 25 ms** in this headless environment. This is evidence for the 60 fps target on this machine, not a guarantee for every device.

## Reproduce

From `montions-app`:

```sh
npm install --prefix /tmp/montions-qa --cache /tmp/montions-npm-cache puppeteer-core
pnpm dev
# In a second shell:
node docs/qa/capture.mjs
node docs/qa/interactions.mjs
node docs/qa/retry.mjs
node docs/qa/networks.mjs
node docs/qa/extras.mjs
node docs/qa/performance.mjs
pnpm build
```

Set `MONTIONS_QA_DIR` to a different temporary tooling prefix or `CHROMIUM_PATH` to another Chromium binary if needed. Scripts expect the app at `127.0.0.1:5180` and run from the project root. Stop the dev server afterwards.

## Remaining risks

Real onchain purchases, wallet extension signing, gas, oracle settlement, and adapter deployment availability were not tested: they belong to the other jobs, and this job does not authorize chain spending. The fallback checks deliberately make real adapter imports unavailable. Mock transactions intentionally have no real explorer URL; real adapter receipts use the returned transaction URL for their QR and explorer action. Browser/device wallet-extension behavior and sustained performance on physical phones remain unverified. Screenshot values vary with simulated live prices.
