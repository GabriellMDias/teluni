# ADR-0018: Isolate Internal Documentation from Product Distribution

**Status:** accepted

**Date:** 2026-10-23

## Context

The owner requires a complete engineering knowledge system for developers and AI agents while separating it from product UI and public documentation. The existing portal uses the React/Vite application, deterministic generated references, a lazy UI import, local search, and synthetic previews. Lazy loading still emits its entire internal catalog and downloads into production artifacts. Removing navigation or adding a browser route guard would leave those files downloadable.

ADR-0008 already selects Vite and code splitting. Development-only identity behavior already uses build-time exclusion. ADR-0017 retains the portal and its sources in projects and makes composition and brand assets project-owned; it does not require shipping engineering assets in product builds. This decision complements that source-retention contract by defining distribution and publication explicitly. These mechanisms can support the requested separation without selecting another framework, authentication provider, or deployment topology.

## Decision

Retain the full internal source catalog, generators, local `/docs` routes, search, previews, and AI-readable references. Treat the portal as a development tool. Exclude its routes, imports, UI styles, generated pages, search assets and reference downloads from every default production web build, in Orion and derived projects. Fail the product build if an accidental included import bypasses that boundary.

Allow explicit internal builds only with an operator acknowledgement that a trusted external host enforces access to the entire artifact. This build selection grants no permission and supplies no authentication. A real internal deployment requires authorization and verified host controls over assets and downloads as well as routes; API controls remain unchanged.

Product documentation belongs to the product's UI, audience, ownership and release process. Public API documentation uses a separately approved source inventory, including referenced schemas and examples. Neither public surface inherits or filters the internal catalog automatically. The foundation does not introduce a public publisher in this change.

Keep portal layout/navigation/styles inside its optional import boundary. Applications retain control of their shell, home, modules, brand and documentation presentation. Preserve the existing toolchain, repository/manifest contract, local URLs, and generated-source ownership.

## Rationale

Compile-time selection removes actual emitted bytes and reuses Vite rather than introducing an application boundary solely for packaging. Independent publication sources prevent an internal addition from becoming a public disclosure. Retaining complete generation keeps engineering discovery and agent context intact. External hosting enforcement accommodates an explicitly authorized internal deployment without inventing a provider or pretending static client checks protect downloads.

## Alternatives Considered

### Hide links or require a browser login

This changes navigation but leaves static references and search content downloadable. It does not establish the required distribution or trust boundary.

### Remove the portal and internal sources during derivation

This reduces product bytes but also removes developer and agent capabilities, generated-reference validation, and a reusable engineering workflow.

### Introduce a separate documentation application immediately

A separate application may be justified by future independent hosting requirements. It is unnecessary for current build exclusion and would add workspace, routing, and validation responsibilities before a concrete deployment exists.

## Consequences

### Positive

- Default products contain no internal portal or generated documentation assets.
- Local engineering workflows and canonical AI-readable knowledge remain available.
- Product and public documentation can evolve independently of engineering navigation and branding.
- Artifact and browser tests cover exclusion, explicit inclusion, accidental imports, and existing local behavior.

### Negative

- Internal deployment operators must explicitly select and protect a distinct artifact; the build cannot verify their real host's access controls.
- Products that previously used `/docs` as end-user help must migrate those links and content.
- Public documentation requires an approved source inventory and a product-owned publication implementation when needed.

### Operational or Migration Impact

Production `/docs` availability intentionally changes; source, local routes, generators, SDKs, database and manifest schemas remain compatible. Rebuild and remove stale deployed assets rather than only changing links. Existing intentional internal deployments must select the protected internal build. The [migration policy](../../architecture/living-documentation.md#existing-project-migration) describes adoption. No derived repository, release, remote push, provider, or deployment is changed by this implementation.

## References

- [Living Documentation policy](../../architecture/living-documentation.md)
- [ADR-0008: web stack](../0008-select-react-vite-and-tanstack-for-web-applications.md)
- [ADR-0017: clean derived baseline](../0017-start-derived-projects-from-a-clean-foundation-baseline.md)
- [Project derivation](../../project-derivation.md)
- [Build isolation tests](../../../apps/web/scripts/documentation-build.test.mjs)
