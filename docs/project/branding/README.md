# Teluni Brand Identity

[Product documentation](../README.md) · [Product vision](../product.md) · [PH-07](../human-actions.md#ph-07) · [Web identity pipeline](../../../apps/web/README.md#identity)

## Approved name and domain direction

This document owns Teluni's current brand/domain direction and approved Connected Tiles visual identity. The owner approved the name/domain direction and selected Connected Tiles for project integration on 2026-10-17. Domain choice is distinct from registration, DNS control or trademark clearance.

| Item | Recorded direction | Evidence / limit |
| --- | --- | --- |
| Product name | **Decided:** Teluni | Explicit owner instruction |
| Visual identity | **Approved:** Connected Tiles | Explicit owner selection and authorization to integrate it |
| Principal domain | **Decided:** `teluni.app` | Approved product address; registration/control evidence has not been supplied |
| Brazil defensive domain | **Decided option:** `teluni.com.br` | Owner reports availability; secondary/defensive option, not a completed registration or spending authorization |
| `.com` domain | **Outside current scope:** `teluni.com` | Owner reports unavailable/premium and unsuitable for the current budget |
| Trademark | **In progress:** preliminary research has advanced | Owner report; no final clearance/registration evidence is inferred |

No registrar purchase, DNS change or application endpoint reconfiguration is performed as part of visual identity integration. Orion provenance and technical configuration names remain unchanged.

## Connected Tiles

The three rounded display tiles express multiple screens coordinated together. A larger primary screen and two smaller companion screens provide a compact, recognizable silhouette for a single merchant or a branch network. Clear gaps preserve the cluster in monochrome and at small sizes.

The wordmark is titlecase **Teluni**, set in **Plus Jakarta Sans Semibold**. The shell and documentation navigation retain accessible live text beside the decorative symbol; standalone institutional wordmarks are available as outlined SVGs. The interface loads the selected variable font locally, with `font-display: swap`, rather than relying on an external font service.

## Palette and surfaces

| Role | Color | Usage |
| --- | --- | --- |
| Primary | `#2563EB` | Main screen, links, selected navigation and focus emphasis |
| Accent | `#14B8A6` | Companion screen and restrained visual accents |
| Secondary / dark-surface emphasis | `#60A5FA` | Companion screen, dark-surface brand variants and suitable blue text on navy |
| Dark surface / primary ink | `#0F172A` | Header, dark applications, primary text on light surfaces |
| Light surface | `#F8FAFC` | Page, navigation and touch-icon background |
| Light ink | `#E2E8F0` | Wordmark/text on navy |
| Supporting neutrals | `#334155`, `#64748B`, `#CBD5E1` | Supporting text, borders and separation as appropriate to contrast |

**Light application:** navy text with blue/teal screen tiles on off-white. **Dark application:** light text with brighter-blue/teal tiles on navy. The product shell now has desktop sidebar navigation and System/Light/Dark appearance selection, with semantic colors for shared controls and surfaces. The developer portal and separate Keycloak pages retain their existing presentation. Theme implementation and remaining screen qualification belong to [PJ-41](../implementation-plan.md#pj-41-interface-alignment); the brand proofs alone are not evidence of complete product coverage.

Use teal as an accent or a background with dark text, rather than small text on off-white. [Measured contrast and export dimensions](review.json) describe the artwork, not a blanket accessibility certification. Favicon proofs cover 16/32 px and navigation proofs 24/32 px. Android adaptive/store exports still depend on the future player's packaging requirements.

## Canonical sources and asset kit

| Asset | Owner / use |
| --- | --- |
| [Runtime brand mark](../../../apps/web/src/assets/brand-mark.svg) | Canonical Connected Tiles symbol; shell, portal and SVG favicon consume this source |
| [Runtime touch icon](../../../apps/web/src/assets/brand-touch-icon.png) | Derived 180×180 PNG generated from the runtime SVG on `#F8FAFC` |
| [Light logo](assets/connected-tiles/logo-light.svg) / [dark logo](assets/connected-tiles/logo-dark.svg) | Outlined institutional lockups; live app text remains accessible |
| [Wordmark](assets/connected-tiles/wordmark.svg) | Outlined lettering for standalone brand use |
| [Monochrome symbol](assets/connected-tiles/symbol-monochrome.svg) | Single-ink applications with preserved tile gaps |
| [Identity board](assets/connected-tiles/identity-board.png) | Approved visual reference; illustrative panels do not implement product workflows |
| [Light application](assets/connected-tiles/application-light.png) / [dark application](assets/connected-tiles/application-dark.png) | Fixed visual brand proofs |
| [Small-size proof](assets/connected-tiles/small-size-proof.png) | Actual-size symbol review |
| [Desktop app](assets/connected-tiles/web-home-desktop.png) / [documentation](assets/connected-tiles/web-docs-desktop.png) | Historical PJ-04 local integration screenshots (2026-10-17); current interface evolution is tracked by PJ-41 |
| [Mobile app](assets/connected-tiles/web-home-mobile.png) / [documentation](assets/connected-tiles/web-docs-mobile.png) | Historical PJ-04 mobile integration screenshots (2026-10-17); current interface evolution is tracked by PJ-41 |
| [Light/dark surfaces](assets/connected-tiles/symbol-surfaces.png) | Runtime SVG inspected against both brand surfaces |
| [Asset inventory](assets.json) | Selected kit's SVG/PNG exports and runtime source locations |

The kit's standalone symbol is an export of the runtime mark; do not evolve it independently. Logo/application SVGs are exact-color vector artwork with outlined wordmark lettering. PNGs are derived review exports. The generated reference board can contain approximate typography/color annotations; the runtime SVG, outlined exports and palette above define the current identity.

## Web integration and regeneration

The shell, documentation rail, browser favicon and the Keycloak sign-in theme (which mounts it from `apps/web/src/assets`) use the canonical SVG. The web stylesheet, and the sign-in theme through the same file, serve Plus Jakarta Sans from [the local font file](../../../apps/web/public/fonts/plus-jakarta-sans.ttf). The public font directory includes its [OFL license](../../../apps/web/public/fonts/OFL.txt) and [upstream source metadata](../../../apps/web/public/fonts/sources.json), which are copied into the static build along with the font. Third-party font software retains its own license.

After changing the approved mark, run `pnpm -C apps/web identity:write` to regenerate the runtime touch PNG through the existing Playwright exporter. Commit SVG and PNG together. The export background is `#F8FAFC`; do not edit the PNG independently or replace it with a board image. Refresh kit symbol/touch copies from these canonical outputs, then regenerate size-specific proofs if needed.

For a kit raster proof with an installed external SVG renderer: `rsvg-convert assets/connected-tiles/symbol.svg -w 32 -h 32 -o assets/connected-tiles/favicon-32.png`. This is an external rendering utility, not a new pnpm command. The outlined wordmark needs no font loading; live specimen text in application SVGs can use fallback rendering, while supplied PNGs remain fixed proofs.

Review home, documentation, mobile navigation, favicon and touch icon at actual sizes; verify local font loading, keyboard/accessibility behavior and light/dark brand surfaces. Run focused web checks and full `pnpm validate`. UI/player mockups remain illustrative; no product workflow or Android application is introduced by the identity kit.

## Planned product interface alignment

On 2026-10-23 the owner requested explicit planning for a product interface aligned with the identity board's light/dark examples, then authorized continued development and a pull request. [PJ-41](../implementation-plan.md#pj-41-interface-alignment) owns the delivery sequence, scope and acceptance criteria. Its first increment implements the shared responsive shell, appearance selection and semantic product colors; the following increment moves company context and its available workflow links into the sidebar. Final visual qualification remains open before pilot acceptance. PJ-04 retains its original brand integration scope. The board remains illustrative for workflows, copy and imagery, while its visual direction now has an explicit product delivery task.

## PH-07 status

Visual direction selection is complete and Connected Tiles is integrated into the web app. PJ-04 is **completed**: desktop/mobile inspection verified image/font loading and responsive layout; full local `pnpm validate` passed, including 16 E2E tests. [Review evidence](review.json) records the runtime checks. PH-07 remains **in progress** solely for dated non-secret domain registration/control evidence when ownership is claimed and the outcome/disposition of trademark research before public brand commitments. Selection and integration do not certify registration or legal clearance. The defensive domain remains an option unless the owner authorizes registration.
