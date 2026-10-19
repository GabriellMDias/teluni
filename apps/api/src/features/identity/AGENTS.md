# Identity Module

This module owns application principals, server-managed human sessions and the session boundary other modules use. Read the [identity and session design](../../../../../docs/project/identity-session-design.md) and the [identity policies](../../../../../docs/project/identity-and-access.md) before changing behavior.

- Other modules import only `public.ts`; dependency rules reject imports of this module's internals. Compose dependents after this module in `src/modules.ts` with `requiresModules: ["identity"]`.
- Never weaken the ADR-0012 verifier, the CSRF/Origin check, the 30-second provider revalidation or the single-use login attempt to make a flow pass. A Keycloak behavior that does not meet the design is a recorded gap, not a reason to relax a check.
- Keep provider calls outside database transactions, credentials out of logs and errors, and the recoverable cookie credential out of storage (only its SHA-256 digest is persisted; provider tokens are sealed).
- The realm contract lives in `apps/api/scripts/identity-realm.ts` and is qualified by `test/identity/keycloak-contract.test.ts` against the pinned image in `scripts/keycloak.ts`; change them together.
