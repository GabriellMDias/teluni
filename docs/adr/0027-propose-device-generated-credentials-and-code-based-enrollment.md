# ADR-0027: Adopt Device-Generated Credentials and Code-Based Enrollment

**Status:** accepted
**Date:** 2026-10-19

**Acceptance scope:** The owner explicitly approved this decision and the nine decisions of the device enrollment and lifecycle design on 2026-10-19 under PH-22. Acceptance establishes the direction for local and CI implementation of PJ-08 with simulated players, not Android player delivery (PJ-12), hardware qualification (PH-08) or production readiness.

## Context

Teluni screens are Android TV players without a keyboard that must be paired to one company and branch by a person who is already signed in to the panel (FR-02). Policies require temporary, single-use, rate-limited codes that are safe under concurrent claims, a separate revocable identity per device that is never a human principal, revocation that denies future server access, and no custom cryptography or token schemes ([security requirements](../project/security-and-i18n.md#pairing-and-device-lifecycle), [release policies](../project/release-policies.md#offline-authorization-and-clock-trust)). Keycloak holds only human identities ([ADR-0024](0024-propose-keycloak-and-server-managed-human-sessions.md)), and the pilot runs on a single host ([ADR-0021](0021-propose-a-single-host-pilot-with-portable-persistent-storage.md)).

This record decides how a device is enrolled and how it authenticates afterward. The detailed rules, limits, data and contracts are in the [device enrollment and lifecycle design](../project/device-enrollment-design.md).

## Decision

Teluni will enroll devices with an application-owned flow shaped like the OAuth 2.0 Device Authorization Grant (RFC 8628) and authenticate them with a device-generated bearer credential:

- The player generates a 256-bit credential from the platform CSPRNG, keeps it in Android Keystore-backed storage and sends only its SHA-256 when it starts an enrollment. The API answers with a short user code to display and an enrollment ID to poll.
- A signed-in, authorized person enters the user code in the panel; one conditional transaction claims the enrollment and creates the device in the chosen company and branch.
- The device then presents the credential as a bearer token on device routes only. The API stores only the hash, resolves it on every request without caching, and revokes it by state change. Human routes never accept it and device routes never accept a human session.
- User codes are short-lived, single-use, stored only as a keyed HMAC and protected by attempt limits.

The API's devices module owns the flow; the shared runtime gains only a `device` operation access kind. No identity provider, certificate authority or proof-of-possession library is introduced now.

## Rationale

RFC 8628 is the established pattern for input-constrained devices, so the user-facing shape and its code guidance (alphabet, length, expiry, rate limits) come from a reviewed standard rather than invention. Generating the credential on the device means no secret is ever returned by the server, so a lost response at any step is retried without issuing anything and without a re-issue path. A 256-bit random value needs only a plain hash for storage and lookup. A bearer credential over HTTPS fits the single-host pilot and the existing Fastify/PostgreSQL stack.

The accepted cost is that a copied credential is usable until revoked, unlike a key that never leaves hardware. Revocation on the next request, rotation and the `device` access kind as a single seam keep a later move to proof of possession contained.

## Alternatives Considered

### Server-issued credential returned at pairing

Returning the only copy of a secret in one response makes a lost response either a stuck device or a reason to add a re-issue path with more secret-bearing responses.

### Device key pair with signed requests or mutual TLS

DPoP (RFC 9449) or client certificates would keep the private key in hardware and resist copying. They add proof verification or certificate issuance and renewal without a measured threat that requires them in the pilot. They remain the preferred upgrade if PH-08 devices offer usable hardware-backed keys and the threat model calls for it.

### Keycloak device grant and service accounts

It reuses an established server, but makes each screen a Keycloak client or user, couples player operation to Keycloak availability and mixes device and human identities that the policies keep apart.

## Consequences

### Positive

- No secret leaves the server, and every enrollment step is safely retryable.
- Revocation is immediate for reachable devices and needs no token lists or expiry windows.
- Device and human authentication stay separate at the operation level.

### Negative

- A credential copied from a compromised or rooted device works until revoked; physical control of a player remains a residual risk, as the security requirements already state.
- Teluni owns the enrollment endpoints, limits and their tests instead of relying on an identity provider.
- A new `RESTRICTED` key ring for user-code HMACs must be configured and rotated.

### Operational or Migration Impact

- Host migration and restore must preserve credential hashes so devices keep working, without ever exporting the credentials themselves.
- Moving to proof of possession later requires a player update and an overlap period in which both schemes are accepted for already-paired devices.

## References

- [Device enrollment and lifecycle design](../project/device-enrollment-design.md)
- [Security requirements: pairing and device lifecycle](../project/security-and-i18n.md#pairing-and-device-lifecycle)
- [Release policies: offline authorization](../project/release-policies.md#offline-authorization-and-clock-trust)
- [ADR-0020](0020-propose-a-native-android-tv-player.md), [ADR-0021](0021-propose-a-single-host-pilot-with-portable-persistent-storage.md), [ADR-0024](0024-propose-keycloak-and-server-managed-human-sessions.md)
