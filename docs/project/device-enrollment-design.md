# Teluni Device Enrollment and Lifecycle Design

[Release policies](release-policies.md#offline-authorization-and-clock-trust) · [Security requirements](security-and-i18n.md#pairing-and-device-lifecycle) · [Identity and access policies](identity-and-access.md#permission-model-and-default-matrix) · [Tenant data design](tenant-data-design.md) · [Proposed ADR-0027](../adr/0027-propose-device-generated-credentials-and-code-based-enrollment.md) · [PH-22](human-actions.md#ph-22)

## Status and scope

**Proposed detailed design for the server side of D-03, 2026-10-19, for owner review under [PH-22](human-actions.md#ph-22).** Nothing here is implemented, and implementation of [PJ-08](implementation-plan.md#current-work) waits for the owner's decision on each item under [decisions for review](#decisions-for-review). ADR-0027 records the credential and enrollment mechanism as `proposed`.

In scope: the device identity and its company/branch assignment, temporary-code enrollment, the device credential and how the API authenticates it, reported capabilities and the configured rotation (FR-03), the server's offline authorization deadline (AT-15), renaming, moving between branches, unlinking, erasure confirmation and reassignment (FR-02, P24), permissions, abuse limits, audit, data, contracts, panel workflow and verification.

Out of scope, with their owners: the Android application and its secure local storage, clock estimation and enforcement of the deadline on the device (D-07, PJ-12); signed authorization envelopes, manifests and synchronization (D-04, PJ-11); content assignment to devices and groups (PJ-10); trial, license and quota admission for enrollment (PJ-27); qualifying any hardware or orientation profile (PH-08). The design leaves explicit hooks for each and claims none of them.

## Policy inputs

The design applies these selected policies without changing them:

- Pairing codes are temporary, single-use, bound to the requesting device, rate-limited and safe under concurrent claims; the claiming person must already be authorized for the destination company and branch; a displayed code is not an enduring credential ([security requirements](security-and-i18n.md#pairing-and-device-lifecycle), FR-02).
- Pairing, moving, unlinking and resetting devices is company-wide for administrators and limited to authorized source and destination branches for branch managers; operators need an additional grant ([permission matrix](identity-and-access.md#permission-model-and-default-matrix)). Administrator and branch-manager grants count only in strongly authenticated sessions (P12).
- Offline authorization expires no later than seven days after its last successful online renewal (AT-15, P22); commercial deadlines may shorten it (PJ-27).
- Unlink needs explicit authorized confirmation, server revocation and a distinct pending-erasure state; private content, configuration and credentials are cleared on reconnection; reassignment to another company requires verified cleanup or a controlled reset; revoked access, unreachable device and confirmed erasure stay distinct (P24).
- Player identities are separate from human identities and restricted to their own assignment, media and reports. Raw codes, credentials and credential-bearing links never reach logs, errors, screenshots or support bundles. No custom cryptography or token scheme.

## Mechanism overview

The flow follows the shape of the OAuth 2.0 Device Authorization Grant ([RFC 8628](https://www.rfc-editor.org/rfc/rfc8628)): a device without a keyboard shows a short code, and a person who is already signed in elsewhere enters it. Teluni does not route devices through Keycloak, because devices are not human principals and Keycloak holds only human identities (ADR-0024); the API module plays both the authorization-server and resource-server role for devices.

```text
Player                                API (devices module)                    Panel (signed-in person)
  │ generate 256-bit credential C            │                                      │
  │ POST /v1/device-enrollments              │                                      │
  │   { credentialHash: SHA-256(C), report } │                                      │
  │ ◀── { enrollmentId, userCode, expiresAt, pollInterval }                         │
  │ show userCode on screen                  │                                      │
  │                                          │ ◀── POST /v1/companies/{id}/devices  │
  │                                          │      { userCode, name, branch, rotation }
  │                                          │ claim: PENDING → CLAIMED, insert device
  │ POST /v1/device-enrollments/{id}/status  │                                      │
  │   Authorization: Bearer C                │                                      │
  │ ◀── { status: "paired", deviceId }       │                                      │
  │ GET /v1/device/self (Bearer C)  ────────▶│ configuration + authorizedUntil       │
```

The device generates its own credential and sends only its hash when enrollment starts. The credential itself never leaves the device until it is used, the server never returns a secret, and a lost response at any step is retried without issuing anything new. This is the central choice in [ADR-0027](../adr/0027-propose-device-generated-credentials-and-code-based-enrollment.md).

## Enrollment

**Start.** `POST /v1/device-enrollments` is anonymous. The body carries the credential hash (32 bytes, base64url) and the device report (see [capabilities](#capabilities-and-rotation)). The server creates a `PENDING` enrollment valid for 10 minutes and answers with the enrollment ID, the user code, the expiry and a 5-second polling interval. A hash that already belongs to a device or a pending enrollment is refused with `ENROLLMENT_REJECTED`, so one credential can never bind two identities.

**User code.** Eight characters from the 20-consonant alphabet `BCDFGHJKLMNPQRSTVWXZ`, shown as `XXXX-XXXX`, as RFC 8628 section 6.1 recommends: about 34.5 bits, no vowels (no accidental words) and no look-alike digits. Entry ignores case, spaces and hyphens. The server stores an HMAC-SHA-256 of the normalized code under a dedicated `RESTRICTED` key ring (key ID stored with the value, newest key first), never the code, so a database copy does not let anyone enumerate live codes offline. A unique index on the HMAC prevents two live enrollments from sharing a code; a collision on insert is retried with a new code.

**Claim.** In the panel, a person enters the code with a name, a destination branch and a rotation. In one transaction the server locks the company row (tenant data design rule 5), rebuilds the actor's access and requires `devices.manage` on the destination branch and an active company and branch, then moves the enrollment from `PENDING` to `CLAIMED` with a conditional update (`WHERE status = 'PENDING' AND expires_at > now()`), inserts the device with the enrollment's credential hash and report, and writes one `device.paired` audit event. Exactly one of two concurrent claims succeeds; the other, an expired code, a used code and an unknown code all answer the same `PAIRING_CODE_INVALID`, so the answer does not reveal which case applied. The rotation must be one the device reported as supported.

**Status.** The device polls `POST /v1/device-enrollments/{id}/status` with `Authorization: Bearer <credential>`; the server checks the credential against the enrollment's hash. Answers are `pending` (with the polling interval), `paired` (with the device ID) or `expired`. Polling faster than the interval answers `RATE_LIMITED` with the interval to use. Pending enrollments expire lazily: reads treat an expired row as expired and a purge deletes `PENDING` and `EXPIRED` rows one day after expiry, and `CLAIMED` rows 30 days after the claim.

**Commercial hook.** The claim transaction is where PJ-27 will add trial, license and quota admission. Until then only company and branch status gate enrollment.

## Device credential and authentication

- **Credential.** 32 bytes from the platform CSPRNG, generated and kept by the player in Android Keystore-backed storage (D-07, PJ-12). The server stores only its SHA-256 under a unique index; because the credential has 256 bits of entropy, an unkeyed hash is sufficient for lookup and gives nothing usable from a database copy. The credential is `RESTRICTED`: never in logs, telemetry, errors, audit, query strings or the panel.
- **Use.** Device operations declare a new operation access kind, `device`, and expect `Authorization: Bearer <credential>` on paths under `/v1/device/`. The devices module resolves the credential to the device on every request, with no cache, so revocation takes effect on the next request. Device routes never accept the human session cookie, and human routes never accept a device credential. The shared runtime gains only the access kind; the devices module owns the lookup.
- **States.** An `ACTIVE` device's credential reaches every device operation. A `REVOKED` device's credential reaches only `GET /v1/device/self`, which answers `{ status: "unlinked", clearRequired: true }`, and `POST /v1/device/self/erasure`, which confirms clearing. Any other credential answers `DEVICE_UNAUTHORIZED` with no detail.
- **Rotation.** `POST /v1/device/self/credential` replaces the hash with a new device-generated one. The previous hash stays valid until the new credential is first used, so a lost response leaves the device with a working credential. Rotation is in the last delivery increment; it is not required by the first player.

## Check-in and the offline authorization deadline

`GET /v1/device/self` returns the device's ID, name, branch name and time zone, rotation, status and `authorizedUntil`. For an active device, `authorizedUntil` is the database clock plus seven days (AT-15), later capped by a commercial deadline under PJ-27. `PUT /v1/device/self/report` updates the reported capabilities. Each successful device request updates `last_seen_at`, written at most once per minute per device so check-ins do not cause a write per request.

In this design `authorizedUntil` is a server statement in an authenticated HTTPS response. Making it tamper-evident on the device (a signed envelope) and enforcing it against a trusted local clock (AT-16) belong to D-04/PJ-11 and D-07/PJ-12. The panel shows "last seen" and, for unreachable devices, the latest deadline the device could hold, so operators never read server intent as device state.

## Capabilities and rotation

The device report is bounded, validated JSON: application version, protocol version, manufacturer and model (each at most 80 characters), Android version, display width and height in pixels (1 to 16384) and the supported rotations. It is stored as reported and labelled "reported by the device" in the panel; it is not a qualified hardware profile (PH-08), and nothing in this design claims support for a device because it reported a capability.

The configured orientation is a rotation of 0, 90, 180 or 270 degrees clockwise: 0 and 180 are horizontal, 90 and 270 vertical (FR-03). A rotation, rather than a horizontal/vertical flag, tells the player which way the screen is physically mounted. Setting a rotation the device did not report as supported answers `ROTATION_UNSUPPORTED`; the panel offers only reported rotations.

## Device lifecycle

```text
          claim                       unlink                       device confirms clearing
(none) ─────────▶ ACTIVE ───────────────────────────▶ REVOKED, erasure PENDING ───────────▶ REVOKED, erasure CONFIRMED
                  │  rename, set rotation, move           │ record controlled reset (person)
                  │  (same company only)                  └──────────────────────────────▶ REVOKED, erasure RESET_RECORDED
```

- **Rename and rotation.** Need `devices.manage` on the device's branch and the expected version.
- **Move.** Changes the branch within the same company. Needs `devices.manage` on both the source and the destination branch, an active destination branch and the expected version. Moving to another company is not an operation: it is an unlink followed by a new enrollment.
- **Unlink.** Needs `devices.manage` on the device's branch, the expected version and an explicit confirmation in the panel that names the device. It sets `REVOKED` with erasure `PENDING` in one transaction; from then on the credential reaches only the two operations above. It cannot be undone; the device is paired again with a new enrollment.
- **Erasure confirmation.** When an unlinked device reconnects, it learns `clearRequired`, deletes private content, configuration and its credential locally (PJ-12), and only then calls `POST /v1/device/self/erasure` with the credential it is about to discard. The server records `CONFIRMED`, deletes the credential hash and writes `device.erasure_confirmed`. If the response is lost, the device has already cleared and the record stays `PENDING`, shown honestly as unconfirmed, which is the safe direction.
- **Controlled reset.** A device that will never reconnect (factory reset, broken, lost) stays `PENDING`. A person with `devices.manage` can record that the device was reset locally; the record says `RESET_RECORDED` with the actor, not `CONFIRMED`, and audit keeps the difference.
- **Reassignment.** The server cannot recognize a physical device across identities, so verified cleanup is enforced where it can be: the player starts a new enrollment only from a state with no credential and no private content, and when it still holds a credential it first completes the erasure confirmation above. A new enrollment always creates a new device identity; the old record keeps its own history. The panel lists unlinked devices with their erasure state until the purge below.

Archived branches keep their devices; archiving a branch that still has active devices answers `BRANCH_HAS_DEVICES` once the organizations module consults the devices module's public port, so a device is never left in a branch nobody can manage.

## Permissions

Two capabilities are added to the organizations domain, which owns role presets:

| Capability | Company administrator | Branch manager | Operator |
| --- | --- | --- | --- |
| `devices.view`: list devices, see details and state | Company | Granted branches | Granted branches |
| `devices.manage`: pair, rename, set rotation, move, unlink, record reset | Company | Granted branches (source and destination for a move) | No (needs an additional grant; custom profiles are PJ-24) |

Hidden devices answer `RESOURCE_NOT_FOUND`. Every operation resolves access on the request through the organizations public port and never takes company, branch or role from the request body as authority.

## Abuse limits

Proposed initial values:

- Enrollment start: the existing per-route rate limit plus at most 20 starts per client address per hour, and at most 10,000 pending enrollments platform-wide, after which starts answer `RATE_LIMITED`. A full pending table makes a guessed code at most 10,000 in 2.56 × 10¹⁰ likely to match.
- Claim: at most 10 failed claims per person per 15 minutes and 30 per company per 15 minutes, counted in PostgreSQL from failed-claim rows that record only the actor, company and time. Exceeding a limit answers `RATE_LIMITED` without saying which applied. With these limits an attacker with one account needs on the order of years of attempts per expected match against a full pending table. Many accounts or companies created for guessing remain a residual risk that the signup abuse controls (PH-13) must bound; a successful guess pairs a stranger's screen to the attacker's company, which its owner notices because pairing fails on their side, and no tenant data is exposed.
- Status polling: once per polling interval per enrollment.

These limits stand on their own; commercial device quotas are PJ-27.

## Data

All tables belong to the devices module, with Prisma models in `prisma/schema/devices.prisma`, semantic metadata, runtime grants and one reviewed migration.

| Table | Contents | Notes |
| --- | --- | --- |
| `device_enrollments` | ID, credential hash (unique), user-code HMAC and key ID (unique), report, status `PENDING`/`CLAIMED`/`EXPIRED`, created/expires/claimed times, claimed `company_id` and `device_id` | Platform-scoped until claimed, like an unaccepted invitation credential; no company access before the claim |
| `devices` | `(company_id, id)`, composite `(company_id, branch_id)` reference to branches, name (1 to 80 characters), rotation, status `ACTIVE`/`REVOKED`, erasure `NONE`/`PENDING`/`CONFIRMED`/`RESET_RECORDED`, credential hash (unique, nullable after erasure), pending rotated hash, report, last seen, paired-by membership, paired/revoked/erased times, version | Composite tenant references; runtime role never updates `company_id` |
| `device_claim_failures` | Actor principal, company, time | Counts only; deleted after one day |
| `device_audit_events` | Same shape as organization audit: company, actor, action, target device, allowlisted details | Append-only; `device.paired`, `device.renamed`, `device.rotation_changed`, `device.moved`, `device.unlinked`, `device.erasure_confirmed`, `device.reset_recorded`. Details never contain codes, hashes or network addresses |

Device reports and last-seen times are `CONFIDENTIAL`. Client network addresses are used only in memory for rate limiting and are not stored.

## Contracts

Human operations (session access, CSRF as elsewhere): `GET /v1/companies/{companyId}/devices` (paginated, cursor-bound, filter by branch and status), `GET .../devices/{deviceId}`, `POST .../devices` (claim), `PATCH .../devices/{deviceId}` (name, rotation, expected version), `POST .../devices/{deviceId}/move`, `POST .../devices/{deviceId}/unlink`, `POST .../devices/{deviceId}/reset-record`. Device operations: the enrollment start and status, `GET /v1/device/self`, `PUT /v1/device/self/report`, `POST /v1/device/self/erasure` and, later, `POST /v1/device/self/credential`. All are TypeBox contracts in the OpenAPI document; the web uses the generated SDK. New expected errors: `PAIRING_CODE_INVALID`, `ENROLLMENT_REJECTED`, `ROTATION_UNSUPPORTED`, `DEVICE_UNAUTHORIZED`, `BRANCH_HAS_DEVICES`, plus the existing `RESOURCE_NOT_FOUND`, `VERSION_CONFLICT`, `RATE_LIMITED` and strong-authentication errors.

## Panel

A **Screens** view per company (pt-BR "Telas") lists devices with name, branch, status, rotation, last seen and erasure state, filtered to what the person may view. **Pair a screen** asks for the code shown on the TV, a name, a branch the person may manage and a rotation, and shows the reported model and resolution after a successful claim. The device page renames, changes rotation, moves (destinations limited to manageable branches), unlinks with a confirmation naming the device, and records a reset for a pending erasure. Conflicts and unknown outcomes reload and explain, as other company pages do. Copy is in `pt-BR` and `en-US`.

## Verification

- Domain unit tests: code generation and normalization, rotation and report validation, lifecycle transitions and permission decisions.
- Integration tests against PostgreSQL, with two companies and differently scoped branch managers: claim allowed and denied by scope, destination branch outside scope, resource-ID substitution across companies, expired, replayed and unknown codes answering the same error, two concurrent claims of one code with exactly one success, credential reuse refused, rate limits, revoked credentials limited to the two operations, erasure confirmation idempotence, move scope on both branches, version conflicts, audit rows and the structural composite-key suite.
- Contract tests for every expected error and the device access kind; no route accepts the wrong credential type.
- Browser component tests for the pairing form, the list and the unlink confirmation, and one end-to-end journey that simulates the player over HTTP: start enrollment, pair in the panel, check in, unlink and confirm erasure.

Physical qualification of the Android flow, key storage and clock behavior remains PJ-12, PH-08 and PJ-14.

## Delivery increments

1. Module, schema, migration, enrollment start/status, claim, device list and detail, check-in and report, permissions, audit, panel list and pairing.
2. Rename, rotation, move, unlink, erasure confirmation, reset record, branch-archive guard and their panel workflow.
3. Credential rotation, enrollment purge and the end-to-end journey hardening.

## Decisions for review

The owner is asked to approve, reject or adjust each item under [PH-22](human-actions.md#ph-22):

1. **Enrollment mechanism (ADR-0027).** RFC 8628-style flow owned by the API: the device shows a short code and polls; a signed-in person claims the code in the panel. Devices do not use Keycloak.
2. **Device-generated credential.** The player generates a 256-bit credential and sends only its SHA-256 at enrollment; the server stores only the hash, never issues a secret and accepts it as a bearer token on device routes only, checked on every request.
3. **User code.** Eight characters from 20 consonants (`XXXX-XXXX`), valid 10 minutes, single use, stored as a keyed HMAC under a new `RESTRICTED` key ring; every failure answers the same error.
4. **Abuse limits.** 20 enrollment starts per address per hour, 10,000 pending platform-wide, 10 failed claims per person and 30 per company per 15 minutes, polling once per interval.
5. **Offline deadline.** Check-in reports `authorizedUntil` as server time plus seven days (AT-15); signing and device-side enforcement are left to PJ-11/PJ-12, and commercial capping to PJ-27.
6. **Rotation and capabilities.** Rotation of 0, 90, 180 or 270 degrees limited to what the device reports; reports are stored as device statements, not qualified support.
7. **Unlink and reassignment.** Unlink is immediate, irreversible revocation with erasure `PENDING`; the revoked credential can only learn it must clear and confirm clearing; a person may record a controlled reset, shown distinctly from confirmation; another company always pairs a new identity, and the player enrolls only from a cleared state.
8. **Permissions.** `devices.view` for all roles in their scope; `devices.manage` for administrators company-wide and branch managers on their branches (both branches for a move); operators need a future additional grant.
9. **Retention (provisional until PH-13).** Unclaimed enrollments deleted one day after expiry, claimed enrollments 30 days after the claim, failed-claim counters after one day; device records and audit are kept with the company; network addresses are never stored.

Approval authorizes implementation of PJ-08 in local and CI environments with simulated players. It does not select hardware (PH-08), implement the Android player (PJ-12) or qualify any physical behavior.

## Alternatives considered

- **Server-issued credential returned once on pairing.** Simpler for the device, but the only copy travels in a response that can be lost, which forces either a re-issue path (more secret-bearing responses) or a stuck device. Rejected in favor of the device-generated credential.
- **Device key pair with signed requests (for example DPoP, RFC 9449, or mutual TLS).** Stronger against a copied credential because the private key can stay in Android Keystore hardware, but it adds JWT/proof verification or certificate infrastructure on a single-host pilot with no measured threat requiring it. ADR-0027 keeps the bearer credential behind the `device` access kind so a proof-of-possession scheme can replace it later without changing the enrollment flow.
- **Keycloak device grant and service accounts.** Reuses an established implementation, but makes every screen a Keycloak client or user, couples player availability to Keycloak and mixes device and human identities, which the policies keep separate.
- **Numeric six-digit codes.** Easier to type on a remote but only about 20 bits; with the same limits an attacker would match a pending code orders of magnitude sooner.
- **QR code with a link.** Convenient on phones but puts a credential-bearing link on screen and in browser history; it can be added later as another way to enter the same short code.
