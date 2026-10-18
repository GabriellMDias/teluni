# Teluni Risks and Dependencies

[Project documentation](README.md) · [Architecture choices](architecture.md#pending-decisions) · [Human actions](human-actions.md)

This register owns product-delivery risks identified from the owner's brief and the repository baseline. They are prospective risks, not claims of discovered production vulnerabilities. Tasks own implementation progress; human actions own actual owner decisions/access. Review this register at each phase gate and after pilot evidence changes assumptions.

| ID | Risk / consequence | Mitigation and verification | Dependency / activation |
| --- | --- | --- | --- |
| R-01 | Cross-tenant or branch leakage exposes private media or allows unauthorized publication | Threat-model data/reference/cache/media boundaries; negative API and database tests before first tenant slice | D-01/D-02; PJ-03/PJ-08 |
| R-02 | Interrupted publication, storage exhaustion or power loss corrupts programming | Immutable staging, verified assets and durable generation recovery; real power/network tests | D-04/D-05; PJ-09/PJ-11/PJ-12 |
| R-03 | Offline operation preserves revoked or commercially expired content | Explicit offline authorization envelope, expiry/default policy and honest unreachable-device state; test expiry and reconnect | D-03/D-06; PH-09 |
| R-04 | Android TV models differ in codecs, storage, orientation and unattended reboot/startup behavior | Agree supported hardware/profile/update matrix and test physical devices before support promises | D-07; PH-08; PJ-12 |
| R-05 | Residential power, internet/CGNAT, ISP or disk failures make administration/distribution unavailable | Verify network/host capability and secure ingress, communicate pilot limits, exercise offline continuity and plan funded migration | D-08; PH-10; PJ-13 |
| R-06 | Database-only or same-host backups cannot restore complete publications after host loss | Off-host protected database-plus-media backups, consistency/revocation/deletion reconciliation and timed isolated restore | PH-10/PH-13; PJ-13 |
| R-07 | Identity/provider or device-credential mistakes create abuse or unrecoverable enrollment | Established protocols, scoped identities, recovery/revocation design, race/rate-limit tests; no custom crypto | D-02/D-03; PH-11 |
| R-08 | Video traffic/storage/processing and manual support exceed affordable costs | Measure upload/download/storage and support burden; local replay avoids repeated streaming but first downloads/updates still consume uplink | PH-12; PJ-14 |
| R-09 | The single candidate pilot biases the product or has unconfirmed demand | Validate core journeys with the snack bar and later other segments; keep specialized capabilities outside core | PH-08; PJ-14 |
| R-10 | Unapproved visual identity, unverified domain/trademark status, copyright attribution, proprietary material or privacy obligations delay distribution | Apache-2.0 selected; Teluni/`teluni.app` branding direction approved, but final identity approval, domain control and trademark outcomes still require evidence. Preserve inherited rights, confirmed attribution and privacy obligations; no unauthorized PDT Display reuse | PH-06/PH-07/PH-13/PH-14 |
| R-11 | Old/offline players cannot interpret new manifests or reconnect after a host move | Explicit compatibility window, endpoint overlap, controlled app update/recovery and migration rehearsal | D-04/D-07/D-08; PJ-11/PJ-12/PJ-13 |
| R-12 | Product expansion overwhelms MVP delivery and introduces paid services prematurely | Phase exit criteria, device-group/campaign scope review, no mandatory AI/payment/ERP dependency | D-06; PH-09; PJ-15/PJ-16 |
| R-13 | Incorrect time/locale handling displays wrong schedules or prices | Zone-aware shared fixtures, exact monetary semantics and localized presentation separated from rules | D-06/D-10/D-11; PJ-10/PJ-15 |
| R-14 | Proposals, inherited CI configuration or written requirements are mistaken for working product/remote acceptance | Explicit status vocabulary, code-based baseline, local gate evidence and separate remote/hardware/pilot verification | PJ-01; phase gates |
| R-15 | Existing high-severity `source-map-js` advisory may expose affected source-map processing to event-loop denial of service | Triage [Dependabot alert #1](https://github.com/GabriellMDias/teluni/security/dependabot/1), identify affected dependency paths and validate a compatible fix; controls are active but this alert remains open as of 2026-10-17 | PJ-18; outside the licensing/security-activation change |

No numeric probability, severity score, SLA, cost ceiling or residual-risk acceptance is fabricated. Quantify these when pilot/hardware/network evidence is available; the project owner accepts operational/commercial exposure before real-customer operation. None prevents completing the current documentation stage.
