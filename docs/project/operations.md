# Teluni Deployment and Migration Planning

[Project documentation](README.md) · [Risks](risks.md) · [ADR-0021 decision](../adr/0021-propose-a-single-host-pilot-with-portable-persistent-storage.md)

## Constraints and current state

**Decided constraint:** no present cloud-service budget. The owner intends to use a personal residential server for development, tests and potentially initial customers, moving to a VPS/cloud when revenue or operational need justifies it. **Accepted initial architecture under ADR-0021:** Debian Linux, Docker Compose, a reverse proxy with HTTPS, local persistent media, automated backups and suitable monitoring. Real-customer use remains subject to PH-10 readiness gates. None is a deployed Teluni environment or executable procedure in this repository.

Follow inherited [production access](../security/production-access.md), [secrets management](../security/secrets-management.md), [retention](../security/data-retention.md), [observability](../reliability/observability.md), [alerting](../reliability/alerting.md), and [runbook authoring](../runbooks/authoring.md). This plan does not grant production authority. Write tested deployment/recovery runbooks when the environment exists, rather than speculative commands now.

## Accepted initial topology and unverified readiness

| Concern | Candidate responsibility | Validation required |
| --- | --- | --- |
| HTTPS ingress | Reverse proxy serves panel and routes API/private media access | Certificate issuance/renewal, domain ownership, proxy trust and origin/access policy |
| Backend and web artifacts | Existing application builds in a simple single-host composition | Image/build/update procedure, readiness, startup ordering, restart and migration handling |
| PostgreSQL | Persistent database on an internal container network with restricted runtime identity | No public listener; privileged migration credentials kept out of normal runtime; restore validation |
| Human identity and browser sessions | Accepted self-hosted Keycloak and backend session direction | PH-10/PH-15 capacity and restricted management; reviewed/pinned provider, persistent identity/session state, revocation-safe recovery; not deployed |
| Identity email and Google login | Verified sender and owner-controlled Google OAuth registration | PH-16/PH-17; safe configuration/callbacks, reliable delivery, protected secrets and independent recovery; no recurring procurement authorized |
| Local media | Durable mounted storage outside disposable containers | Capacity, permissions, atomic/durable object lifecycle, reference reconciliation and private delivery |
| Operations | Backups, redacted logs/metrics and disk/process/certificate checks | Independent backup destination, bounded retention and useful failure notifications |

Do not add queues, multiple backend services, a managed object store, CDN, Kubernetes, or vendor-specific services without measured need. Single-host failure remains a deliberate pilot risk, not solved by container restart policy.

## Residential exposure and readiness gate

[PH-10](human-actions.md#ph-10) requires an actual host/network inventory: CPU/RAM/disk and growth, upload bandwidth, data caps, power/reboot recovery, router/firewall, public address or CGNAT, ISP restrictions, available domain, certificate renewal, secure remote administration and backup connectivity. Keep private addresses, credentials and sensitive topology out of tracked public documentation.

A tunnel, free DNS option or any video-delivery intermediary requires evaluation of current terms, limits, privacy, security, transfer cost and failure behavior before selection. Do not assume Cloudflare Tunnel, DNS, or video distribution automatically provides an acceptable production path. No such provider is selected here.

Before any real pilot, record and demonstrate:

- HTTPS works end to end; only intentional public application endpoints are exposed. PostgreSQL, orchestration dashboards and administrative interfaces remain private/restricted. Remote administration does not imply an unrestricted remote-control product feature.
- Development/test and customer data, identities, credentials and backups are separated; logs/diagnostics are redacted; real data does not enter development fixtures.
- Durable database and media survive container recreation, controlled app updates and host reboot. Schema migrations use reviewed release procedures and an explicit recovery plan.
- Offline playback has been tested independently from backend availability. A home outage still prevents new uploads, publication, pairing, current monitoring and some recovery; communicate these limits to pilot participants.
- The owner agrees measurable availability, maintenance, incident contact, backup RPO/RTO and support expectations. No commercial SLA is implied by the architecture.

Until verified, external exposure and real-customer operation are **pending**, even if development works locally.

## Persistent state and storage portability

Keep environment-specific URLs, credentials and paths in validated environment configuration; use only implemented keys from the [configuration reference](../generated/configuration/api.md) today. Define and document new keys with their future canonical schemas when implemented. Do not embed the residential hostname/path in business entities, contracts or player binaries.

**Accepted storage boundary:** the media capability owns object identity, integrity, metadata, authorized reads and lifecycle. Isolate the actual filesystem I/O behind a cohesive media-owned storage responsibility so a future S3-compatible implementation can preserve object semantics without rewriting domain rules. Avoid a general provider framework or mandatory S3 dependency now. Object-store replacement still needs verified access, integrity, migration and concurrency semantics; portability is not a free automatic migration.

Use durable logical object identifiers rather than storing temporary download credentials as business identity. External media endpoints are configurable. Authorized delivery may use an API or another reviewed access mechanism; public filesystem paths and unbounded permanent bearer URLs are not the default.

## Backup and restore requirements

Backups must cover PostgreSQL, media, future provider identity state and the non-secret configuration/release metadata needed to reconstruct operation. Review future session persistence separately: restoring old sessions must never resurrect revoked access; session invalidation/reauthentication may be necessary. Provider signing material and authentication recovery require a protected, separately controlled recovery path, not plaintext configuration exports. Protect and recover secrets through a separate controlled process. A database-only backup is insufficient if it points to unavailable media.

Choose a consistency method for the database-plus-files set, backup schedule, off-host destination, encryption/key recovery, retention, capacity and success/failure reporting. A second directory on the same disk does not cover loss of the host. Local budget constraints do not eliminate the need to resolve off-host recovery before accepting private customer data.

Rehearse restore into an isolated environment: verify migration/application compatibility, ownership/permissions, manifest-to-file integrity, representative playback and tenant access, then reconcile revoked identities and deletion/retention obligations. Record achieved recovery point/time and compare them with owner-approved RPO/RTO. Preserve audit/release history; do not restore stale authorization silently.

## Future host or storage migration

**Proposed sequence**, to turn into tested runbooks once topology and credentials exist:

1. Inventory supported player versions, configurable API/media addresses, tenant data, assets, release versions and secret destinations. Prepare DNS/certificate ownership and compatible software at the destination.
2. Rehearse backup restore and file verification without customer writes. Determine whether logical object IDs remain stable and how private media authorization is preserved.
3. Plan a bounded write cutover or verified incremental reconciliation to avoid divergent metadata and media. Preserve audit and device identities without exposing their credentials.
4. Update endpoints through the approved mechanism with certificate validation and rollback capability. Keep the old address/redirect or compatibility path only for an explicitly defined overlap, accounting for long-offline players. Never accept arbitrary redirected credential recipients.
5. Verify representative players reconnect, reconcile desired/active versions, and continue offline playback. Check uploads, access denial, publication, backups and monitoring on the new host.
6. Close the rollback window deliberately, reconcile retained data/deletions and retire old storage/credentials safely. The endpoint overlap and maximum supported offline interval must be compatible; unresolved unreachable devices require a support plan.

Triggers for migration include measured cost/availability/support risk, storage or uplink saturation, growth, or earned revenue supporting operations. Cloud procurement and live migration are outside this documentation task.
