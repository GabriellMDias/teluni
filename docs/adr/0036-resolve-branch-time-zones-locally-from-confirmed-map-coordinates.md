# ADR-0036: Resolve Branch Time Zones Locally from Confirmed Map Coordinates

**Status:** accepted
**Date:** 2026-11-15

**Acceptance scope:** Accepted under the owner's explicit full-address/map request and the engineering-choice delegation recorded in [PH-25](../project/human-actions.md#ph-25). The pull request provides repository review; acceptance selects the direction and does not claim implementation or pilot qualification.

## Context

The owner requested a full branch address with selection on a map, replacing the visible branch time-zone field. Scheduling already uses branch IANA zones and explicit screen overrides. A city-only selection cannot represent an arbitrary branch point or a time-zone boundary accurately. An address written by a person is not a verified geographic assertion.

## Decision

Keep branch addresses and confirmed coordinates in the organizations module. Resolve coordinates to a unique supported IANA zone on the server with the pinned `geo-tz` geographic-boundary dataset, atomically with the branch update. Reject ambiguous or unsupported results explicitly rather than choosing an arbitrary zone. Preserve existing branch zones until a location is selected; keep explicit screen overrides.

Use feature-local Leaflet maps with attributed OpenStreetMap raster tiles and normal browser caching/referrer behavior. A bundled, attributed GeoNames city search helps center the map without sending address text to a geocoding service. The person enters the full address and confirms the exact point by clicking, dragging, keyboard selection, or explicit coordinate entry. Address verification and address autocomplete are outside this increment.

## Rationale

Geographic time-zone lookup remains deterministic and available without a remote geocoding or time-zone account. `geo-tz` documents an exact boundary lookup, including places with more than one zone; its larger server-side installation is acceptable for infrequent branch administration. Leaflet supports the needed marker and keyboard interactions without coupling organizations to playback media or device internals. Map tiles are presentation data and cannot decide scheduling authority. The existing native address field and independent coordinate alternative keep editing available when tile delivery fails.

## Alternatives Considered

- City-only zone lookup was initially explored, then superseded within this unmerged increment by the owner's explicit map/full-address preference.
- A live geocoding provider could offer address lookup, but adds availability, privacy, usage-policy and credential/commercial decisions. This request can be completed with local city navigation and explicit point selection, so no address geocoding provider is introduced.
- Approximate coordinate lookup reduces installation size but can choose the wrong side of a geographic boundary. Exact local lookup and an explicit ambiguous-result failure preserve scheduling semantics.

## Consequences

- Full addresses and coordinates are confidential company data. Do not put them in telemetry or audit payloads; audit field names and apply current branch permissions and version checks.
- Public map tiles require internet, visible attribution and compliance with the [OpenStreetMap tile policy](https://operations.osmfoundation.org/policies/tiles/). Use viewport tiles only, normal HTTP caching and a browser referrer; there is no offline prefetch or availability guarantee. Reassess the tile provider before traffic exceeds that service's permitted usage. A different tile provider is a presentation substitution, independent of stored coordinates or zone lookup.
- GeoNames and timezone-boundary-derived data retain their upstream licenses and attribution; refreshing either dependency/catalog is an explicit reviewed maintenance change. Existing stored zones do not change solely because a dataset was refreshed.
- The additive migration retains legacy rows and supports old name-only clients. Direct legacy time-zone overrides are rejected after a map location exists, preventing a location/zone mismatch. A selected location also requires a full address. Apply migration and runtime grants before the application.

## References

- [Tenant data design](../project/tenant-data-design.md)
- [Organizations implementation](../../apps/api/README.md#organizations)
- [geo-tz](https://github.com/evansiroky/node-geo-tz)
- [Leaflet stable API](https://leafletjs.com/reference-1.9.4.html)
- [GeoNames data](https://download.geonames.org/export/dump/readme.txt)
