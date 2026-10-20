# Devices Module

This module owns screen (player) enrollment, pairing and lifecycle under [ADR-0027](../../../../../docs/adr/0027-propose-device-generated-credentials-and-code-based-enrollment.md) and the [device enrollment design](../../../../../docs/project/device-enrollment-design.md). Read both before changing behavior.

- The device credential is generated on the device and never reaches the server; only its SHA-256 is accepted, stored and compared. Pairing codes are stored only as HMACs under `TELUNI_DEVICE_CODE_KEYS`. Codes, credentials, hashes and client addresses never reach logs, audit details or error bodies.
- Device routes take their pre-authentication limits from `registerDeviceRequestLimits` (per presented credential, under a per-address ceiling); never key them by client address alone, because many screens share one.
- Every failed claim, whatever the reason (unknown, expired, already claimed, malformed), answers the same `PAIRING_CODE_INVALID` and counts toward the per-principal and per-company limits.
- Human operations resolve access through the organizations `CompanyAccessPort` and take its `lockForWrite` (company, membership and branches `FOR SHARE`) before locking enrollment or device rows; do not add another lock order. A device outside the caller's branches answers `RESOURCE_NOT_FOUND`.
- Device rows keep the composite `(company_id, id)` key and never change company; moving changes `branch_id` only. Unlinking is irreversible: the device becomes `REVOKED` with erasure `PENDING`, and only the device's confirmation or a person's reset record ends it.
- Each human change and erasure confirmation writes its `device_audit_events` row in the same transaction; details hold IDs and settings only. Other modules import only `public.ts` of identity and organizations.
