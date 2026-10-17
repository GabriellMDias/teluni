# ADR-0022: License Teluni under Apache-2.0

**Status:** accepted
**Date:** 2026-10-17

## Context

Teluni is derived from Orion, whose source already carries Apache-2.0 under ADR-0016. That foundation decision explicitly leaves independently developed product licensing to the product owner. Teluni's owner explicitly approved Apache License 2.0 for Teluni on 2026-10-17; this record documents that owner-authorized decision. The repository already contains the standard root license text, but its README and human actions previously said product licensing was undecided.

## Decision

License Teluni repository source and documentation, including independently developed product material, under the unmodified Apache License, Version 2.0. Retain the root `LICENSE` as the canonical terms and use SPDX identifier `Apache-2.0` in the root, API, web and SDK package metadata. Update README and project documentation to make the scope explicit.

Preserve Orion provenance and its applicable rights/notices. Do not relabel third-party dependencies or separately licensed material. Do not invent a named copyright holder or NOTICE without confirmed attribution. This decision concerns repository licensing; SaaS pricing, support and customer service terms remain separate product decisions.

## Rationale

The owner explicitly selected Apache-2.0 rather than delegating the legal choice to an agent. Applying the existing standard text consistently to Teluni resolves the previous distinction between inherited foundation licensing and undecided product licensing, without changing architecture or runtime behavior.

## Alternatives Considered

### Keep product licensing undecided

This was the documented state. It no longer reflects the owner's explicit instruction and leaves the intended licensing scope unclear.

## Consequences

### Positive

- Teluni's source/documentation license is explicit and consistent with the standard license file and package metadata.
- The product decision remains separate from the historical Orion ADR and commercial pricing decisions.

### Negative

- Distribution must preserve applicable license/attribution obligations; the choice does not determine third-party rights or authorize reuse of PDT Display material.
- Named attribution still needs confirmed ownership evidence if such notices are added.

### Operational or Migration Impact

No database migration, dependency upgrade, application feature or deployment change is required. Existing tags/history and the canonical license text remain unchanged. PH-06 records the owner's selection; PH-14 tracks conditional named-attribution work.

## References

- [Canonical license](../../LICENSE)
- [README licensing scope](../../README.md#license)
- [Orion license decision](0016-license-the-orion-foundation-under-apache-2-0.md)
- [Product human actions](../project/human-actions.md#ph-06)
