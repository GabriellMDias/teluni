# Teluni Data Handling Policies

[Security and data inventory](security-and-i18n.md#initial-data-inventory) · [Data retention policy](../security/data-retention.md) · [Commercial policies](commercial-policies.md#payment-expiry-cancellation-and-retention) · [Deployment design](deployment-design.md) · [Human actions](human-actions.md#ph-13)

## Status

**Decided on 2026-10-22 under the owner's delegation, pending qualified legal review.** On 2026-10-22 the owner asked the agent to take every pending decision that is only a decision. These are the operating choices of [PH-13](human-actions.md#ph-13): what customers may upload, who answers for what, how long each kind of data is kept, and how export, deletion and incidents work. They are product decisions, not a legal opinion or an LGPD compliance certification. [PH-28](human-actions.md#ph-28) keeps the qualified legal review, the published privacy notice and terms of use, and any change that review requires. Until PH-28 is complete, no real customer data or public signup is accepted (the readiness gates of [operations](operations.md#residential-exposure-and-readiness-gate) and PJ-14 still apply).

## Who answers for what

- **The customer company** chooses what it uploads, shows on its screens and whom it invites. It answers for having the rights to its media and for any personal data in that content, such as photos of its staff or customers.
- **Teluni's operator** runs the service on the customer's behalf for that content. Teluni uses it only to store, convert, publish and show it, and gives it no other use: no analytics on content, no training of models, no sharing.
- **Teluni's operator** decides the data needed to run accounts and security: sign-in identities, memberships, sessions, device credentials, audit, the commercial ledger and operational logs. It keeps only what those purposes need.
- **The legal roles** behind this split (controlador and operador under the LGPD), and the wording that customers accept, are for PH-28 to confirm. The product behaves as described above either way.

## What customers may not upload or show

The terms of use will say this, and the panel's upload screen links to it:

- sensitive personal data (health, biometrics, religious or political opinions and the like), documents identifying people, and payment card data;
- surveillance or security camera footage, and images of identifiable people without their consent;
- content the customer has no right to use, and unlawful content;
- in catalogs and agenda views, only information meant for public display (products, prices, event times), never private records of clients or staff.

Teluni does not inspect content for these rules. A report or complaint is handled through the support channel. The customer is asked to remove the content, and the operator may block its publication when the content is clearly unlawful.

## Retention schedule

Retention runs from the stated trigger. "With the company" means until the company's content is deleted after closure (below). The module designs own the mechanics; this table owns the durations, which confirm the provisional values they recorded.

| Data | Kept | Then | Owner |
| --- | --- | --- | --- |
| Uploads not completed | 1 hour | Discarded | [Media](media-library-design.md) |
| Deleted media | At least 30 days in the trash | Purged unless a published or staged reference still protects it | Media |
| Inactive publication generations | 90 days after being superseded (AT-18) | Manifest and media references pruned; the history row stays with the company | [Publications](publication-sync-design.md#history-restore-and-retention) |
| Screen state reports | 30 days (AT-20) | Deleted | Publications |
| Price publication intents | 30 days after their final state | Deleted | [Catalog design](catalog-composition-design.md) |
| Device enrollments | Unclaimed: 1 day after expiry. Claimed: 30 days after the claim | Deleted | [Devices](device-enrollment-design.md) |
| Outbound email messages | 30 days after their final state; sealed credentials erased at the final state | Deleted | [Mail](invitation-delivery-design.md) |
| Invitation recipient addresses | 90 days after the invitation becomes final | Replaced by a tombstone | Organizations |
| Sessions and login attempts | 30 days after a session ends (expiry, sign-out or termination) or an attempt expires | Deleted; the identity module has no cleanup yet, which PJ-24 adds | [Identity](identity-session-design.md) |
| Organization and module audit events | With the company | Deleted with the company's content, except entries the commercial ledger needs | Organizations, each module |
| Commercial ledger (periods, licenses, settlements; no content) | 5 years after the period ends, until PH-19 and PH-28 confirm the fiscal duration | Deleted | PJ-27 |
| Application logs on the host | 14 days | Rotated out | [Deployment](deployment-design.md#host-administration-and-monitoring) |
| Backups | At most about 35 days | Expired by `restic forget` | [Deployment](deployment-design.md#backups-and-restore) |

**Access records.** If PH-28 confirms that article 15 of the Marco Civil da Internet (Law 12.965/2014) applies to Teluni's operator, sign-in records (time and client address) are kept for 6 months in a restricted store and used only to answer a court order. Until then no client address is stored, as today.

## Company closure

1. A commercial end (trial expiry, cancellation or unpaid grace) starts the 30-day window of the commercial policies. The company is restricted: no editing or publication, but authorized reactivation and export remain.
2. At the end of the window the company is closed. Within 7 days its content is deleted: media objects, catalogs, layouts, programming, publications, device records and audit events. Memberships end, and invitations are erased.
3. Backups age out within about 35 days after that. A restore within that period deletes the closed company again before the service reopens.
4. Screens that still hold the company's content stop showing it when their authorization statement expires, at most seven days after their last renewal (AT-15). A device that is never reconnected keeps its cache until it is reset, as the device design says.

## A person's account

- Leaving or being removed from a company ends the membership. The person's account stays usable for other companies.
- A person may ask, through the support channel, to delete their account. Within 15 days the operator ends their memberships and sessions, deletes their Keycloak user, and replaces their name and email on the application principal with a deletion marker. Audit entries keep the principal's identifier, so past actions stay attributable without the personal details.
- Self-service deletion arrives with the identity workflows of PJ-24.

## Export

A company administrator may request an export at any time while the company is active or restricted. It contains:

- original media files;
- catalogs with fields, items and prices as JSON;
- layouts in the `teluni.layout` format;
- playlists, programs and schedules as JSON;
- the company's audit events.

During the pilot the operator produces it within 7 days of the request and delivers it through an expiring link of at most 7 days, deleting the file afterwards. Self-service export arrives with PJ-27 (CP-10, CP-11).

## Requests from people whose data Teluni holds

Requests to confirm, access, correct or delete personal data arrive through the support email channel. They are answered within 15 days. A request about content a customer uploaded is forwarded to that customer, who decides about its content. PH-28 confirms the procedure and the deadline.

## Incidents

An incident that exposes or loses customer data is contained first. The affected companies' administrators are told by email what happened, what data it touched and what they should do, within 2 business days of confirming it. Records of the incident are kept with the security log. When Teluni's operator must also notify the ANPD or the affected people, PH-28 confirms how and when; the Brazilian regulation currently sets 3 business days.

## Service providers

The deployment uses these providers. PH-28 reviews their terms and the international transfers:

| Provider | Purpose | What it receives |
| --- | --- | --- |
| Resend (United States) | Transactional email | Recipient address, subject and body of invitations and account mail |
| Backblaze B2 (United States) | Off-host backups | restic ciphertext only; the keys stay with the operator |
| Oracle Cloud (relay, only if the line needs it) | Forwarding encrypted traffic | TLS-encrypted bytes and client addresses, which it does not log |
| Google (only when a person chooses Google sign-in) | External sign-in | The sign-in exchange for that person |

## Decisions

The agent took these decisions on 2026-10-22 under the owner's delegation:

1. **Responsibility split.** Customers answer for their content. The operator processes that content only to provide the service, and decides account, security and operational data.
2. **Upload restrictions.** No sensitive personal data, surveillance footage, card data, unlicensed or unlawful content, and only publicly displayable information in catalogs. These are enforced through the terms and complaints, not content scanning.
3. **Retention schedule.** As in the table; it confirms the provisional values the module designs recorded, and adds audit, ledger, log and backup durations.
4. **Company closure.** Content is deleted within 7 days after the 30-day window, and backups age out about 35 days later.
5. **Account deletion.** On request, within 15 days, with pseudonymous attribution kept in audit.
6. **Export.** On request within 7 days during the pilot, through an expiring link.
7. **Requests and incidents.** Requests are answered within 15 days; affected customers are told within 2 business days; the legal notifications are confirmed by PH-28.
8. **Access records.** Kept for 6 months only if PH-28 confirms the legal obligation.
