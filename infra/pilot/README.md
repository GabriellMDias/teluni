# Pilot Deployment

The declarative pilot deployment of the [deployment design](../../docs/project/deployment-design.md) and [ADR-0033](../../docs/adr/0033-expose-the-pilot-host-with-end-to-end-tls-and-back-it-up-with-encrypted-off-host-snapshots.md): one Debian host running Docker Compose. Nothing here is deployed; installing it on the real host waits for [PH-10](../../docs/project/human-actions.md#ph-10) and its runbooks.

| File | Purpose |
| --- | --- |
| [`Dockerfile`](Dockerfile) | Every image, built from the repository root: `api` (Ubuntu 24.04 with FFmpeg 6.1, production dependencies, unprivileged user), `release` (migrations, runtime grants, realm), `keycloak` (the login theme, built for PostgreSQL), `proxy` (Caddy with the panel's static build) and `backup` (PostgreSQL 16 client tools with restic) |
| [`compose.yaml`](compose.yaml) | The composition: `postgres`, the one-off `release`, `keycloak`, `api`, `proxy`, and the on-demand `backup` |
| [`Caddyfile`](Caddyfile) | Routing, TLS and headers for `app`, `auth` and the apex name |
| [`postgres/init.sh`](postgres/init.sh) | The databases and roles, created once with the volume |
| [`backup/teluni-backup.sh`](backup/teluni-backup.sh) | `snapshot`, `maintain`, `restore`, `verify` and `snapshots` |
| [`systemd/`](systemd/teluni-backup.timer) | Timers for a snapshot every 6 hours and weekly maintenance |
| [`rehearsal.sh`](rehearsal.sh) | Builds and runs the whole stack locally, backs it up, restores it into a new project and checks both; CI runs it |

## Configuration

Compose reads per-host values from the environment and secrets from env files in `TELUNI_CONFIG_DIR`, a root-only directory such as `/etc/teluni`. The rehearsal's `write_config` function writes a complete disposable set and is the reference for their contents.

| Variable or file | Holds |
| --- | --- |
| `TELUNI_CONFIG_DIR`, `TELUNI_APP_HOST`, `TELUNI_AUTH_HOST`, `TELUNI_APEX_HOST`, `TELUNI_ACME_EMAIL`, `TELUNI_RELEASE` | Compose interpolation, for example in `/etc/teluni/compose.env` for the systemd units |
| `postgres.env` | `POSTGRES_PASSWORD` and the passwords of the `teluni_owner`, `orion_runtime` and `keycloak` roles |
| `release.env` | `ORION_MIGRATION_DATABASE_URL` (the owner role) and the realm step's Keycloak administrator, origin, audience and client secrets |
| `keycloak.env` | `KC_DB_PASSWORD` and the bootstrap administrator, which is disabled after the realm exists |
| `api.env` | The API settings of the [configuration reference](../../docs/generated/configuration/api.md); the Compose file sets `TELUNI_TRUSTED_PROXIES` to the proxy's fixed address |
| `backup.env` | `PGPASSWORD`, `RESTIC_REPOSITORY`, `RESTIC_PASSWORD` and the bucket's credentials (for Backblaze B2, `B2_ACCOUNT_ID` and `B2_ACCOUNT_KEY`) |

## Commands

From this directory, with the environment above:

- `docker compose --profile tools build` builds every image.
- `docker compose up --detach --wait` applies migrations and grants (the `release` service), then starts the stack.
- `docker compose run --rm release realm` creates or updates the `teluni` realm; `docker compose run --rm release end-sessions` ends every Keycloak session after a restore.
- `docker compose run --rm backup snapshot`, `maintain`, `restore [ID]`, `verify [--hash]` and `snapshots` manage backups. `restore` refuses databases or a media volume that are not empty, so it runs on a fresh project before the rest of the stack starts.
- `./rehearsal.sh` rehearses all of it on this machine, using loopback ports 80 and 443 and Caddy's local CA.

On a network that intercepts TLS, set `TELUNI_BUILD_CA_FILE` to its CA certificate before running the rehearsal, so the build can reach the npm registry. The rehearsal passes it as the Dockerfile's optional `extra-ca` build secret, which is never stored in an image. When the file is outside this directory, Buildx also needs `BUILDX_BAKE_ENTITLEMENTS_FS=0` to read it.

## Not yet here

The relay listener with PROXY protocol for a line behind CGNAT, alert delivery for failed backups and renewals, and the runbooks for installation, updates and restore arrive with the real host (PH-10). Keycloak's own production mail needs authenticated SMTP in the realm contract, which PJ-24 adds.
