# Infrastructure Instructions

This directory holds declarative deployment and operational infrastructure only, never business logic ([repository structure](../docs/architecture/repository-structure.md)). Read the [pilot deployment and recovery design](../docs/project/deployment-design.md) and [ADR-0033](../docs/adr/0033-expose-the-pilot-host-with-end-to-end-tls-and-back-it-up-with-encrypted-off-host-snapshots.md) before changing anything under `pilot/`.

- Never commit secrets, real hostnames' credentials or environment files with values. Secrets reach containers only from the env files in the host's root-only configuration directory; the rehearsal generates disposable ones.
- Pin every base image by digest and every tool by exact version. Application images are built from this repository; runtime code never imports anything from here.
- Configuration keys come from the [configuration reference](../docs/generated/configuration/api.md); do not invent API settings here. A new setting is added to `apps/api/src/config.ts` first.
- TLS ends in the proxy on the owner's host (ADR-0033). Do not add a TLS-terminating tunnel, CDN or a public route to the API's health endpoints or Keycloak's admin console.
- Run `infra/pilot/rehearsal.sh` after changing images, the composition, the proxy or the backup script; CI runs it as the Deployment rehearsal job.
