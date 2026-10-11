Read /home/arg/projects/hack/colessolana/.orchestra/CONTEXT.md first (incl. the DIRECTION UPDATE, item 5).

# Job: original anime mascots for the UwU mode (Grok)

You own ONLY montions-app/src/mascot/** and montions-app/public/mascot/** (create them). Do not edit other app files; a later job wires your components into the UI.

Create ORIGINAL chibi anime-girl mascots — "chain-tans", one per venue — as hand-authored, layered vector SVG (no raster images, no external assets, no copying or imitating any existing character, franchise, artist or logo; no sexualisation — cute, wholesome, all-ages, SFW):
- **Base-chan** (blue palette, short bob, round glasses, hoodie), **Arbi-chan** (navy + cyan, long ponytail, techwear jacket), **Hyper-chan** (mint/teal, twin tails, headphones), **Sol-chan** (purple→teal gradient accents, wavy hair, star clip), and **Mon-chan** the Montions host (warm cream + coral, side braid, holding a ticket). Distinct silhouettes; consistent art style: big expressive eyes with highlights, simple cel shading (1–2 tones), clean outlines.
- Expressions per character: `neutral`, `happy`, `excited` (sparkle eyes), `worried`, `wink`, `sleepy`; poses: `idle`, `point` (pointing at the content), `cheer` (arms up), `hold-ticket`.
- Implement as typed React components: `src/mascot/Mascot.tsx` exporting `<Mascot who="base|arbi|hyper|sol|mon" mood="…" pose="…" size={number} />` built from shared SVG parts (head, hair, eyes, mouth, body, arms) so expressions/poses swap parts, plus a tiny CSS animation set (idle bob, blink every few seconds, cheer bounce) that respects prefers-reduced-motion. Also export `<SpeechBubble>` (rounded pastel bubble with tail) and a `kaomoji` helper set ((＾▽＾), (｡•̀ᴗ-)✧, (๑˃ᴗ˂)ﻭ …).
- Also produce static exports `public/mascot/<who>-<mood>.svg` for each character's `happy` and `neutral` moods (for the paper/docs/social cards).
- UwU scene assets (components, no rasters): `src/mascot/Sakura.tsx` (falling sakura petals canvas/SVG, lightweight), `src/mascot/Sparkles.tsx`.
- Quality check is mandatory: render every character × mood × pose to PNG (e.g. `rsvg-convert` if installed, else headless Chrome via a temp-dir puppeteer-core/playwright script rendering a contact-sheet HTML page), LOOK at the PNGs with your image-reading ability, and iterate until faces are symmetric, eyes aligned, proportions consistent and they look genuinely cute and polished. Save the final contact sheet to montions-app/docs/screens/mascots.png.
- Typecheck: `cd /home/arg/projects/hack/colessolana/montions-app && npx tsc --noEmit` (report errors only from your files).
Report: component API, list of assets, the contact-sheet path, and anything you'd improve.
