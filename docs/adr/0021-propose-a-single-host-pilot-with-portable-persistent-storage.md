# ADR-0021: Propose a Single-Host Pilot with Portable Persistent Storage

**Status:** proposed
**Date:** 2026-10-17

## Context

The owner currently has no cloud-service budget and intends to evaluate a personal residential server for development and first pilots. Network exposure, CGNAT, domain, hardware capacity, backup destination and acceptable downtime have not been verified. Orion does not select a production deployment platform.

## Decision

Propose an initial Debian host with Docker Compose, HTTPS reverse-proxy ingress, private PostgreSQL and media on durable mounted storage outside disposable containers. Keep environment-specific endpoints/configuration out of domain identity. Media storage remains a cohesive capability with replaceable filesystem I/O, allowing a later S3-compatible implementation when justified.

Real-customer exposure is conditional on network/security review, owner-approved availability and recovery targets, off-host backup/restore proof and tested player behavior during outages. No tunnel, DNS, proxy, object-storage or cloud provider is selected or presumed to satisfy these gates.

## Rationale

One host and local media fit the stated budget and avoid premature distributed operations. Stable logical asset identity, explicit configuration and tested recovery make a host/storage move tractable. They do not remove single-host failure or bandwidth constraints, nor make a future migration automatic.

## Alternatives Considered

- **Immediate paid VPS/cloud:** potentially changes power/network risk, but needs an actual affordable operating budget. Revisit with revenue or a demonstrated operational requirement.
- **Distributed services or orchestration first:** adds deployment and failure-management costs without measured need at the initial pilot scope.

## Consequences

### Positive

- Keeps the first operating model understandable and limits mandatory paid infrastructure.
- Establishes persistent state and endpoint portability as design obligations before deployment.

### Negative

- Residential availability, uplink and physical security remain material risks; no production SLA follows from Compose.
- Database-plus-media consistency, off-host recovery, secure exposure and maintenance remain owner/operator responsibilities.

### Operational or Migration Impact

Acceptance requires the host/network inventory, endpoint migration strategy and timed recovery rehearsal. Implementation must later supply tested deployment/recovery runbooks and release procedures. No container manifest or production change is introduced here.

## References

- [Deployment and migration planning](../project/operations.md)
- [Production access](../security/production-access.md)
- [Configuration](../architecture/configuration.md)
- [Data retention and recovery](../security/data-retention.md)
