# Teluni Human Identity and Access Policies

[Project documentation](README.md) · [Security and internationalization](security-and-i18n.md) · [Provider evaluation](identity-provider-evaluation.md) · [PH-11](human-actions.md#ph-11)

## Status and ownership

**Decided product policies, 2026-10-18:** the owner answered all 38 PH-11 questions directly. This document owns human enrollment, authentication assurance, recovery, sessions, permission allocation and support policy. The inherited [authentication](../security/authentication.md) and [authorization](../security/authorization.md) controls still govern. [Release policies](release-policies.md) own publication/playback behavior; this policy constrains who can trigger it.

**Accepted provider direction:** self-hosted Keycloak, with the [pinned-source compatibility assessment](identity-provider-evaluation.md#pinned-source-assessment) and owner acceptance recorded on 2026-10-18. Actual deployment remains subject to PH-10 host feasibility and PJ-24 integration qualification. No recurring identity/email procurement budget is authorized. This does not establish zero operating cost or an available email service. Google is the only selected external login provider; Microsoft is not part of this delivery.

**Accepted architecture:** the owner explicitly approved [ADR-0024](../adr/0024-propose-keycloak-and-server-managed-human-sessions.md) and [ADR-0025](../adr/0025-propose-application-owned-scoped-access-profiles.md) on 2026-10-18. They do not supersede accepted ADR-0012. **Implemented:** foundation JWT verification only; no product login, provider deployment, session/membership store or permission engine exists. PH-11 is completed for provider/policy/architecture selection; every unperformed integration test remains PJ-03/PJ-24. This documentation does not authorize implementation or external provisioning.

## Enrollment and account continuity

- Support **public registration with automatic company activation** after verification and abuse checks, rather than requiring routine Teluni approval. The new company is separate from every existing company; matching a name, claimed business identifier or email domain never proves control of an existing tenant. Activation does not imply a free plan, trial duration, paid entitlement or unlimited resources. PH-12 must establish eligibility/entitlement/resource rules, and PH-13 the applicable notices, before public activation is opened. A pending prerequisite must not silently turn the selected product into invitation-only onboarding.
- Offer email/password and optional passkeys through the established identity provider, plus optional Google login. Do not make an external social account the sole administrative recovery method. Localized enrollment/login/recovery must support `pt-BR` and `en-US`.
- Require trusted email verification before company access. Company invitations are recipient-bound, single-use, revocable and valid for **seven days**; a resend invalidates the previous pending invitation. Acceptance requires the matching authenticated identity and explicit membership confirmation. Changing recipient requires a new invitation. Verification establishes mailbox control, not legal identity or company ownership.
- Link login methods only through an explicit flow proving the existing account and new method with recent authentication. Never merge accounts solely by equal email. A new email must be verified, the previous address notified and the stable application identity preserved. Method removal must leave a usable method meeting assurance requirements. This applies equally to first Google login and later linking.
- One human identity may hold independent memberships in multiple companies and different scopes/roles within each. Switching company explicitly revalidates access. A company administrator cannot enumerate the person's other companies or manage their global credentials.
- Each company has a **designated responsible administrator** who approves additional company administrators. Other administrators retain the matrix's ordinary administrative capabilities but cannot bypass that approval. Establish the first responsible administrator from the verified automatic signup flow; controlled assisted enrollment may serve support/migration needs without overriding the public-registration decision. Responsibility transfer requires an attributable, strongly authenticated flow and successor acceptance; prevent loss of the last active administrator or responsibility without a valid transfer. Responsibility is a company relationship, not an inferred legal-ownership determination or platform privilege.
- Provision platform administrators through a controlled procedure, outside public signup and tenant administration. Use individual administrative accounts distinct from ordinary customer operation, with phishing-resistant assurance and prepared recovery. Product administration does not grant access to provider administration, infrastructure, database credentials or customer content.

## Assurance, recovery and abuse

Strong authentication is mandatory for platform administrators, company administrators and branch managers. Operators may opt in, and companies can require it for everyone. Any operator/profile granted publication or automatic-price distribution must also meet the strong-authentication requirement. Do not let custom role labels bypass an assurance requirement attached to a capability.

Prefer passkeys with user verification; password plus an authenticator-app second factor is the selected alternative, with protected single-use recovery codes. Platform administration requires a phishing-resistant method and protected recovery. Social login or a generic passkey label does not alone prove equivalent assurance: qualify the actual flow and assertion. Email-only recovery cannot bypass mandatory MFA. Do not use SMS as the default method.

Require strong authentication no more than **five minutes** old when promoting administrators, changing credentials/MFA/email, transferring responsibility, granting support access, exporting in bulk or unlinking/destroying in bulk. Ordinary authorized publication/price operations use the normal compliant session, without a new prompt for every save. Sensitive operations by users without an enrolled adequate factor must first obtain the required assurance. Confirmation dialogs do not constitute authentication.

Use provider-owned password recovery with enumeration-safe public responses. The selected reset-link target is **15 minutes**, single-purpose and single-use; verify exact invalidation semantics in the selected version. Successful password recovery revokes earlier sessions. MFA recovery first uses a valid alternate authenticator or recovery code. Suspected compromise offers global session termination and a support channel.

Complete loss of recovery methods uses exceptional assisted recovery with proportionate evidence, waiting/notification to previous channels, review and audit. The operational procedure, waiting interval, evidence criteria and escalation remain to be reviewed before use; no instant-unlock promise is made. Seek independent review for higher-risk cases when available, without claiming a two-person control in a one-person operation. Insufficient evidence denies access. Do not introduce personal security questions, agent-created temporary passwords or email-only removal of MFA. Company administrators may repair local membership but cannot reset another person's global identity. Prepare a separate accountable recovery path for the sole platform administrator/last responsible company administrator.

Apply context/operation rate limits, progressive delays, enumeration-safe responses and monitoring, without permanent attacker-triggered lockout. Additional challenges need demonstrated need, accessibility/privacy review and cost approval; they are not a default on every interaction. Numerical anti-abuse limits and provider password-policy parameters require technical review rather than invented vendor defaults. No external challenge subscription is authorized.

## Human session lifecycle

| Policy | Selected boundary |
| --- | --- |
| Inactivity | 30 minutes for administrative contexts, including branch-management operation; two hours for operators |
| Absolute session duration | 12 hours; companies may select shorter limits |
| Remember me | Not offered in this delivery; no implicit persistent seven-day human login |
| Concurrent sessions | Up to five per person; at most two platform-administration contexts. On reaching the limit, explicitly choose a session to terminate |
| Recent strong authentication | Five minutes for the sensitive operations above |
| Access-token lifetime target | Five minutes, with independent session/account/membership enforcement |
| Revocation/freshness | Deny new protected operations within 30 seconds of global disablement, session termination or membership removal/reduction; sensitive confirmation uses current state |

List sessions using minimized, justified metadata; allow termination of one or all. Background polling/refresh does not count as human activity and cannot extend absolute duration. Warn before timeout and protect recoverable drafts without leaking them across account/company changes or retaining protected caches after logout. Detailed concurrent-session accounting across provider and application sessions remains design/qualification work.

**Accepted browser architecture, not implemented:** server-managed application sessions with an opaque protected browser cookie; provider access/refresh tokens remain server-side. Compose this capability into the modular backend where appropriate rather than adding a microservice by default. Use established OIDC Authorization Code with PKCE and established session/security components; do not invent token issuance, crypto or password handling. Evaluate `Secure`, `HttpOnly`, `SameSite`, narrow cookie scope, explicit CSRF protection, state/nonce/redirect validation, fixation prevention, refresh rotation/replay/concurrency, logout propagation and token minimization. No cookie names, routes, storage library or environment variables are implemented by this policy.

The internal API bearer boundary remains ADR-0012. A browser cookie must terminate at a reviewed session boundary that obtains the legitimate issuer access token; it is not a second implicit credential accepted by every domain route. The current verifier returns principal ID/scopes, not session or assurance evidence; extend integration contracts deliberately through technical review rather than trusting browser-supplied session IDs, role flags, timestamps or MFA claims.

Validate current application account/session/membership state in addition to JWT signature/expiry to meet the 30-second bound. Cache invalidation, session linkage and sensitive-write race handling need explicit implementation evidence. A valid five-minute JWT alone cannot satisfy that bound. Provider logout and application logout must be reconciled, including reuse/replay and local/global termination. Human logout does not revoke unrelated company memberships or player identities.

On provider, email or session infrastructure failure, unavailable flows report a safe temporary failure. Existing operations continue only while trusted identity, validity and authorization can still be established; otherwise deny protected operations and preserve recoverable work safely. A key/session-store outage is not permission to skip checks. There is no offline administrative panel or public emergency credential. Players retain their independently selected bounded offline policy, not these human-session limits.

## Permission model and default matrix

Support readable default roles plus company-customized profiles built from explicit business capabilities and scopes. The application owns memberships, profiles and resource authorization, not arbitrary provider groups or self-editable identity attributes. Check company, branch, resource, operation, assurance and current state on the server, including background jobs and generated data. This is a product policy; the accepted technical direction is ADR-0025; its concrete mechanism and verification remain implementation work.

Grants combine within their explicit scopes. A person can manage one branch and observe another. A suspended account/membership or expired grant always denies; no grant means deny. Newly created branches do not silently enter a restricted branch grant. Company-wide administrative scope is an explicit grant. Avoid arbitrary negative-rule languages, cyclic inheritance or an unrestricted role shortcut. Grantors cannot confer authority they lack; company grants never confer platform authority. Profile edits must show affected users/scopes and be audited.

In the table, **company** means that company only, **branches** means explicit authorized branches, and **additional grant** is not part of the default role. All ordinary grants are constrained by resource state, lifecycle protections and authentication assurance. P10's responsible-administrator approval takes precedence over the generic administration row.

| Capability | Company administrator | Branch manager | Operator |
| --- | --- | --- | --- |
| General company settings and branches | Company | No | No |
| Manage administrators and profiles | Company; new administrators require responsible-administrator approval | No | No |
| Invite operators | Company | Own branches, without granting authority beyond the manager's | No |
| View content and device state | Company | Branches and explicitly shared resources | Branches and explicitly shared resources |
| Upload media and prepare drafts | Company | Branches | Branches |
| Author layouts, playlists and agendas | Company | Branches | Branches, drafts only |
| Publish or restore a published version | Company | Branches | Additional grant |
| Change prices with automatic publication | Company | Only when authorized for every affected target | Additional grant, with the same impact checks |
| Create shared company catalog/schema | Company | Additional grant | Additional grant |
| Edit records without automatic publication | Company | Authorized branches/resources | Authorized branches/resources, drafts only |
| Pair, move, unlink or reset devices | Company | Authorized source/destination branches and required confirmations | Additional grant |
| Archive or restore permitted resources | Company | Branches, preserving references | Additional grant |
| Permanently delete content | Company, subject to retention/reference controls | No | No |
| View audit | Company | Own branch operations, without other-scope data | No |
| Bulk export | Company, recent strong authentication | Additional grant, recent strong authentication | No |

Share media, layouts and catalogs explicitly with selected branches or the whole company, separating read/use from edit authority. Sharing does not confer publication authority over another branch or expose private referenced records/previews/URLs. Enforce scopes on detail/list/search/count/export, uploads/downloads/previews, imports, manifests, telemetry, caches and bulk requests, not only visible buttons.

Use individual human accounts; no shared shift credentials for writes or viewing private customer information. Support explicit account switching on shared computers. Temporary memberships/grants have explicit start/expiry, no automatic renewal and the same scope/audit controls. Machine integrations require distinct future identities rather than borrowed human credentials.

## Publication impact and delayed work

An authorized designated price save triggers automatic publication under PH-09. Before accepting it, authorize the mutation **and all affected published targets**. If any target is outside scope, **reject the entire price mutation** with a safe explanation. Do not partially distribute it, modify the company base price anyway or create an out-of-scope approval request as an automatic fallback. An explicit authorized branch override may be used only when the model and local impact permit it. A permitted shared edit cannot grant hidden publication power.

Authorized publishers normally publish directly. A company may optionally require independent approval by branch/operation; default is disabled, with no self-approval where required. For covered prices, entering a proposal is not saving an effective price: the authorized approval commits that price and triggers automatic publication. This explicit policy qualifies the PH-09 save behavior without turning ordinary drafts into live content. P27 still requires denying an out-of-scope price mutation; optional approvals do not provide a bypass. Approval-chain configuration must identify eligible reviewers, prevent scope escalation and clearly distinguish proposed, approved, saved, queued and active states. No approval module is implemented or inherited from Orion's removed reference feature.

Revalidate company/actor/target authority before an outstanding intent effects a protected change/publication. If authority has been removed/reduced, block the not-yet-effected intent and require new attributable authorization, retaining original authorship. A valid version already authorized and issued continues its normal delivery lifecycle; removing its author does not automatically cancel company programming. Incident response may revoke specific publications/identities. Revalidation cannot silently expand old targets or allow stale work to overwrite newer generations.

Company administrators remove only the local membership; other memberships and global identity remain. Departure does not delete company content. Global disablement is an identity operation. Company suspension denies new protected server operations, with explicit reconciliation for already-authorized offline players; PH-12 owns commercial/cancellation consequences. Historical attribution remains meaningful subject to PH-13 retention/deletion rules. Never promise instantaneous erasure of unreachable devices.

## Support, audit and continuity

Routine customer-content support requires an explicit company-administrator grant: reason, scope, maximum default duration **one hour**, read-only default and separate write authority. Support uses its own identity, with visible/audited activity; **no impersonation in this delivery**. Platform operations may manage customer lifecycle metadata without implicit content browsing. A support grant never authorizes provider/database/infrastructure access.

Emergency access requires a distinct exceptional procedure with justification, strong authentication, scope, expiry, audit and notification afterward where applicable. It creates no permanent secret user, universal password or unrestricted standing customer-content access. Evidence criteria, available reviewers and execution/revocation steps must be reviewed before use, honestly reflecting team size. A routine support grant is not emergency authority.

Users can review their sessions and receive relevant credential/recovery notices. Company administrators see company-scoped audit; branch managers see only their branch operations. The platform receives minimized events needed for security/operation. Audit invites, grants/profile changes, assurance/recovery/revocation, support, prices/publications and relevant failures with actor/scope/action/outcome, excluding secrets and full payloads. Security-audit retention and metadata such as IP remain PH-13; the PH-09 operational-report retention is not a legal/security retention decision.

Require application-stable principal IDs, application-owned memberships/permissions, isolated environments and synthetic test identities. Back up/restore identity state under PH-10 and reconcile revocations after restoration. Portability is required, but P37=A does **not** require a pre-pilot export/import proof as a separate acceptance gate; qualify migration when selected/needed and document available mechanisms/limits. A migration may require safe password reset or authenticator reenrollment; do not promise export of every factor or session. No production credentials in CI or cross-environment token acceptance.

## Required verification cases

These are specified allow/deny and lifecycle cases, **not executed tests**. PJ-03/PJ-24 own implementation evidence; PJ-07 owns design review.

| Case | Required expected result |
| --- | --- |
| IA-01 — Public enrollment | Verified eligible signup creates a new isolated company and its responsible administrator; cannot claim an existing tenant, set privileged principal claims or gain platform authority |
| IA-02 — Invitation and linking | Correct verified recipient accepts once within seven days; wrong recipient, replay, revoked/replaced/expired invite and email-only account merging fail |
| IA-03 — Company context | One identity uses independently scoped memberships; switching/reusing IDs, mixed-tenant references, collections, counts, downloads and caches cannot cross scope |
| IA-04 — Responsibility | Responsible administrator approves additional administrators; ordinary admin cannot bypass it; last-admin removal and incomplete transfer fail |
| IA-05 — Assurance | Required roles/capabilities cannot bypass MFA; sensitive actions require trusted assurance no older than five minutes; social/weak recovery cannot satisfy it implicitly |
| IA-06 — Recovery | Reset-link expiry/single use, MFA recovery and earlier-session revocation work; insufficient assisted-recovery evidence cannot grant access or affect unrelated memberships |
| IA-07 — Sessions | Idle/absolute limits, no remember-me, five-session/two-platform-context bounds and explicit termination work across tabs, refresh concurrency and logout |
| IA-08 — Revocation | Global/session/local removal and profile reductions prevent new operations within 30 seconds; stale JWT/grants cannot authorize sensitive effects; unrelated memberships remain available |
| IA-09 — Browser boundary | OIDC state/nonce/PKCE/redirect checks, protected cookies, CSRF/fixation controls, token redaction and server-only token storage resist bypass; provider logout/refresh replay are reconciled |
| IA-10 — Scoped profiles | Matrix allow cases work; operator publish/delete/export, manager cross-branch actions, unauthorized grants/profile edits and temporary-grant expiry fail closed |
| IA-11 — Price impact | Authorized all-target save publishes; any unauthorized target rejects the whole mutation without a partial save/distribution or hidden approval fallback; authorized local override stays local |
| IA-12 — Optional approvals | Disabled policy allows authorized direct publication; enabled policy requires independent scoped approval and never labels a price proposal already effective |
| IA-13 — Delayed work | Removal/reduction blocks an outstanding protected effect; issued valid publications continue normally; retries do not expand scope or lose real authorship |
| IA-14 — Support/emergency | No default customer-content privilege; scoped consent expires within its grant, read grants cannot write, no impersonation, exceptional access follows separately reviewed controls |
| IA-15 — Failure and continuity | Identity/JWKS/session/email outages fail safely without administrative bypass; environments, restore and migration preserve principal scope/revocation and independent player behavior |
| IA-16 — Evidence and abuse | Safe public errors, bounded abuse controls, audit access/notifications and redaction preserve attribution without enumerating identities or leaking secrets |

## PH-11 decision record

Evidence: the owner supplied the completed response table on **2026-10-18**. All dispositions below are direct answers, with no delegated/unanswered selection. Each letter refers to the temporary questionnaire, not a persistent implementation identifier.

| Question | Owner answer | Recorded outcome |
| --- | --- | --- |
| P01 | A | Self-hosted identity, conditional on PH-10 feasibility |
| P02 | A | Keycloak selected as candidate, with compatibility/recovery review |
| P03 | A | No recurring identity/email procurement now; readiness may remain pending |
| P04 | A | Email/password plus optional passkeys |
| P05 | B | Google only as external login; no Microsoft in this delivery |
| P06 | C | Public signup and automatic company activation after verification/abuse checks; commercial/privacy prerequisites remain |
| P07 | A | Verified email; recipient-bound seven-day single-use/revocable invites; resend supersedes pending invite |
| P08 | A | Explicit proven account/method linking; no email-only merge |
| P09 | A | Independent multi-company memberships and explicit context switching |
| P10 | C | Designated responsible administrator approves other administrators; controlled responsibility transfer |
| P11 | A | Separate individually provisioned platform-administration accounts |
| P12 | A | Mandatory strong authentication for administrators/managers and distribution-capable operators; company-wide option |
| P13 | A | User-verified passkeys preferred, authenticator alternative/recovery codes; platform phishing resistance |
| P14 | A | Five-minute recent strong authentication for selected sensitive operations; normal compliant publication session |
| P15 | A | Provider-owned safe recovery; 15-minute reset-link target and earlier-session revocation |
| P16 | A | Exceptional proportionate assisted recovery; no global credential reset by company admins |
| P17 | A | Administrative idle 30 minutes; operator idle two hours; absolute 12 hours; shorter company limits allowed |
| P18 | A | No remember-me in this delivery |
| P19 | A | Five sessions/person, two platform-administration contexts; explicit session termination |
| P20 | A | 30-second revocation/freshness bound with current-state sensitive confirmation; five-minute access-token target |
| P21 | A | Server-managed browser session direction, subject to ADR review |
| P22 | A | Continue only safely verifiable authorized operations during outages; otherwise fail closed |
| P23 | A | Standard and company-customizable scoped capability profiles |
| P24 | A | Default permission matrix, subject to the more specific P10/P27 controls |
| P25 | A | Multiple additive grants in explicit scopes; suspended/expired state denies |
| P26 | A | Explicit company/branch resource sharing; read/use separate from editing/publication |
| P27 | A | Reject entire out-of-scope price mutation; no automatic approval-request fallback |
| P28 | A | Optional independent approval policies; disabled by default; proposals are not effective price saves |
| P29 | A | Revalidate before outstanding protected effects; already-issued valid versions retain their lifecycle |
| P30 | A | Explicitly expiring temporary access, without automatic renewal |
| P31 | A | Individual attributable human accounts, no shared shift credentials |
| P32 | A | Local membership removal distinct from global identity, content ownership and company suspension |
| P33 | A | Explicit scoped customer support consent, one-hour default maximum, read-first/separate writes |
| P34 | A | Support's own identity, no impersonation; separate exceptional emergency procedure |
| P35 | A | User sessions/notices, company/branch-scoped audit and minimized platform security events |
| P36 | A | Contextual abuse controls and justified challenges; no permanent attacker-triggered lockout |
| P37 | A | Stable application identity/portability/environment isolation; no additional mandatory pre-pilot export/import proof |
| P38 | A | Consolidate policies and proposed ADRs; close decision portion only after reviewed/accepted technical decision; provision/test separately |

No owner questionnaire response remains unanswered. Following the answers, the owner explicitly accepted ADR-0024/ADR-0025 and all other pending Teluni ADRs on 2026-10-18. The pinned-source compatibility assessment supports that selection, and PH-11 is completed for decisions. Actual provider/session qualification remains PJ-24 and is not inferred from acceptance. External identity, Google and mail setup are tracked separately in PH-15–PH-17. Hardware, host, commercial and privacy gates remain PH-08/PH-10/PH-12/PH-13.
