# Teluni Human Actions

[Project plan](implementation-plan.md) · [Project derivation](../project-derivation.md) · [Secrets policy](../security/secrets-management.md)

## Purpose and current state

This checklist records Teluni's prerequisites that require a project-owner decision, a human-controlled account action, an unavailable privilege, or securely supplied external configuration. Every contributor or coding agent performing implementation work must maintain it and must never silently skip work because human intervention is needed.

Teluni (https://github.com/GabriellMDias/teluni) was initialized from Orion (https://github.com/GabriellMDias/Orion). Repository settings verified for Orion—Renovate, branch protection, and security controls—do not apply to this repository; the actions below establish them here. Conditional needs such as an identity provider, durable releases, or a deployment environment become new actions when their trigger occurs.

## Maintaining this checklist

The owner authorized the [Orion v3.0.0 upgrade](foundation-upgrade-v3.md) on 2026-10-23, followed by the [post-upgrade audit](foundation-upgrade-v3.md#post-upgrade-audit). [PR #28](https://github.com/GabriellMDias/teluni/pull/28) passed its final required CI gate and was integrated with merge commit `6ab489c`, verified on 2026-10-24; PJ-42 is completed. Existing pilot, device and production prerequisites remain open at their original triggers. Ordinary development continues under the owner's subsequent authorization; it grants no production access or deployment authority.

1. Inspect existing decisions, access, tools, configuration, and prior authorization before requesting human intervention. Complete authorized automation and all useful preparation first.
2. Keep one stable `PH-NN` ID per coherent action; never reuse or renumber IDs. Split broad items into independently verifiable actions as they become concrete, and add newly discovered actions immediately.
3. Every action retains its ID, checkbox, owner, status, dependency, and evidence. Active or conditional requests also need the exact action, reason, non-secret configuration names, and verification method. Use `pending`, `in progress`, `completed`, `blocked`, or `changed` consistently with the [plan](implementation-plan.md#maintaining-this-plan).
4. Before asking the user, provide a concrete request: the exact setting or decision, prepared options where appropriate, why automation cannot finish it, affected task IDs, and how completion will be checked.
5. If an action blocks work now, mark the dependent plan task `blocked`, link this entry, and surface the request to the user. Continue independent authorized work.
6. Use `[x]` and `completed` only after verification, recording safe evidence and the verification date. If direct verification is unavailable, record the limitation rather than claiming success.
7. Reopen an action with `[ ]` if later evidence invalidates completion, access expires, or configuration changes, and record why.
8. A conditional item that becomes unnecessary remains `[ ]` with status `changed`, an explicit reason, and its future trigger or replacement.

## Interface planning request of 2026-10-23

The owner requested explicit planning for a product interface aligned with the Connected Tiles identity board's light/dark examples, then authorized continued development and creation of a pull request on the same day. After merging PR #25, the owner accepted the visual result and requested continued development. [PJ-41](implementation-plan.md#pj-41-interface-alignment) records the company-navigation increment and the remaining adoption/qualification work. PH-07's completed visual-direction selection and PJ-04's original brand integration remain intact. No new external account, credential or human blocker is required for this local implementation; existing production and pilot prerequisites remain in force.

The owner subsequently requested correction of PR #26's CI failure. The [CI qualification correction](implementation-plan.md#ci-qualification-correction) records the runner prerequisites and mail-test precision fix. It requires no new owner account, credential or repository privilege; current-head CI qualification remains part of the implementation work.

## Safe configuration handoff

On 2026-10-24 the owner requested autonomous development after the local product test. The Orion upgrade is merged under PJ-42. The [device workflow interface increment](implementation-plan.md#device-workflow-interface-increment) continues PJ-41 using existing components and approved behavior. It requires no new human action, provider access or product decision. Device qualification and production prerequisites remain open at their original triggers.

- Record configuration names, required scopes, environment, purpose, non-secret resource identifiers, and secure destination. Never record passwords, tokens, API keys, connection strings containing credentials, private keys, or complete environment dumps here, in the plan, in chat, or in tracked example files.
- Name only implemented configuration keys and link the [generated configuration reference](../generated/configuration/api.md); do not invent variable names in advance.
- Humans place secrets directly into the selected protected secret store or an explicitly documented ignored local file. Contributors verify presence and authorized behavior without printing secret contents.
- Use synthetic local and test data and ephemeral credentials where possible. Production secrets must not be prerequisites for ordinary development or CI.

## Decision review of 2026-10-22

On 2026-10-22 the owner asked the agent to take every pending decision that is only a decision, so that development can continue, extending the delegation recorded with [PH-25](#ph-25). The agent reviewed every open action. The decision parts are now decided in the [deployment design](deployment-design.md) with [ADR-0033](../adr/0033-expose-the-pilot-host-with-end-to-end-tls-and-back-it-up-with-encrypted-off-host-snapshots.md), the [data handling policies](data-handling-policies.md) and the player's [hardware envelope](player-design.md#supported-hardware-envelope). What remains below needs the owner's accounts, devices, facts, legal identity or a qualified professional, which no decision can replace.

| Action | Decided on 2026-10-22 | Still needs the owner |
| --- | --- | --- |
| [PH-07](#ph-07) | Nothing left to decide; the hostnames under `teluni.app` are set by the deployment design | Registering `teluni.app` and the trademark evidence |
| [PH-08](#ph-08) | The hardware envelope devices are bought and qualified against | The pilot's confirmation, the physical devices and their measurements |
| [PH-10](#ph-10) | How the host is reached, the proxy, backups, RPO and RTO, availability objective and maintenance window | The host and line facts, the relay and backup accounts, the real restore rehearsal |
| [PH-13](#ph-13) | Completed: responsibilities, upload restrictions, retention, closure, deletion, export, requests and incidents | The legal review moves to [PH-28](#ph-28) |
| [PH-14](#ph-14) | Nothing: the copyright holder is a legal fact, not a choice | The holder's name, when distribution needs it |
| [PH-15](#ph-15) | The issuer address `https://auth.teluni.app/realms/teluni` and the production composition | Running Keycloak with the protected inputs |
| [PH-16](#ph-16) | Client type, redirect URI and scopes | Registering the Google client |
| [PH-17](#ph-17) | Resend over SMTP from `notify.teluni.app`, staged DMARC, Brevo as fallback | The account, DNS verification and the key |
| [PH-18](#ph-18) | Nothing: customer acceptance, costs and support coverage are measured facts | Pilot evidence |
| [PH-19](#ph-19) | Nothing: the billing issuer and fiscal process depend on the owner's legal situation and an accountant | The qualified fiscal setup |
| [PH-26](#ph-26) | Nothing: environment settings | Allowing two hosts in the cloud environment |
| [PH-27](#ph-27) | Nothing: the key must be created and kept outside agent sessions | Creating and keeping the key |

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
**Evidence / blocker:** 2026-10-17: owner explicitly selected Connected Tiles and requested its integration. PJ-04 completed the runtime SVG, derived touch icon, locally served font and shell/portal colors. Desktop/mobile inspection and full local `pnpm validate` passed, including 16 E2E tests; the [branding guide](branding/README.md#approved-name-and-domain-direction) and its review evidence record the approved integration. No further visual-direction choice is pending. Domain registration/control and trademark outcomes remain unverified, so PH-07 is not complete. 2026-10-22: the [deployment design](deployment-design.md#hostnames-and-routing) uses `app.teluni.app`, `auth.teluni.app` and `notify.teluni.app`, which wait for this registration and DNS access; no decision remains in this action.

## PH-08

- [ ] **Confirm the pilot participant, physical devices and supported hardware envelope.**

**Status:** pending. **Owner:** project owner and candidate pilot operator.
**Dependency / trigger:** PJ-07, PJ-08, PJ-09, PJ-12, PJ-20 and PJ-14; before hardware-specific commitments and pilot acceptance.
**Request and reason:** Confirm the snack bar's participation and core workflow, screen/device quantity and models within the decided [hardware envelope](player-design.md#supported-hardware-envelope), connection/storage conditions, orientations and installation/update access. Qualify AT-04 and the selected startup/power/offline/timing targets with the FR-10 video/audio and FR-11 generic-catalog profiles; policy approval is not physical support evidence. A candidate customer is not a confirmed pilot or a tested hardware profile.
**Configuration:** none yet; record model/capability facts without private access details.
**Verification:** Approved hardware/support matrix and operator workflow, available test devices, and recorded playback/reboot/codec tests during implementation.
**Evidence / blocker:** Owner identified a potential snack bar pilot; hardware, participation and capacity remain unverified. 2026-10-22: under the owner's delegation the agent decided the envelope devices are bought and qualified against (certified Android TV or Google TV, Android 9 or later, Anatel homologation, 2 GB of RAM, 8 GB of storage, H.264 1080p30 hardware decoding, a Google TV HDMI device as the reference class). What remains is the pilot's confirmation, the physical devices and their measurements. 2026-10-24: PJ-12 stored-media integrity and repair passed 115 JVM/Android tests and an emulator corruption/reconnection exercise; the full local repository gate also passed. Evidence is linked from the [player implementation status](player-design.md#implementation-status); they do not qualify physical storage faults, power cuts or hardware timings. No additional human action blocks this development increment. The subsequent PJ-11/PJ-12 health increment passed 123 JVM/Android tests, the full repository gate and a controlled emulator crash/restart exercise with the real panel/API; its evidence is recorded in the same implementation status. It uses only local/test infrastructure and introduces no human blocker. Physical hardware qualification and production rollout remain pending; private crash-evidence uploads remain outside this increment. The subsequent PJ-08 lifecycle history increment also uses local/test infrastructure and introduces no new human prerequisite; its scope and evidence are recorded in the [device design](device-enrollment-design.md#implementation-status).

## PH-09

- [x] **Agree product policy boundaries and measurable release acceptance targets.**

**Status:** completed. **Owner:** product owner with delegated engineering decisions.
**Dependency / trigger:** PJ-07 and the dependent Phase 2 slices; policy/target selection before implementation and acceptance claims.
**Request and reason:** Consolidate the owner's questionnaire and explicitly delegated unanswered choices into [release policies](release-policies.md) and [acceptance targets](release-targets.md), including configurable catalogs beyond products, hybrid regions, automatic price publication, multi-video/audio, calendar/offline/retention rules and measurable qualification goals.
**Configuration:** no runtime settings or schemas introduced; selected limits become canonical validated configuration/contracts only during implementation.
**Verification:** All P01–P31 have a recorded owner or delegated disposition. AT-01–AT-26 name numeric limits/measurement boundaries and FR/NF evidence requirements. Architecture ADRs are now owner-accepted; concrete technical design and physical measurements remain PJ-07, PH-08/PH-10 and implementation/qualification tasks, without being silently marked passed.
**Evidence / blocker:** 2026-10-18: owner supplied detailed questionnaire responses and explicitly authorized decisions for delegated or unanswered items. The [decision record](release-policies.md#ph-09-decision-record) preserves 21 direct answers and 10 delegated selections; the unfilled optional summary table does not override those answers. Product-policy/target selection is complete with no remaining PH-09 owner question. ADR-0023 was drafted as proposed and accepted by the owner on 2026-10-18; hardware, deployment, actual identity implementation, privacy and target results remain separately pending. PJ-22 tracks documentation validation, not product delivery.

## PH-10

- [ ] **Confirm residential-host feasibility, exposure and recovery commitments before a real pilot.**

**Status:** pending. **Owner:** project owner / server and network administrator.
**Dependency / trigger:** PJ-07/PJ-13 and before PJ-14 real-customer operation.
**Request and reason:** Supply the host/network inventory: whether the line has a public IPv4 address or is behind CGNAT, whether inbound 443 reaches the router, IPv6, upload bandwidth, data caps, power and reboot behavior, CPU/RAM/disk. Create the accounts the [deployment design](deployment-design.md) needs: the relay VM only if the line requires it, and the off-host backup bucket. Keep the restic password offline. Then run the restore rehearsal on the real host. The exposure path, proxy, backup method, RPO/RTO, availability objective and maintenance window are decided there. Support coverage stays with PH-18. Review the [deployment readiness gates](operations.md#residential-exposure-and-readiness-gate).
**Configuration:** only currently implemented names from the [configuration reference](../generated/configuration/api.md); new deployment keys are pending design. Put secrets only in an approved protected destination.
**Verification:** Network/ingress/security inspection and isolated timed PostgreSQL-plus-media restore, followed by reboot/offline and endpoint-migration rehearsal with supported players.
**Evidence / blocker:** No cloud budget; personal residential server intended. 2026-10-22: under the owner's delegation the agent decided the [deployment design](deployment-design.md) and ADR-0033: end-to-end TLS on the host through Caddy, direct or through a WireGuard TCP relay; restic snapshots every 6 hours to Backblaze B2, kept about 35 days; RPO 6 hours, RTO 4 hours with the host intact and 72 hours if it is lost; a 99% internal objective; and a weekday 02:00–06:00 maintenance window. Host facts, accounts and the real rehearsal remain unverified. No deployment authorized by this entry.

## PH-11

- [x] **Choose the human identity provider and approve the initial permission/recovery policy.**

**Status:** completed. **Owner:** product owner with engineering/security review.
**Dependency / trigger:** PJ-07/PJ-03/PJ-24; identity and scoped access are initial-release requirements.
**Request and reason:** The owner selected all policies, approved the matrix and explicitly accepted the architectural ADRs. Keycloak, server-managed browser sessions and application-owned scoped profiles are accepted under ADR-0024/ADR-0025, preserving ADR-0012. The [provider evaluation](identity-provider-evaluation.md#pinned-source-assessment) records the reviewed version/source and mandatory integration controls.
**Configuration:** at PH-11 completion, `ORION_TOKEN_ISSUER`, `ORION_TOKEN_AUDIENCE` and `ORION_TOKEN_JWKS_URL` were the only implemented API token settings; the session settings implemented later under PJ-24 are listed in PH-15. No secret destination is implied. Identity, Google and mail provisioning remain PH-15–PH-17.
**Verification:** All 38 direct owner choices, the default/custom scoped matrix and IA-01–IA-16 specified allow/deny cases are recorded in [identity/access](identity-and-access.md). The owner explicitly accepted ADR-0024/ADR-0025 on 2026-10-18. A pinned-source assessment of Keycloak 26.8.1 at `24ed1dadf3f246a555adb6d3d4a99e9b3003fb3b` establishes a viable mapping path; no actual provider login/token/session/revocation test is claimed.
**Evidence / blocker:** 2026-10-18: after answering all 38 questions, the owner explicitly authorized acceptance of all pending Teluni ADRs. PH-11's provider/policy/architecture decision scope is complete, with no remaining owner decision. Concrete trusted principal/session/assurance integration, configured-version compatibility tests and all unperformed IA cases remain PJ-03/PJ-07/PJ-24; host/recovery, external inputs and commercial/privacy readiness remain PH-10/PH-12/PH-13/PH-15–PH-17. Completing this decision does not authorize or certify implementation, exposure or a real-customer release.

## PH-12

- [x] **Approve the initial pilot, subscription and commercial-access policies.**

**Status:** completed. **Owner:** project owner.
**Dependency / trigger:** PJ-14 pilot planning, PJ-27 basic commercial access and PJ-16 later expansion.
**Request and reason:** All 38 questionnaire recommendations are approved in [commercial policies](commercial-policies.md), including conditional support and delegated resource dimensioning. Initial validation prices are BRL 79.90/month/company for two licenses plus BRL 29.90/additional license, with a 30-day first accompanied pilot and 14-day public trial. No published offer or proven margin is inferred.
**Configuration:** none; no plan IDs, entitlements, quotas, gateway, bank destination or payment implementation is introduced. Numerical paid resource examples remain a proposed qualification baseline under P16=C, not approved production capacity.
**Verification:** Owner explicitly instructed proceeding with every suggestion and closing PH-12 on 2026-10-18. The canonical decision record covers P01–P38, including P10=B, P16=C/delegation, P32=B and conditional P23/P24. CP-01–CP-12 specify future verification without claiming execution. Conditional availability and the cost worksheet remain unknown.
**Evidence / blocker:** 2026-10-18: owner commercial-policy selection is complete. **Explicit scope split:** the original action combined owner decisions with real commercial evidence; the latter is preserved in pending PH-18 (pilot/customer acceptance, measured cost/support, capacity-qualified offer) and PH-19 (billing/fiscal readiness), linked to PJ-14/PJ-27. No customer agreement, cost measurement, real support window or fiscal capability was supplied. This completion closes decisions only and does not authorize charging, public admission, procurement, implementation or production claims.

## PH-13

- [x] **Define customer data responsibilities and privacy/retention obligations before collecting pilot data.**

**Status:** completed (decision scope; the legal review is [PH-28](#ph-28)). **Owner:** project owner with qualified legal/privacy input when needed.
**Dependency / trigger:** PJ-13/PJ-14 before real customer/personal data or public signup; international expansion when triggered.
**Request and reason:** Review the [initial data inventory](security-and-i18n.md#initial-data-inventory), intended content restrictions, notices/terms, customer/operator responsibilities, lawful purposes, retention/deletion/export, backup reconciliation and incident contact. Determine applicable LGPD and other jurisdictional obligations against actual operation; the product documentation is not compliance certification.
**Configuration:** no legal/privacy settings implemented; do not put customer records or private advice in public examples.
**Verification:** Approved obligations and retention/deletion/access procedures linked to implementation and restore acceptance; no sensitive clinic/patient dataset required for signage.
**Evidence / blocker:** Initial classifications documented. 2026-10-22: the owner asked the agent to take every pending decision that is only a decision. Under that delegation the agent recorded the [data handling policies](data-handling-policies.md): the responsibility split, upload restrictions, the retention schedule (confirming the modules' provisional values and adding audit, ledger, log and backup durations), company closure, account deletion, export, data subject requests, incident communication and the service providers. **Explicit scope split, as with PH-12:** the qualified legal/privacy review, the LGPD and Marco Civil applicability, and the published privacy notice and terms of use move to [PH-28](#ph-28), which still gates real customer data and public signup. This completion closes decisions only.

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
**Dependency / trigger:** PH-10, completed PH-11 architectural selection and the reviewed PJ-24 implementation design; before provider integration or real identity use.
**Request and reason:** Confirm host capacity, a controlled HTTPS issuer address, restricted provider administration, persistent provider storage and protected signing/recovery material. Identify responsible administrators and safe recovery ownership without publishing personal account details. Prepare inputs only after the reviewed provider/version design; this action does not authorize deployment.
**Configuration:** the [configuration reference](../generated/configuration/api.md) defines the token settings `ORION_TOKEN_ISSUER`, `ORION_TOKEN_AUDIENCE` and `ORION_TOKEN_JWKS_URL` and the human identity settings `TELUNI_PUBLIC_ORIGIN`, `TELUNI_OIDC_CLIENT_ID`, `TELUNI_OIDC_CLIENT_SECRET`, `TELUNI_IDENTITY_PROVISIONER_CLIENT_ID`, `TELUNI_IDENTITY_PROVISIONER_CLIENT_SECRET` and `TELUNI_SESSION_KEYS` (the three secrets are `RESTRICTED`). The realm and clients they refer to are created by `apps/api/scripts/identity-realm.ts`, and the realm's `teluni` login theme must be installed in the deployed Keycloak (`apps/api/keycloak/themes/teluni` plus the brand mark and typeface listed by `teluniThemeFiles()`). Supply secret material only in an approved protected destination, never in this checklist or chat.
**Verification:** Record non-secret environment/issuer ownership and controlled access; during authorized implementation verify pinned provider, human-only claim provisioning, key rotation, restricted management and isolated revocation-safe restore under PH-10/PJ-13.
**Evidence / blocker:** 2026-10-18: self-hosting/Keycloak accepted by the owner; Keycloak 26.8.1 source was reviewed for compatibility, but host capacity, actual deployment version/image, issuer control, secret destination and deployment remain unverified. Foundation validation is not provisioning evidence. 2026-10-22: under the owner's delegation the [deployment design](deployment-design.md#identity-in-a-real-environment) decided the issuer `https://auth.teluni.app/realms/teluni`, the production Keycloak service (`start`, PostgreSQL storage, the pinned digest, admin console reachable only over the administration tunnel) and secrets as root-only files. Running it with the protected inputs remains.

## PH-16

- [ ] **Provide owner-controlled Google OAuth registration for the selected external login.**

**Status:** pending. **Owner:** project owner / Google application administrator.
**Dependency / trigger:** PH-07 controlled domain, PH-11 reviewed callback/provider design and PH-15; before enabling Google login in PJ-24.
**Request and reason:** Register/control the Google application and required consent/branding configuration for the actual environment. Approve exact reviewed callback origins/redirects and required identity attributes/scopes; keep environments separate. Microsoft is not selected. Do not invent callback URLs before implementation defines them or register an application in this documentation task.
**Configuration:** no Google-specific application keys are implemented. Store any future client secret in the approved protected destination; record only safe ownership/environment evidence.
**Verification:** Authorized implementation verifies the controlled callback, correct audience/environment, account linking without email-only merging and non-bypassable administrative assurance. Provider account actions are not implied by answering the questionnaire.
**Evidence / blocker:** 2026-10-18: P05=B selects Google only; no Google registration, credentials, consent setup or callback test is verified. 2026-10-22: under the owner's delegation the [deployment design](deployment-design.md#identity-in-a-real-environment) decided the registration values: one web client per environment, redirect URI `https://auth.teluni.app/realms/teluni/broker/google/endpoint`, no JavaScript origins, scopes `openid`, `email` and `profile`, and a consent screen named Teluni that links the notices PH-28 approves. Registering the client remains.

## PH-17

- [ ] **Establish a verified transactional-email path for identity invitations and recovery.**

**Status:** pending. **Owner:** project owner / domain and mail administrator.
**Dependency / trigger:** PH-07 domain control, PH-10 hosting, PH-11 flow review and PH-13 notices; before public signup or real invitations/recovery in PJ-24.
**Request and reason:** Create the account of the decided provider (Resend's free plan; Brevo's free plan as fallback), verify the sending domain `notify.teluni.app` with its SPF and DKIM records, publish the staged DMARC record, and place an API key limited to sending in the protected store ([deployment design](deployment-design.md#transactional-email-ph-17-choice)). Confirm the provider's current limits and terms. Review required DNS authentication, deliverability, abuse response and sender continuity; do not assume residential SMTP or an unspecified free service is adequate. If no suitable path exists, record the budget/readiness blocker rather than bypassing verification/recovery.
**Configuration:** the [configuration reference](../generated/configuration/api.md) defines `TELUNI_MAIL_SMTP_HOST`, `TELUNI_MAIL_SMTP_PORT`, `TELUNI_MAIL_SMTP_SECURITY` (TLS required in production), `TELUNI_MAIL_SMTP_USERNAME`, `TELUNI_MAIL_SMTP_PASSWORD` (`RESTRICTED`), `TELUNI_MAIL_FROM` and the `RESTRICTED` key ring `TELUNI_MAIL_KEYS`; Keycloak's realm SMTP settings for its own mail are written by the realm provisioning script. Credentials go only in the approved protected store. Do not publish credentials, reset or invitation links, or private recipient records.
**Verification:** Authorized implementation tests delivery/failure/retry and invitation/reset expiry/single-use behavior with synthetic addresses under actual approved sender configuration. DNS/service/account facts need owner evidence; documentation is not delivery proof.
**Evidence / blocker:** 2026-10-18: P03=A confirms no recurring identity/email procurement now. No existing sender, delivery service, DNS configuration or successful delivery is established. The approved [invitation and email delivery design](invitation-delivery-design.md) ([PH-21](#ph-21)) requires only authenticated SMTP submission with TLS from the chosen service, shared by the application and Keycloak. 2026-10-22: under the owner's delegation the agent chose the provider and sender in the [deployment design](deployment-design.md#transactional-email-ph-17-choice): Resend over SMTP with implicit TLS from `no-reply@notify.teluni.app`, DMARC `p=none` for 30 days then `p=quarantine`, and Brevo as fallback. The account, DNS verification, key and a real delivery test remain.

## PH-18

- [ ] **Verify pilot commercial acceptance, real costs/support coverage and qualified offer limits.**

**Status:** pending. **Owner:** project owner and pilot operator, with engineering/operations measurement.
**Dependency / trigger:** PJ-14/PJ-27 and PH-08/PH-10. Customer agreement and a safe bounded budget precede the pilot; measured outcomes, offer capacity and coverage precede applicable paid/public commitments.
**Request and reason:** This retains the empirical portion of PH-12's original verification scope. Confirm the customer's actual acceptance of proposed pilot/conversion conditions separately from Teluni owner approval. Record real support channels/coverage/calendar, physical capacity and original/rendition/history/backup demand, transfers/conversion, onboarding/support hours, identity/mail/network/energy and payment/fiscal costs. Qualify numerical commercial quotas before advertising/enforcing them; distinguish measured, estimated, assumed and unknown inputs.
**Configuration:** none implemented. Record safe facts/results and evidence references; no customer personal records, private support contacts, bank details or secrets in public documentation.
**Verification:** Attributable customer agreement before entry; pilot measurements and host/admission evidence; a reviewed offer whose price/usage/support commitments fit the recorded cost/capacity analysis. Compare the selected 70% contribution goal using the stated BRL 50/hour analytical assumption or a justified revised value, without claiming profitability from arithmetic. Support hours/WhatsApp are offered only with verified coverage. Measured data may require a new owner-approved price/limit change before offers; PH-12 is not an instruction to ignore contradictory evidence.
**Evidence / blocker:** 2026-10-18: all questionnaire suggestions approved, but none of the 12 cost/fact worksheet categories was supplied as measured evidence. Paid quota numbers remain a proposed qualification baseline; real support availability and customer acceptance remain unknown. Do not mark this passed through foundation tests or a policy approval.

## PH-19

- [ ] **Confirm the billing issuer, fiscal process and reviewed commercial documents before charging.**

**Status:** pending. **Owner:** project owner with qualified fiscal/legal input appropriate to the actual operation.
**Dependency / trigger:** P36/completed PH-12, PH-13 and PJ-27; before the first paid offer/charge and applicable public contracting.
**Request and reason:** Establish who supplies the SaaS, the applicable registration/fiscal/documentation process, recording and reconciliation responsibilities, reviewed subscription/cancellation/refund terms and an appropriate protected destination for financial records. The selected manual Pix/transfer method does not establish fiscal readiness. No legal holder, tax regime/rate, account or ability to issue fiscal documents is inferred from the repository or GitHub identity.
**Configuration:** none implemented; no payment/tax/provider keys or bank destination are selected. Supply financial identifiers/credentials only through appropriate protected channels, not this checklist or chat.
**Verification:** Record safe confirmation of the qualified review, responsible issuer/process and usable billing/documentation workflow; distinguish settlement, receipt and applicable fiscal documentation. Confirm final conditions against the approved commercial policy and PH-13, including cancellation/refund/retention obligations. No tax or legal compliance certification is produced by documentation validation.
**Evidence / blocker:** 2026-10-18: P36=A approved professional preparation before charging; actual formalization, fiscal process and reviewed documents remain unknown. No charge, invoice, contract or registration action was performed.

## PH-20

**Local testing follow-up, 2026-10-24:** The owner explicitly requested optional two-step verification for the local development environment. The [development assurance exception](identity-session-design.md#local-development-assurance-exception) and [PJ-24 increment](implementation-plan.md#local-development-mfa-option) record the guarded implementation. This authorizes the machine-local setting only; production MFA and real-environment qualification gates remain required. No new human blocker is introduced.

- [x] **Review and approve the proposed D-01 tenant data and D-02 identity/session designs.**

**Status:** completed. **Owner:** project owner, with engineering/security review.
**Dependency / trigger:** [PJ-28](implementation-plan.md#current-work) and PJ-29; blocks PJ-24 and PJ-03, and through them every tenant-owned Phase 2 module. The plan requires reviewed D-01/D-02 before the first product migration and identity implementation.
**Request and reason:** Read the [tenant data design](tenant-data-design.md) and the [identity and session design](identity-session-design.md), then approve, reject or adjust each decision below. They are security and persistence choices with long-lived consequences, which the repository requires a human to review rather than an agent to self-approve. (1) Row-level security is not adopted for the first slice; composite tenant keys, immutable `company_id` grants, mandatory adapter scope, per-request access resolution, a structural catalog test and the two-company suite compensate; reevaluate before PJ-14. (2) An API `identity` module in the existing process owns principals and PostgreSQL-backed sessions, with provider tokens encrypted at rest, `openid-client` and `@fastify/cookie`, and no generic session plugin. (3) The application creates principal UUIDs and writes them to an administrator-only Keycloak attribute through a `teluni-provisioner` service account holding `manage-users`. (4) Provider revalidation by token introspection every 30 seconds meets the revocation bound, so a Keycloak outage stops protected panel operations within 30 seconds. (5) Product modules reject bearer-only human requests without a session. (6) The shared module contract gains a narrow module-to-module requirement. (7) The proposed password policy (length 12–128, not username/email, no composition rules). (8) Local and CI qualification use disposable `quay.io/keycloak/keycloak` 26.8.1 and Mailpit containers pulled from their public registries, before PH-15–PH-17, which remain gates for real environments only.
**Configuration:** none. The designs name configuration concepts only; settings are added to the canonical configuration schema when implemented.
**Verification:** Record the owner's dated explicit decision per item (chat or pull-request review). On approval, mark both designs approved, complete PJ-28/PJ-29 and move PJ-24 to `in progress`. A rejected or changed item updates the affected design and, where it is a significant new mechanism, goes through the ADR process.
**Evidence / blocker:** 2026-10-18: both designs drafted and linked from the plan and the product architecture. The same day the owner explicitly approved all eight decisions above as proposed, in chat, and instructed proceeding to PJ-24/PJ-03 implementation. This approves the designs, including pulling the pinned Keycloak and Mailpit test images, and the reading that PH-15–PH-17 gate real environments rather than local/CI development. It does not qualify any Keycloak behavior or replace PJ-24's tests, and PH-15–PH-17 remain pending for real environments. The organizations company-administration increment (paged lists, settings and change history) uses the same approved disposable local environment; its qualification and remaining work are recorded in PJ-03 and the D-01/D-02 implementation status. No real provider, Google or mail environment is provisioned by that work.

## PH-21

- [x] **Review and approve the proposed D-13 invitation and durable email delivery design and ADR-0026.**

**Status:** completed. **Owner:** project owner, with engineering/security review.
**Dependency / trigger:** [PJ-30](implementation-plan.md#current-work); blocks the invitation work remaining in PJ-03, which every real onboarding of a second person into a company needs. Real sending to real people additionally remains gated by [PH-17](#ph-17) and [PH-13](#ph-13).
**Request and reason:** Read the [invitation and email delivery design](invitation-delivery-design.md) and the proposed [ADR-0026](../adr/0026-propose-a-postgresql-outbox-and-smtp-relay-for-transactional-email.md), then approve, reject or adjust each of the design's [ten decisions for review](invitation-delivery-design.md#decisions-for-review): (1) a PostgreSQL outbox written in the producer's transaction, an in-process dispatcher and a provider-neutral SMTP relay through `nodemailer`, with no broker, worker service, provider API or webhooks; (2) at-least-once delivery with up to eight attempts over about 22 hours and failures shown to the inviter; (3) a 256-bit credential stored as a hash, an encrypted delivery copy erased at the message's final state, and the link credential in the URL fragment; (4) acceptance only by a session whose verified email equals the recipient, with no email lookup at invitation time and, until signup exists, only existing verified accounts; (5) active members gain the invited grant, suspended members are refused, removed people return as a new membership (membership uniqueness then excludes removed rows); (6) revalidation at acceptance with no silent narrowing, so a responsibility transfer invalidates the former responsible administrator's pending administrator invitations; (7) who may invite whom, grant expiry, one pending invitation per address and resend replacing it; (8) limits of 50 invitations per company per day, 100 pending per company and 3 emails per address per day, with fixed `pt-BR`/`en-US` templates and no free text; (9) provisional retention of 30 days for message rows and 90 days for invitation addresses after final state, never storing addresses in audit; (10) Keycloak keeps sending its own mail synchronously through the same relay. These are security, privacy and delivery choices with long-lived consequences that the repository requires the owner, not an agent, to approve.
**Configuration:** none. The design names configuration concepts only (relay host/port/TLS mode/username, a `RESTRICTED` relay password, sender address/name and a `RESTRICTED` outbound-mail key ring); settings are added to the canonical configuration schema when implemented. No real relay credentials are needed for local or CI work, which uses Mailpit.
**Verification:** Record the owner's dated explicit decision per item (chat or pull-request review). On approval, mark the design approved and ADR-0026 accepted, complete PJ-30 and resume the PJ-03 invitation increments. A rejected or changed item updates the design and, where it changes the delivery mechanism, ADR-0026 or a new ADR.
**Evidence / blocker:** 2026-10-18: the owner asked for this design for approval; the design and ADR-0026 were drafted and linked from the plan, the product architecture and the decision index. The same day the owner explicitly approved all ten decisions as proposed, including ADR-0026, in chat, and asked to proceed to implementing invitations. This approves the design and the delivery mechanism for local and CI work with synthetic addresses and Mailpit. It does not choose the real provider or sender (PH-17), set legal retention (PH-13) or authorize sending to real people.

## PH-22

- [x] **Review and approve the proposed server-side D-03 device enrollment and lifecycle design and ADR-0027.**

**Status:** completed. **Owner:** project owner, with engineering/security review.
**Dependency / trigger:** [PJ-33](implementation-plan.md#current-work); blocks [PJ-08](implementation-plan.md#current-work), which every screen pairing needs, and through it PJ-10/PJ-11/PJ-12.
**Request and reason:** Read the [device enrollment and lifecycle design](device-enrollment-design.md) and the proposed [ADR-0027](../adr/0027-propose-device-generated-credentials-and-code-based-enrollment.md), then approve, reject or adjust each of the design's [nine decisions for review](device-enrollment-design.md#decisions-for-review): (1) an RFC 8628-style code flow owned by the API, without Keycloak for devices; (2) a device-generated 256-bit credential sent only as a hash and accepted as a bearer token on device routes only; (3) eight-consonant codes valid 10 minutes, single use, stored as a keyed HMAC; (4) the enrollment, claim and polling limits; (5) a seven-day `authorizedUntil` statement at check-in, with signing and device enforcement left to PJ-11/PJ-12; (6) rotations of 0/90/180/270 degrees limited to reported support; (7) irreversible unlink with pending, confirmed or recorded-reset erasure and new identities for reassignment; (8) `devices.view`/`devices.manage` permissions; (9) provisional retention. These are security choices with long-lived consequences for every paired screen that the repository requires the owner, not an agent, to approve.
**Configuration:** none now. The design names one new `RESTRICTED` key ring for user-code HMACs; its setting is added to the canonical configuration schema when implemented. Local and CI work uses generated keys and simulated players.
**Verification:** Record the owner's dated explicit decision per item (chat or pull-request review). On approval, mark the design approved and ADR-0027 accepted, complete PJ-33 and start PJ-08. A rejected or changed item updates the design and, where it changes the mechanism, ADR-0027.
**Evidence / blocker:** 2026-10-19: design proposed in [pull request #7](https://github.com/GabriellMDias/teluni/pull/7); the owner approved all nine decisions as proposed, including ADR-0027, in the project thread the same day and asked for implementation, which continues in PJ-08.

## PH-23

- [x] **Review and approve the proposed D-05 media library design and ADR-0028.**

**Status:** completed. **Owner:** project owner, with engineering/security review.
**Dependency / trigger:** [PJ-34](implementation-plan.md#current-work); gates merging [PJ-09](implementation-plan.md#current-work), which every playlist, publication and screen needs, and through it PJ-10/PJ-11/PJ-12/PJ-20/PJ-21.
**Request and reason:** Read the [media library design](media-library-design.md) and the proposed [ADR-0028](../adr/0028-propose-local-content-addressed-media-storage-and-isolated-ffmpeg-processing.md), then approve, reject or adjust each of the design's [nine decisions for review](media-library-design.md#decisions-for-review): (1) local content-addressed storage per company with atomic publication and a free-space reserve; (2) FFmpeg 6.1+ as the only parser and converter, in isolated child processes with timeouts, and an in-process PostgreSQL-leased processor; (3) the accepted image and video formats and bounds; (4) the single display rendition profile (H.264 High 4.1 up to 1080p30 with AAC, images within 3840×2160 with metadata removed); (5) a create request followed by one streamed upload, without a resumable protocol; (6) company or branch ownership and the `media.view`/`media.upload`/`media.archive`/`media.delete` permissions; (7) archive, delete blocked by protected references, a 30-day trash and reference-checked purge; (8) the abuse limits; (9) provisional retention. These are security, storage and processing choices with long-lived consequences for every customer file, which the repository requires the owner, not an agent, to approve.
**Configuration:** none now. The design names `TELUNI_MEDIA_STORAGE_PATH`, `TELUNI_MEDIA_FFMPEG_PATH`, `TELUNI_MEDIA_FFPROBE_PATH` and `TELUNI_MEDIA_PROCESSING_CONCURRENCY`, added to the canonical configuration schema with the implementation; none is secret. Local and CI work uses a temporary directory and the distribution's FFmpeg.
**Verification:** Record the owner's dated explicit decision per item (chat or pull-request review). On approval, mark the design approved and ADR-0028 accepted, complete PJ-34 and merge PJ-09 work. A rejected or changed item updates the design and, where it changes the mechanism, ADR-0028.
**Evidence / blocker:** 2026-10-19: the owner asked for development to continue autonomously; the design and ADR-0028 were drafted, linked from the plan, the product architecture and the decision index, and implemented on the same branch following the recommended options so the review can see working behavior. The same day the owner approved all nine decisions as proposed, including ADR-0028, on the decision card in the project thread; implementation continues in PJ-09.

## PH-24

- [x] **Review and approve the proposed D-06 programming design and ADR-0029.**

**Status:** completed. **Owner:** project owner, with engineering review.
**Dependency / trigger:** [PJ-35](implementation-plan.md#current-work); gates merging [PJ-10](implementation-plan.md#current-work), which every publication and screen schedule needs, and through it PJ-11/PJ-12/PJ-20.
**Request and reason:** Read the [programming design](programming-design.md) and the proposed [ADR-0029](../adr/0029-propose-temporal-based-schedule-evaluation-with-shared-fixtures.md), then approve, reject or adjust each of the design's [eleven decisions for review](programming-design.md#decisions-for-review): (1) reusable company or branch playlists and one program per group and per screen; (2) groups with a fixed branch span; (3) the rule representation; (4) wall-clock conflict validation; (5) the DST handoff refinement of P14; (6) the Temporal-based evaluator with `temporal-polyfill` and canonical fixtures; (7) items and transitions; (8) `programming.view`/`programming.edit`/`programming.assign`; (9) the unpublished-destination confirmation; (10) deletion only when unused; (11) the limits. Decision 5 refines an owner-selected policy, and the others shape every customer's schedules, which the repository requires the owner, not an agent, to approve.
**Configuration:** none. The design adds no setting.
**Verification:** Record the owner's dated explicit decision per item (chat or pull-request review). On approval, mark the design approved and ADR-0029 accepted, complete PJ-35 and merge PJ-10 work. A rejected or changed item updates the design and, where it changes the mechanism, ADR-0029.
**Evidence / blocker:** 2026-10-19: the owner asked for development to continue autonomously; the design and ADR-0029 were drafted, linked from the plan, the product architecture and the decision index, and are being implemented following the recommended options so the review can see working behavior. The same day the owner approved all eleven decisions as proposed, including ADR-0029, on the decision card in the project thread; implementation continues in PJ-10 ([pull request #11](https://github.com/GabriellMDias/teluni/pull/11), merged on 2026-10-20).

## PH-25

- [x] **Review and approve the proposed D-04 publication and synchronization design and ADR-0030.**

**Status:** completed. **Owner:** project owner, with engineering review.
**Dependency / trigger:** [PJ-36](implementation-plan.md#current-work); gates merging [PJ-11](implementation-plan.md#current-work), which screens need to show any published programming, and through it PJ-12/PJ-14.
**Request and reason:** Read the [publication and synchronization design](publication-sync-design.md) and the proposed [ADR-0030](../adr/0030-propose-pull-based-screen-synchronization-with-signed-authorization-statements.md), then approve, reject or adjust each of the design's [ten decisions for review](publication-sync-design.md#decisions-for-review): (1) one immutable generation sequence per program, published with the reviewed content digest; (2) desired state derived at each synchronization, with the assignment confirmation only for unpublished destinations; (3) polling every 30 seconds with downloads limited to the desired publication; (4) the protocol 1 manifest; (5) ES256 authorization statements with a seven-day expiry and signed server time; (6) validation at publication, refusing fades until a profile is qualified; (7) `publications.publish`; (8) state reports and monitoring; (9) retention for 90 days and restore; (10) the limits. They decide what customers' screens are allowed to play, for how long offline, and who may publish, which the repository requires the owner, not an agent, to approve.
**Configuration:** `TELUNI_SYNC_SIGNING_KEYS` (secret key ring) in real environments, provisioned under PJ-13; local and CI runs generate disposable keys.
**Verification:** Record the owner's dated explicit decision per item (chat or pull-request review). On approval, mark the design approved and ADR-0030 accepted, complete PJ-36 and merge PJ-11 work. A rejected or changed item updates the design and, where it changes the mechanism, ADR-0030.
**Evidence / blocker:** 2026-10-19: the owner asked for development to continue autonomously; the design and ADR-0030 were drafted, linked from the plan, the product architecture and the decision index, and are being implemented following the recommended options so the review can see working behavior. On 2026-10-20 the owner approved PH-25 in the session chat, which covers all ten decisions as proposed, including ADR-0030, and delegated to the agent any further decision that needs a choice. The design is marked approved, ADR-0030 accepted and PJ-36 completed; PJ-11 continues in its pull request.

## PH-26

- [ ] **Allow the cloud development environment to reach Google's Maven repository and Gradle's downloads.**

**Status:** pending. **Owner:** project owner (environment settings).
**Dependency / trigger:** [PJ-12](implementation-plan.md#current-work); blocks building and testing the player's Android `app` module in the cloud development environment, and running the Gradle wrapper there. The pure-JVM `core` module and the CI job are not blocked: GitHub's runners reach both hosts, and the environment's preinstalled Gradle matches the wrapper's version.
**Request and reason:** In the cloud environment's settings (the environment menu in the session's title bar, then Edit, then Network access), add `dl.google.com` and `downloads.gradle.org` to the allowed domains with the package-manager defaults kept. `https://maven.google.com` redirects every Android Gradle plugin, AndroidX and Media3 artifact to `dl.google.com`, and the Android SDK platforms come from it too. `services.gradle.org` redirects Gradle distributions to `downloads.gradle.org`. On 2026-10-20 the proxy refused it with 403. An agent cannot change its own network policy, and writing Android code that cannot be compiled or tested would not meet the repository's verification rules. Steps: https://code.claude.com/docs/en/cloud-environments#network-access.
**Configuration:** none in the repository.
**Verification:** In a new session, `curl -sI https://dl.google.com/dl/android/maven2/com/android/tools/build/gradle/maven-metadata.xml` and `curl -sI https://downloads.gradle.org/distributions/gradle-8.14.3-bin.zip` answer 200, and `./gradlew check` in `apps/player` downloads Gradle and resolves its dependencies.
**Local development evidence (2026-10-24):** On the owner's Linux host, Google Maven and the Gradle distribution resolved to HTTP 200; Gradle, the Android SDK and the Android TV image downloaded successfully. Local PJ-12 work can proceed. The cloud environment's independent policy has not been rechecked or changed. 2026-10-25: PR #30's initial GitHub Player job reached dependency resolution but found four missing Gradle verification entries. This was reproduced with an empty local cache; regenerated metadata was independently verified against Maven Central, and the strict build passed in a second empty user home with 144 player tests. Evidence and the distinction from broader PR qualification are recorded in the [player implementation status](player-design.md#implementation-status); it introduces no new human prerequisite.

**Evidence / blocker:** 2026-10-20: `maven.google.com` answered 301 to `dl.google.com`, and the proxy refused `dl.google.com` with 403; `services.gradle.org` answered 301 to `downloads.gradle.org`, which the proxy also refused. Maven Central and the Gradle plugin portal were reachable. The owner was told about `dl.google.com` in the session chat.

## PH-27

- [ ] **Create and keep the player's release signing key.**

**Status:** pending. **Owner:** project owner.
**Dependency / trigger:** [PJ-12](implementation-plan.md#current-work) increment 4 and any APK installed on a pilot screen. It does not block development or CI, which build debug or unsigned release APKs.
**Request and reason:** Android accepts an update only when it is signed with the same key as the installed app, so the key that signs the first pilot APK must sign every later release. It must stay outside the repository and agent sessions. Create an RSA 4096 or EC P-256 key in a PKCS12 keystore (for example with `keytool -genkeypair -keystore teluni-player-release.p12 -storetype PKCS12 -alias teluni-player -keyalg RSA -keysize 4096 -validity 10000`). Keep it with two offline backups, and record only the certificate's SHA-256 fingerprint in the player's installation guide. Losing the key means every screen must be reset and reinstalled.
**Configuration:** the release build will read the keystore path, alias and passwords from Gradle properties or environment variables that the player README names when release signing is implemented; never commit their values.
**Verification:** The fingerprint is recorded, an APK signed by the release process verifies with `apksigner verify --print-certs` against it, and an update signed with the same key installs over the previous release on a test device.
**Evidence / blocker:** 2026-10-20: requested by the [player design](player-design.md#updates-and-compatibility); no key exists yet. 2026-10-25: the PJ-12 credential-rotation increment passed 138 player tests and a local emulator upgrade/restart exercise using only local/test infrastructure; it does not require this APK signing key. Verification and the separate repository-gate caveat are recorded in the [player implementation status](player-design.md#implementation-status). Release signing, update distribution and real-device installation still require this action; no production key is created or handled by the agent.

## PH-28

- [ ] **Have the data handling policies reviewed by a qualified professional and publish the privacy notice and terms of use.**

**Status:** pending. **Owner:** project owner with qualified legal/privacy input.
**Dependency / trigger:** split from [PH-13](#ph-13) on 2026-10-22; PJ-13/PJ-14 before real customer or personal data, public signup or the Google consent screen ([PH-16](#ph-16)); PH-19 for the commercial terms.
**Request and reason:** Have a lawyer or privacy professional review the [data handling policies](data-handling-policies.md) against the actual operation. The review confirms or changes: the controller/processor roles, the retention durations (including the 5-year commercial ledger and the Marco Civil access-record question), the 15-day request deadline, incident notification to the ANPD and data subjects, and the international transfers to the listed providers. Then publish a privacy notice and terms of use in Portuguese, including the upload restrictions, at addresses the panel and consent screen can link. An agent can draft texts, but cannot give or replace legal advice.
**Configuration:** none. Do not put customer records or private advice in public documentation.
**Verification:** A dated record of the review's conclusions (not the private advice itself), the policies updated to match, and the published notice and terms reachable from the panel.
**Evidence / blocker:** 2026-10-22: policies decided under the owner's delegation; no review has taken place and no notice or terms are published.

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
