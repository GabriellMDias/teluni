# Mail Module

This module owns the transactional outbound-email outbox, its dispatcher and the SMTP adapter (ADR-0026). Read the [delivery section of the invitation and email delivery design](../../../../../docs/project/invitation-delivery-design.md#durable-email-delivery) and the [delivery policy](../../../../../docs/architecture/delivery-and-side-effects.md) before changing behavior.

- Producers own what a message means: they register its template and enqueue it through `public.ts` inside their own transaction. Do not add producer-specific wording, rules or tables here.
- Delivery is at least once. Never claim exactly once, and keep every outcome write guarded by the claim's lease and the pending state so a stale dispatcher or a cancellation is never overwritten.
- Secret parameters stay sealed under the mail key ring and are erased at the final state. Recipient addresses, secrets and message bodies never reach logs, spans, metrics or errors; diagnostics carry message IDs and failure classes only.
- Retry timing, attempt limits, lease length and retention live in `domain.ts`; change them with the design, its tests and the schema metadata together.
