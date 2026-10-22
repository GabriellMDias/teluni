# Teluni Company Invitation and Durable Email Delivery Design

[Identity and access policies](identity-and-access.md) · [Tenant data design](tenant-data-design.md) · [Identity and session design](identity-session-design.md) · [ADR-0026](../adr/0026-propose-a-postgresql-outbox-and-smtp-relay-for-transactional-email.md) · [Delivery policy](../architecture/delivery-and-side-effects.md) · [PH-21](human-actions.md#ph-21)

## Status and scope

**Approved detailed design for D-13, 2026-10-18.** The owner approved all ten [decisions for review](#decisions-for-review) as proposed, including ADR-0026, under [PH-21](human-actions.md#ph-21), and asked for implementation. Approval authorizes implementation in local and CI environments with synthetic addresses and Mailpit; [implementation status](#implementation-status) records what exists. It specifies company invitations (the selected invitation policy and IA-02) on top of the approved [tenant data design](tenant-data-design.md) and [identity and session design](identity-session-design.md), and the durable transactional-email mechanism they need, whose architectural direction [ADR-0026](../adr/0026-propose-a-postgresql-outbox-and-smtp-relay-for-transactional-email.md) proposes. The approved decisions are listed under [decisions for review](#decisions-for-review).

In scope: who may invite whom and with which access, the invitation lifecycle, the invitation credential and link, acceptance by a verified identity, revalidation, abuse limits, the outbound-mail outbox and dispatcher, SMTP delivery, failure handling, retention, observability and verification. Out of scope: account registration, email verification and password recovery, which Keycloak performs under D-02 and PJ-24; Keycloak's own mail delivery (see [Keycloak mail](#keycloak-mail)); choosing the real mail provider, sender domain and DNS authentication, which remain [PH-17](human-actions.md#ph-17); and legal retention periods, which remain [PH-13](human-actions.md#ph-13).

## Policy inputs

The design applies these selected policies without changing them:

- Company invitations are recipient-bound, single-use, revocable and valid for seven days; a resend invalidates the previous pending invitation; acceptance requires the matching authenticated identity and explicit membership confirmation; changing the recipient requires a new invitation ([identity and access](identity-and-access.md#enrollment-and-account-continuity)).
- Email verification establishes mailbox control, not legal identity or company ownership, and accounts are never merged solely by equal email.
- Company administrators invite with company scope; branch managers invite operators to their own branches without granting authority beyond their own ([permission matrix](identity-and-access.md#permission-model-and-default-matrix)). New administrators require the responsible administrator's approval (P10) with strong authentication no older than five minutes (P14). Temporary access expires explicitly and is never renewed automatically (P30).
- Credentials in URLs are allowed only as short-lived, high-entropy, single-purpose values whose exposure is understood; reset and invitation links are `RESTRICTED` ([authentication policy](../security/authentication.md)). Retry, duplicate request, delivery failure and expiry must stay safe for email-based flows.
- A durable required side effect records its intent in the same transaction as the change, and consumers tolerate duplicates ([delivery policy](../architecture/delivery-and-side-effects.md)).

## Who may invite

An invitation carries exactly one grant request with the same shape as a direct grant: a standard role, either the whole company or one to 100 explicit active branches of the company, and an optional grant expiry. The rules mirror direct grants:

| Inviter | May invite | Conditions |
| --- | --- | --- |
| Company administrator (strongly authenticated) | Operator or branch manager, company-wide or for any active branches | Company active |
| Responsible administrator | Additionally company administrator, always company-wide | Strong authentication no older than five minutes; the invitation is the P10 approval |
| Branch manager (strongly authenticated) | Operator only, for a subset of the branches the manager currently manages | Never company-wide, never another role |
| Operator | Nobody | — |

A new capability, `invitations.manage`, is company-wide for administrators and branch-scoped for managers. Administrators see and manage every invitation of the company; a branch manager sees and manages only invitations whose whole branch scope lies inside the branches they currently manage. Invitation lists are paginated and cursor-bound like other company lists.

At invitation time the system never looks up principals by email: it neither reveals whether the address belongs to an account or a member nor links anything by address. The address binds only the later acceptance.

## Invitation lifecycle

```text
PENDING ──accept──▶ ACCEPTED
   │ ├──revoke──▶ REVOKED
   │ ├──resend──▶ REPLACED   (a new PENDING invitation takes its place)
   │ └──7 days──▶ EXPIRED    (recorded lazily; an expired row is never accepted)
```

- **Create.** Validates the recipient address (trimmed, at most 254 characters, one `@`, compared in lower case) and the grant request, then inserts the invitation, enqueues its email in the same transaction and writes one `invitation.created` audit event. A company has at most one pending invitation per normalized address (a partial unique index); creating another returns `INVITATION_PENDING`, and the panel offers resend instead.
- **Resend.** Marks the pending invitation `REPLACED`, cancels its unsent email, and creates a new invitation with a new credential and a new seven-day validity, in one transaction. The old link stops working immediately.
- **Revoke.** Marks the pending invitation `REVOKED` and cancels its unsent email. Revoking a final invitation is a no-op.
- **Expire.** Validity ends seven days after creation. Reads treat an expired pending row as expired, and every invitation write in the company first records its expired pending rows as `EXPIRED`, so a new invitation to the same address is never blocked by an expired one and no scheduled job is needed for correctness.
- **Accept.** See [acceptance](#acceptance). Acceptance is idempotent for the principal that accepted: repeating it returns the same result, so a lost response can be retried safely.

Every change writes its audit event in the same transaction. Audit details are allowlisted (invitation ID, role, scope, branch count, grant expiry, replaced invitation ID) and never contain the recipient address, so later erasure of the address does not require editing append-only audit rows.

Authority-changing writes follow tenant data design rule 5: the company row is locked first, then the invitation row, then the involved membership rows in ID order, and the actor's current access is rechecked inside the transaction.

## Invitation credential and link

- **Credential.** 32 bytes from the platform CSPRNG, encoded base64url. The invitation stores only its SHA-256 hash, under a unique index used for lookup. The credential is `RESTRICTED`: it never appears in logs, telemetry, errors, audit, analytics, query strings or the panel after acceptance.
- **Delivery copy.** The email must contain the credential, so the outbox row keeps it encrypted with authenticated encryption under a dedicated outbound-mail key ring (key ID stored with the ciphertext, newest key first, older keys readable during rotation). The ciphertext is erased when the message reaches a final state (sent, failed or cancelled). After that, the credential is not recoverable from the database; a lost email is handled by resending, which issues a new credential.
- **Link.** `{public origin}/invitations/accept#{credential}`. The fragment is never sent in HTTP requests or `Referer` headers. The panel reads it, keeps it in the tab's `sessionStorage`, removes it from the address bar with `history.replaceState`, and sends it only in the body of `POST` requests. Sign-in returns to `/invitations/accept` without the credential, and the panel resumes from `sessionStorage`; the stored value is cleared after acceptance, after a final error or when the tab closes.

## Acceptance

1. The invitee opens the link. Without a session, the page explains the invitation and offers sign-in through the existing login flow. Account registration, if the invitee has no account, is D-02's signup flow and is not designed here; until it exists, only people with an existing verified account can accept.
2. With a session, the panel calls a preview operation with the credential. It answers with the company display name, the role, the scope (branch names), any grant expiry, the invitation expiry and the inviter's display name, or with a failure. A preview has no effect.
3. The invitee explicitly confirms. The accept operation then, in one transaction:
   1. finds the invitation by credential hash and locks its company row, the invitation row and the involved membership rows in that order; an unknown credential answers `RESOURCE_NOT_FOUND`, and a final or expired one `INVITATION_NO_LONGER_VALID`;
   2. requires that the session principal's verified email (identity's snapshot from the latest verified sign-in; sign-in already rejects unverified addresses) equals the recipient address case-insensitively, otherwise `INVITATION_RECIPIENT_MISMATCH`, which never reveals the invited address;
   3. revalidates the invitation against current state: the company is active; the inviter is still an active member who could grant this role and scope now (for an administrator invitation, still the responsible administrator; for a manager's invitation, still managing every branch); every branch is still active. If anything fails, the invitation becomes invalid with `INVITATION_NO_LONGER_VALID` rather than being narrowed silently, and the inviter can issue a new one;
   4. applies the membership rule below, inserts the grant with the inviter as grantor, marks the invitation `ACCEPTED`, and writes one `invitation.accepted` audit event.

| Invitee's membership in the company | Result |
| --- | --- |
| None | A new active membership with the invited grant |
| Active | The invited grant is added to the existing membership (an identical effective grant is not duplicated) |
| Suspended | Refused with `MEMBERSHIP_SUSPENDED`; suspension is lifted only by an administrator, never by an invitation |
| Removed | A new active membership; the removed membership stays as history. The membership uniqueness rule becomes `UNIQUE (company_id, principal_id) WHERE status <> 'REMOVED'` |

The invited role's assurance requirement still applies at use: an accepted administrator or branch-manager grant counts only in a strongly authenticated session, so the panel then offers step-up as it does today.

## Abuse limits and content

Invitations send email to arbitrary addresses from Teluni's sender, so they need limits independent of commercial quotas. Proposed initial values, enforced in PostgreSQL in the creating transaction:

- at most 50 invitations created or resent per company in any 24 hours, and at most 100 pending invitations per company;
- at most 3 invitation emails to the same normalized address in any 24 hours across all companies, counted from the invitation rows themselves, so no extra copy of the address exists and the count reveals nothing to other companies;
- the existing per-route request rate limits.

Exceeding a limit answers `RATE_LIMITED` without saying which limit applied. The email contains no inviter-supplied free text. Subject and body are fixed templates in `pt-BR` and `en-US`, chosen by the company's default locale, with a plain-text part and an escaped HTML part. Company and inviter names are inserted as escaped, length-limited text inside fixed wording, and the only link points to the configured public origin. The message says that ignoring it is safe and that it was sent because of a request in the named company. Phishing through tenant-chosen company names remains a residual risk that these limits and PH-17's abuse response mitigate but do not remove.

## Durable email delivery

[ADR-0026](../adr/0026-propose-a-postgresql-outbox-and-smtp-relay-for-transactional-email.md) sets the direction; this section specifies it.

**Ownership.** A new API module, `mail`, owns an `outbound_emails` table, the dispatcher and the SMTP adapter. It is platform-operational infrastructure without its own business meaning: producers own what a message means. Its public port lets a producer enqueue a message with a template key, locale, recipient, allowlisted parameters and an optional secret parameter inside the producer's own database transaction, and cancel a message it enqueued. Organizations is the first producer. The table has no tenant key because future producers (identity notices, platform messages) are not tenant-scoped; each row records its producer and producer reference, and invitation rows reference their message.

**Message states.** `PENDING` (waiting for a first or later attempt), `SENT`, `FAILED` (attempts exhausted or permanent rejection) and `CANCELLED` (cancelled by the producer before sending). A row records attempts, next attempt time, lease expiry, last failure class and the SMTP reply code, never the raw provider text or the message body.

**Dispatcher.** Runs inside the API process when the mail settings are configured, started after the server is ready and stopped during drain. Every few seconds, or when signalled after a commit in the same process, it claims a small batch with `FOR UPDATE SKIP LOCKED`: due `PENDING` rows whose lease is absent or expired, setting a lease of two minutes and incrementing attempts. Several API instances can run it safely; the pilot runs one. For each message it decrypts the secret parameter, renders the templates and submits through SMTP with connection and total timeouts of 30 seconds. Shutdown stops claiming, lets in-flight sends finish within the drain deadline, and leaves the rest to lease expiry.

**Outcomes and retries.**

| SMTP outcome | Result |
| --- | --- |
| Accepted (2xx after `DATA`) | `SENT`, secret erased |
| Permanent rejection (5xx) | `FAILED` immediately, secret erased |
| Transient failure (4xx, connection, TLS or timeout) | Retry after about 1, 5, 15 and 60 minutes, then 3, 6 and 12 hours, with jitter; `FAILED` after the 8th attempt (about 22 hours, well inside the seven-day invitation) |

Retries use the same `Message-ID`, derived from the message ID, so mail clients can recognize repeats. Delivery is at least once: a crash after the relay accepted a message but before `SENT` was recorded sends it again when the lease expires. A duplicate invitation email carries the same still-valid link, so the duplicate is harmless. Bounces after acceptance by the relay and provider webhooks are not handled in this version; the panel shows "sent" as "handed to the mail service", not as delivered.

**Panel feedback.** The invitation list shows each pending invitation's delivery state (waiting, sent, or failed) and offers resend and revoke. A failed delivery never silently disappears.

**Failure windows.** Committing the invitation and its message together closes the commit/publication gap. The relay-accepted/not-recorded gap is the accepted duplicate above. A revoke racing an in-flight send can deliver a link that no longer works, which acceptance rejects. Losing the database after `SENT` loses nothing a resend cannot recreate.

**Transport.** SMTP submission with authentication through the established `nodemailer` library, pinned like other dependencies. Production requires implicit TLS or mandatory STARTTLS with certificate verification; plaintext SMTP is accepted only for loopback or test sinks outside production. The relay is provider-neutral, so PH-17 can choose any service that offers authenticated SMTP submission, and changing provider is a configuration change.

**Configuration concepts.** Relay host and port, TLS mode, username, password (`RESTRICTED`), sender address and display name, and the outbound-mail key ring (`RESTRICTED`). Names are added to the canonical configuration schema when implemented. Like other module requirements, mail stays unmounted outside production until configured, and production refuses to start when a module that requires mail is composed without it. Invitations require mail.

**Observability.** Metrics: messages by state, age of the oldest due `PENDING` message, attempts, send latency, and failures by class. Logs and traces carry message, producer and invitation IDs, never recipient addresses, credentials or bodies. Alert thresholds and channels remain D-09; until then, the oldest pending age and failure counts are visible through metrics.

## Keycloak mail

Keycloak sends its own verification and recovery email synchronously, through the SMTP settings the realm provisioning script writes, and the person can request it again. Teluni configures Keycloak with the same relay and sender. Those messages do not pass through the outbox, and their durability remains Keycloak's behavior, qualified under PJ-24.

## Data and retention

| Data | Classification | Proposed lifecycle (provisional until PH-13) |
| --- | --- | --- |
| Invitation credential | `RESTRICTED` | Never stored in plaintext; the hash lives with the invitation; the encrypted delivery copy is erased at the message's final state |
| Recipient address on the invitation | `CONFIDENTIAL` (personal data) | Kept while pending and for 90 days after the invitation becomes final, then replaced by a tombstone; the invitation row and its audit events remain |
| Outbound message row (recipient, parameters, status) | `CONFIDENTIAL` | Deleted 30 days after reaching a final state |
| Audit events | `CONFIDENTIAL` | Append-only, without recipient addresses, under the existing audit rules |

Cleanup runs in the dispatcher's loop as bounded batches, with the same claiming rules. Backups keep copies until their own expiry under PH-10/PH-13. Real customer addresses are not processed before PH-13's notices and PH-17's approved sender exist; local and CI environments use synthetic addresses and Mailpit only.

## Contracts

Proposed operations, finalized with the implementation and generated into OpenAPI and the SDK:

| Operation | Purpose |
| --- | --- |
| `POST /companies/{companyId}/invitations` | Create an invitation (recipient, role, scope, branches, optional grant expiry) |
| `GET /companies/{companyId}/invitations` | Paginated invitations visible to the caller, with delivery state |
| `POST /companies/{companyId}/invitations/{invitationId}/resend` | Replace a pending invitation with a new one |
| `POST /companies/{companyId}/invitations/{invitationId}/revoke` | Revoke a pending invitation |
| `POST /invitations/preview` | Describe the invitation a credential refers to (session required, credential in the body) |
| `POST /invitations/accept` | Accept it (session required, credential in the body) |

New public error codes: `INVITATION_PENDING` and `INVITATION_NO_LONGER_VALID` (409), `INVITATION_RECIPIENT_MISMATCH` (403) and `MEMBERSHIP_SUSPENDED` (409), in addition to the existing access, validation, assurance and rate-limit codes. The panel adds an invite form and an invitation list to the members view and an acceptance page.

## Verification

Integration tests against migrated PostgreSQL, the synthetic two-company fixture and a disposable Mailpit:

1. IA-02: the verified recipient accepts once within seven days; a wrong recipient, replay by another principal, and revoked, replaced or expired invitations fail; a repeated acceptance by the same principal returns the same result; no account is linked by email.
2. Inviter scope: managers cannot invite beyond operators or outside their branches; non-responsible administrators cannot invite administrators; stale assurance is rejected; cross-company identifiers answer not found.
3. Revalidation: acceptance fails after the inviter loses authority or responsibility, after a branch is archived and after company suspension; nothing is narrowed silently.
4. Membership cases: none, active, suspended and removed, with the partial uniqueness rule.
5. Atomicity: a failed invitation insert enqueues no message; revoke and resend cancel unsent messages; audit events commit exactly once.
6. Delivery: Mailpit receives the rendered `pt-BR` and `en-US` messages with a working link; injected 4xx, 5xx, timeout and crash-after-accept cases follow the retry table; competing dispatchers never send one claim twice; secrets are erased at final states; no address or credential appears in captured logs.
7. Limits and retention: the per-company, pending and per-address limits; cleanup removes rows on schedule.

A browser journey sends an invitation, reads the message from Mailpit, signs in as the recipient, accepts and sees the company; a second identity with a different address is refused.

## Delivery increments

1. `mail` module: outbox, dispatcher, SMTP adapter, configuration and Mailpit-backed tests.
2. Administrator invitations: create, list, resend and revoke, with the panel's invite form and list.
3. Acceptance: preview and accept operations, the acceptance page, membership cases and the browser journey.
4. Branch-manager invitations of operators within their branches.

Real invitations to real people additionally require PH-17 (sender, domain authentication, provider terms) and PH-13 (notices and retention).

## Implementation status

**Implemented and verified locally on 2026-10-18** (increments 1–4 above), with synthetic addresses and Mailpit only; no real provider, sender domain or recipient is involved.

| Capability | Location | Verification |
| --- | --- | --- |
| `mail` API module: `outbound_emails` outbox, sealed secret parameters under the `TELUNI_MAIL_KEYS` ring, `SKIP LOCKED` leases, retry schedule, final-state erasure, 30-day purge, metrics and allowlisted logs | [`src/features/mail/`](../../apps/api/src/features/mail/module.ts), [migration](../../apps/api/prisma/migrations/20261018040000_mail_outbox/migration.sql), [grants](../../apps/api/prisma/runtime-grants/mail.sql), `TELUNI_MAIL_*` in the [configuration reference](../generated/configuration/api.md) | [Mail suite](../../apps/api/test/mail/integration.test.ts) against migrated PostgreSQL and a disposable Mailpit: real SMTP delivery, rollback, retries to the eighth attempt, permanent rejection, cancellation during an attempt, stale claims, competing dispatchers, purge, no address or secret in logs, runtime-role limits; [unit tests](../../apps/api/test/mail/domain.test.ts) for retry timing and failure classes |
| `invitations` API module (in the organizations feature, so organizations works without mail): create, list, resend, revoke, preview and accept, abuse limits, revalidation, membership cases, address tombstones and the fixed `pt-BR`/`en-US` template | [`invitations-module.ts`](../../apps/api/src/features/organizations/invitations-module.ts), [migration](../../apps/api/prisma/migrations/20261018050000_company_invitations/migration.sql) | [Invitation suite](../../apps/api/test/organizations/invitations.test.ts): IA-02 recipient binding, replay, inviter scopes, stale assurance, resend/revoke, revalidation after suspension, archive and expiry, active/suspended/removed members, limits, atomicity with the audit insert, retention and runtime-role limits |
| Panel: a company Invitations view (invite form, list with delivery state, resend and revoke) for administrators and branch managers, and the `/invitations/accept` page | [`invitations.tsx`](../../apps/web/src/organizations/invitations.tsx) | [Browser component tests](../../apps/web/test/organizations.browser.test.tsx) and the [company journey](../../apps/web/test/e2e/organizations/companies.spec.ts): an administrator invites through the panel, the link is read from Mailpit, another signed-in person is refused, and the invitee signs in and accepts |

Implementation refinements within the approved decisions: the per-address limit counts the invitation rows instead of keeping separate keyed counters, which keeps fewer copies of the address; an acceptance that fails revalidation leaves the invitation pending but unusable rather than recording a new state, and the inviter can revoke or resend it; producer upkeep (expiry marking and address tombstones) runs inside the mail dispatcher's maintenance pass. Not yet done: real sending (PH-17 sender, domain authentication and provider terms; PH-28 notices) and bounce handling. Since 2026-10-22 an invited person without an account creates one from the invitation page and accepts in the same tab, and Keycloak's own mail can use the authenticated relay ([identity status](identity-session-design.md#implementation-status)).

## Decisions for review

The owner approved each item as proposed on 2026-10-18 under [PH-21](human-actions.md#ph-21):

1. **Delivery architecture (ADR-0026).** Application-owned transactional email through a PostgreSQL outbox written in the producer's transaction, an in-process dispatcher in the API, and a provider-neutral authenticated SMTP relay through `nodemailer`; no message broker, separate worker service, provider HTTP API or webhook in this version.
2. **Delivery guarantees.** At least once, with possible duplicates after a crash; up to eight attempts over about 22 hours, immediate failure on permanent rejection, and failures shown to the inviter, who can resend.
3. **Invitation credential.** 256-bit random credential, stored only as a hash; an encrypted copy for delivery under a dedicated key ring, erased at the message's final state; link credential in the URL fragment, removed from the address bar and kept in the tab's session storage during sign-in.
4. **Acceptance identity.** The session principal's verified email must equal the recipient address case-insensitively, with explicit confirmation; principals are never looked up by email at invitation time; until D-02 signup exists, only people with an existing verified account can accept.
5. **Membership cases.** An active member gains the invited grant; a suspended member is refused; a removed person returns as a new membership, which changes membership uniqueness to exclude removed memberships.
6. **Revalidation at acceptance.** The inviter must still be able to grant the invited role and scope, the company and every branch must be active; otherwise the invitation becomes invalid rather than narrowed. A responsibility transfer therefore invalidates the former responsible administrator's pending administrator invitations.
7. **Who invites.** Administrators invite operators and branch managers; only the responsible administrator, with five-minute strong authentication, invites administrators; branch managers invite operators within their own branches; invitations can carry a grant expiry; one pending invitation per company and address, and resend replaces it.
8. **Abuse limits and content.** 50 invitations per company per 24 hours, 100 pending per company, 3 invitation emails per address per 24 hours across Teluni; no free-text message; fixed `pt-BR`/`en-US` templates in the company's default locale.
9. **Retention (provisional until PH-13).** Encrypted credential erased at final state; outbound message rows deleted 30 days after their final state; invitation recipient addresses replaced by a tombstone 90 days after the invitation becomes final; audit events never store the address.
10. **Keycloak mail.** Keycloak keeps sending its own verification and recovery mail synchronously through the same relay, outside the outbox.

Approving these items authorizes implementation in local and CI environments with synthetic addresses and Mailpit. It does not choose the real mail provider or sender domain (PH-17), set legal retention (PH-13) or authorize sending to real people.

## Alternatives considered

| Alternative | Reason not proposed |
| --- | --- |
| Sending email directly in the request, after commit | A crash or relay outage after commit loses the email silently; the delivery policy requires recorded intent for required side effects |
| An existing PostgreSQL job library (for example pg-boss) | It owns its schema and migrations, which would need adapting to the reviewed-migration, metadata and least-privilege grant rules, for a need a small owned table covers |
| A broker or Redis-backed queue | New stateful infrastructure on the single residential host for low volume; PostgreSQL already provides transactional claiming |
| A provider HTTP API with webhooks | Couples the code to one provider before PH-17 selects one and contradicts the no-recurring-procurement constraint; SMTP keeps providers interchangeable |
| Keycloak sending invitations | Keycloak sends only its own account flows; invitations, grants and memberships are application-owned (ADR-0025), and Keycloak Organizations was rejected |
| A credential derived from the invitation ID with a server key | Avoids storing the encrypted copy, but keeps every pending link recomputable from the database plus one key for the whole validity; the erased encrypted copy limits that window to the delivery period |
| Narrowing an invitation when a branch is archived | Silent narrowing grants something different from what the inviter chose; failing and re-inviting keeps the grant explicit |
