# ADR-0029: Evaluate Schedules with the Temporal API and Shared Fixtures

**Status:** proposed
**Date:** 2026-10-19

## Context

Teluni schedules playlists by local business time per screen: weekdays, local hours, overnight windows, inclusive final dates and all-day windows, interpreted in the screen's time zone or its branch's, never the server's (FR-06). The [release policies](../project/release-policies.md#time-and-scheduling) fix how DST gaps and repeated hours resolve and require the backend preview and the Android player to share fixtures. Node.js 24, the API runtime, does not ship the ECMAScript Temporal API, and the standard `Date` and `Intl` objects give offsets for an instant but no way to resolve a local time that falls in a gap or a repeated hour. D-10 has not selected a time-zone library.

This record decides how the API represents and resolves local time for schedules and how the API and the player agree on the results. The rules themselves are in the [programming design](../project/programming-design.md).

## Decision

Teluni will evaluate schedules with a pure evaluator over the Temporal API and verify every implementation against one fixture file:

- The API's programming module owns a pure TypeScript evaluator that takes rules, a default, an IANA zone name and an instant range and returns resolved segments. It never reads a clock or the process time zone.
- Local dates and times are Temporal `PlainDate` and `PlainTime` values, instants are Temporal `Instant` values, and zone resolution uses `ZonedDateTime` with explicit disambiguation plus transition lookup for gaps. Until Node.js provides Temporal natively, the API uses the `temporal-polyfill` package, pinned to an exact version, imported only by the programming module.
- Canonical fixtures in JSON (rules, zone, range and expected segments in UTC and local form, and expected validation codes) are owned by the API module and run by its tests. The player runs the same file against its implementation in PJ-12; neither implementation is the reference for the other.
- Preview is computed only by the API; the panel displays its segments.

## Rationale

Temporal models exactly the concepts the policies use (plain local dates and times, instants, zones and explicit disambiguation), and its model matches `java.time`, which an Android player is expected to use, so both implementations reason in the same terms and the fixtures express the same cases. A spec-conformant polyfill keeps the code on the standard API, so removing it when Node.js ships Temporal is an import change rather than a rewrite. Fixtures, not shared code, are the contract between two runtimes in different languages. Keeping the evaluator pure makes validation, preview and tests deterministic and independent of the host.

## Alternatives Considered

### Luxon or date-fns-tz

Mature libraries, but each has its own model of gaps and repeated hours that differs from `java.time` and from the standard on the way to Node.js, so the fixtures would encode library behavior rather than the policy.

### Hand-written resolution over `Intl.DateTimeFormat`

Avoids a dependency, but searching transitions and disambiguating local times is where subtle errors appear, and the code would duplicate a standard that is about to ship.

### A shared evaluator package compiled for both runtimes

One implementation for the API and the player would remove the second implementation, but the player is a native Android application; embedding a JavaScript engine to run schedules adds a runtime and its own failure modes on the device.

## Consequences

### Positive

- Deterministic, host-independent schedule results with the selected DST rules.
- One fixture file that both the API and the player must pass.
- A direct path to native Temporal.

### Negative

- A runtime dependency in the API until Node.js ships Temporal, which must be kept current with the zone database it relies on (the polyfill uses the runtime's `Intl` zone data).
- Two implementations of the evaluator, kept equal only by the fixtures.

### Operational or Migration Impact

- Zone data comes from the Node.js runtime's ICU; updating Node.js updates zone rules, and preview results for future dates can change after a zone-database update, as on the device.
- Replacing the polyfill with native Temporal removes the dependency and its import; the fixtures must still pass.

## References

- [Programming design](../project/programming-design.md)
- [Release policies: time and scheduling](../project/release-policies.md#time-and-scheduling)
- [Playback and synchronization](../project/playback-and-sync.md#time-and-regional-scheduling)
- [ADR-0019](0019-propose-immutable-publications-and-atomic-player-activation.md), [ADR-0020](0020-propose-a-native-android-tv-player.md)
