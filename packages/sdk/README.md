# API SDK

[API modules](../../apps/api/README.md#modules) · [Generated OpenAPI](../../docs/generated/api/openapi.json) · [API policy](../../docs/api/principles.md) · [Web consumer](../../apps/web/README.md)

This private workspace package (`packages/sdk`) is the client boundary for the API. [`src/index.ts`](src/index.ts) exports `createApiClient(baseUrl, getAccessToken, { getCsrfToken })`, `ApiClient`, and generated `paths` types. The host provides credentials through the callbacks; the SDK adds the bearer header, and the session CSRF token on unsafe methods only, without issuing, refreshing, persisting, or logging them. Session cookies travel as same-origin browser cookies. It contains no business authorization, persistence, or provider-specific identity model.

The API owns executable TypeBox schemas and stable operation IDs. Generated OpenAPI feeds `openapi-typescript`, which produces [`src/generated/api-types.ts`](src/generated/api-types.ts); `openapi-fetch` supplies the thin typed runtime. Never edit generated types or import server implementation models. Compile-time typing does not automatically revalidate successful responses at runtime.

From the repository root, follow the [artifact workflow](../../docs/architecture/backend-execution-and-generated-artifacts.md): regenerate API OpenAPI first, run `pnpm -C packages/sdk generate`, and regenerate affected portal data. `pnpm references:check` verifies API/database/SDK freshness without editing tracked files. Run `pnpm -C packages/sdk typecheck` and the full `pnpm validate` gate for the client and web consumer.

This package has no independently published compatibility promise. A real independently released consumer activates [API compatibility policy](../../docs/api/versioning.md) and a human action to identify its supported baseline; SDK package versions and server contract versions are distinct. Current-source drift checks do not validate a historical released consumer.
