# Teluni Brand Identity Studies

[Product documentation](../README.md) · [Product vision](../product.md) · [PH-07](../human-actions.md#ph-07) · [Web identity pipeline](../../../apps/web/README.md#identity)

## Approved name and domain direction

This document owns Teluni's brand/domain direction and the comparison of initial visual candidates. The product owner approved the following direction on 2026-10-17; approval of a domain choice is distinct from registration, DNS control or trademark clearance.

| Item | Recorded direction | Evidence / limit |
| --- | --- | --- |
| Product name | **Decided:** Teluni | Explicit owner instruction; the visual identity is still awaiting review |
| Principal domain | **Decided:** `teluni.app` | Approved product address; no purchase, DNS control, HTTPS deployment or ownership evidence supplied in this task |
| Brazil defensive domain | **Decided option:** `teluni.com.br` | Owner reports availability; secondary/defensive option for Brazil, not a completed registration or commitment to spend |
| `.com` domain | **Outside current scope:** `teluni.com` | Owner reports unavailable/premium and unsuitable for the current budget; do not pursue it now |
| Trademark | **In progress:** preliminary research has advanced | Owner report only; no final registration/clearance evidence is invented |

No registrar purchase, live domain availability check, DNS change or network endpoint reconfiguration is performed here. The canonical technical configuration and Orion provenance are unchanged.

## Review status and asset hierarchy

All A/B/C identity assets are **proposed**, unapproved studies. The production [brand SVG](../../../apps/web/src/assets/brand-mark.svg) and derived [touch icon](../../../apps/web/src/assets/brand-touch-icon.png) remain the neutral foundation placeholders. UI and player applications in the boards are illustrative compositions, not implemented product screens.

Each direction has one image-generation board containing its logo/wordmark, symbol, palette, typography and light/dark application. Separate SVG candidates provide exact geometry/colors and outlined wordmark lettering; they are vector refinements of the studies, not pixel-identical extractions from the generated boards. Standalone PNG proofs are rasterized from those SVG sources. The generated boards can contain approximate type/color annotations; the exact specifications below and candidate SVGs are authoritative for these proposals.

The SVGs are candidates, not replacements for runtime assets. The favicon/app/touch examples test shape and spacing; they are not a complete Android adaptive-icon or app-store submission package.

## Option A — Unified Frame

**Concept:** one strong screen frame, with a T-shaped opening and a small teal accent, represents a clear central point for managing displays. It favors a compact silhouette, generous negative space and a recognizable display metaphor.

**Palette:** blue `#2563EB` primary, teal `#14B8A6` accent, navy `#0F172A`, off-white `#F8FAFC`, light text `#E2E8F0`, supporting slate `#334155` / `#64748B` / `#CBD5E1`. A lighter blue `#60A5FA` is available for dark-surface emphasis.

**Typography:** Manrope Semibold for the proposed wordmark/headings, regular/medium for future interface copy. The vector wordmark uses outlined glyphs for stable rendering; UI font adoption is a later approved integration.

**Wordmark and symbol:** titlecase `Teluni`, ample space after the symbol, a separate symbol for tight navigation/favicon contexts. The teal detail is optional in monochrome, so identity does not depend on color alone.

**Light:** navy wordmark, blue symbol, restrained teal details on off-white. **Dark:** light wordmark, brighter blue symbol and teal accent on navy. Keep shape cutouts transparent so they inherit the actual surface.

**Recommendation:** preferred technical starting point. It states the screen-management purpose directly and has fewer independent elements to preserve at tiny sizes than B. Final optical spacing and favicon review still require human approval.

## Option B — Connected Tiles

**Concept:** a compact cluster of three display tiles expresses multiple endpoints coordinated together. Rounded modules provide a warmer, commercially approachable identity for small businesses and branch networks.

**Palette:** blue `#2563EB` anchors the identity; teal `#14B8A6` is more prominent than in A; navy `#0F172A`, off-white `#F8FAFC`, light text `#E2E8F0` and the same slate neutrals support it. The smaller secondary tile also uses `#60A5FA`; dark-surface emphasis can use this lighter blue.

**Typography:** Plus Jakarta Sans Semibold for the wordmark/headings; regular/medium for proposed interface copy.

**Wordmark and symbol:** titlecase `Teluni` paired with three separated rounded tiles. The tile cluster remains distinct in a single ink; no hairline connections are necessary.

**Light:** navy lettering with blue/teal tiles on off-white. **Dark:** light lettering with brighter blue/teal modules on navy. The monochrome variant must preserve gaps between tiles.

**Tradeoff:** the strongest multi-screen metaphor, but tile separations require more care at 16 px. Retain it as a serious alternative if the owner prefers the network/portfolio message over a single screen frame.

## Option C — Focus Monogram

**Concept:** a geometric T/U ligature combines a display's top rail with a U-shaped stage/cradle. It is more abstract and editorial, emphasizing a compact distinctive lettermark over a literal screen outline.

**Palette:** navy `#0F172A` leads; blue `#2563EB` and teal `#14B8A6` distinguish the top rail and lower form. Off-white `#F8FAFC`, light text `#E2E8F0` and slate neutrals support it; on dark surfaces the navy part becomes light and the blue can brighten to `#60A5FA`.

**Typography:** Space Grotesk Medium for the wordmark/headings; regular for proposed interface copy.

**Wordmark and symbol:** titlecase `Teluni` alongside the T/U form; a monochrome version retains both the upper bar and the lower counter.

**Light:** navy/teal lower cradle and blue upper rail, dark lettering on off-white. **Dark:** light/teal lower cradle, brighter blue rail, light lettering on navy.

**Tradeoff:** strongest as a premium abstract monogram, but its connection to signage needs more explanation than A. It remains available for refinement rather than being discarded.

## Files and comparison

The [asset inventory](assets.json) lists every board, logo/wordmark, symbol, light/dark application, favicon/app/touch proof and small-size contact sheet by option. Each directory uses the same filenames so comparisons are like-for-like. Open the individual files at actual size before judging favicon readability.

| Option | All-in-one generated image | Vector logo / symbol | Exact light / dark proofs |
| --- | --- | --- | --- |
| A | [Board](assets/option-a/identity-board.png) | [Logo](assets/option-a/logo-light.svg) / [Symbol](assets/option-a/symbol.svg) | [Light](assets/option-a/application-light.png) / [Dark](assets/option-a/application-dark.png) |
| B | [Board](assets/option-b/identity-board.png) | [Logo](assets/option-b/logo-light.svg) / [Symbol](assets/option-b/symbol.svg) | [Light](assets/option-b/application-light.png) / [Dark](assets/option-b/application-dark.png) |
| C | [Board](assets/option-c/identity-board.png) | [Logo](assets/option-c/logo-light.svg) / [Symbol](assets/option-c/symbol.svg) | [Light](assets/option-c/application-light.png) / [Dark](assets/option-c/application-dark.png) |

## Contrast and small-size review

Exact sRGB contrast measurements and tested sizes are recorded in [review measurements](review.json). These are checks of candidate artwork, not an accessibility certification of the illustrated product UI. Navy on off-white and light text on navy are the primary text pairs. Blue on off-white supports emphasis; light text on the brighter-blue variant must be checked for each actual use.

Teal is an accent or background with suitable dark text; do not use it as small text on off-white. Use `#60A5FA` for small blue text on navy rather than assuming the base blue meets every text contrast need. Logos also have monochrome candidates. Review 16/32 px favicon and 24/32 px navigation proofs, 180 px touch tiles and 512 px app-icon examples; Android adaptive safe areas and platform masks require a separate final export review.

## Candidate sources and reproduction

The editable SVGs are the canonical candidate artwork; the PNGs are derived review exports. Wordmark lettering is already outlined and does not require font loading to display. The application mockups contain live UI specimen text and can use fallback text rendering in an SVG viewer; their supplied PNGs are the fixed visual proofs. Fonts are retained only to reproduce/refine typography studies.

For a candidate raster export with an installed SVG renderer, for example: `rsvg-convert assets/option-a/symbol.svg -w 32 -h 32 -o assets/option-a/favicon-32.png`. This is an external rendering utility, not a new pnpm command or runtime dependency. Board PNGs come from image generation and are not mechanically regenerated from the refined SVGs. The production web touch icon continues to use its existing Playwright exporter after approval.

## Technical integration after approval

1. The owner chooses A, B or C, requests any refinements, then approves the final symbol, wordmark, colors and usage rules. Recommendation of A is not approval.
2. Refine the selected source SVG for small sizes, contrast, clear space and predictable self-contained rendering. Keep comparison assets for the other options. Confirm any attribution/trademark questions from PH-07/PH-14 without assuming the studies are legally cleared.
3. Replace only `apps/web/src/assets/brand-mark.svg` with the approved symbol, preserving the existing single-source asset flow. The shell, portal and favicon already consume this SVG. Keep the adjacent live `Teluni` text and decorative image accessibility behavior; a wordmark image need not replace accessible text.
4. Run `pnpm -C apps/web identity:write` to derive the 180×180 `brand-touch-icon.png`. The current exporter uses `#f7f9fa`; if the approved light tile must use exactly `#F8FAFC`, deliberately update that script in the integration task, regenerate, and review the diff. Never independently overwrite the production PNG with an AI board or unrelated raster.
5. Review shell/portal/favicon/touch outputs in both real light/dark contexts, at actual sizes and mobile/desktop layouts. UI color tokens and loading a proposed font are separate approved changes, not automatically supplied by replacing the symbol. Run the focused web checks and full `pnpm validate`.
6. Produce the future Android adaptive/store icon exports only after its packaging requirements are known. Current player mockups do not constitute an Android implementation.

## What remains for PH-07

- Recorded owner choice and approval of one final visual identity, including refinements from actual-size review.
- Integration of the approved SVG and generated touch icon into the real web app, with visual and validation evidence. Preserve the existing workflow until that approval.
- Dated non-secret registration/control evidence for domains when claimed as owned, and a recorded outcome/disposition of trademark research before public brand commitments. The defensive domain remains an option unless the owner authorizes registration.

PH-07 remains **in progress**. Asset exploration can be delivered while final integration waits for approval; PJ-04 is not complete.

## Sources and provenance

Boards were created using the built-in `image_gen.imagegen` tool. The exact [prompt set](generation-prompts.json) is saved for review. Each generated original is copied into this repository; no project asset depends solely on a Codex cache path. The proposals were developed for this brief without supplied third-party logos; this is not a trademark similarity search or certification of originality against all existing marks.

Typography sources are the official Google Fonts directories for [Manrope](https://github.com/google/fonts/tree/main/ofl/manrope), [Plus Jakarta Sans](https://github.com/google/fonts/tree/main/ofl/plusjakartasans) and [Space Grotesk](https://github.com/google/fonts/tree/main/ofl/spacegrotesk). Bundled, unmodified font files are for reproducible studies, retain their family-specific OFL notices in [Manrope](fonts/manrope-OFL.txt), [Plus Jakarta Sans](fonts/plusjakartasans-OFL.txt) and [Space Grotesk](fonts/spacegrotesk-OFL.txt), and are not loaded by the web application. [Source metadata](fonts/sources.json) records upstream URLs and Git blob identifiers. Third-party font software retains its own license rather than being relabeled under Teluni's Apache-2.0 choice.
