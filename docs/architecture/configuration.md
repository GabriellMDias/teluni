# Configuration

[Documentation index](../README.md) · [Local setup](../setup.md) · [Secrets management](../security/secrets-management.md)

Configuration is an explicit application dependency: validate it before use, expose only safe projections, and keep its meaning discoverable without access to secret values. [ADR-0007](../adr/0007-establish-api-contract-openapi-sdk-and-configuration-schema-strategy.md) selects TypeBox for bootstrap schemas. This page owns configuration policy; application sources own their settings and the setup guide owns loading commands.

## Canonical Configuration Schema

Web engineering-tool inclusion is controlled separately by the non-secret process environment selection in [the documentation build policy](living-documentation.md#build-and-deployment-boundary). It is evaluated by Vite configuration, is excluded from the API `.env.example` schema, and grants neither browser credentials nor hosting access.

Each application owns a canonical schema with derived types where practical. Define each setting's name, type, purpose, required/optional state, default, validation constraints, classification, secret status, client visibility, and operational consequences. Document the owner, permitted changes, environment scope, and whether a restart is required. Descriptions explain semantics rather than repeat the name.

Current sources are:

| Application | Canonical input and representation |
| --- | --- |
| API | [`serverConfigSchema`, parser, and reference metadata](../../apps/api/src/config.ts); [generated safe reference](../generated/configuration/api.md) and schema-checked [`.env.example`](../../.env.example). All API settings are server-only; its client projection is empty. |
| Web | [`loadClientConfig`](../../apps/web/src/config.ts) validates the build-time `VITE_ORION_API_BASE_URL`, defaulting to `/api`. Web-specific setup belongs in the [web guide](../../apps/web/README.md). |

The API metadata records type, required/default, visibility, classification, secret status, and purpose. The runtime database URL is classified `RESTRICTED` and secret; no API setting is browser-visible. `ORION_RELEASE_ID` identifies the actual artifact in logs and traces when supplied, defaulting to `local` for unversioned development. The parser, generated reference, and safe example do not imply a generic configuration/secret-management platform exists.

Avoid independent definitions in code, READMEs, examples, and deployment files when they can derive from the schema. Generated references must never contain actual secrets. Changes to the API source require regeneration through [artifact tooling](backend-execution-and-generated-artifacts.md#artifact-ownership-and-storage); new applications need their own schema and explicit example/check.

## Configuration Validation

Parse raw strings into meaningful booleans, numbers, durations, URLs, enums, lists, or objects at the boundary. A nonempty `"false"` must not become true. Names/types must make units explicit, use clear positive boolean semantics, and group related settings coherently. Prefer one validated mode over conflicting enable/disable booleans.

Validate required values, cross-field invariants, conditional requirements, ranges, protocols, and mutually exclusive modes before use. Missing or invalid required configuration normally prevents startup. Diagnostics should name the key and expected requirement where practical without echoing restricted values. After successful parsing, components can rely on the declared schema.

Defaults must be safe, predictable, documented, and unambiguous. Require explicit configuration when no safe default exists; never silently disable expected authentication or select an unintended production database. Isolate development-only conveniences. The current API explicitly permits health-only operation in development/test, requires the database and token settings together to enable the feature, and requires that feature configuration in production.

Unknown keys can indicate typos or obsolete deployment settings; detect them where practical, with warnings/errors appropriate to the source. The current API selects known environment keys into a validated object; it does not reject every unrelated variable in the process environment.

## Configuration Precedence

Sources and precedence must be deterministic and documented. Use the smallest set of mechanisms that satisfies real needs; do not add overlapping files, CLI overrides, or remote systems speculatively.

The API development command optionally loads the root ignored `.env.local`; existing shell environment values win. The production start command receives process environment and does not implicitly load that file. Vite owns the web application's environment loading and embeds its public build-time values. Disposable end-to-end and module stacks supply their own temporary configuration. [Setup](../setup.md#load-local-configuration) is the canonical procedure; no global remote configuration hierarchy or deployment platform is selected.

## Centralized Ingestion

Resolve raw configuration near bootstrap/composition, then pass narrow validated inputs to components. Do not scatter direct environment reads, pass every setting to every service, or let shared packages discover application environment implicitly. A library should accept simple parameters unless environment ingestion is its explicit responsibility. Keep provider-specific settings near that integration.

Stable domain invariants should not become deployment switches. Configuration controls intentional operational variability; business records, per-user preferences, and frequently edited business settings often belong in application data. Choose ownership according to meaning, who changes it, and frequency. Share schemas/settings across applications only when their semantics match, and distinguish sharing a schema from sharing an actual value.

Environment identity is not a generic feature flag. Use a small explicit environment model and name actual capabilities/modes when controlling behavior. Necessary production differences, such as diagnostic limits or real provider integration, must be intentional and testable. Avoid platform-specific settings when a useful application concept exists, without inventing portability abstractions.

## Configuration and Secrets

The schema may describe a secret requirement; secret delivery, storage, rotation, and revocation follow [secret policy](../security/secrets-management.md). Secret references may be useful where infrastructure supports them, but resolved values remain restricted in memory. Agents must understand requirements from schemas, safe placeholders, and descriptions without needing real credentials.

Build-time values can remain embedded in browser/mobile/desktop artifacts or image layers and are accessible to recipients. Never embed server-only secrets. Client-visible settings must be explicitly safe; environment-variable delivery alone does not make them public. Keep server credentials, private tokens/keys, and privileged internal endpoints out of client artifacts and shared public configuration.

Do not serialize or log entire configuration objects in startup logs, errors, health endpoints, debug output, or support bundles. Use explicit safe projections, such as whether a dependency is configured. Even nonsecret fields obey [data classification](../security/data-classification.md) and [telemetry redaction](../security/telemetry-redaction.md). Safe configuration summaries/fingerprints may help diagnose drift only when useful and excluding secrets.

## Evolution and Operational Changes

Configuration changes can break deployment or rollback even without code changes. For a rename/removal, identify old/new applications, supported rolling/rollback combinations, CI, local examples, deployment scripts, secret stores, and documentation. Introduce replacements, support both temporarily if required, migrate consumers, then remove old usage/configuration/secrets. Do not remove keys while a supported old version still requires them or retain unused keys indefinitely. Follow [compatibility policy](versioning-and-compatibility.md), including coordinated database/configuration transitions.

A separate configuration schema version is justified only if independently managed configuration needs it; application releases and Git may suffice. Deployment definitions, when introduced, should expose requirements and reject invalid mandatory configuration before activation. Validate secret presence/references without exposing values.

Prefer static startup configuration initially. Dynamic/remote configuration creates availability, authentication, caching, fallback, consistency, concurrency, rollback, auditability, and test obligations. If introduced, distinguish startup-only, reloadable, and process-immutable values. High-impact changes need risk-appropriate safe audit context (key, actor/system, time), not secret old/new values. Feature flags need explicit rollout/removal criteria unless they are permanent product settings; they are not automatically ordinary environment variables.

## Verification and Enforcement

Tests construct explicit configuration and synthetic credentials instead of relying on machine state. Unit tests inject the minimum values; parser tests exercise missing/invalid input, defaults, secret-safe errors, conditional modes, and cross-field behavior. Integration tests exercise the actual ingestion boundary with isolated resources. CI jobs receive only the settings/credentials they require, never unrelated production access.

Client builds must reject attempts to import or embed server-only/restricted configuration. Implemented checks include API parser tests, generated-reference freshness, `pnpm env:example:check`, and the web [bundle marker check](../../apps/web/scripts/check-bundle.mjs). The example check compares safe placeholders/defaults with API metadata; it does not validate deployed environments. The bundle check detects known server-only markers, not every possible leak. Direct environment access outside approved modules and full secret/classification metadata coverage remain review responsibilities; no dedicated lint rule or deployed-configuration validator currently proves them. These limits do not relax the policy.

## New Configuration Checklist

Before adding a setting, establish its concrete variability requirement, owning application, consumers, type/units, required/default behavior, classification/secret/client visibility, environment scope, change/restart behavior, validation, tests, documentation, and compatibility impact. Consider whether the value belongs in application data or can remain fixed. Every option expands the behavior space; keep only justified configuration and update its canonical source and derived representations together.
