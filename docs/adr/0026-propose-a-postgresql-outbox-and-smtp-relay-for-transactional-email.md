# ADR-0026: Deliver Transactional Email through a PostgreSQL Outbox and an SMTP Relay

**Status:** proposed
**Date:** 2026-10-18

## Context

Company invitations are the first Teluni workflow that must send email from the application: the selected identity policy requires recipient-bound, single-use invitations valid for seven days, and later notices will need the same capability. Keycloak sends its own verification and recovery messages but cannot send application messages, and memberships and grants are application-owned (ADR-0025).

The [delivery policy](../architecture/delivery-and-side-effects.md) requires a durable required side effect to record its intent with the state change, since sending after commit can lose the effect in a crash and sending before commit can announce a change that never happened. The API currently has no background processing, message broker or outbound-email path. Deployment is a single residential host with Docker Compose and PostgreSQL (ADR-0021), with no recurring procurement budget for identity or email services yet (P03). The real provider, sender domain and DNS authentication are not selected (PH-17), and legal retention is not set (PH-13).

This record decides the delivery mechanism. The invitation rules, credential handling, limits and retention proposals are specified in the [invitation and email delivery design](../project/invitation-delivery-design.md) (D-13).

## Decision

Teluni will deliver transactional email through an application-owned outbox in PostgreSQL and an authenticated SMTP relay:

- A dedicated API capability owns an outbound-message table, a dispatcher and an SMTP adapter. Producers enqueue a message in the same database transaction as the business change it reports, through that capability's public port, and can cancel a message they enqueued. The producing capability owns the meaning of a message; the mail capability owns only delivery.
- The dispatcher runs inside the API process. It claims due messages with row locks and `SKIP LOCKED` under expiring leases, submits them through SMTP, and records sent, failed or cancelled outcomes with bounded retries, so several instances never send one claim twice in normal operation.
- Delivery is at least once. A crash between the relay's acceptance and the local record can send a message again; consumers of the email (people following a link) must tolerate repeats, and exactly-once delivery is not claimed.
- The SMTP client is the established `nodemailer` library. The relay is provider-neutral and configured, with TLS required in production; a provider's proprietary HTTP API or webhooks are not used in this version.
- Message bodies are rendered from fixed templates when sent. Secret parameters are stored encrypted under a dedicated key ring only until the message is final. Recipient addresses and credentials never reach logs or telemetry.

No message broker, separate worker service or job-queue library is introduced. Bounce processing, delivery receipts and a separate worker deployment remain possible later without changing producers.

## Rationale

PostgreSQL is already the system of record and provides transactional enqueueing and concurrent claiming, so the producer's change and its email commit or fail together without a second stateful system on the single host. In-process dispatch adds no deployment unit; when the API is down, messages wait rather than disappear, which fits low pilot volume and residential availability. Leases and `SKIP LOCKED` keep the design correct if more instances run later.

SMTP submission is the most widely supported provider interface, which keeps PH-17 free to choose any service, including one already available to the owner, and keeps a provider change to configuration. `nodemailer` is the long-established Node.js SMTP client and avoids writing protocol code; it is a routine dependency added under the normal review and supply-chain rules.

At-least-once delivery is the honest guarantee for an external effect without provider-side idempotency. For invitations a repeated email contains the same still-valid link, so duplicates are harmless; later producers must state their own tolerance.

## Alternatives Considered

### Send after commit in the request

Simplest, but a crash or relay outage after commit silently loses the message, and retrying inside the request ties panel latency to the relay. Rejected by the delivery policy for required effects.

### PostgreSQL job library

Libraries such as pg-boss provide queues on PostgreSQL, but they own their schema and its migrations. Fitting that schema into the repository's reviewed SQL migrations, semantic metadata and least-privilege runtime grants would need adaptation and ongoing tracking of the library's internal tables. A small owned table covers the current need with explicit semantics. This was assessed from the libraries' documented design, not by a trial integration.

### Broker or Redis-backed queue

Adds stateful infrastructure, backups and monitoring on the single host for low volume, and still needs an outbox to close the commit gap.

### Provider HTTP API with webhooks

Offers delivery events and bounce data, but couples code to one provider before PH-17 selects it and may require paid procurement. Can be reconsidered when a provider is chosen and bounce handling is needed.

## Consequences

### Positive

- An email intent commits or rolls back with the change it reports, and survives restarts and relay outages.
- No new infrastructure beyond the existing API and PostgreSQL; the provider stays replaceable through configuration.
- Delivery state is queryable, so the panel can show failures and offer resend.

### Negative

- Duplicate emails are possible after a crash; every producer must tolerate them.
- Dispatch stops while the API is down, and the API process gains a background loop to drain, monitor and test.
- Without bounce processing, "sent" means accepted by the relay, not delivered to the mailbox.
- The outbox holds personal data and short-lived encrypted secrets, which need retention, cleanup and key rotation.

### Operational or Migration Impact

- New `RESTRICTED` settings (relay credentials and the outbound-mail key ring) and monitoring of queue age and failures. Real sending requires PH-17's sender, domain authentication and provider terms, and PH-13's notices; local and CI use a disposable Mailpit sink.
- Moving dispatch to a separate worker later reuses the same table and claiming rules; adopting a provider API later replaces only the adapter.

## References

- [Invitation and email delivery design (D-13)](../project/invitation-delivery-design.md)
- [Delivery and side effects](../architecture/delivery-and-side-effects.md)
- [Identity and access policies](../project/identity-and-access.md)
- [ADR-0021](0021-propose-a-single-host-pilot-with-portable-persistent-storage.md), [ADR-0024](0024-propose-keycloak-and-server-managed-human-sessions.md), [ADR-0025](0025-propose-application-owned-scoped-access-profiles.md)
- [PH-17](../project/human-actions.md#ph-17), [PH-21](../project/human-actions.md#ph-21)
