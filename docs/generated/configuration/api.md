# API Configuration Reference

<!-- Generated from apps/api/src/config.ts. Run pnpm -C apps/api references:write; do not edit. -->

[Configuration policy](../../architecture/configuration.md) · [API runtime](../../../apps/api/README.md)

No values are eligible for client exposure. `ORION_ENV` is always required. The three token settings are configured together. The six `TELUNI_` human identity settings are also configured together and additionally require the token settings, whose issuer they reuse. The devices module additionally requires `TELUNI_DEVICE_CODE_KEYS`, the media module `TELUNI_MEDIA_STORAGE_PATH` and the publications module `TELUNI_SYNC_SIGNING_KEYS`. API modules that require the database, bearer authentication, human identity, mail, device code keys, media storage or signing keys stay unmounted until those settings exist, and production startup fails instead.

| Environment variable | Type | Required | Default | Visibility | Classification | Secret | Purpose |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `ORION_ENV` | development \| test \| production | yes | — | server | INTERNAL | no | Runtime environment. |
| `ORION_RELEASE_ID` | artifact identifier, 1..128 ASCII letters/digits/._- | no | `local` | server | INTERNAL | no | Actual artifact revision for correlated logs and traces; local for unversioned development. |
| `ORION_API_HOST` | nonempty string | no | `127.0.0.1` | server | INTERNAL | no | Listen address; loopback by default. |
| `ORION_API_PORT` | integer 0..65535 | no | `3000` | server | INTERNAL | no | Listen port; zero selects an ephemeral port. |
| `TELUNI_TRUSTED_PROXIES` | comma-separated IP addresses or CIDR ranges, at most 16 | no | — | server | INTERNAL | no | Reverse proxies whose X-Forwarded-For and X-Forwarded-Proto headers are trusted, so request limits count the real client address; none by default. |
| `ORION_LOG_LEVEL` | Pino level | no | `info` | server | INTERNAL | no | Structured log threshold. |
| `ORION_SHUTDOWN_TIMEOUT_MS` | integer 100..30000 | no | `5000` | server | INTERNAL | no | Total graceful shutdown deadline. |
| `ORION_OTLP_ENDPOINT` | http(s) URL | no | — | server | INTERNAL | no | Optional OTLP HTTP collector base URL. |
| `ORION_TRACE_SAMPLE_RATIO` | number 0..1 | no | `1` | server | INTERNAL | no | Trace sampling probability. |
| `ORION_DATABASE_URL` | PostgreSQL URL | no | — | server | RESTRICTED | yes | Runtime PostgreSQL credential; enables the database for modules that require it and adds it to readiness. |
| `ORION_TOKEN_ISSUER` | issuer URL | no | — | server | INTERNAL | no | Expected access-token issuer; configure with audience and JWKS URL to enable bearer authentication. |
| `ORION_TOKEN_AUDIENCE` | nonempty string | no | — | server | INTERNAL | no | Expected API access-token audience. |
| `ORION_TOKEN_JWKS_URL` | http(s) URL | no | — | server | INTERNAL | no | Trusted issuer public-key endpoint. |
| `TELUNI_PUBLIC_ORIGIN` | origin URL (scheme, host, optional port) | no | — | server | INTERNAL | no | Browser-visible panel origin for OIDC callbacks, cookie security and CSRF origin checks; HTTPS outside loopback development. |
| `TELUNI_OIDC_CLIENT_ID` | client identifier | no | — | server | INTERNAL | no | Confidential human-login OIDC client used by the server-managed session boundary. |
| `TELUNI_OIDC_CLIENT_SECRET` | secret string, at least 16 characters | no | — | server | RESTRICTED | yes | Credential of the human-login OIDC client. |
| `TELUNI_IDENTITY_PROVISIONER_CLIENT_ID` | client identifier | no | — | server | INTERNAL | no | Service-account client that writes the administrator-only application principal attribute. |
| `TELUNI_IDENTITY_PROVISIONER_CLIENT_SECRET` | secret string, at least 16 characters | no | — | server | RESTRICTED | yes | Credential of the principal provisioner service account. |
| `TELUNI_KEYCLOAK_ADMIN_URL` | HTTP(S) base URL, optional context path, no trailing slash | no | — | server | INTERNAL | no | Optional private Keycloak base URL for principal provisioning and administrative session termination; defaults to the public issuer's base. HTTP is only for a trusted private host/container network. Does not change OIDC discovery, token issuer or TLS verification. Requires complete human identity settings and an API restart. |
| `TELUNI_SESSION_KEYS` | comma-separated id:base64url 32-byte keys, newest first | no | — | server | RESTRICTED | yes | Key ring for provider-token encryption and CSRF tokens; the first key protects new values, all keys remain readable during rotation. |
| `TELUNI_MAIL_SMTP_HOST` | host name or address | no | — | server | INTERNAL | no | SMTP submission relay for transactional email; configure with the sender and mail key ring to enable the mail module. |
| `TELUNI_MAIL_SMTP_PORT` | integer 1..65535 | no | `587` | server | INTERNAL | no | SMTP submission relay port. |
| `TELUNI_MAIL_SMTP_SECURITY` | tls \| starttls \| none | no | `starttls` | server | INTERNAL | no | Implicit TLS or mandatory STARTTLS with certificate verification; none only for a loopback test sink outside production. |
| `TELUNI_MAIL_SMTP_USERNAME` | string, 1..256 characters | no | — | server | INTERNAL | no | SMTP authentication user; configured together with the password, or both omitted for an unauthenticated test sink. |
| `TELUNI_MAIL_SMTP_PASSWORD` | secret string, 1..512 characters | no | — | server | RESTRICTED | yes | SMTP authentication credential of the mail relay. |
| `TELUNI_MAIL_FROM` | email address | no | — | server | INTERNAL | no | Sender address of transactional email; its domain must be authorized for the relay. |
| `TELUNI_MAIL_KEYS` | comma-separated id:base64url 32-byte keys, newest first | no | — | server | RESTRICTED | yes | Key ring sealing secret message parameters, such as invitation credentials, until delivery ends; the first key protects new values. |
| `TELUNI_DEVICE_CODE_KEYS` | comma-separated id:base64url 32-byte keys, newest first | no | — | server | RESTRICTED | yes | Key ring for the HMAC that stores screen pairing codes; the first key protects new codes, all keys remain readable during rotation. Enables the devices module. |
| `TELUNI_MEDIA_STORAGE_PATH` | absolute directory path | no | — | server | INTERNAL | no | Directory on durable storage that holds media objects and work files on one filesystem; enables the media module. |
| `TELUNI_MEDIA_FFMPEG_PATH` | executable name or path | no | `ffmpeg` | server | INTERNAL | no | FFmpeg 6.1 or later executable that converts media in isolated child processes. |
| `TELUNI_MEDIA_FFPROBE_PATH` | executable name or path | no | `ffprobe` | server | INTERNAL | no | ffprobe 6.1 or later executable that inspects uploaded media in isolated child processes. |
| `TELUNI_MEDIA_PROCESSING_CONCURRENCY` | integer 1..4 | no | `1` | server | INTERNAL | no | Media processing jobs this API process runs at once. |
| `TELUNI_SYNC_SIGNING_KEYS` | comma-separated id:base64url PKCS#8 DER EC P-256 private keys, newest first | no | — | server | RESTRICTED | yes | Key ring that signs screen authorization statements (ADR-0030); the first key signs, and every key's public half stays available to screens during rotation. Enables the publications module. |
