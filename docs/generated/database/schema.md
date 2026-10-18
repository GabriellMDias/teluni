# Database Reference

<!-- Generated from migrated PostgreSQL and apps/api/prisma/metadata. Do not edit. -->

[Schema documentation policy](../../database/schema-documentation.md) · [Database principles](../../database/principles.md)

## principals

Provider-independent application principal for one human identity at one issuer; its UUID is the stable identity referenced by memberships, ownership and audit.

Owner: Identity. Classification: CONFIDENTIAL.

Lifecycle: Created at first verified login; never deleted by the runtime. Disablement is a state change. Retention and erasure follow PH-13.

| Column | PostgreSQL type | Nullable | Default | Classification | Meaning | Null meaning | Unit |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `id` | `uuid` | no | — | CONFIDENTIAL | Application-generated immutable principal UUID, written to the provider's administrator-only attribute and asserted by access tokens as orion_principal_id. | — | — |
| `issuer` | `character varying(512)` | no | — | INTERNAL | Exact OIDC issuer that authenticated this principal; together with subject it is the provider association. | — | — |
| `subject` | `character varying(255)` | no | — | CONFIDENTIAL | Provider-assigned stable subject identifier at the issuer; never used as the application identity. | — | — |
| `status` | `"PrincipalStatus"` | no | `'ACTIVE'::"PrincipalStatus"` | INTERNAL | ACTIVE principals can hold sessions; DISABLED principals are globally denied within the 30-second revocation bound. | — | — |
| `created_at` | `timestamp(3) with time zone` | no | `CURRENT_TIMESTAMP` | INTERNAL | PostgreSQL-clock instant of principal provisioning. | — | UTC instant, millisecond precision |
| `disabled_at` | `timestamp(3) with time zone` | yes | — | INTERNAL | PostgreSQL-clock instant of global disablement. | The principal is active. | UTC instant, millisecond precision |

### Constraints and indexes

| Object | Physical definition | Purpose |
| --- | --- | --- |
| `principals_disabled_state` | `CHECK (((status = 'DISABLED'::"PrincipalStatus") = (disabled_at IS NOT NULL)))` | A disablement instant exists exactly for disabled principals. |
| `principals_issuer_nonblank` | `CHECK (((issuer)::text ~ '^https?://[^[:space:]]+$'::text))` | Issuer is an absolute HTTP(S) URL without whitespace. |
| `principals_pkey` | `PRIMARY KEY (id)` | Unique immutable application principal identity. |
| `principals_subject_nonblank` | `CHECK (((subject)::text ~ '[^[:space:]]'::text))` | Provider subject cannot be blank. |
| `principals_issuer_subject_key` | `CREATE UNIQUE INDEX principals_issuer_subject_key ON public.principals USING btree (issuer, subject)` | One application principal per provider identity; concurrent first logins converge on one row. |

## human_sessions

Server-managed browser session: an opaque cookie credential's hash, its bounds and assurance, and the sealed provider tokens obtained for it.

Owner: Identity. Classification: RESTRICTED.

Lifecycle: Created at login as ACTIVE, or PENDING_LIMIT when the principal already has five active sessions; REVOKED rows are retained without deletion until a retention rule is approved under PH-13.

| Column | PostgreSQL type | Nullable | Default | Classification | Meaning | Null meaning | Unit |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `id` | `uuid` | no | — | CONFIDENTIAL | Backend-generated session UUID, shown to its owner for session management and bound into sealed tokens and CSRF tokens. | — | — |
| `principal_id` | `uuid` | no | — | CONFIDENTIAL | Principal that authenticated this session. | — | — |
| `token_hash` | `bytea` | no | — | RESTRICTED | SHA-256 of the 32-byte random cookie credential; the recoverable credential is never stored. | — | — |
| `state` | `"HumanSessionState"` | no | — | INTERNAL | PENDING_LIMIT may only list and end sessions; ACTIVE may call protected operations; REVOKED is terminal. | — | — |
| `provider_session_id` | `character varying(255)` | yes | — | CONFIDENTIAL | Provider session identifier (OIDC sid) used to apply back-channel logout. | The provider did not report a session identifier. | — |
| `assurance_level` | `character varying(64)` | no | — | INTERNAL | Authentication context class (acr) asserted by the ID token verified at login. | — | — |
| `authenticated_at` | `timestamp(3) with time zone` | no | — | INTERNAL | Provider-reported instant of the user's authentication (auth_time) for this session. | — | UTC instant, millisecond precision |
| `strong_authenticated_at` | `timestamp(3) with time zone` | yes | — | INTERNAL | Instant of the latest strong authentication verified for this session, used for recent-authentication checks. | No strong authentication has been verified for this session. | UTC instant, millisecond precision |
| `idle_timeout_seconds` | `integer` | no | — | INTERNAL | Inactivity bound applied to this session: 1800 for administrative contexts or principals without memberships, 7200 for operator-only access. | — | seconds |
| `created_at` | `timestamp(3) with time zone` | no | `CURRENT_TIMESTAMP` | INTERNAL | PostgreSQL-clock instant the session was created. | — | UTC instant, millisecond precision |
| `last_activity_at` | `timestamp(3) with time zone` | no | `CURRENT_TIMESTAMP` | INTERNAL | PostgreSQL-clock instant of the latest recorded human activity; background requests do not advance it, and writes are throttled to 15 seconds. | — | UTC instant, millisecond precision |
| `absolute_expires_at` | `timestamp(3) with time zone` | no | — | INTERNAL | Instant after which the session is invalid regardless of activity, at most 12 hours after creation. | — | UTC instant, millisecond precision |
| `provider_tokens` | `bytea` | no | — | RESTRICTED | Provider access, refresh and ID tokens sealed with AES-256-GCM under the session key ring and bound to the session ID. | — | — |
| `access_token_expires_at` | `timestamp(3) with time zone` | no | — | INTERNAL | Database-clock estimate of the sealed access token's expiry, five seconds earlier than the provider's lifetime. | — | UTC instant, millisecond precision |
| `provider_checked_at` | `timestamp(3) with time zone` | no | `CURRENT_TIMESTAMP` | INTERNAL | Latest instant the provider confirmed the session through introspection, refresh or login. | — | UTC instant, millisecond precision |
| `refresh_lease_until` | `timestamp(3) with time zone` | yes | — | INTERNAL | End of the single-flight lease held by the request refreshing provider tokens. | No refresh is in progress. | UTC instant, millisecond precision |
| `revoked_at` | `timestamp(3) with time zone` | yes | — | INTERNAL | PostgreSQL-clock instant the session was revoked. | The session has not been revoked. | UTC instant, millisecond precision |
| `revocation_reason` | `character varying(32)` | yes | — | INTERNAL | Why the session ended: logout, user termination, expiry, replacement, provider logout or inactivity, refresh rejection, principal disablement or principal mismatch. | The session has not been revoked. | — |

### Constraints and indexes

| Object | Physical definition | Purpose |
| --- | --- | --- |
| `human_sessions_absolute_after_creation` | `CHECK (((absolute_expires_at > created_at) AND (absolute_expires_at <= (created_at + '12:00:00'::interval))))` | Absolute expiry follows creation by at most the selected 12-hour maximum. |
| `human_sessions_idle_bounds` | `CHECK (((idle_timeout_seconds >= 60) AND (idle_timeout_seconds <= 7200)))` | Inactivity bound stays between one minute and the two-hour operator maximum. |
| `human_sessions_pkey` | `PRIMARY KEY (id)` | Unique session identity. |
| `human_sessions_principal_id_fkey` | `FOREIGN KEY (principal_id) REFERENCES principals(id) ON UPDATE RESTRICT ON DELETE RESTRICT` | A session belongs to an existing principal; principals cannot be deleted while sessions exist. |
| `human_sessions_revocation_reason_known` | `CHECK (((revocation_reason IS NULL) OR ((revocation_reason)::text = ANY ((ARRAY['LOGOUT'::character varying, 'TERMINATED_BY_USER'::character varying, 'EXPIRED'::character varying, 'REPLACED'::character varying, 'PROVIDER_LOGOUT'::character varying, 'PROVIDER_INACTIVE'::character varying, 'REFRESH_REJECTED'::character varying, 'PRINCIPAL_DISABLED'::character varying, 'PRINCIPAL_MISMATCH'::character varying])::text[]))))` | Revocation reason is one of the documented values. |
| `human_sessions_revocation_state` | `CHECK (((state = 'REVOKED'::"HumanSessionState") = ((revoked_at IS NOT NULL) AND (revocation_reason IS NOT NULL))))` | Revocation instant and reason exist exactly for revoked sessions. |
| `human_sessions_token_hash_sha256` | `CHECK ((octet_length(token_hash) = 32))` | Credential hash is exactly one SHA-256 digest. |
| `human_sessions_principal_state_idx` | `CREATE INDEX human_sessions_principal_state_idx ON public.human_sessions USING btree (principal_id, state)` | Supports counting and listing a principal's sessions by state. |
| `human_sessions_provider_session_idx` | `CREATE INDEX human_sessions_provider_session_idx ON public.human_sessions USING btree (provider_session_id)` | Supports back-channel logout by provider session identifier. |
| `human_sessions_token_hash_key` | `CREATE UNIQUE INDEX human_sessions_token_hash_key ON public.human_sessions USING btree (token_hash)` | One session per cookie credential; supports lookup by credential hash. |

## oidc_login_attempts

Single-use binding between a browser login-attempt cookie and the OIDC state, nonce and PKCE verifier of one authorization request.

Owner: Identity. Classification: RESTRICTED.

Lifecycle: Created when a login starts, consumed once by the callback and expired after 10 minutes; expired rows are retained until a cleanup rule is approved.

| Column | PostgreSQL type | Nullable | Default | Classification | Meaning | Null meaning | Unit |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `id` | `uuid` | no | — | INTERNAL | Backend-generated attempt UUID that binds the sealed secrets. | — | — |
| `handle_hash` | `bytea` | no | — | RESTRICTED | SHA-256 of the random login-attempt cookie value. | — | — |
| `state` | `character varying(128)` | no | — | INTERNAL | OIDC state value expected back at the callback. | — | — |
| `secrets` | `bytea` | no | — | RESTRICTED | PKCE code verifier and OIDC nonce sealed with AES-256-GCM and bound to the attempt ID. | — | — |
| `return_to` | `character varying(2048)` | no | — | INTERNAL | Validated same-origin relative path to open after a successful login. | — | — |
| `requested_assurance` | `character varying(64)` | yes | — | INTERNAL | Authentication context class (acr) this login requested, such as the strong teluni-aal2 level for step-up. | A standard login without a requested level. | — |
| `max_age_seconds` | `integer` | yes | — | INTERNAL | Maximum authentication age requested from the provider; 0 forces a new authentication for recent-authentication checks. | No maximum age was requested. | seconds |
| `created_at` | `timestamp(3) with time zone` | no | `CURRENT_TIMESTAMP` | INTERNAL | PostgreSQL-clock instant the login started. | — | UTC instant, millisecond precision |
| `expires_at` | `timestamp(3) with time zone` | no | — | INTERNAL | Instant after which the callback can no longer consume the attempt. | — | UTC instant, millisecond precision |
| `consumed_at` | `timestamp(3) with time zone` | yes | — | INTERNAL | Instant the callback consumed the attempt; a second use is rejected. | The attempt has not been used. | UTC instant, millisecond precision |

### Constraints and indexes

| Object | Physical definition | Purpose |
| --- | --- | --- |
| `oidc_login_attempts_expiry_bounds` | `CHECK (((expires_at > created_at) AND (expires_at <= (created_at + '00:10:00'::interval))))` | An attempt expires after creation and within 10 minutes. |
| `oidc_login_attempts_handle_sha256` | `CHECK ((octet_length(handle_hash) = 32))` | Handle hash is exactly one SHA-256 digest. |
| `oidc_login_attempts_max_age_bounds` | `CHECK (((max_age_seconds IS NULL) OR (max_age_seconds >= 0)))` | Requested maximum authentication age cannot be negative. |
| `oidc_login_attempts_pkey` | `PRIMARY KEY (id)` | Unique attempt identity. |
| `oidc_login_attempts_return_relative` | `CHECK (((return_to)::text ~ '^/'::text))` | Return path is relative to the panel origin. |
| `oidc_login_attempts_state_nonblank` | `CHECK (((state)::text ~ '^[A-Za-z0-9_-]+$'::text))` | State uses the base64url alphabet and cannot be blank. |
| `oidc_login_attempts_handle_hash_key` | `CREATE UNIQUE INDEX oidc_login_attempts_handle_hash_key ON public.oidc_login_attempts USING btree (handle_hash)` | One attempt per browser handle; supports consumption by handle. |

## backchannel_logout_replays

Identifiers of accepted provider logout tokens, kept to reject a replayed token.

Owner: Identity. Classification: INTERNAL.

Lifecycle: Inserted when a logout token is accepted; rows past expires_at may be deleted because the token is then too old to be accepted.

| Column | PostgreSQL type | Nullable | Default | Classification | Meaning | Null meaning | Unit |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `jti` | `character varying(255)` | no | — | INTERNAL | Unique identifier (jti) of an accepted logout token. | — | — |
| `received_at` | `timestamp(3) with time zone` | no | `CURRENT_TIMESTAMP` | INTERNAL | PostgreSQL-clock instant the token was accepted. | — | UTC instant, millisecond precision |
| `expires_at` | `timestamp(3) with time zone` | no | — | INTERNAL | Instant after which the token would fail the five-minute age check, so its record is no longer needed. | — | UTC instant, millisecond precision |

### Constraints and indexes

| Object | Physical definition | Purpose |
| --- | --- | --- |
| `backchannel_logout_replays_expiry_after_receipt` | `CHECK ((expires_at > received_at))` | A replay record expires after it was received. |
| `backchannel_logout_replays_pkey` | `PRIMARY KEY (jti)` | Each logout token is accepted at most once. |

## Database enums

| Enum | Values | Meaning |
| --- | --- | --- |
| `HumanSessionState` | PENDING_LIMIT, ACTIVE, REVOKED | Server-managed session state: PENDING_LIMIT, ACTIVE or REVOKED. |
| `PrincipalStatus` | ACTIVE, DISABLED | Global principal state: ACTIVE or DISABLED. |
