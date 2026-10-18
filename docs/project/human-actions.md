# Teluni Human Actions

[Project plan](implementation-plan.md) · [Project derivation](../project-derivation.md) · [Secrets policy](../security/secrets-management.md)

## Purpose and current state

This checklist records Teluni's prerequisites that require a project-owner decision, a human-controlled account action, an unavailable privilege, or securely supplied external configuration. Every contributor or coding agent performing implementation work must maintain it and must never silently skip work because human intervention is needed.

Teluni (https://github.com/GabriellMDias/teluni) was initialized from Orion (https://github.com/GabriellMDias/Orion). Repository settings verified for Orion—Renovate, branch protection, and security controls—do not apply to this repository; the actions below establish them here. Conditional needs such as an identity provider, durable releases, or a deployment environment become new actions when their trigger occurs.

## Maintaining this checklist

1. Inspect existing decisions, access, tools, configuration, and prior authorization before requesting human intervention. Complete authorized automation and all useful preparation first.
2. Keep one stable `PH-NN` ID per coherent action; never reuse or renumber IDs. Split broad items into independently verifiable actions as they become concrete, and add newly discovered actions immediately.
3. Every action retains its ID, checkbox, owner, status, dependency, and evidence. Active or conditional requests also need the exact action, reason, non-secret configuration names, and verification method. Use `pending`, `in progress`, `completed`, `blocked`, or `changed` consistently with the [plan](implementation-plan.md#maintaining-this-plan).
4. Before asking the user, provide a concrete request: the exact setting or decision, prepared options where appropriate, why automation cannot finish it, affected task IDs, and how completion will be checked.
5. If an action blocks work now, mark the dependent plan task `blocked`, link this entry, and surface the request to the user. Continue independent authorized work.
6. Use `[x]` and `completed` only after verification, recording safe evidence and the verification date. If direct verification is unavailable, record the limitation rather than claiming success.
7. Reopen an action with `[ ]` if later evidence invalidates completion, access expires, or configuration changes, and record why.
8. A conditional item that becomes unnecessary remains `[ ]` with status `changed`, an explicit reason, and its future trigger or replacement.

## Safe configuration handoff

- Record configuration names, required scopes, environment, purpose, non-secret resource identifiers, and secure destination. Never record passwords, tokens, API keys, connection strings containing credentials, private keys, or complete environment dumps here, in the plan, in chat, or in tracked example files.
- Name only implemented configuration keys and link the [generated configuration reference](../generated/configuration/api.md); do not invent variable names in advance.
- Humans place secrets directly into the selected protected secret store or an explicitly documented ignored local file. Contributors verify presence and authorized behavior without printing secret contents.
- Use synthetic local and test data and ephemeral credentials where possible. Production secrets must not be prerequisites for ordinary development or CI.

## PH-01

- [x] **Create Teluni's repository and publish the initialized default branch.**

**Status:** completed. **Owner:** project owner or repository administrator.
**Dependency / trigger:** [PJ-01](implementation-plan.md#current-work); required before this repository has its own pull requests, CI runs, or settings.
**Request and reason:** Create an empty repository at https://github.com/GabriellMDias/teluni without a generated README, license, or ignore file, then run `git push -u origin main`. Initialization configured `origin` locally but never creates remote repositories or pushes.
**Configuration:** none. Do not embed credentials in remote URLs.
**Verification:** `git ls-remote origin main` returns the local `main` commit, and `pnpm orion:check` passes in a fresh clone.
**Evidence / blocker:** 2026-10-17: the owner supplied successful fresh-clone output for `pnpm install --frozen-lockfile` (pnpm 11.25.0) and `pnpm orion:check`, confirming the recorded Orion baseline and `@teluni` scope. Independently verified that `git ls-remote origin refs/heads/main` and local `git rev-parse refs/heads/main` both return `c9193734d5f5de22883af433d48006805fb86604`. Repository creation/publication and fresh-clone provenance verification are complete. Remote CI and branch protection remain separate PH-02 / PJ-01 obligations.

## PH-02

- [x] **Require pull requests and the CI gate on this repository's default branch, and keep merge commits available.**

**Status:** completed. **Owner:** repository administrator.
**Dependency / trigger:** PH-01; [PJ-01](implementation-plan.md#current-work).
**Request and reason:** Protect `main`: require pull requests and the `Orion required gate` status check, block force pushes and deletion, and review bypass actors. Keep merge commits allowed and do not require linear history on `main`, because Orion upgrade pull requests must be merged with a merge commit to preserve upstream ancestry ([upgrade workflow](../project-derivation.md#upgrade-to-a-newer-orion-revision)). Branch protection is repository administration that local automation cannot perform.
**Configuration:** none beyond the repository ruleset and merge settings.
**Verification:** Read the effective rules for `main` and confirm the required check name matches [CI](../../.github/workflows/ci.yml) and that no linear-history requirement applies; confirm merge commits are allowed; a successful required-gate run appears on a pull request.
**Evidence / blocker:** 2026-10-17: verified through the GitHub API that active [ruleset 25323352, Protect main](https://github.com/GabriellMDias/teluni/rules/25323352) targets the default branch `main`, requires pull requests and the `Orion required gate` check from GitHub Actions (integration 15368), blocks deletion and non-fast-forward updates, has no bypass actors, and does not require linear history. Merge commits are allowed in both the repository settings and the ruleset. [CI run 39077703462](https://github.com/GabriellMDias/teluni/actions/runs/39077703462) succeeded for push commit `c9193734d5f5de22883af433d48006805fb86604`, including `Validate` and `Orion required gate`. [PR #2](https://github.com/GabriellMDias/teluni/pull/2) then exercised the pull-request workflow: [run 39078757654](https://github.com/GabriellMDias/teluni/actions/runs/39078757654) passed `Validate` and `Orion required gate` for head commit `98a87a896fce6126566ba1521c8954b1fdb5866a`. Configuration and successful PR-gate verification are complete. No repository settings were changed during verification.

## PH-03

- [x] **Enable Renovate for this repository.**

**Status:** completed. **Owner:** repository administrator.
**Dependency / trigger:** PH-01.
**Request and reason:** Grant the Renovate GitHub App access to https://github.com/GabriellMDias/teluni so the committed [configuration](../../renovate.json) runs. App installation is an account action.
**Configuration:** none; no personal token is required.
**Verification:** Renovate opens this repository's Dependency Dashboard reflecting the committed dependencies and schedule.
**Evidence / blocker:** 2026-10-17: owner confirmed installation; GitHub API verified [Dependency Dashboard #1](https://github.com/GabriellMDias/teluni/issues/1), authored by `app/renovate`, with detected workspace dependencies, updates awaiting the configured schedule, and major updates pending approval. These match `renovate.json` (weekly schedule, dashboard/major approval, automerge disabled).

## PH-04

- [x] **Enable and verify applicable GitHub security controls.**

**Status:** completed. **Owner:** repository administrator.
**Dependency / trigger:** PH-01.
**Request and reason:** Enable available code scanning, secret scanning and push protection, dependency graph, and vulnerability alerts, and set the Actions variable `DEPENDENCY_REVIEW_ENABLED=true` so the dependency-review job runs. Record entitlement limits for this repository's visibility and plan.
**Configuration:** Actions variable `DEPENDENCY_REVIEW_ENABLED` (non-secret).
**Verification:** Inspect effective security settings and a pull-request run in which dependency review executed and the aggregate gate passed.
**Evidence / blocker:** 2026-10-17: owner confirmed setup. GitHub API verified this public repository has secret scanning and push protection enabled, vulnerability alerts enabled (HTTP 204), an available dependency graph/SBOM, CodeQL default setup configured, and Actions variable `DEPENDENCY_REVIEW_ENABLED=true`. [CodeQL run 39079537512](https://github.com/GabriellMDias/teluni/actions/runs/39079537512) passed analysis for Actions and JavaScript/TypeScript. Earlier PR runs skipped dependency review before the variable was set. [PR #3 run 39080134706](https://github.com/GabriellMDias/teluni/actions/runs/39080134706) passed `Validate`, `Dependency review` and `Orion required gate` for head `e92673af60fe99d23023aaedccfde004a6984c16`, completing the required PR verification. The existing high-severity [Dependabot alert #1](https://github.com/GabriellMDias/teluni/security/dependabot/1) for `source-map-js` remains open and is separately tracked as PJ-18; enabled controls do not imply a vulnerability-free dependency tree. Dependabot automatic security-update PRs are disabled; they are not an acceptance requirement and do not replace Renovate.

## PH-05

- [x] **Define the product scope and acceptance criteria.**

**Status:** completed. **Owner:** project owner.
**Dependency / trigger:** [PJ-02](implementation-plan.md#current-work); required before product modules are implemented.
**Request and reason:** Supply the initial product brief rather than allowing agents to invent product requirements.
**Configuration:** none.
**Verification:** Requirements are recorded in the repository and linked from the project plan.
**Evidence / blocker:** 2026-10-17: owner supplied the Teluni brief covering vision, actors, MVP, offline behavior, technologies, infrastructure, business hypotheses and internationalization. Recorded in [product documentation](README.md), [MVP acceptance](mvp.md) and [security/data inventory](security-and-i18n.md). Quantitative targets and ambiguous product policies remain separate PH-09; no implemented feature is claimed.

## PH-06

- [x] **Determine the product license before distribution requires it.**

**Status:** completed. **Owner:** project owner, with legal input when needed.
**Dependency / trigger:** Publication or distribution of Teluni.
**Request and reason:** Record the owner's explicit Apache-2.0 selection for Teluni source and documentation. Inherited Orion rights remain intact; commercial SaaS terms remain PH-12. Named copyright/NOTICE attribution, if required for distribution, is separately tracked in PH-14 rather than invented.
**Configuration:** none.
**Verification:** License files, the README, and publication metadata match the recorded decision.
**Evidence / blocker:** 2026-10-17: owner explicitly selected Apache-2.0. [ADR-0022](../adr/0022-license-teluni-under-apache-2-0.md), the root README and all four workspace `package.json` license fields record that selection. The existing canonical root `LICENSE` already contains Apache License 2.0 and is retained unmodified. No named copyright holder or fabricated NOTICE is added.

## PH-07

- [ ] **Verify Teluni's domain/trademark evidence and visual identity before public launch.**

**Status:** in progress. **Owner:** project owner, with specialist input where needed.
**Dependency / trigger:** PJ-04 and PJ-14; before external brand commitments.
**Request and reason:** The owner approved the [Connected Tiles identity](branding/README.md) and authorized project integration. Teluni and `teluni.app` are approved; `teluni.com.br` remains the secondary/defensive Brazil option (reported available), and unavailable/premium `teluni.com` remains outside the current budget/scope. Record registration/control and final trademark evidence only when supplied or verified.
**Configuration:** none; do not publish registrar credentials.
**Verification:** Preserve owner-approved Connected Tiles assets and verify the integrated shell, portal, SVG favicon, derived touch icon and local font. Record dated non-secret domain-control/registration and trademark outcomes before claiming them; player/store exports are conditional on the future Android application.
**Evidence / blocker:** 2026-10-17: owner explicitly selected Connected Tiles and requested its integration. PJ-04 completed the runtime SVG, derived touch icon, locally served font and shell/portal colors. Desktop/mobile inspection and full local `pnpm validate` passed, including 16 E2E tests; the [branding guide](branding/README.md#approved-name-and-domain-direction) and its review evidence record the approved integration. No further visual-direction choice is pending. Domain registration/control and trademark outcomes remain unverified, so PH-07 is not complete.

## PH-08

- [ ] **Confirm the pilot participant, physical devices and supported hardware envelope.**

**Status:** pending. **Owner:** project owner and candidate pilot operator.
**Dependency / trigger:** PJ-07, PJ-08, PJ-09, PJ-12, PJ-20 and PJ-14; before hardware-specific commitments and pilot acceptance.
**Request and reason:** Confirm the snack bar's participation and core workflow, screen/device quantity and models, Android versions, connection/storage conditions, orientations and installation/update access. Qualify AT-04 and the selected startup/power/offline/timing targets with the FR-10 video/audio and FR-11 generic-catalog profiles; policy approval is not physical support evidence. A candidate customer is not a confirmed pilot or a tested hardware profile.
**Configuration:** none yet; record model/capability facts without private access details.
**Verification:** Approved hardware/support matrix and operator workflow, available test devices, and recorded playback/reboot/codec tests during implementation.
**Evidence / blocker:** Owner identified a potential snack bar pilot; hardware, participation and capacity remain unverified.

## PH-09

- [x] **Agree product policy boundaries and measurable release acceptance targets.**

**Status:** completed. **Owner:** product owner with delegated engineering decisions.
**Dependency / trigger:** PJ-07 and the dependent Phase 2 slices; policy/target selection before implementation and acceptance claims.
**Request and reason:** Consolidate the owner's questionnaire and explicitly delegated unanswered choices into [release policies](release-policies.md) and [acceptance targets](release-targets.md), including configurable catalogs beyond products, hybrid regions, automatic price publication, multi-video/audio, calendar/offline/retention rules and measurable qualification goals.
**Configuration:** no runtime settings or schemas introduced; selected limits become canonical validated configuration/contracts only during implementation.
**Verification:** All P01–P31 have a recorded owner or delegated disposition. AT-01–AT-26 name numeric limits/measurement boundaries and FR/NF evidence requirements. Technical design/ADR acceptance and physical measurements remain PJ-07, PH-08/PH-10 and implementation/qualification tasks; they are not silently marked passed.
**Evidence / blocker:** 2026-10-18: owner supplied detailed questionnaire responses and explicitly authorized decisions for delegated or unanswered items. The [decision record](release-policies.md#ph-09-decision-record) preserves 21 direct answers and 10 delegated selections; the unfilled optional summary table does not override those answers. Product-policy/target selection is complete with no remaining PH-09 owner question. ADR-0023 remains proposed; hardware, deployment, identity, privacy and actual target results remain separately pending. PJ-22 tracks documentation validation, not product delivery.

## PH-10

- [ ] **Confirm residential-host feasibility, exposure and recovery commitments before a real pilot.**

**Status:** pending. **Owner:** project owner / server and network administrator.
**Dependency / trigger:** PJ-07/PJ-13 and before PJ-14 real-customer operation.
**Request and reason:** Supply the host/network inventory, public access/CGNAT/ISP constraints, controlled domain/HTTPS path, safe administration, power/uplink/capacity facts, off-host backup destination, recovery-key handling and acceptable RPO/RTO/downtime/support. Review the [deployment readiness gates](operations.md#residential-exposure-and-readiness-gate). No tunnel, free DNS or home-server arrangement has been certified suitable.
**Configuration:** only currently implemented names from the [configuration reference](../generated/configuration/api.md); new deployment keys are pending design. Put secrets only in an approved protected destination.
**Verification:** Network/ingress/security inspection and isolated timed PostgreSQL-plus-media restore, followed by reboot/offline and endpoint-migration rehearsal with supported players.
**Evidence / blocker:** No cloud budget; personal residential server intended. Topology, exposure, backup destination and availability/recovery targets remain unverified. No deployment authorized by this entry.

## PH-11

- [ ] **Choose the human identity provider and approve the initial permission/recovery policy.**

**Status:** in progress. **Owner:** product owner with engineering/security review.
**Dependency / trigger:** PJ-07/PJ-03/PJ-24; identity and scoped access are initial-release requirements.
**Request and reason:** All owner choices are recorded in [identity/access policies](identity-and-access.md), including the default matrix and IA-01–IA-16 allow/deny cases. Review [provider evidence and gaps](identity-provider-evaluation.md), pinned-version claim/session/assurance compatibility, and proposed ADR-0024/ADR-0025 before technical acceptance. Do not weaken ADR-0012 or infer provider interoperability from a valid-looking JWT.
**Configuration:** existing `ORION_TOKEN_ISSUER`, `ORION_TOKEN_AUDIENCE` and `ORION_TOKEN_JWKS_URL` are documented in the [API configuration reference](../generated/configuration/api.md). No provider/session-specific application keys or secret destinations are implemented. External identity, Google and mail provisioning are separate PH-15–PH-17.
**Verification:** Owner policy selection is complete. The decision gate still requires a reviewed/accepted technical ADR and supported compatibility assessment; unresolved evidence remains explicit. Actual provider/token/session/revocation/recovery tests belong to PJ-24 and later acceptance, not this documentation task.
**Evidence / blocker:** 2026-10-18: owner directly answered all 38 questions. Keycloak is the self-hosted candidate, Google the only external login, company activation public/automatic, and the responsible administrator approves additional administrators. P27=A rejects complete out-of-scope price changes; P37=A does not add a mandatory pre-pilot export/import proof. Official documentation supports configurable `at+jwt` and mapping primitives, but no pinned-provider integration or session/assurance qualification was run. ADR-0024/ADR-0025 remain proposed; therefore PH-11 is not completed. No owner questionnaire response remains missing. This does not block completion of the current documentation work.

## PH-12

- [ ] **Validate pilot commercial terms, costs and eventual plans before offering subscriptions.**

**Status:** pending. **Owner:** project owner.
**Dependency / trigger:** PJ-14 pilot terms; PJ-16 commercial expansion.
**Request and reason:** Validate per-screen/company pricing, storage/traffic/processing limits, support, installation, cancellation, operating cost and partnerships/referrals. PH-11 selects public signup with automatic company activation: approve eligibility/entitlements, initial quotas and any trial/free/paid conditions before opening it; no commercial defaults are inferred from identity verification. BRL 79.90/month for two screens is exploratory only. Automatic billing remains outside the mandatory MVP.
**Configuration:** none; no plan IDs, prices, gateway or entitlements implemented.
**Verification:** Record approved pilot terms and measured cost/support evidence; later approve plan limits and commercial policies before implementing subscription enforcement.
**Evidence / blocker:** Recurring SaaS is intended; no definitive pricing or paid infrastructure/provider budget established.

## PH-13

- [ ] **Define customer data responsibilities and privacy/retention obligations before collecting pilot data.**

**Status:** pending. **Owner:** project owner with qualified legal/privacy input when needed.
**Dependency / trigger:** PJ-13/PJ-14 before real customer/personal data or public signup; international expansion when triggered.
**Request and reason:** Review the [initial data inventory](security-and-i18n.md#initial-data-inventory), intended content restrictions, notices/terms, customer/operator responsibilities, lawful purposes, retention/deletion/export, backup reconciliation and incident contact. Determine applicable LGPD and other jurisdictional obligations against actual operation; the product documentation is not compliance certification.
**Configuration:** no legal/privacy settings implemented; do not put customer records or private advice in public examples.
**Verification:** Approved obligations and retention/deletion/access procedures linked to implementation and restore acceptance; no sensitive clinic/patient dataset required for signage.
**Evidence / blocker:** Initial classifications documented; legal/operational policies and retention periods remain pending.

## PH-14

- [ ] **Confirm named copyright and attribution notices when distribution requires them.**

**Status:** pending (conditional). **Owner:** project owner, with qualified input where needed.
**Dependency / trigger:** PH-06; before adding holder-specific notices or distributing artifacts with attribution requirements beyond the current repository license/provenance.
**Request and reason:** Confirm the exact attribution names and any applicable third-party notices from evidence. Apache-2.0 is selected, but agents must not infer legal ownership from a GitHub account or invent a NOTICE. This preserves the attribution portion of the original PH-06 scope without blocking the owner's license choice.
**Configuration:** none.
**Verification:** Any added notices identify confirmed holders and preserve applicable inherited/third-party notices; distribution metadata matches the owner-approved attribution.
**Evidence / blocker:** No holder-specific notice supplied or added in this task. Root `LICENSE` and Orion provenance remain intact.

## PH-15

- [ ] **Prepare controlled self-hosted identity resources and protected provisioning inputs.**

**Status:** pending. **Owner:** project owner / identity and server administrator.
**Dependency / trigger:** PH-10, PH-11 technical acceptance and PJ-24; before provider integration or real identity use.
**Request and reason:** Confirm host capacity, a controlled HTTPS issuer address, restricted provider administration, persistent provider storage and protected signing/recovery material. Identify responsible administrators and safe recovery ownership without publishing personal account details. Prepare inputs only after the reviewed provider/version design; this action does not authorize deployment.
**Configuration:** existing API token settings are `ORION_TOKEN_ISSUER`, `ORION_TOKEN_AUDIENCE` and `ORION_TOKEN_JWKS_URL`; future provider/session settings must first have canonical schemas/documentation. Supply secret material only in an approved protected destination, never in this checklist or chat.
**Verification:** Record non-secret environment/issuer ownership and controlled access; during authorized implementation verify pinned provider, human-only claim provisioning, key rotation, restricted management and isolated revocation-safe restore under PH-10/PJ-13.
**Evidence / blocker:** 2026-10-18: self-hosting/Keycloak chosen as candidate, but host capacity, provider version, issuer control, secret destination and deployment are unverified. Foundation validation is not provisioning evidence.

## PH-16

- [ ] **Provide owner-controlled Google OAuth registration for the selected external login.**

**Status:** pending. **Owner:** project owner / Google application administrator.
**Dependency / trigger:** PH-07 controlled domain, PH-11 reviewed callback/provider design and PH-15; before enabling Google login in PJ-24.
**Request and reason:** Register/control the Google application and required consent/branding configuration for the actual environment. Approve exact reviewed callback origins/redirects and required identity attributes/scopes; keep environments separate. Microsoft is not selected. Do not invent callback URLs before implementation defines them or register an application in this documentation task.
**Configuration:** no Google-specific application keys are implemented. Store any future client secret in the approved protected destination; record only safe ownership/environment evidence.
**Verification:** Authorized implementation verifies the controlled callback, correct audience/environment, account linking without email-only merging and non-bypassable administrative assurance. Provider account actions are not implied by answering the questionnaire.
**Evidence / blocker:** 2026-10-18: P05=B selects Google only; no Google registration, credentials, consent setup or callback test is verified.

## PH-17

- [ ] **Establish a verified transactional-email path for identity invitations and recovery.**

**Status:** pending. **Owner:** project owner / domain and mail administrator.
**Dependency / trigger:** PH-07 domain control, PH-10 hosting, PH-11 flow review and PH-13 notices; before public signup or real invitations/recovery in PJ-24.
**Request and reason:** Identify a reliable sender/delivery service compatible with the no-recurring-procurement constraint, confirm sender/domain control and applicable limits/terms, and prepare protected mail credentials. Review required DNS authentication, deliverability, abuse response and sender continuity; do not assume residential SMTP or an unspecified free service is adequate. If no suitable path exists, record the budget/readiness blocker rather than bypassing verification/recovery.
**Configuration:** no mail-specific application keys are implemented; future credentials go only in the approved protected store. Do not publish credentials, reset links or private recipient records.
**Verification:** Authorized implementation tests delivery/failure/retry and invitation/reset expiry/single-use behavior with synthetic addresses under actual approved sender configuration. DNS/service/account facts need owner evidence; documentation is not delivery proof.
**Evidence / blocker:** 2026-10-18: P03=A confirms no recurring identity/email procurement now. No existing sender, delivery service, DNS configuration or successful delivery is established.

## New action template

Allocate a new stable `PH-NN`; do not reuse existing IDs. Link it from the blocked or conditional plan task.

```markdown
## PH-NN

- [ ] **Concrete human action.**

**Status:** pending. **Owner:** actual person or responsible role.
**Dependency / trigger:** Linked task; whether it blocks current work.
**Request and reason:** Exact need, completed preparation, and why authorized automation cannot finish it.
**Configuration:** Exact non-secret names, minimum scopes and secure destination; never secret values. Use "none" if no configuration is needed.
**Verification:** Observable checks required before completion.
**Evidence / blocker:** Dated safe evidence, outstanding limit, or changed applicability.
```
