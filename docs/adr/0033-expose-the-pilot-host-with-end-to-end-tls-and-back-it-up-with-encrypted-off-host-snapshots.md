# ADR-0033: Expose the Pilot Host with End-to-End TLS and Back It Up with Encrypted Off-Host Snapshots

**Status:** accepted
**Date:** 2026-10-22

**Acceptance scope:** On 2026-10-22 the owner asked the agent to take every pending decision that is only a decision, which extends the delegation recorded with PH-25. The agent accepted this decision under that delegation together with the decisions of the [deployment design](../project/deployment-design.md); merging the pull request that adds it is the repository review. Acceptance establishes the direction for building and rehearsing the deployment in PJ-13. It does not verify the owner's host or network (PH-10), create any account, or authorize exposing a host.

## Context

ADR-0021 chose a single residential Debian host with Docker Compose, a reverse proxy with HTTPS and durable local media. It deliberately selected no tunnel, proxy, object store or provider, and it made real-customer use conditional on off-host recovery and owner-approved recovery targets. Residential lines in Brazil are often behind CGNAT or block inbound ports, and the owner has no recurring cloud budget.

Screens download video renditions, and people upload videos of up to 1 GiB in a single request. Sessions are server-managed cookies, and media are private to their company. Screens play for up to seven days without the server (AT-15), which bounds how long a recovery can take.

## Decision

TLS ends on the owner's host, in a Caddy reverse proxy that obtains Let's Encrypt certificates. The host is reached directly when the line has a usable public address. Otherwise it is reached through a TCP relay on a free-tier virtual machine that forwards encrypted traffic through a WireGuard tunnel opened by the host. No TLS-terminating tunnel, CDN or proxy service sits in front of Teluni.

Backups are restic snapshots, encrypted on the host, of the PostgreSQL dumps followed by hard links of the content-addressed media objects, taken under a lock that keeps object files from being deleted in between. They are written every 6 hours to an S3-compatible bucket at a separate provider, initially Backblaze B2, and kept for at most about 35 days. Secrets are excluded from snapshots and kept offline by the owner.

## Rationale

- Ending TLS on the host keeps session cookies, credentials and private media away from intermediaries. The relay is replaceable and holds nothing.
- A TLS-terminating free tunnel would solve CGNAT, but its terms restrict serving video outside paid products. Its reported upload cap is below the media limit, and it would see every session.
- Object files are written before the rows that record them and deleted only after those rows, under an advisory lock that the backup holds from before its dumps until it has hard-linked the objects. That makes "dumps first, then objects" a consistent set without stopping the service or making anyone wait on the upload. The restore check verifies it.
- Client-side encryption lets a free off-host bucket hold customer data as ciphertext only. Deduplication keeps 6-hourly snapshots within the free allowance at pilot scale.
- A 6-hour recovery point and a 72-hour worst-case recovery time keep screens playing through any recovery under AT-15.

Assumptions: provider allowances (Oracle Cloud's outbound transfer, Backblaze B2's free storage and downloads) are as reported in October 2026. They can change, so the destination and relay must stay replaceable. Whether the owner's line needs the relay is unknown until PH-10.

## Alternatives Considered

### A TLS-terminating tunnel (Cloudflare Tunnel or similar)

Free, and it avoids port forwarding, but it ends TLS at the provider. It conflicts with the CDN terms for video, and its reported 100 MB upload cap rejects valid uploads. Rejected for this service.

### Running everything on the free-tier virtual machine

Removes the residential risks at no cost. It would, however, put customer data under the provider's idle-reclamation and account terms with no paid support. It is kept only as a relay.

### Continuous WAL archiving

Reduces the recovery point to minutes, at the cost of a second backup and restore mechanism. Deferred until a customer needs a smaller recovery point.

## Consequences

### Positive

- No intermediary sees decrypted traffic or backups.
- No recurring cost at pilot scale, and every external piece (relay, bucket, mail relay) can be replaced without changing the application.
- Deleted data leaves backups within about 35 days, which the data handling policies can state.

### Negative

- The owner operates certificates, the relay and backup monitoring. A failed backup is only noticed through the alerts the deployment design requires.
- Losing the offline restic password loses every backup. Losing the secret key rings after a restore invalidates sessions and sealed mail credentials.
- Free tiers can change their terms. The design names fallbacks, but switching still takes work.

### Operational or Migration Impact

PJ-13 builds the Compose bundle, the backup, restore and verification scripts, and a rehearsal that CI runs. The real-host rehearsal and runbooks wait for PH-10. Moving to a paid VPS later keeps the same composition, with the relay removed.

## References

- [ADR-0021](0021-propose-a-single-host-pilot-with-portable-persistent-storage.md)
- [Deployment design](../project/deployment-design.md)
- [Deployment and migration planning](../project/operations.md)
- [Data retention](../security/data-retention.md)
- [Media library design](../project/media-library-design.md)
