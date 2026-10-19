# ADR-0030: Synchronize Screens by Polling with Signed Authorization Statements

**Status:** proposed
**Date:** 2026-10-19

## Context

ADR-0019 adopted immutable publications and atomic player activation but selected no transport, manifest serialization, integrity metadata or cryptographic mechanism. The policies require that a screen detect a new desired publication within 30 seconds (AT-11), report its state every 30 seconds (AT-24), never be rolled back by stale or reordered messages, keep playing valid content offline for at most seven days after its last renewal (AT-15) and suspend time-dependent output when its clock cannot be trusted (AT-16). Screens authenticate with a device-generated bearer credential under ADR-0027, and the device enrollment design left a tamper-evident form of the offline deadline to this decision. The pilot runs one API process on one host (ADR-0021).

This record decides how screens learn their desired publication, how they obtain and verify its manifest and media, and how the server states, verifiably, what a screen may play and until when. The details are in the [publication and synchronization design](../project/publication-sync-design.md).

## Decision

- Screens **poll**. Every 30 seconds a screen calls `POST /device/sync` with its state report and receives its status, time zone, desired publication and a new authorization statement. The server computes the desired publication from current rows at each call; it keeps no push channel and no per-screen delivery queue.
- A publication's **manifest** is UTF-8 JSON produced in a fixed key order, stored as exact bytes and identified by their SHA-256. Media are delivered as display renditions identified by SHA-256. Manifests and media are downloadable only for the screen's current desired publication; superseded work coalesces by synchronizing again.
- Each sync response carries an **authorization statement**: a compact JWS signed with ECDSA P-256 and SHA-256 (`ES256`) by the first key of a configured key ring. It names the screen and company, the server time of issue, an expiry seven days later and the publications (ID and manifest SHA-256) the screen may activate or keep active until then. The key set's public halves are served to screens, which pin them after pairing.
- Manifests and exchanges carry a **protocol** number; the server answers with the highest protocol both sides support and serializes publications in the current and previous protocol for at least 90 days after a new one (AT-26).

## Rationale

Polling at 30 seconds meets AT-11 and doubles as the AT-24 heartbeat with one request per screen, uses only the HTTPS path the device credential already protects, and survives proxies, restarts and the single-host deployment without connection state. Deriving desired state from authoritative rows makes ordering a property of the database rather than of message delivery, so no acknowledgement or crash can roll a screen back or lose an assignment. Exact stored bytes give the manifest an identity that a statement can sign; a structure regenerated or normalized on each request could not. A per-screen statement binds entitlement, expiry and a signed server time in one object the player can check offline and store next to its active generation, which makes the seven-day deadline and the choice of content tamper-evident on the device and gives the trusted clock a server reference. ECDSA P-256 is implemented by Node.js and by Android's standard security providers, so neither side needs a new cryptographic dependency.

## Alternatives Considered

### Push through WebSocket, server-sent events or a broker

Detection within seconds, but AT-11 allows 30, and a persistent channel adds connection management, proxy configuration and reconnection on the pilot host. A push hint can be added later without changing the state model.

### Fan-out of desired state into per-screen rows

Simple reads, but a crash between a publication and its fan-out needs a durable queue, and fan-out races with concurrent assignments. Computing from authoritative rows is always consistent and costs one indexed query per poll.

### TLS only, without signed statements

TLS authenticates the server during transfer but leaves the stored deadline and content choice as plain local files. It also gives the player no signed time reference.

### Signing manifests at publication

Authenticates content once, but not which screen may play it or until when; a statement per screen covers both.

### Ed25519 or a shared HMAC key

Ed25519 is compact but not provided by older Android versions without an added library; an HMAC would require a secret on every screen, so any one screen could forge statements.

## Consequences

### Positive

- Screens converge on the latest authorized publication within one polling interval, with no message ordering assumptions.
- The player can verify offline which content it may show and until when, and anchor its clock to a signed server time.
- No new infrastructure or cryptographic dependency on either side.

### Negative

- Every screen makes a request every 30 seconds whether or not anything changed; the reference load of 100 screens is about 3.3 requests per second.
- The signing key ring is a new production secret with rotation duties.
- Detection is bounded by the polling interval, not immediate.

### Operational or Migration Impact

- `TELUNI_SYNC_SIGNING_KEYS` must be provisioned and backed up with the other secrets (PJ-13). Rotation adds a key at the front and keeps the previous one for at least seven days.
- Restoring a database backup restores publications and desired state together; screens reconcile at their next poll. Pointing screens at a different host needs the same signing keys or a published key transition.
- A future protocol needs dual serialization for the support window.

## References

- [Publication and synchronization design](../project/publication-sync-design.md)
- [Offline playback and synchronization](../project/playback-and-sync.md)
- [ADR-0019](0019-propose-immutable-publications-and-atomic-player-activation.md), [ADR-0021](0021-propose-a-single-host-pilot-with-portable-persistent-storage.md), [ADR-0027](0027-propose-device-generated-credentials-and-code-based-enrollment.md)
- [Delivery and side effects](../architecture/delivery-and-side-effects.md)
