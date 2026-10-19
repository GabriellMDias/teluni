# Database Reference

<!-- Generated from migrated PostgreSQL and apps/api/prisma/metadata. Do not edit. -->

[Schema documentation policy](../../database/schema-documentation.md) · [Database principles](../../database/principles.md)

## device_enrollments

A screen's request to be paired: the hash of the credential the player generated, the HMAC of the short code it shows and its report. Platform-scoped until a member claims the code.

Owner: Devices. Classification: RESTRICTED.

Lifecycle: Created PENDING with a ten-minute validity; becomes CLAIMED when a member pairs the code, which creates the device. Expiry is read lazily. Unclaimed rows are deleted one day after expiry and claimed rows 30 days after the claim (provisional until PH-13).

| Column | PostgreSQL type | Nullable | Default | Classification | Meaning | Null meaning | Unit |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `id` | `uuid` | no | — | INTERNAL | Backend-generated enrollment UUID the player polls. | — | — |
| `credential_hash` | `bytea` | no | — | RESTRICTED | SHA-256 of the 256-bit credential the player generated; the credential itself never reaches the server before it is used. | — | — |
| `code_hmac` | `bytea` | no | — | RESTRICTED | HMAC-SHA-256 of the normalized eight-character code under the device code key ring; the code itself is never stored. | — | — |
| `code_key_id` | `character varying(32)` | no | — | INTERNAL | Identifier of the code key ring entry that computed code_hmac. | — | — |
| `report` | `jsonb` | no | — | CONFIDENTIAL | The player's report of its application, model, display and supported rotations, as sent at enrollment. | — | — |
| `status` | `"DeviceEnrollmentStatus"` | no | `'PENDING'::"DeviceEnrollmentStatus"` | INTERNAL | PENDING until a member claims the code, then CLAIMED. | — | — |
| `created_at` | `timestamp(3) with time zone` | no | `CURRENT_TIMESTAMP` | INTERNAL | PostgreSQL-clock instant the enrollment started. | — | UTC instant, millisecond precision |
| `expires_at` | `timestamp(3) with time zone` | no | — | INTERNAL | Instant after which the code can no longer be claimed. | — | UTC instant, millisecond precision |
| `last_polled_at` | `timestamp(3) with time zone` | yes | — | INTERNAL | Latest accepted status poll, which bounds polling to once per interval. | The player has not polled yet. | UTC instant, millisecond precision |
| `claimed_at` | `timestamp(3) with time zone` | yes | — | INTERNAL | PostgreSQL-clock instant a member claimed the code. | The enrollment was not claimed. | UTC instant, millisecond precision |

### Constraints and indexes

| Object | Physical definition | Purpose |
| --- | --- | --- |
| `device_enrollments_claim_state` | `CHECK (((status = 'CLAIMED'::"DeviceEnrollmentStatus") = (claimed_at IS NOT NULL)))` | A claim instant exists exactly for claimed enrollments. |
| `device_enrollments_code_hmac_length` | `CHECK ((octet_length(code_hmac) = 32))` | The stored code HMAC is a SHA-256 digest. |
| `device_enrollments_credential_hash_length` | `CHECK ((octet_length(credential_hash) = 32))` | The stored credential hash is a SHA-256 digest. |
| `device_enrollments_expiry_after_creation` | `CHECK ((expires_at > created_at))` | An enrollment expires after it started. |
| `device_enrollments_pkey` | `PRIMARY KEY (id)` | Unique enrollment identity. |
| `device_enrollments_report_object` | `CHECK ((jsonb_typeof(report) = 'object'::text))` | The report is a JSON object. |
| `device_enrollments_code_key` | `CREATE UNIQUE INDEX device_enrollments_code_key ON public.device_enrollments USING btree (code_hmac)` | Live codes never collide; a colliding new code is regenerated. |
| `device_enrollments_credential_key` | `CREATE UNIQUE INDEX device_enrollments_credential_key ON public.device_enrollments USING btree (credential_hash)` | One credential hash binds at most one enrollment. |
| `device_enrollments_status_expiry_idx` | `CREATE INDEX device_enrollments_status_expiry_idx ON public.device_enrollments USING btree (status, expires_at)` | Counts live pending enrollments and finds expired ones to purge. |

## devices

A paired screen: its identity in one company and branch, configuration, credential hash and unlink/erasure state.

Owner: Devices. Classification: CONFIDENTIAL.

Lifecycle: Created ACTIVE when a member claims an enrollment. Renamed, rotated and moved within the company with optimistic versions. Unlinking makes it REVOKED with erasure PENDING, irreversibly; the screen confirms erasure (CONFIRMED, credential hash deleted) or a member records a controlled reset (RESET_RECORDED). Rows are kept with the company; no runtime deletion.

| Column | PostgreSQL type | Nullable | Default | Classification | Meaning | Null meaning | Unit |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `id` | `uuid` | no | — | INTERNAL | Backend-generated immutable device UUID. | — | — |
| `company_id` | `uuid` | no | — | INTERNAL | Company that owns the device; immutable (tenant key). | — | — |
| `branch_id` | `uuid` | no | — | INTERNAL | Branch the screen is assigned to within its company. | — | — |
| `enrollment_id` | `uuid` | no | — | INTERNAL | Enrollment the device was claimed from; a plain identifier because enrollments are purged. | — | — |
| `name` | `character varying(80)` | no | — | CONFIDENTIAL | Trimmed screen name shown to members. | — | — |
| `rotation` | `integer` | no | — | INTERNAL | Configured clockwise rotation in degrees: 0 and 180 horizontal, 90 and 270 vertical; one the screen reported as supported. | — | degrees |
| `status` | `"DeviceStatus"` | no | `'ACTIVE'::"DeviceStatus"` | INTERNAL | ACTIVE screens use every device operation; REVOKED screens can only learn they must clear and confirm it. | — | — |
| `erasure` | `"DeviceErasure"` | no | `'NONE'::"DeviceErasure"` | INTERNAL | NONE while active; PENDING after unlink; CONFIRMED by the screen or RESET_RECORDED by a member. | — | — |
| `credential_hash` | `bytea` | yes | — | RESTRICTED | SHA-256 of the screen's current credential. | Erasure was confirmed, so the credential no longer authenticates. | — |
| `next_credential_hash` | `bytea` | yes | — | RESTRICTED | SHA-256 of a rotated credential that replaces the current one on first use. | No rotation is pending. | — |
| `report` | `jsonb` | no | — | CONFIDENTIAL | The screen's latest report of its application, model, display and supported rotations; a device statement, not a qualified profile. | — | — |
| `last_seen_at` | `timestamp(3) with time zone` | yes | — | CONFIDENTIAL | Latest authenticated device request, written at most once per minute. | The screen has not called since pairing. | UTC instant, millisecond precision |
| `paired_by_membership_id` | `uuid` | no | — | INTERNAL | Membership that claimed the code. | — | — |
| `paired_at` | `timestamp(3) with time zone` | no | `CURRENT_TIMESTAMP` | INTERNAL | PostgreSQL-clock instant the device was paired. | — | UTC instant, millisecond precision |
| `revoked_at` | `timestamp(3) with time zone` | yes | — | INTERNAL | PostgreSQL-clock instant the device was unlinked. | The device is active. | UTC instant, millisecond precision |
| `erasure_recorded_at` | `timestamp(3) with time zone` | yes | — | INTERNAL | Instant the erasure was confirmed by the screen or the reset was recorded. | No erasure outcome is recorded. | UTC instant, millisecond precision |
| `version` | `integer` | no | `1` | INTERNAL | Optimistic concurrency token incremented once per successful change. | — | successful writes |
| `updated_at` | `timestamp(3) with time zone` | no | `CURRENT_TIMESTAMP` | INTERNAL | PostgreSQL-clock instant of the latest change. | — | UTC instant, millisecond precision |

### Constraints and indexes

| Object | Physical definition | Purpose |
| --- | --- | --- |
| `devices_active_credential` | `CHECK (((status <> 'ACTIVE'::"DeviceStatus") OR (credential_hash IS NOT NULL)))` | An active device always has a credential. |
| `devices_active_state` | `CHECK (((status = 'ACTIVE'::"DeviceStatus") = (erasure = 'NONE'::"DeviceErasure")))` | Exactly the active devices have no erasure state. |
| `devices_company_id_branch_id_fkey` | `FOREIGN KEY (company_id, branch_id) REFERENCES branches(company_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT` | The device's branch belongs to the same company. |
| `devices_company_id_fkey` | `FOREIGN KEY (company_id) REFERENCES companies(id) ON UPDATE RESTRICT ON DELETE RESTRICT` | A device belongs to an existing company. |
| `devices_company_id_paired_by_membership_id_fkey` | `FOREIGN KEY (company_id, paired_by_membership_id) REFERENCES memberships(company_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT` | The pairing membership belongs to the same company. |
| `devices_confirmed_without_credential` | `CHECK (((erasure <> 'CONFIRMED'::"DeviceErasure") OR (credential_hash IS NULL)))` | A confirmed erasure leaves no credential hash. |
| `devices_credential_hash_length` | `CHECK (((credential_hash IS NULL) OR (octet_length(credential_hash) = 32)))` | The stored credential hash is a SHA-256 digest. |
| `devices_erasure_recorded_state` | `CHECK (((erasure = ANY (ARRAY['CONFIRMED'::"DeviceErasure", 'RESET_RECORDED'::"DeviceErasure"])) = (erasure_recorded_at IS NOT NULL)))` | An erasure instant exists exactly for confirmed or recorded erasures. |
| `devices_name_trimmed` | `CHECK ((((name)::text = btrim((name)::text)) AND (char_length((name)::text) >= 1)))` | Names are stored trimmed and nonempty. |
| `devices_next_credential_distinct` | `CHECK (((next_credential_hash IS NULL) OR (next_credential_hash <> credential_hash)))` | A rotation names a different credential. |
| `devices_next_credential_hash_length` | `CHECK (((next_credential_hash IS NULL) OR (octet_length(next_credential_hash) = 32)))` | The stored rotated credential hash is a SHA-256 digest. |
| `devices_pkey` | `PRIMARY KEY (id)` | Unique device identity. |
| `devices_report_object` | `CHECK ((jsonb_typeof(report) = 'object'::text))` | The report is a JSON object. |
| `devices_revocation_state` | `CHECK (((status = 'REVOKED'::"DeviceStatus") = (revoked_at IS NOT NULL)))` | A revocation instant exists exactly for revoked devices. |
| `devices_rotation_pending_only_active` | `CHECK (((status = 'ACTIVE'::"DeviceStatus") OR (next_credential_hash IS NULL)))` | Only active devices can have a pending credential rotation. |
| `devices_rotation_valid` | `CHECK ((rotation = ANY (ARRAY[0, 90, 180, 270])))` | Rotation is a quarter turn. |
| `devices_version_positive` | `CHECK ((version >= 1))` | Versions start at one. |
| `devices_company_branch_status_idx` | `CREATE INDEX devices_company_branch_status_idx ON public.devices USING btree (company_id, branch_id, status)` | Lists a branch's devices and finds active devices before a branch is archived. |
| `devices_company_id_id_key` | `CREATE UNIQUE INDEX devices_company_id_id_key ON public.devices USING btree (company_id, id)` | Tenant key for references to devices. |
| `devices_company_paired_idx` | `CREATE INDEX devices_company_paired_idx ON public.devices USING btree (company_id, paired_at DESC, id DESC)` | Lists a company's devices newest pairing first with stable keyset pagination. |
| `devices_credential_key` | `CREATE UNIQUE INDEX devices_credential_key ON public.devices USING btree (credential_hash)` | Finds a device by credential hash; credentials never collide. |
| `devices_enrollment_key` | `CREATE UNIQUE INDEX devices_enrollment_key ON public.devices USING btree (enrollment_id)` | An enrollment creates at most one device and finds it when the player polls. |
| `devices_next_credential_key` | `CREATE UNIQUE INDEX devices_next_credential_key ON public.devices USING btree (next_credential_hash)` | Finds a device by its rotated credential; credentials never collide. |

## device_claim_failures

Counter rows for failed pairing-code claims, which bound guessing per person and per company.

Owner: Devices. Classification: INTERNAL.

Lifecycle: Inserted on each failed claim; counted over 15 minutes and deleted one day later.

| Column | PostgreSQL type | Nullable | Default | Classification | Meaning | Null meaning | Unit |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `id` | `uuid` | no | — | INTERNAL | Backend-generated failure UUID. | — | — |
| `company_id` | `uuid` | no | — | INTERNAL | Company the failed claim targeted; immutable (tenant key). | — | — |
| `principal_id` | `uuid` | no | — | INTERNAL | Person who attempted the claim. | — | — |
| `occurred_at` | `timestamp(3) with time zone` | no | `CURRENT_TIMESTAMP` | INTERNAL | PostgreSQL-clock instant of the failure. | — | UTC instant, millisecond precision |

### Constraints and indexes

| Object | Physical definition | Purpose |
| --- | --- | --- |
| `device_claim_failures_company_id_fkey` | `FOREIGN KEY (company_id) REFERENCES companies(id) ON UPDATE RESTRICT ON DELETE RESTRICT` | A failure belongs to an existing company. |
| `device_claim_failures_pkey` | `PRIMARY KEY (id)` | Unique failure identity. |
| `device_claim_failures_principal_id_fkey` | `FOREIGN KEY (principal_id) REFERENCES principals(id) ON UPDATE RESTRICT ON DELETE RESTRICT` | A failure belongs to an existing principal. |
| `device_claim_failures_company_id_id_key` | `CREATE UNIQUE INDEX device_claim_failures_company_id_id_key ON public.device_claim_failures USING btree (company_id, id)` | Tenant key of failure rows. |
| `device_claim_failures_company_time_idx` | `CREATE INDEX device_claim_failures_company_time_idx ON public.device_claim_failures USING btree (company_id, occurred_at)` | Counts a company's recent failures. |
| `device_claim_failures_principal_time_idx` | `CREATE INDEX device_claim_failures_principal_time_idx ON public.device_claim_failures USING btree (principal_id, occurred_at)` | Counts a person's recent failures. |

## device_audit_events

Append-only device lifecycle audit: pairing, renaming, rotation, moves, unlinking, erasure confirmation and recorded resets.

Owner: Devices. Classification: CONFIDENTIAL.

Lifecycle: Inserted in the transaction of the change it records; never updated or deleted by the runtime. Retention follows PH-13.

| Column | PostgreSQL type | Nullable | Default | Classification | Meaning | Null meaning | Unit |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `id` | `uuid` | no | — | INTERNAL | Backend-generated event UUID. | — | — |
| `company_id` | `uuid` | no | — | INTERNAL | Company the event belongs to; immutable (tenant key). | — | — |
| `device_id` | `uuid` | no | — | INTERNAL | Device the event is about. | — | — |
| `occurred_at` | `timestamp(3) with time zone` | no | `CURRENT_TIMESTAMP` | INTERNAL | PostgreSQL-clock instant of the change. | — | UTC instant, millisecond precision |
| `actor_principal_id` | `uuid` | yes | — | INTERNAL | Person who made the change. | The device itself confirmed its erasure. | — |
| `actor_membership_id` | `uuid` | yes | — | INTERNAL | Membership through which the person acted. | The device itself confirmed its erasure. | — |
| `action` | `character varying(64)` | no | — | INTERNAL | Event name, such as device.paired or device.unlinked. | — | — |
| `details` | `jsonb` | no | `'{}'::jsonb` | INTERNAL | Allowlisted details such as branch IDs and rotations; never codes, hashes or network addresses. | — | — |

### Constraints and indexes

| Object | Physical definition | Purpose |
| --- | --- | --- |
| `device_audit_events_actor_pair` | `CHECK (((actor_principal_id IS NULL) = (actor_membership_id IS NULL)))` | A person and their membership are recorded together or not at all. |
| `device_audit_events_actor_principal_id_fkey` | `FOREIGN KEY (actor_principal_id) REFERENCES principals(id) ON UPDATE RESTRICT ON DELETE RESTRICT` | The actor is an existing principal. |
| `device_audit_events_company_id_actor_membership_id_fkey` | `FOREIGN KEY (company_id, actor_membership_id) REFERENCES memberships(company_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT` | The acting membership belongs to the same company. |
| `device_audit_events_company_id_device_id_fkey` | `FOREIGN KEY (company_id, device_id) REFERENCES devices(company_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT` | The device belongs to the same company. |
| `device_audit_events_company_id_fkey` | `FOREIGN KEY (company_id) REFERENCES companies(id) ON UPDATE RESTRICT ON DELETE RESTRICT` | An event belongs to an existing company. |
| `device_audit_events_details_object` | `CHECK ((jsonb_typeof(details) = 'object'::text))` | Details are a JSON object. |
| `device_audit_events_pkey` | `PRIMARY KEY (id)` | Unique event identity. |
| `device_audit_events_company_id_id_key` | `CREATE UNIQUE INDEX device_audit_events_company_id_id_key ON public.device_audit_events USING btree (company_id, id)` | Tenant key of device audit events. |
| `device_audit_events_device_time_idx` | `CREATE INDEX device_audit_events_device_time_idx ON public.device_audit_events USING btree (company_id, device_id, occurred_at DESC, id DESC)` | Lists a device's events newest first. |

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
| `display_name` | `character varying(200)` | yes | — | CONFIDENTIAL | Presentation name from the last verified login; never used as identity or authorization evidence. | No bounded display name has been obtained from a verified login. | — |
| `verified_email` | `character varying(320)` | yes | — | CONFIDENTIAL | Presentation email snapshot from the last verified login; never used to link accounts, grant access or accept invitations. | No bounded verified email snapshot has been obtained. | — |

### Constraints and indexes

| Object | Physical definition | Purpose |
| --- | --- | --- |
| `principals_disabled_state` | `CHECK (((status = 'DISABLED'::"PrincipalStatus") = (disabled_at IS NOT NULL)))` | A disablement instant exists exactly for disabled principals. |
| `principals_display_name_nonblank` | `CHECK (((display_name IS NULL) OR (btrim((display_name)::text) <> ''::text)))` | A presentation name, when present, cannot be blank. |
| `principals_issuer_nonblank` | `CHECK (((issuer)::text ~ '^https?://[^[:space:]]+$'::text))` | Issuer is an absolute HTTP(S) URL without whitespace. |
| `principals_pkey` | `PRIMARY KEY (id)` | Unique immutable application principal identity. |
| `principals_subject_nonblank` | `CHECK (((subject)::text ~ '[^[:space:]]'::text))` | Provider subject cannot be blank. |
| `principals_verified_email_nonblank` | `CHECK (((verified_email IS NULL) OR (btrim((verified_email)::text) <> ''::text)))` | A verified-login email snapshot, when present, cannot be blank. |
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

## outbound_emails

Transactional outbox of email messages: a producer records the intent in its own transaction and the dispatcher delivers it through the SMTP relay at least once.

Owner: Mail. Classification: CONFIDENTIAL.

Lifecycle: Created PENDING by a producer; becomes SENT when the relay accepts it, FAILED after a permanent rejection or the last attempt, or CANCELLED by its producer. The sealed secret is erased at the final state, and the row is deleted 30 days later (provisional until PH-13).

| Column | PostgreSQL type | Nullable | Default | Classification | Meaning | Null meaning | Unit |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `id` | `uuid` | no | — | INTERNAL | Backend-generated message UUID; also the stable source of the email Message-ID across retries. | — | — |
| `producer` | `character varying(64)` | no | — | INTERNAL | Capability that enqueued the message and owns its meaning, for example organizations.invitation. | — | — |
| `producer_reference` | `uuid` | no | — | INTERNAL | Identifier of the producer's record the message reports, such as an invitation ID. | — | — |
| `template` | `character varying(64)` | no | — | INTERNAL | Producer-registered template rendered when the message is sent. | — | — |
| `locale` | `character varying(16)` | no | — | INTERNAL | Template locale: pt-BR or en-US. | — | — |
| `recipient` | `character varying(254)` | no | — | CONFIDENTIAL | Normalized recipient address. | — | — |
| `parameters` | `jsonb` | no | — | CONFIDENTIAL | Allowlisted, non-secret template parameters as a JSON object of strings. | — | — |
| `sealed_secret` | `bytea` | yes | — | RESTRICTED | AES-256-GCM sealed secret parameter (such as an invitation credential) under the mail key ring, bound to the message ID. | The message has no secret parameter, or it reached a final state and the secret was erased. | — |
| `status` | `"OutboundEmailStatus"` | no | `'PENDING'::"OutboundEmailStatus"` | INTERNAL | PENDING until sent, failed or cancelled. | — | — |
| `attempts` | `integer` | no | `0` | INTERNAL | Delivery attempts claimed so far, including an attempt interrupted by a crash. | — | attempts |
| `next_attempt_at` | `timestamp(3) with time zone` | no | `CURRENT_TIMESTAMP` | INTERNAL | Earliest instant the dispatcher may claim the pending message again. | — | UTC instant, millisecond precision |
| `lease_expires_at` | `timestamp(3) with time zone` | yes | — | INTERNAL | End of the current dispatcher's claim; also its ownership token when recording the outcome. | No dispatcher has claimed the message yet. | UTC instant, millisecond precision |
| `last_failure` | `character varying(32)` | yes | — | INTERNAL | Class of the latest failed attempt: connection, timeout, tls, authentication, rejected or unexpected. Never raw provider text. | No attempt has failed. | — |
| `last_reply_code` | `integer` | yes | — | INTERNAL | SMTP reply code of the latest failed attempt. | No failure, or the failure carried no SMTP reply. | — |
| `created_at` | `timestamp(3) with time zone` | no | `CURRENT_TIMESTAMP` | INTERNAL | PostgreSQL-clock instant the producer enqueued the message. | — | UTC instant, millisecond precision |
| `finalized_at` | `timestamp(3) with time zone` | yes | — | INTERNAL | PostgreSQL-clock instant the message reached SENT, FAILED or CANCELLED; starts the retention period. | The message is still pending. | UTC instant, millisecond precision |

### Constraints and indexes

| Object | Physical definition | Purpose |
| --- | --- | --- |
| `outbound_emails_attempts_nonnegative` | `CHECK ((attempts >= 0))` | Attempt counts never go negative. |
| `outbound_emails_final_state` | `CHECK (((status = 'PENDING'::"OutboundEmailStatus") = (finalized_at IS NULL)))` | A final instant exists exactly for messages that are no longer pending. |
| `outbound_emails_parameters_object` | `CHECK ((jsonb_typeof(parameters) = 'object'::text))` | Template parameters are a JSON object. |
| `outbound_emails_pkey` | `PRIMARY KEY (id)` | Unique message identity. |
| `outbound_emails_secret_only_pending` | `CHECK (((status = 'PENDING'::"OutboundEmailStatus") OR (sealed_secret IS NULL)))` | A sealed secret survives only while the message is pending. |
| `outbound_emails_due_idx` | `CREATE INDEX outbound_emails_due_idx ON public.outbound_emails USING btree (next_attempt_at) WHERE (status = 'PENDING'::"OutboundEmailStatus")` | Claims due pending messages in order without scanning final ones. |
| `outbound_emails_finalized_idx` | `CREATE INDEX outbound_emails_finalized_idx ON public.outbound_emails USING btree (finalized_at) WHERE (status <> 'PENDING'::"OutboundEmailStatus")` | Finds final messages whose retention period has ended. |
| `outbound_emails_producer_idx` | `CREATE INDEX outbound_emails_producer_idx ON public.outbound_emails USING btree (producer, producer_reference)` | Finds a producer's messages to report delivery state or cancel them. |

## companies

Customer company: the tenant that owns branches, memberships, content, devices and publications.

Owner: Organizations. Classification: CONFIDENTIAL.

Lifecycle: Created ACTIVE by its first responsible administrator; suspension is a state. No runtime deletion; erasure and retention follow PH-13.

| Column | PostgreSQL type | Nullable | Default | Classification | Meaning | Null meaning | Unit |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `id` | `uuid` | no | — | INTERNAL | Backend-generated immutable company UUID; the tenant identifier and public resource ID. | — | — |
| `display_name` | `character varying(120)` | no | — | CONFIDENTIAL | Company name shown to its members. | — | — |
| `status` | `"CompanyStatus"` | no | `'ACTIVE'::"CompanyStatus"` | INTERNAL | ACTIVE companies allow protected operations; SUSPENDED denies them to members. | — | — |
| `default_locale` | `character varying(10)` | no | — | INTERNAL | Default interface locale for the company: pt-BR or en-US. | — | — |
| `time_zone` | `character varying(64)` | no | — | INTERNAL | Default IANA time zone for new branches; business time never uses the host time zone. | — | — |
| `version` | `integer` | no | `1` | INTERNAL | Optimistic concurrency token incremented once per successful settings change. | — | successful writes |
| `created_by_principal_id` | `uuid` | no | — | CONFIDENTIAL | Principal who created the company and became its first responsible administrator. | — | — |
| `creation_key` | `character varying(200)` | no | — | INTERNAL | Creator-supplied idempotency key, unique per creator, that makes company creation safely repeatable. | — | — |
| `creation_fingerprint` | `character(64)` | no | — | CONFIDENTIAL | Immutable SHA-256 fingerprint of the normalized original creation inputs; retries compare it rather than mutable company settings. Not exposed in the API. | — | — |
| `created_at` | `timestamp(3) with time zone` | no | `CURRENT_TIMESTAMP` | INTERNAL | PostgreSQL-clock creation instant. | — | UTC instant, millisecond precision |
| `updated_at` | `timestamp(3) with time zone` | no | `CURRENT_TIMESTAMP` | INTERNAL | PostgreSQL-clock instant of the latest settings change; not audit history. | — | UTC instant, millisecond precision |

### Constraints and indexes

| Object | Physical definition | Purpose |
| --- | --- | --- |
| `companies_created_by_principal_id_fkey` | `FOREIGN KEY (created_by_principal_id) REFERENCES principals(id) ON UPDATE RESTRICT ON DELETE RESTRICT` | The creator is an existing principal. |
| `companies_creation_fingerprint_format` | `CHECK ((creation_fingerprint ~ '^[0-9a-f]{64}$'::text))` | Creation fingerprints are lowercase SHA-256 hex values. |
| `companies_creation_key_format` | `CHECK (((creation_key)::text ~ '^[A-Za-z0-9._~-]+$'::text))` | Creation keys use the documented opaque ASCII alphabet. |
| `companies_default_locale_supported` | `CHECK (((default_locale)::text = ANY ((ARRAY['pt-BR'::character varying, 'en-US'::character varying])::text[])))` | Only the supported interface locales. |
| `companies_display_name_nonblank` | `CHECK (((display_name)::text ~ '[^[:space:]]'::text))` | Company name cannot be blank. |
| `companies_pkey` | `PRIMARY KEY (id)` | Unique immutable company identity. |
| `companies_time_zone_nonblank` | `CHECK (((time_zone)::text ~ '^[A-Za-z][A-Za-z0-9_+/-]*$'::text))` | Time zone has the IANA identifier shape; the API validates it against the runtime's zone database. |
| `companies_version_positive` | `CHECK ((version > 0))` | Rejects invalid concurrency versions. |
| `companies_creator_key_unique` | `CREATE UNIQUE INDEX companies_creator_key_unique ON public.companies USING btree (created_by_principal_id, creation_key)` | One company per creator and creation key, including racing retries. |

## branches

Branch of a company: a location with its own business time zone, assigned members and, later, devices.

Owner: Organizations. Classification: CONFIDENTIAL.

Lifecycle: Created ACTIVE; archived rather than deleted so references remain valid.

| Column | PostgreSQL type | Nullable | Default | Classification | Meaning | Null meaning | Unit |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `id` | `uuid` | no | — | INTERNAL | Backend-generated immutable branch UUID; public resource ID. | — | — |
| `company_id` | `uuid` | no | — | INTERNAL | Owning company; immutable (tenant key). | — | — |
| `name` | `character varying(120)` | no | — | CONFIDENTIAL | Branch name, unique among the company's active branches regardless of case. | — | — |
| `time_zone` | `character varying(64)` | no | — | INTERNAL | IANA time zone for the branch's local business time. | — | — |
| `status` | `"BranchStatus"` | no | `'ACTIVE'::"BranchStatus"` | INTERNAL | ACTIVE branches are usable; ARCHIVED branches are retained for references. | — | — |
| `version` | `integer` | no | `1` | INTERNAL | Optimistic concurrency token incremented once per successful change. | — | successful writes |
| `created_at` | `timestamp(3) with time zone` | no | `CURRENT_TIMESTAMP` | INTERNAL | PostgreSQL-clock creation instant. | — | UTC instant, millisecond precision |
| `updated_at` | `timestamp(3) with time zone` | no | `CURRENT_TIMESTAMP` | INTERNAL | PostgreSQL-clock instant of the latest change; not audit history. | — | UTC instant, millisecond precision |

### Constraints and indexes

| Object | Physical definition | Purpose |
| --- | --- | --- |
| `branches_company_id_fkey` | `FOREIGN KEY (company_id) REFERENCES companies(id) ON UPDATE RESTRICT ON DELETE RESTRICT` | A branch belongs to an existing company. |
| `branches_name_nonblank` | `CHECK (((name)::text ~ '[^[:space:]]'::text))` | Branch name cannot be blank. |
| `branches_pkey` | `PRIMARY KEY (id)` | Unique branch identity. |
| `branches_time_zone_nonblank` | `CHECK (((time_zone)::text ~ '^[A-Za-z][A-Za-z0-9_+/-]*$'::text))` | Time zone has the IANA identifier shape. |
| `branches_version_positive` | `CHECK ((version > 0))` | Rejects invalid concurrency versions. |
| `branches_company_active_name_unique` | `CREATE UNIQUE INDEX branches_company_active_name_unique ON public.branches USING btree (company_id, lower((name)::text)) WHERE (status = 'ACTIVE'::"BranchStatus")` | Active branch names are unique within a company, ignoring case, including racing creations. |
| `branches_company_id_id_key` | `CREATE UNIQUE INDEX branches_company_id_id_key ON public.branches USING btree (company_id, id)` | Tenant key that tenant references target. |
| `branches_company_status_name_idx` | `CREATE INDEX branches_company_status_name_idx ON public.branches USING btree (company_id, status, name)` | Supports listing a company's branches by state and name. |

## memberships

A principal's membership in one company; access comes only from its unexpired grants.

Owner: Organizations. Classification: CONFIDENTIAL.

Lifecycle: Created ACTIVE; company administrators may suspend, reactivate or terminally remove membership with an observed version. Responsibility and the last active administrator are protected. Historical attribution is retained; no runtime deletion.

| Column | PostgreSQL type | Nullable | Default | Classification | Meaning | Null meaning | Unit |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `id` | `uuid` | no | — | INTERNAL | Backend-generated membership UUID. | — | — |
| `company_id` | `uuid` | no | — | INTERNAL | Company of the membership; immutable (tenant key). | — | — |
| `principal_id` | `uuid` | no | — | CONFIDENTIAL | Member principal; a principal may hold memberships in several companies that never see each other. | — | — |
| `status` | `"MembershipStatus"` | no | `'ACTIVE'::"MembershipStatus"` | INTERNAL | Only ACTIVE memberships grant access. | — | — |
| `version` | `integer` | no | `1` | INTERNAL | Optimistic concurrency token for membership changes. | — | successful writes |
| `created_at` | `timestamp(3) with time zone` | no | `CURRENT_TIMESTAMP` | INTERNAL | PostgreSQL-clock creation instant. | — | UTC instant, millisecond precision |
| `updated_at` | `timestamp(3) with time zone` | no | `CURRENT_TIMESTAMP` | INTERNAL | PostgreSQL-clock instant of the latest change. | — | UTC instant, millisecond precision |

### Constraints and indexes

| Object | Physical definition | Purpose |
| --- | --- | --- |
| `memberships_company_id_fkey` | `FOREIGN KEY (company_id) REFERENCES companies(id) ON UPDATE RESTRICT ON DELETE RESTRICT` | A membership belongs to an existing company. |
| `memberships_pkey` | `PRIMARY KEY (id)` | Unique membership identity. |
| `memberships_principal_id_fkey` | `FOREIGN KEY (principal_id) REFERENCES principals(id) ON UPDATE RESTRICT ON DELETE RESTRICT` | The member is an existing principal. |
| `memberships_version_positive` | `CHECK ((version > 0))` | Rejects invalid concurrency versions. |
| `memberships_company_id_id_key` | `CREATE UNIQUE INDEX memberships_company_id_id_key ON public.memberships USING btree (company_id, id)` | Tenant key that tenant references target. |
| `memberships_company_principal_current_key` | `CREATE UNIQUE INDEX memberships_company_principal_current_key ON public.memberships USING btree (company_id, principal_id) WHERE (status <> 'REMOVED'::"MembershipStatus")` | At most one current (not REMOVED) membership per principal and company; a removed membership stays as history and the person can return through a new membership. |
| `memberships_principal_status_idx` | `CREATE INDEX memberships_principal_status_idx ON public.memberships USING btree (principal_id, status)` | Supports listing a principal's companies. |

## company_responsibilities

The company's designated responsible administrator, who approves additional administrators (P10).

Owner: Organizations. Classification: CONFIDENTIAL.

Lifecycle: Created with the company; moves to another active administrator only when that successor accepts a pending responsibility transfer.

| Column | PostgreSQL type | Nullable | Default | Classification | Meaning | Null meaning | Unit |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `company_id` | `uuid` | no | — | INTERNAL | Company whose responsibility this row records; one row per company. | — | — |
| `membership_id` | `uuid` | no | — | INTERNAL | Membership of the responsible administrator in the same company. | — | — |
| `assigned_at` | `timestamp(3) with time zone` | no | `CURRENT_TIMESTAMP` | INTERNAL | PostgreSQL-clock instant of the assignment. | — | UTC instant, millisecond precision |

### Constraints and indexes

| Object | Physical definition | Purpose |
| --- | --- | --- |
| `company_responsibilities_company_id_fkey` | `FOREIGN KEY (company_id) REFERENCES companies(id) ON UPDATE RESTRICT ON DELETE RESTRICT` | Responsibility belongs to an existing company. |
| `company_responsibilities_company_id_membership_id_fkey` | `FOREIGN KEY (company_id, membership_id) REFERENCES memberships(company_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT` | The responsible membership belongs to the same company. |
| `company_responsibilities_pkey` | `PRIMARY KEY (company_id)` | Exactly one responsible administrator per company. |
| `company_responsibilities_membership_key` | `CREATE UNIQUE INDEX company_responsibilities_membership_key ON public.company_responsibilities USING btree (company_id, membership_id)` | Supports the composite reference to the responsible membership. |

## access_profiles

Company-customized access profile: a named set of delegable business capabilities that grants can carry instead of a standard role.

Owner: Organizations. Classification: CONFIDENTIAL.

Lifecycle: Created ACTIVE; edited with expected versions, so every holder's access follows the current capabilities; archived rather than deleted, and only when no effective grant holds it.

| Column | PostgreSQL type | Nullable | Default | Classification | Meaning | Null meaning | Unit |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `id` | `uuid` | no | — | INTERNAL | Backend-generated immutable profile UUID; public resource ID. | — | — |
| `company_id` | `uuid` | no | — | INTERNAL | Owning company; immutable (tenant key). | — | — |
| `name` | `character varying(120)` | no | — | CONFIDENTIAL | Profile name, unique among the company's active profiles regardless of case. | — | — |
| `capabilities` | `text[]` | no | — | INTERNAL | Delegable capability names (branches.view, invitations.manage, audit.view, devices.view, devices.manage); company administration is never delegable through a profile. | — | — |
| `status` | `"AccessProfileStatus"` | no | `'ACTIVE'::"AccessProfileStatus"` | INTERNAL | ACTIVE profiles can be granted; ARCHIVED profiles are retained for attribution. | — | — |
| `version` | `integer` | no | `1` | INTERNAL | Optimistic concurrency token incremented once per successful change. | — | successful writes |
| `created_at` | `timestamp(3) with time zone` | no | `CURRENT_TIMESTAMP` | INTERNAL | PostgreSQL-clock creation instant. | — | UTC instant, millisecond precision |
| `updated_at` | `timestamp(3) with time zone` | no | `CURRENT_TIMESTAMP` | INTERNAL | PostgreSQL-clock instant of the latest change; not audit history. | — | UTC instant, millisecond precision |

### Constraints and indexes

| Object | Physical definition | Purpose |
| --- | --- | --- |
| `access_profiles_company_id_fkey` | `FOREIGN KEY (company_id) REFERENCES companies(id) ON UPDATE RESTRICT ON DELETE RESTRICT` | A profile belongs to an existing company. |
| `access_profiles_delegable_capabilities` | `CHECK (((cardinality(capabilities) >= 1) AND (capabilities <@ ARRAY['branches.view'::text, 'invitations.manage'::text, 'audit.view'::text, 'devices.view'::text, 'devices.manage'::text])))` | A profile names at least one capability, all of them delegable. |
| `access_profiles_name_nonblank` | `CHECK ((btrim((name)::text) <> ''::text))` | Profile name cannot be blank. |
| `access_profiles_pkey` | `PRIMARY KEY (id)` | Unique profile identity. |
| `access_profiles_version_positive` | `CHECK ((version >= 1))` | Rejects invalid concurrency versions. |
| `access_profiles_company_active_name_unique` | `CREATE UNIQUE INDEX access_profiles_company_active_name_unique ON public.access_profiles USING btree (company_id, lower((name)::text)) WHERE (status = 'ACTIVE'::"AccessProfileStatus")` | Active profile names are unique within a company, ignoring case. |
| `access_profiles_company_id_id_key` | `CREATE UNIQUE INDEX access_profiles_company_id_id_key ON public.access_profiles USING btree (company_id, id)` | Tenant key that grants target. |

## membership_grants

A standard role or a company-customized access profile granted to a membership over the whole company or explicit branches; grants combine additively.

Owner: Organizations. Classification: CONFIDENTIAL.

Lifecycle: Effective from starts_at until expires_at or revoked_at; company administrators revoke grants, never delete them, and expired or revoked grants are retained for attribution.

| Column | PostgreSQL type | Nullable | Default | Classification | Meaning | Null meaning | Unit |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `id` | `uuid` | no | — | INTERNAL | Backend-generated grant UUID. | — | — |
| `company_id` | `uuid` | no | — | INTERNAL | Company of the grant; immutable (tenant key). | — | — |
| `membership_id` | `uuid` | no | — | INTERNAL | Membership that holds the grant. | — | — |
| `role` | `"AccessRole"` | yes | — | INTERNAL | Standard role preset: COMPANY_ADMINISTRATOR, BRANCH_MANAGER or OPERATOR; capabilities are defined by the application. | The grant carries an access profile instead. | — |
| `scope` | `"GrantScope"` | no | — | INTERNAL | COMPANY covers every branch, including future ones; BRANCHES covers only the listed branches. | — | — |
| `starts_at` | `timestamp(3) with time zone` | no | `CURRENT_TIMESTAMP` | INTERNAL | Instant the grant becomes effective. | — | UTC instant, millisecond precision |
| `expires_at` | `timestamp(3) with time zone` | yes | — | INTERNAL | Instant a temporary grant stops being effective; no automatic renewal. | The grant does not expire. | UTC instant, millisecond precision |
| `granted_by_membership_id` | `uuid` | yes | — | INTERNAL | Membership that granted it, for attribution. | Granted by company creation. | — |
| `created_at` | `timestamp(3) with time zone` | no | `CURRENT_TIMESTAMP` | INTERNAL | PostgreSQL-clock creation instant. | — | UTC instant, millisecond precision |
| `revoked_at` | `timestamp(3) with time zone` | yes | — | INTERNAL | Instant a company administrator revoked the grant; revocation is terminal. | The grant has not been revoked. | UTC instant, millisecond precision |
| `profile_id` | `uuid` | yes | — | INTERNAL | Company-customized access profile whose current capabilities the grant confers. | The grant carries a standard role instead. | — |

### Constraints and indexes

| Object | Physical definition | Purpose |
| --- | --- | --- |
| `membership_grants_company_id_fkey` | `FOREIGN KEY (company_id) REFERENCES companies(id) ON UPDATE RESTRICT ON DELETE RESTRICT` | A grant belongs to an existing company. |
| `membership_grants_company_id_granted_by_membership_id_fkey` | `FOREIGN KEY (company_id, granted_by_membership_id) REFERENCES memberships(company_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT` | The grantor, when present, is a membership of the same company. |
| `membership_grants_company_id_membership_id_fkey` | `FOREIGN KEY (company_id, membership_id) REFERENCES memberships(company_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT` | The holder is a membership of the same company. |
| `membership_grants_company_id_profile_id_fkey` | `FOREIGN KEY (company_id, profile_id) REFERENCES access_profiles(company_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT` | The profile belongs to the same company; mixed-company profiles are unrepresentable. |
| `membership_grants_company_role_scope` | `CHECK (((role <> 'COMPANY_ADMINISTRATOR'::"AccessRole") OR (scope = 'COMPANY'::"GrantScope")))` | Company administration is always company-wide. |
| `membership_grants_expiry_after_start` | `CHECK (((expires_at IS NULL) OR (expires_at > starts_at)))` | A temporary grant expires after it starts. |
| `membership_grants_pkey` | `PRIMARY KEY (id)` | Unique grant identity. |
| `membership_grants_role_or_profile` | `CHECK ((num_nonnulls(role, profile_id) = 1))` | A grant carries exactly one standard role or one access profile. |
| `membership_grants_company_id_id_key` | `CREATE UNIQUE INDEX membership_grants_company_id_id_key ON public.membership_grants USING btree (company_id, id)` | Tenant key that branch scopes target. |
| `membership_grants_membership_idx` | `CREATE INDEX membership_grants_membership_idx ON public.membership_grants USING btree (company_id, membership_id)` | Supports resolving a membership's grants. |
| `membership_grants_profile_idx` | `CREATE INDEX membership_grants_profile_idx ON public.membership_grants USING btree (company_id, profile_id)` | Supports finding the grants that hold a profile. |

## membership_grant_branches

Explicit branches covered by a BRANCHES-scoped grant; new branches never join silently.

Owner: Organizations. Classification: CONFIDENTIAL.

Lifecycle: Written with the grant; retained while the grant exists.

| Column | PostgreSQL type | Nullable | Default | Classification | Meaning | Null meaning | Unit |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `company_id` | `uuid` | no | — | INTERNAL | Company shared by the grant and the branch. | — | — |
| `grant_id` | `uuid` | no | — | INTERNAL | Grant whose scope includes the branch. | — | — |
| `branch_id` | `uuid` | no | — | INTERNAL | Branch covered by the grant. | — | — |

### Constraints and indexes

| Object | Physical definition | Purpose |
| --- | --- | --- |
| `membership_grant_branches_company_id_branch_id_fkey` | `FOREIGN KEY (company_id, branch_id) REFERENCES branches(company_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT` | The branch belongs to the same company; mixed-company scopes are unrepresentable. |
| `membership_grant_branches_company_id_fkey` | `FOREIGN KEY (company_id) REFERENCES companies(id) ON UPDATE RESTRICT ON DELETE RESTRICT` | The scope belongs to an existing company. |
| `membership_grant_branches_company_id_grant_id_fkey` | `FOREIGN KEY (company_id, grant_id) REFERENCES membership_grants(company_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT` | The grant belongs to the same company. |
| `membership_grant_branches_pkey` | `PRIMARY KEY (grant_id, branch_id)` | A branch appears at most once in a grant's scope. |
| `membership_grant_branches_branch_idx` | `CREATE INDEX membership_grant_branches_branch_idx ON public.membership_grant_branches USING btree (company_id, branch_id)` | Supports finding the grants that cover a branch. |

## organization_audit_events

Append-only attributable record of company, branch, membership and grant changes, written in the same transaction as each change.

Owner: Organizations. Classification: CONFIDENTIAL.

Lifecycle: Never updated or deleted by the runtime; retention follows PH-13.

| Column | PostgreSQL type | Nullable | Default | Classification | Meaning | Null meaning | Unit |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `id` | `uuid` | no | — | INTERNAL | Backend-generated event UUID. | — | — |
| `company_id` | `uuid` | no | — | INTERNAL | Company whose change the event records. | — | — |
| `occurred_at` | `timestamp(3) with time zone` | no | `CURRENT_TIMESTAMP` | INTERNAL | PostgreSQL-clock instant of the change. | — | UTC instant, millisecond precision |
| `actor_principal_id` | `uuid` | no | — | CONFIDENTIAL | Principal who performed the change. | — | — |
| `actor_membership_id` | `uuid` | yes | — | INTERNAL | Actor's membership in the company. | The actor had no membership yet, as when creating the company. | — |
| `action` | `character varying(64)` | no | — | INTERNAL | Stable dotted action identifier, such as company.created or branch.archived. | — | — |
| `target_type` | `character varying(32)` | no | — | INTERNAL | Kind of changed resource, such as company or branch. | — | — |
| `target_id` | `uuid` | no | — | INTERNAL | Identifier of the changed resource. | — | — |
| `details` | `jsonb` | no | `'{}'::jsonb` | CONFIDENTIAL | Allowlisted non-secret change details: changed field names and, for branch events, the branch name at the time of the event. Never secrets or full payloads. | — | — |

### Constraints and indexes

| Object | Physical definition | Purpose |
| --- | --- | --- |
| `organization_audit_events_action_format` | `CHECK (((action)::text ~ '^[a-z]+(\.[a-z_]+)+$'::text))` | Actions use the stable dotted identifier format. |
| `organization_audit_events_actor_principal_id_fkey` | `FOREIGN KEY (actor_principal_id) REFERENCES principals(id) ON UPDATE RESTRICT ON DELETE RESTRICT` | The actor is an existing principal. |
| `organization_audit_events_company_id_actor_membership_id_fkey` | `FOREIGN KEY (company_id, actor_membership_id) REFERENCES memberships(company_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT` | The actor membership, when present, belongs to the same company. |
| `organization_audit_events_company_id_fkey` | `FOREIGN KEY (company_id) REFERENCES companies(id) ON UPDATE RESTRICT ON DELETE RESTRICT` | An event belongs to an existing company. |
| `organization_audit_events_details_object` | `CHECK ((jsonb_typeof(details) = 'object'::text))` | Details are always a JSON object. |
| `organization_audit_events_pkey` | `PRIMARY KEY (id)` | Unique event identity. |
| `organization_audit_events_target_type_format` | `CHECK (((target_type)::text ~ '^[a-z_]+$'::text))` | Target types use lowercase identifiers. |
| `organization_audit_events_company_id_id_key` | `CREATE UNIQUE INDEX organization_audit_events_company_id_id_key ON public.organization_audit_events USING btree (company_id, id)` | Tenant key for future references to events. |
| `organization_audit_events_company_time_idx` | `CREATE INDEX organization_audit_events_company_time_idx ON public.organization_audit_events USING btree (company_id, occurred_at DESC, id DESC)` | Supports company-scoped newest-first audit pagination. |

## organization_audit_event_branches

Branches an organization audit event concerns; branch managers read only events whose branches all lie within their own branches.

Owner: Organizations. Classification: CONFIDENTIAL.

Lifecycle: Written with the event; never updated or deleted by the runtime. An event without rows is a company-level operation.

| Column | PostgreSQL type | Nullable | Default | Classification | Meaning | Null meaning | Unit |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `company_id` | `uuid` | no | — | INTERNAL | Company shared by the event and the branch. | — | — |
| `event_id` | `uuid` | no | — | INTERNAL | Audit event that concerns the branch. | — | — |
| `branch_id` | `uuid` | no | — | INTERNAL | Branch the event concerns. | — | — |

### Constraints and indexes

| Object | Physical definition | Purpose |
| --- | --- | --- |
| `organization_audit_event_branches_company_id_branch_id_fkey` | `FOREIGN KEY (company_id, branch_id) REFERENCES branches(company_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT` | The branch belongs to the same company; mixed-company audit scopes are unrepresentable. |
| `organization_audit_event_branches_company_id_event_id_fkey` | `FOREIGN KEY (company_id, event_id) REFERENCES organization_audit_events(company_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT` | The event belongs to the same company. |
| `organization_audit_event_branches_company_id_fkey` | `FOREIGN KEY (company_id) REFERENCES companies(id) ON UPDATE RESTRICT ON DELETE RESTRICT` | The row belongs to an existing company. |
| `organization_audit_event_branches_pkey` | `PRIMARY KEY (event_id, branch_id)` | A branch appears at most once per event. |
| `organization_audit_event_branches_branch_idx` | `CREATE INDEX organization_audit_event_branches_branch_idx ON public.organization_audit_event_branches USING btree (company_id, branch_id)` | Supports finding the events that concern a branch. |

## responsibility_transfers

A responsible administrator's proposal to hand company responsibility to another active administrator; it takes effect only when that successor accepts.

Owner: Organizations. Classification: CONFIDENTIAL.

Lifecycle: Created PENDING; becomes ACCEPTED, DECLINED by the successor, CANCELLED by the proposer, or EXPIRED after seven days. Retained for attribution; no runtime deletion.

| Column | PostgreSQL type | Nullable | Default | Classification | Meaning | Null meaning | Unit |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `id` | `uuid` | no | — | INTERNAL | Backend-generated transfer UUID. | — | — |
| `company_id` | `uuid` | no | — | INTERNAL | Company whose responsibility would move; immutable (tenant key). | — | — |
| `from_membership_id` | `uuid` | no | — | INTERNAL | Membership of the responsible administrator who proposed the transfer. | — | — |
| `to_membership_id` | `uuid` | no | — | INTERNAL | Membership of the proposed successor, who must still be an active company administrator when accepting. | — | — |
| `status` | `"ResponsibilityTransferStatus"` | no | `'PENDING'::"ResponsibilityTransferStatus"` | INTERNAL | PENDING until the successor accepts or declines, the proposer cancels, or the proposal expires. | — | — |
| `created_at` | `timestamp(3) with time zone` | no | `CURRENT_TIMESTAMP` | INTERNAL | PostgreSQL-clock instant of the proposal. | — | UTC instant, millisecond precision |
| `expires_at` | `timestamp(3) with time zone` | no | — | INTERNAL | Instant after which the pending proposal can no longer be accepted. | — | UTC instant, millisecond precision |
| `decided_at` | `timestamp(3) with time zone` | yes | — | INTERNAL | PostgreSQL-clock instant the proposal stopped being pending. | The proposal is still pending. | UTC instant, millisecond precision |

### Constraints and indexes

| Object | Physical definition | Purpose |
| --- | --- | --- |
| `responsibility_transfers_company_id_fkey` | `FOREIGN KEY (company_id) REFERENCES companies(id) ON UPDATE RESTRICT ON DELETE RESTRICT` | A transfer belongs to an existing company. |
| `responsibility_transfers_company_id_from_membership_id_fkey` | `FOREIGN KEY (company_id, from_membership_id) REFERENCES memberships(company_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT` | The proposer is a membership of the same company. |
| `responsibility_transfers_company_id_to_membership_id_fkey` | `FOREIGN KEY (company_id, to_membership_id) REFERENCES memberships(company_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT` | The successor is a membership of the same company. |
| `responsibility_transfers_decision_state` | `CHECK (((status = 'PENDING'::"ResponsibilityTransferStatus") = (decided_at IS NULL)))` | A decision instant exists exactly for proposals that are no longer pending. |
| `responsibility_transfers_distinct_parties` | `CHECK ((from_membership_id <> to_membership_id))` | A responsible administrator cannot propose themselves. |
| `responsibility_transfers_expiry_after_creation` | `CHECK ((expires_at > created_at))` | A proposal expires after it was made. |
| `responsibility_transfers_pkey` | `PRIMARY KEY (id)` | Unique transfer identity. |
| `responsibility_transfers_company_id_id_key` | `CREATE UNIQUE INDEX responsibility_transfers_company_id_id_key ON public.responsibility_transfers USING btree (company_id, id)` | Tenant key for future references to transfers. |
| `responsibility_transfers_one_pending` | `CREATE UNIQUE INDEX responsibility_transfers_one_pending ON public.responsibility_transfers USING btree (company_id) WHERE (status = 'PENDING'::"ResponsibilityTransferStatus")` | At most one pending transfer per company, including racing proposals. |
| `responsibility_transfers_successor_idx` | `CREATE INDEX responsibility_transfers_successor_idx ON public.responsibility_transfers USING btree (company_id, to_membership_id)` | Supports finding the proposals addressed to a successor. |

## company_invitations

An invitation for a recipient address to join a company with one grant; only the person signed in with that verified address can accept it.

Owner: Organizations. Classification: CONFIDENTIAL.

Lifecycle: Created PENDING with a seven-day validity; becomes ACCEPTED, REVOKED by an inviter, REPLACED by a resend or EXPIRED. The recipient address is replaced by a tombstone (NULL) 90 days after the invitation becomes final (provisional until PH-13); the row and its audit events remain.

| Column | PostgreSQL type | Nullable | Default | Classification | Meaning | Null meaning | Unit |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `id` | `uuid` | no | — | INTERNAL | Backend-generated invitation UUID. | — | — |
| `company_id` | `uuid` | no | — | INTERNAL | Company the invitation admits to; immutable (tenant key). | — | — |
| `recipient_email` | `character varying(254)` | yes | — | CONFIDENTIAL | Trimmed, lower-cased recipient address the accepting identity's verified email must equal. | The invitation is final and its retention period ended, so the address was erased. | — |
| `credential_hash` | `bytea` | no | — | RESTRICTED | SHA-256 hash of the invitation's 256-bit credential; the credential itself is never stored in plaintext. | — | — |
| `role` | `"AccessRole"` | no | — | INTERNAL | Standard role the accepted invitation grants. | — | — |
| `scope` | `"GrantScope"` | no | — | INTERNAL | COMPANY or explicit BRANCHES listed in company_invitation_branches; administration is always company-wide. | — | — |
| `grant_expires_at` | `timestamp(3) with time zone` | yes | — | INTERNAL | Expiry of the granted access once accepted; never renewed automatically (P30). | The granted access does not expire. | UTC instant, millisecond precision |
| `invited_by_membership_id` | `uuid` | no | — | INTERNAL | Membership of the inviter, whose authority is rechecked at acceptance. | — | — |
| `status` | `"InvitationStatus"` | no | `'PENDING'::"InvitationStatus"` | INTERNAL | PENDING until accepted, revoked, replaced or expired. | — | — |
| `message_id` | `uuid` | yes | — | INTERNAL | Outbound email that carries the invitation, owned by the mail module; a soft reference, because the mail module deletes final messages after their retention period. | No message was recorded. | — |
| `replaces_invitation_id` | `uuid` | yes | — | INTERNAL | Pending invitation this one replaced through a resend. | The invitation was not created by a resend. | — |
| `accepted_membership_id` | `uuid` | yes | — | INTERNAL | Membership that received the invited grant on acceptance. | The invitation was not accepted. | — |
| `created_at` | `timestamp(3) with time zone` | no | `CURRENT_TIMESTAMP` | INTERNAL | PostgreSQL-clock instant the invitation was created. | — | UTC instant, millisecond precision |
| `expires_at` | `timestamp(3) with time zone` | no | — | INTERNAL | Instant after which the pending invitation can no longer be accepted. | — | UTC instant, millisecond precision |
| `decided_at` | `timestamp(3) with time zone` | yes | — | INTERNAL | PostgreSQL-clock instant the invitation stopped being pending. | The invitation is still pending. | UTC instant, millisecond precision |

### Constraints and indexes

| Object | Physical definition | Purpose |
| --- | --- | --- |
| `company_invitations_acceptance_state` | `CHECK (((status = 'ACCEPTED'::"InvitationStatus") = (accepted_membership_id IS NOT NULL)))` | Exactly the accepted invitations name the membership that received the grant. |
| `company_invitations_administrator_company_wide` | `CHECK (((role <> 'COMPANY_ADMINISTRATOR'::"AccessRole") OR (scope = 'COMPANY'::"GrantScope")))` | Administration is never branch-scoped. |
| `company_invitations_company_id_accepted_membership_id_fkey` | `FOREIGN KEY (company_id, accepted_membership_id) REFERENCES memberships(company_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT` | The accepting membership belongs to the same company. |
| `company_invitations_company_id_fkey` | `FOREIGN KEY (company_id) REFERENCES companies(id) ON UPDATE RESTRICT ON DELETE RESTRICT` | An invitation belongs to an existing company. |
| `company_invitations_company_id_invited_by_membership_id_fkey` | `FOREIGN KEY (company_id, invited_by_membership_id) REFERENCES memberships(company_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT` | The inviter is a membership of the same company. |
| `company_invitations_company_id_replaces_invitation_id_fkey` | `FOREIGN KEY (company_id, replaces_invitation_id) REFERENCES company_invitations(company_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT` | A resend replaces an invitation of the same company. |
| `company_invitations_credential_hash_length` | `CHECK ((octet_length(credential_hash) = 32))` | The stored credential hash is a SHA-256 digest. |
| `company_invitations_decision_state` | `CHECK (((status = 'PENDING'::"InvitationStatus") = (decided_at IS NULL)))` | A decision instant exists exactly for invitations that are no longer pending. |
| `company_invitations_expiry_after_creation` | `CHECK ((expires_at > created_at))` | An invitation expires after it was created. |
| `company_invitations_grant_expiry_after_creation` | `CHECK (((grant_expires_at IS NULL) OR (grant_expires_at > created_at)))` | A temporary grant ends after the invitation was created. |
| `company_invitations_pending_recipient` | `CHECK (((status <> 'PENDING'::"InvitationStatus") OR (recipient_email IS NOT NULL)))` | A pending invitation always has its recipient address. |
| `company_invitations_pkey` | `PRIMARY KEY (id)` | Unique invitation identity. |
| `company_invitations_recipient_normalized` | `CHECK (((recipient_email)::text = lower(btrim((recipient_email)::text))))` | Recipient addresses are stored trimmed and lower-cased. |
| `company_invitations_company_id_id_key` | `CREATE UNIQUE INDEX company_invitations_company_id_id_key ON public.company_invitations USING btree (company_id, id)` | Tenant key for references to invitations. |
| `company_invitations_company_time_idx` | `CREATE INDEX company_invitations_company_time_idx ON public.company_invitations USING btree (company_id, created_at DESC, id DESC)` | Lists a company's invitations newest first with stable keyset pagination. |
| `company_invitations_credential_key` | `CREATE UNIQUE INDEX company_invitations_credential_key ON public.company_invitations USING btree (credential_hash)` | Finds an invitation by credential hash; credentials never collide. |
| `company_invitations_one_pending` | `CREATE UNIQUE INDEX company_invitations_one_pending ON public.company_invitations USING btree (company_id, recipient_email) WHERE (status = 'PENDING'::"InvitationStatus")` | At most one pending invitation per company and address, including racing requests. |
| `company_invitations_recipient_idx` | `CREATE INDEX company_invitations_recipient_idx ON public.company_invitations USING btree (recipient_email, created_at)` | Counts recent invitations to one address across companies for the abuse limit. |

## company_invitation_branches

Explicit branches of a branch-scoped invitation; all must still be active when it is accepted.

Owner: Organizations. Classification: CONFIDENTIAL.

Lifecycle: Created with its invitation and never changed.

| Column | PostgreSQL type | Nullable | Default | Classification | Meaning | Null meaning | Unit |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `company_id` | `uuid` | no | — | INTERNAL | Owning company; immutable (tenant key). | — | — |
| `invitation_id` | `uuid` | no | — | INTERNAL | Branch-scoped invitation. | — | — |
| `branch_id` | `uuid` | no | — | INTERNAL | A branch the accepted grant will cover. | — | — |

### Constraints and indexes

| Object | Physical definition | Purpose |
| --- | --- | --- |
| `company_invitation_branches_company_id_branch_id_fkey` | `FOREIGN KEY (company_id, branch_id) REFERENCES branches(company_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT` | The branch belongs to the same company. |
| `company_invitation_branches_company_id_fkey` | `FOREIGN KEY (company_id) REFERENCES companies(id) ON UPDATE RESTRICT ON DELETE RESTRICT` | Rows belong to an existing company. |
| `company_invitation_branches_company_id_invitation_id_fkey` | `FOREIGN KEY (company_id, invitation_id) REFERENCES company_invitations(company_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT` | The invitation belongs to the same company. |
| `company_invitation_branches_pkey` | `PRIMARY KEY (invitation_id, branch_id)` | Each branch appears once per invitation. |
| `company_invitation_branches_branch_idx` | `CREATE INDEX company_invitation_branches_branch_idx ON public.company_invitation_branches USING btree (company_id, branch_id)` | Finds invitations that name a branch. |

## Database enums

| Enum | Values | Meaning |
| --- | --- | --- |
| `AccessProfileStatus` | ACTIVE, ARCHIVED | Access profile state: ACTIVE or ARCHIVED. |
| `AccessRole` | COMPANY_ADMINISTRATOR, BRANCH_MANAGER, OPERATOR | Standard role presets: COMPANY_ADMINISTRATOR, BRANCH_MANAGER and OPERATOR. |
| `BranchStatus` | ACTIVE, ARCHIVED | Branch state: ACTIVE or ARCHIVED. |
| `CompanyStatus` | ACTIVE, SUSPENDED | Company state: ACTIVE or SUSPENDED. |
| `DeviceEnrollmentStatus` | PENDING, CLAIMED | Enrollment state: PENDING or CLAIMED. |
| `DeviceErasure` | NONE, PENDING, CONFIRMED, RESET_RECORDED | Erasure state of a device: NONE, PENDING, CONFIRMED or RESET_RECORDED. |
| `DeviceStatus` | ACTIVE, REVOKED | Device state: ACTIVE or REVOKED. |
| `GrantScope` | COMPANY, BRANCHES | Grant scope: COMPANY or explicit BRANCHES. |
| `HumanSessionState` | PENDING_LIMIT, ACTIVE, REVOKED | Server-managed session state: PENDING_LIMIT, ACTIVE or REVOKED. |
| `InvitationStatus` | PENDING, ACCEPTED, REVOKED, REPLACED, EXPIRED | Invitation state: PENDING, ACCEPTED, REVOKED, REPLACED or EXPIRED. |
| `MembershipStatus` | ACTIVE, SUSPENDED, REMOVED | Membership state: ACTIVE, SUSPENDED or REMOVED. |
| `OutboundEmailStatus` | PENDING, SENT, FAILED, CANCELLED | Outbound email state: PENDING, SENT, FAILED or CANCELLED. |
| `PrincipalStatus` | ACTIVE, DISABLED | Global principal state: ACTIVE or DISABLED. |
| `ResponsibilityTransferStatus` | PENDING, ACCEPTED, DECLINED, CANCELLED, EXPIRED | Responsibility transfer state: PENDING, ACCEPTED, DECLINED, CANCELLED or EXPIRED. |
