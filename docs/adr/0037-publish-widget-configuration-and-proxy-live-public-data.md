# ADR-0037: Publish Widget Configuration and Proxy Live Public Data

**Status:** proposed
**Date:** 2026-11-16

## Context

The owner explicitly requested clock/date, dynamic QR codes, scrolling text, weather and RSS components, followed by local example layouts. These extend the freeform authoring model beyond media and catalog areas. Installed players strictly parse immutable publication protocols; accepting additional area kinds under protocol 2 would break that boundary. Weather and RSS also introduce untrusted outbound sources and data that change independently of the published presentation.

## Decision

Add a Programming-owned widget area with five versioned configuration variants. Publish widget layouts as protocol 3, while preserving protocol 1/2 bytes and readers. Layout documents containing widgets use schema 2; existing schema 1 documents remain supported. Configuration, source selection, geometry and QR modules belong to the immutable manifest. The existing area-view default covers a widget's own presentation; regional playlist rules may still override it. Widgets are independent of coordinated pages and cannot produce audio.

Fetch weather and RSS on the API, never from a screen or browser directly. MET Norway Locationforecast is the initial weather adapter, with attribution, an identifying User-Agent, bounded coordinates and provider-compliant caching. RSS/Atom access accepts only public HTTPS sources, with DNS/IP validation, pinned connections, redirect revalidation, size/time/concurrency limits and XML without DTD/entities. Render only bounded plain-text headlines, source credit and validated links. Authenticated preview requires programming edit authority. Device data requests resolve only the current desired publication and its approved widget sources, under existing device admission and rate limits.

Treat live data as a bounded sidecar to an authorized protocol 3 generation, rather than rewriting immutable manifests or creating a publication for every forecast/headline update. The player validates it, writes it atomically and retains bounded generation-specific caches. Source failures preserve explicitly stale data for at most 24 hours; absent/expired data show an unavailable state. Protected output still requires the existing generation authorization and trusted clock. Clock/date use the screen's server-provided zone offsets; animation uses monotonic presentation time.

A dynamic QR uses a stable opaque link derived from the layout identity and area key. Saving remains a draft: the public destination becomes active only when an authorized publication commits. The most recent publication of that layout area sets the destination across its uses; restoring a publication deliberately restores that destination. Layout deletion removes its links. QR destinations are explicitly public HTTPS addresses; links grant no access to tenant APIs. The panel owns the public short-link route and resolves it through the generated API client.

Implementation on this branch is a review candidate under the owner's implementation authorization and prior delegation of product decisions. This record starts as proposed; repository review and integration establish acceptance. It does not claim hardware or pilot qualification.

## Rationale

The server is the existing authorization and provider boundary, and shared caches prevent every screen from contacting a news/weather provider. A separate protocol protects installed strict readers. A live-data sidecar preserves authoring/publication boundaries while allowing current information and offline recovery. Stable QR links provide the requested destination changes without forcing a new encoded symbol.

## Alternatives Considered

### Direct provider requests from Android and the browser

Rejected because it spreads provider behavior, reveals screen addresses to providers, bypasses centralized limits and makes offline/SSRF controls inconsistent.

### New immutable publications for every live-data refresh

Rejected because weather/news updates are data refreshes rather than editorial publication decisions, and would consume generation limits and retention/audit capacity.

### Reuse catalog or media areas to simulate widgets

Rejected because a clock, animated ticker or live feed has different configuration and runtime semantics. Mislabeling it would obscure contracts and bypass validation.

## Consequences

### Positive

- Existing media/catalog publications retain their format and behavior.
- Players consume approved configuration and bounded data through their existing trusted API.
- The editor can configure and preview all five components with reusable controls.

### Negative

- Live data need a cache, explicit staleness handling and provider-specific maintenance.
- A stable QR destination is shared by every use of the same layout area; publishing it can affect previously displayed copies of that code.
- QR links need a reachable configured panel origin. Local-only origins remain local test links.

### Operational or Migration Impact

Use additive SQL for widget configuration and public QR links. Regenerate API/SDK/database/component references and protocol fixtures. A protocol 3 player must be installed before widget layouts can play; old players remain explicitly incompatible with those generations and keep their authorized cached output. Provider access is optional to core signage, needs no API key for the initial adapter, and has no delivery SLA. Existing deployment and hardware acceptance actions remain in force.

## References

- [Composition design](../project/catalog-composition-design.md)
- [Player design](../project/player-design.md)
- [API compatibility](../api/versioning.md)
- [MET Norway terms](https://api.met.no/doc/TermsOfService), [license](https://api.met.no/doc/License) and [Locationforecast](https://api.met.no/weatherapi/locationforecast/2.0/documentation)
- [RSS specification](https://www.rssboard.org/rss-specification)
