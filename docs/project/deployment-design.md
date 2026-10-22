# Teluni Pilot Deployment and Recovery Design

[Deployment and migration planning](operations.md) · [Data handling policies](data-handling-policies.md) · [Release targets](release-targets.md) · [Commercial policies](commercial-policies.md) · [Identity and session design](identity-session-design.md) · [Invitation and email delivery design](invitation-delivery-design.md) · [ADR-0021](../adr/0021-propose-a-single-host-pilot-with-portable-persistent-storage.md) · [ADR-0033](../adr/0033-expose-the-pilot-host-with-end-to-end-tls-and-back-it-up-with-encrypted-off-host-snapshots.md)

## Status and scope

**Decided detailed design for D-08, 2026-10-22.** On 2026-10-22 the owner asked the agent to take every pending decision that is only a decision, so that development can continue. This extends the delegation of 2026-10-20 recorded with [PH-25](human-actions.md#ph-25). The agent took the [decisions](#decisions) below under that delegation, together with ADR-0033. Merging the pull request that adds this design is the repository review. The decisions authorize [PJ-13](implementation-plan.md#current-work) to build and rehearse the deployment locally and in CI. They do not deploy anything, expose a host or claim that the owner's host and network qualify. Those facts and accounts stay with [PH-10](human-actions.md#ph-10), [PH-15](human-actions.md#ph-15), [PH-16](human-actions.md#ph-16) and [PH-17](human-actions.md#ph-17).

In scope: public hostnames and routing, how the residential host is reached, the reverse proxy and TLS, the single-host composition, Keycloak in a real environment, the transactional email provider, Google sign-in registration values, backups and restore, recovery and availability targets, host administration and minimal monitoring.

Out of scope, with their owners: the host and network facts (PH-10), legal review of the data handling choices ([PH-28](human-actions.md#ph-28)), support coverage and real costs (PH-18), audit integrity and alert channels beyond backups and health ([D-09](architecture.md#pending-decisions)), and the player's update channel (PJ-12 increment 4).

## Policy inputs

- ADR-0021: one Debian host, Docker Compose, a reverse proxy with HTTPS, private PostgreSQL, media on durable mounted storage, and no tunnel or provider presumed suitable.
- No recurring cloud budget (P03 in the [identity policies](identity-and-access.md), PH-12). Free tiers are acceptable when their limits fit the pilot and leaving them is cheap.
- AT-15: screens keep playing for up to seven days without the server. Recovery must finish well inside that window.
- Commercial policies: no formal availability SLA. Support coverage is unknown under PH-18.
- Media design: uploads of up to 1 GiB (AT-03) stream through one request. Screens download H.264/AAC renditions.
- Player design: TLS with the system trust store, `minSdk` 26, and no certificate pinning.

## Hostnames and routing

The product domain is `teluni.app` ([branding](branding/README.md#approved-name-and-domain-direction)). Its registration and control are PH-07 evidence, and every name below waits for it.

| Name | Serves | Public paths |
| --- | --- | --- |
| `app.teluni.app` | The panel's static build and, under `/api`, the API for people and screens | Everything except the API's internal health and metrics endpoints |
| `auth.teluni.app` | Keycloak's `teluni` realm | `/realms/teluni/` and `/resources/` only |
| `teluni.app` | A redirect to `app.teluni.app` until a public site exists | `/` |

- `TELUNI_PUBLIC_ORIGIN` is `https://app.teluni.app`, and `ORION_TOKEN_ISSUER` is `https://auth.teluni.app/realms/teluni`.
- The proxy strips the `/api` prefix exactly as the development server does, so the API keeps one path layout everywhere. Screens are configured with `https://app.teluni.app/api`.
- Keycloak's admin console and master realm are never routed publicly. Administrators reach them only over the host's administration tunnel.
- One origin for the panel and API keeps cookies host-only and CSRF origin checks simple. It also avoids CORS.
- **Client addresses.** Rate limits count per client address, so the API must see the real one. Caddy sets `X-Forwarded-For`, and the API trusts that header only from the proxy's address. That needs a new trusted-proxy setting, added with the deployment bundle; without it every request would share the proxy's address. On the relay path, the relay sends PROXY protocol v2, and Caddy accepts it only from the tunnel's address.

## Reaching the residential host

TLS always ends on the owner's host, so no third party sees session cookies, credentials or private media. Two paths are acceptable, chosen by PH-10's facts:

1. **Direct.** If the line has a public IPv4 address (not in `100.64.0.0/10`) and inbound TCP 443 reaches the router, forward 443 (and 80 for redirects) to the host. Publish AAAA records too when the line and router give the host a stable IPv6 address. A small dynamic DNS client updates the records through the DNS provider's API when the address changes.
2. **Relay.** Behind CGNAT or a blocked port, a free-tier VM (Oracle Cloud Always Free, about 10 TB of outbound transfer per month) accepts TCP 443 and forwards it through a WireGuard tunnel that the home host opens, prefixed with PROXY protocol v2 so the host learns the client's address. The relay never holds certificates or keys. It sees only encrypted traffic, plus client addresses that it does not log.

Rejected for this service: Cloudflare Tunnel or proxying (TLS ends at Cloudflare; its CDN terms restrict video and large files outside its paid products; uploads are reported to be capped at 100 MB, well under the 1 GiB video limit), Tailscale Funnel and free ngrok-style tunnels (bandwidth and fair-use limits that suit demos, not screens).

## Host composition

One Compose project runs on the Debian host:

| Service | Image | Notes |
| --- | --- | --- |
| `proxy` | Caddy 2, pinned by digest | Only service with published ports (80, 443). Automatic ACME certificates from Let's Encrypt, HTTP/2 and HTTP/3, the routing above, security headers, and request limits that fit the 1 GiB upload and its 2-hour timeout |
| `api` | Teluni API, built from this repository | Non-root user and read-only root filesystem. Media volume and FFmpeg inside the image. Health checked before traffic. Migrations run as a separate one-off step with the privileged database role before the new version starts, under the [migration rules](../database/migrations.md) |
| `keycloak` | The digest pinned in `apps/api/scripts/keycloak.ts` | `start` (not `start-dev`), PostgreSQL storage, proxy headers from Caddy only, hostname `auth.teluni.app`, and the `teluni` theme installed into the image |
| `postgres` | PostgreSQL 16, pinned by digest | No published port. Separate databases and roles for Teluni and Keycloak. Data on a named volume on the host's durable disk |

- The panel's static build is served by Caddy from a read-only copy produced at release time.
- Secrets reach containers as files from a root-only directory on the host, never as values in the Compose file or the repository. They go to the variables named in the [configuration reference](../generated/configuration/api.md).
- Networks: the proxy and the API share a front network. The API, Keycloak and PostgreSQL share a back network with no route out except what each service needs (the API reaches the mail relay; Keycloak reaches Google).
- Let's Encrypt's ISRG Root X1 is in Android's trust store since 7.1.1, below the player's `minSdk` 26. Screens therefore trust the certificates without pinning.

## Identity in a real environment

- The realm and clients come from `apps/api/scripts/identity-realm.ts`, run against the real Keycloak with the administrator's bootstrap account, which is then disabled.
- Keycloak sends its own mail through the same relay as the API ([D-13](invitation-delivery-design.md)).
- **Google sign-in (PH-16 values).** One OAuth client of type "Web application" per environment, owned by the owner's Google account:
  - authorized redirect URI `https://auth.teluni.app/realms/teluni/broker/google/endpoint`;
  - JavaScript origins: none;
  - scopes `openid`, `email` and `profile` only;
  - consent screen "Teluni", user type external, with the privacy notice and terms links that PH-28 approves.

  Keycloak's identity-provider link keeps the D-02 rule: no account merging by email alone.

## Transactional email (PH-17 choice)

- **Provider:** Resend's free plan through SMTP: `smtp.resend.com`, port 465 with implicit TLS (`TELUNI_MAIL_SMTP_SECURITY=tls`), user `resend`, and an API key limited to sending as the password. Reported limits are 3,000 messages a month, 100 a day and one domain, which cover the pilot's invitations and recovery.
- **Sender:** a dedicated subdomain keeps the product domain's reputation separate. `TELUNI_MAIL_FROM` is `no-reply@notify.teluni.app`, with the provider's SPF and DKIM records on `notify.teluni.app`.
- **DMARC:** `p=none` with aggregate reports to the owner's address for the first 30 days, then `p=quarantine` once reports show only the relay sending.
- **Fallback:** Brevo's free plan through `smtp-relay.brevo.com`, reported at 300 messages a day but with its branding added. It needs only new SMTP settings, because the relay adapter is provider-neutral (ADR-0026).
- **Review triggers:** the daily cap approaching 80%, bounces above 5%, or a terms change prompt a review of the provider.

## Backups and restore

- **Tool.** restic: encrypted, deduplicated snapshots to an S3-compatible bucket, with one repository per environment. The repository password and the bucket key are host secrets. The owner keeps a copy of the repository password offline, because losing it loses every backup.
- **Destination.** Backblaze B2. Its first 10 GB are reported free, and downloads are reported free up to three times the stored data, which covers restore rehearsals. restic encrypts before upload, so the provider holds only ciphertext. Cloudflare R2 is the alternative. A destination on the same host or the same disk never counts as off-host.
- **What is in a snapshot:**
  - a `pg_dump` custom-format dump of each database (Teluni and Keycloak), taken first;
  - then the media volume's `objects/` tree;
  - the release identifier and non-secret configuration names.

  Secrets are excluded. They are backed up separately, as below.

- **Consistency.** Media objects are write-once and named by their hash, and purge waits at least 30 days after deletion. Copying the objects after the dump therefore includes every object the dump references. The restore check verifies this instead of assuming it.
- **Schedule and retention.** A snapshot every 6 hours. `restic forget` keeps the last 8, 14 daily, and 5 weekly snapshots, then prunes weekly. No backup outlives about 35 days, which bounds how long deleted data survives in backups ([data handling policies](data-handling-policies.md)). A weekly `restic check` reads a 5% sample of the data.
- **Secrets recovery.** The signing key rings, session and mail key rings, client secrets and the restic password are exported to a password manager or encrypted offline medium that the owner controls, and only when they change. Restoring a database without its key rings makes sealed mail credentials unreadable and invalidates sessions. That loss is acceptable, and it is safer than storing keys next to the data.
- **Restore rehearsal.** Restore into an isolated Compose project and check:
  - migrations are current;
  - every referenced object exists with the right hash;
  - a test company's publication manifest resolves;
  - revoked sessions stay revoked (sessions older than the backup are not trusted: all sessions are terminated after a restore).

  Record the achieved recovery point and time. Rehearse before the pilot and then monthly.

## Recovery and availability targets

| Target | Value | Why |
| --- | --- | --- |
| Recovery point (RPO) | 6 hours of data (the snapshot interval) | A day's edits are costly to redo for a small business; 6-hourly snapshots are cheap with deduplication |
| Recovery time, host intact (RTO) | 4 hours | Restore from the latest snapshot onto the same host |
| Recovery time, host lost | 72 hours, including obtaining replacement hardware | Stays well inside the seven-day offline window of AT-15, so screens keep playing throughout |
| Internal availability objective | 99% per month for panel and API, excluding announced maintenance | Measured, not sold. The commercial policies keep "no formal SLA" |
| Planned maintenance | Weekdays 02:00–06:00 `America/Sao_Paulo`, announced 48 hours ahead when the outage exceeds 15 minutes | Snack bars and restaurants run evenings and weekends |

Screens play through outages; publishing, pairing, sign-in and monitoring stop. The pilot conversation states this (operations readiness gate).

## Host administration and monitoring

- Debian stable with unattended security upgrades, SSH by key only and no password sign-in, a host firewall that allows only 80 and 443 (and the WireGuard port on the relay path), and full-disk encryption when the hardware allows unattended unlocking. Otherwise the database and media volumes stay on the system disk, and the threat is recorded under PH-10.
- Administration over WireGuard from the owner's devices. No administrative interface is exposed publicly.
- Logs: the containers' JSON logs are rotated at 14 days. They hold no personal data beyond identifiers, under the [redaction policy](../security/telemetry-redaction.md).
- Minimum alerts: a failed or late backup, low disk space (below the media reserve plus 10%), a failed certificate renewal and the API health check failing for 5 minutes. All are sent by email through the same relay. An external uptime monitor is optional and not required.

## Remaining human actions

- PH-10: host and line facts (public address or CGNAT, port 443, upload bandwidth, power), the relay VM account if the line needs it, the backup account and the restore rehearsal on the real host.
- PH-07: registering `teluni.app` and access to its DNS.
- PH-15: running Keycloak with the secrets in place.
- PH-16: registering the Google client with the values above.
- PH-17: creating the Resend account, verifying `notify.teluni.app` and storing the key.
- PH-28: legal review of the notices and terms that the consent screen and pilot link to.

## Delivery increments

1. **Deployment bundle (PJ-13).** In the repository: the API's trusted-proxy setting, container images for the API (with FFmpeg) and Keycloak (with the theme), the Compose file, the Caddyfile, the backup, restore and verification scripts, and a local rehearsal that brings the stack up, writes data, backs it up to a local S3-compatible server, restores it into a fresh project and verifies it. CI runs the rehearsal.
2. **Runbooks** for install, update, backup failure, restore and host migration, written against the real host once PH-10 provides it.
3. **Real-host qualification**: the readiness gate in [operations](operations.md#residential-exposure-and-readiness-gate), the timed restore and a recorded RPO and RTO.

## Implementation status

Not started. Nothing is deployed.

## Decisions

The agent took these decisions on 2026-10-22 under the owner's delegation:

1. **Hostnames.** `app.teluni.app` for the panel and the API under `/api`, `auth.teluni.app` for the `teluni` realm only, and `teluni.app` redirecting to the panel.
2. **End-to-end TLS.** TLS ends on the owner's host. The host is reached directly when the line allows it, or through a TCP relay on a free-tier VM over WireGuard; no TLS-terminating tunnel or CDN is used (ADR-0033).
3. **Proxy.** Caddy 2 with automatic Let's Encrypt certificates, as the only published service. The API trusts forwarded client addresses only from it, and the relay passes them with PROXY protocol v2.
4. **Composition.** Four Compose services (proxy, API, Keycloak, PostgreSQL), digest-pinned images, secrets as files, one-off privileged migrations and internal networks.
5. **Email.** Resend's free plan over SMTP with implicit TLS from `no-reply@notify.teluni.app`, staged DMARC, and Brevo as fallback.
6. **Google sign-in.** One web client per environment with the Keycloak broker redirect URI and the `openid`, `email` and `profile` scopes.
7. **Backups.** restic snapshots every 6 hours to Backblaze B2, holding database dumps then media objects, kept for at most about 35 days, with secrets backed up separately offline (ADR-0033).
8. **Targets.** RPO 6 hours; RTO 4 hours with the host intact and 72 hours if it is lost; a 99% internal monthly availability objective; and the maintenance window above.
9. **Administration.** Key-only SSH, WireGuard administration, a minimal firewall, 14-day logs and four email alerts.

## Alternatives considered

- **Cloudflare Tunnel.** Free, and it removes CGNAT problems, but TLS ends at Cloudflare. The CDN terms restrict serving video and large files outside paid products, and the reported 100 MB upload cap rejects valid videos. It would also put every session cookie in a third party's path.
- **A paid VPS for everything.** Removes residential risks, but contradicts the current budget. It stays the migration target in [operations](operations.md#future-host-or-storage-migration) when revenue or measured risk justifies it.
- **Running the whole stack on the free-tier VM.** The free VM is subject to the provider's idle reclamation and account terms. Hosting customer data there makes those terms a single point of failure. As a relay it holds nothing and can be replaced in minutes.
- **nginx with certbot, or Traefik.** Both work. Caddy needs the least configuration for automatic certificates and has no separate renewal job to monitor.
- **PostgreSQL continuous archiving (WAL) for a smaller RPO.** Gives minutes of data loss, but needs a second backup mechanism and its own restore procedure. Six hours fits the pilot, and archiving can be added when a customer needs it.
- **Brevo as the first email choice.** Higher daily cap, but its free plan adds branding to every message, including invitations and recovery mail.
- **Backups to a second disk or another directory.** Does not survive the loss of the host, which ADR-0021 requires.
