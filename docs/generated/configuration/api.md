# API Configuration Reference

<!-- Generated from apps/api/src/config.ts. Run pnpm -C apps/api references:write; do not edit. -->

[Configuration policy](../../architecture/configuration.md) · [API runtime](../../../apps/api/README.md)

No values are eligible for client exposure. `ORION_ENV` is always required. The three token settings are configured together. The six `TELUNI_` human identity settings are also configured together and additionally require the token settings, whose issuer they reuse. API modules that require the database, bearer authentication or human identity stay unmounted until those settings exist, and production startup fails instead.

| Environment variable | Type | Required | Default | Visibility | Classification | Secret | Purpose |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `ORION_ENV` | development \| test \| production | yes | — | server | INTERNAL | no | Runtime environment. |
| `ORION_RELEASE_ID` | artifact identifier, 1..128 ASCII letters/digits/._- | no | `local` | server | INTERNAL | no | Actual artifact revision for correlated logs and traces; local for unversioned development. |
| `ORION_API_HOST` | nonempty string | no | `127.0.0.1` | server | INTERNAL | no | Listen address; loopback by default. |
| `ORION_API_PORT` | integer 0..65535 | no | `3000` | server | INTERNAL | no | Listen port; zero selects an ephemeral port. |
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
| `TELUNI_SESSION_KEYS` | comma-separated id:base64url 32-byte keys, newest first | no | — | server | RESTRICTED | yes | Key ring for provider-token encryption and CSRF tokens; the first key protects new values, all keys remain readable during rotation. |
