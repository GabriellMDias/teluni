# SDK-local Instructions

Use [the package guide](README.md) for ownership and generation. Global repository instructions still apply.

- `src/index.ts` is the public surface. Keep the SDK a thin generated-contract consumer; never import API implementation, persistence, or backend business authorization.
- Generate `src/generated/api-types.ts` from committed OpenAPI after changing the API's executable contracts. Follow the [artifact workflow](../../docs/architecture/backend-execution-and-generated-artifacts.md); never hand-edit generated types or duplicate wire schemas here.
- The host supplies bearer tokens and the session CSRF token through `createApiClient`; do not add token storage, provider-specific identity, or authorization rules.
- Preserve structured errors and safe unknown-code fallback. Consider actual consumer compatibility when changing the client surface or generator; this private workspace package has no independent publication promise.
- Run `pnpm -C packages/sdk typecheck` and root `pnpm references:check`, then root `pnpm validate` before substantial-work handoff.
