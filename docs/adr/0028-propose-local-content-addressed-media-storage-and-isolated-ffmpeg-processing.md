# ADR-0028: Adopt Local Content-Addressed Media Storage and Isolated FFmpeg Processing

**Status:** proposed
**Date:** 2026-10-19

## Context

Teluni stores private customer images and videos, validates them against the selected ingestion bounds and turns them into renditions that Android TV screens can play offline (FR-04, AT-02, AT-03). The pilot runs on one residential host with durable mounted storage and no cloud budget, and media storage must stay a media-owned capability with replaceable filesystem I/O ([ADR-0021](0021-propose-a-single-host-pilot-with-portable-persistent-storage.md)). Security requirements ask for trustworthy inspection, parser isolation and no unvalidated transcoding framework ([security requirements](../project/security-and-i18n.md#media-and-audit-protections)); the release policies require preserved originals, compatible renditions, reference-safe deletion and a recoverable trash.

This record decides where media bytes live, how they are named and published, and which tool parses and converts untrusted files, and how it is isolated. The detailed rules, profiles, limits, data and contracts are in the [media library design](../project/media-library-design.md).

## Decision

Teluni will store media as immutable content-addressed objects on a local volume and process it only with FFmpeg in isolated child processes:

- The media module owns an object interface (`put`, `open` with an optional byte range, `delete`, `list`) implemented over a configured directory on durable storage. Each object is named by the SHA-256 of its bytes inside its company and is never modified; identical bytes are stored once per company and never shared across companies.
- Objects are written to a work directory on the same filesystem, flushed, and published by an atomic rename while a PostgreSQL row lock on the object is held, before the referencing asset commits. PostgreSQL is the authority for which objects exist and who may read them; paths never leave the module.
- Untrusted files are parsed and converted only by the FFmpeg executables (`ffprobe`, `ffmpeg`, version 6.1 or later), run without a shell, with a scrubbed environment, a forced demuxer, the file protocol only, bounded output and timeouts, and resource limits where the host offers them. No media parser or image library runs inside the API process.
- Work is queued in PostgreSQL and claimed by an in-process processor with leases, so several API processes can share it and interrupted work resumes.

## Rationale

Content addressing makes objects immutable, integrity checkable and deduplicated, which publications (ADR-0019) need for manifests and the player's shared-file accounting (AT-05). Publishing by rename under a row lock gives a simple crash rule: a file may exist without a reference and is swept, but a reference never exists without its file. Per-company naming keeps tenants independent at the cost of storing a file twice when two companies upload it.

FFmpeg is the established tool for both inspection and conversion of every format the release needs, including EXIF orientation and metadata removal for images, so one external tool covers both kinds instead of FFmpeg plus an in-process image library. Running it as a separate executable keeps memory-safety defects in parsers out of the API process and lets timeouts and limits kill a hostile file. It also keeps Teluni's Apache-2.0 code separate from FFmpeg's GPL build. The trade-off is CPU-heavy work on the API host and a binary dependency that every environment must provide.

## Alternatives Considered

### S3-compatible object storage now

A MinIO or cloud bucket would separate storage from the API host and scale later, but it adds a service to run on the single-host pilot or a paid dependency. The object interface keeps this as a later implementation without changing object identity.

### Media in PostgreSQL

Large objects or `bytea` would make storage transactional, but they inflate database backups and I/O with gigabytes of video and complicate streaming and range reads.

### libvips (`sharp`) for images and FFmpeg for video

Faster image handling, but it parses untrusted images inside the API process and adds a second native toolchain to qualify and isolate.

### A separate processing service with a broker

Stronger isolation and independent scaling, but it adds deployment and failure modes that the pilot does not yet need. A separate, network-less processing container running the same commands is the deployment-level hardening step, without changing this decision.

## Consequences

### Positive

- Immutable, verifiable objects that publications and players can reference by hash.
- Crash-safe publication and reference-safe purge with a single lock order.
- Hostile files cannot run code in, or exhaust, the API process.

### Negative

- Conversion competes with the API for CPU on the pilot host; concurrency is limited to one job by default and long videos take minutes.
- Every environment (development, CI, production image) must provide a compatible FFmpeg build, and its security updates become an operational duty.
- Storage is tied to one host until another object store implementation exists; backups must cover the media volume together with PostgreSQL.

### Operational or Migration Impact

- Backups and restore must copy the media volume and the database consistently; restored objects are verified against their hashes, and a sweep removes files without rows.
- Moving to another object store copies objects by hash and switches the implementation; asset and object identities stay the same.
- The production image must ship FFmpeg with its license notices (PJ-13).

## References

- [Media library design](../project/media-library-design.md)
- [Release policies: media and deletion lifecycle](../project/release-policies.md#media-and-deletion-lifecycle)
- [Acceptance targets](../project/release-targets.md#media-and-rendering-targets)
- [Operations: persistent state and storage portability](../project/operations.md#persistent-state-and-storage-portability)
- [ADR-0019](0019-propose-immutable-publications-and-atomic-player-activation.md), [ADR-0021](0021-propose-a-single-host-pilot-with-portable-persistent-storage.md)
