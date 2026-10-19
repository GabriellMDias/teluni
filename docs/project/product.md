# Teluni Product Vision

[Project documentation](README.md) · [MVP scope](mvp.md) · [Delivery phases](implementation-plan.md#phase-sequence-and-exit-criteria)

## Purpose and positioning

**Decided:** Teluni is a multi-tenant digital signage SaaS for centralized management of visual content on televisions, monitors, and other display devices. It should combine simple operation, reliable local playback, freeform simultaneous presentation and configurable data-driven content. Brazil is the initial market, with international commercialization anticipated. The owner selected initial capabilities for product quality rather than limiting them solely by the MVP label.

| Locale  | Intended slogan                   |
| ------- | --------------------------------- |
| `pt-BR` | Todas as suas telas. Um só lugar. |
| `en-US` | Every screen. One place.          |

**Decided:** the owner approved Teluni as the product name and `teluni.app` as the principal domain. `teluni.com.br` is the secondary/defensive Brazil option (availability reported by the owner); unavailable/premium `teluni.com` is outside the current budget and scope. [Branding](branding/README.md) owns these decisions and the approved Connected Tiles identity. Preliminary trademark research has advanced, but registration/control and final clearance are not inferred. Connected Tiles is integrated into the web shell, portal and favicon, with the selected locally served font and derived touch icon. [PH-07](human-actions.md#ph-07) remains in progress for domain registration/control and trademark evidence.

## Origin and pilot

The initial opportunity is a snack bar considering televisions for products, images, videos, and promotions. It is a candidate pilot, not a confirmed customer or an exclusive definition of the product.

The owner's experience with PDT Display provides conceptual learning only. Teluni must have independent architecture, identity, and implementation. Do not copy PDT Display code, assets, credentials, customer data, private designs, or proprietary information without authorization. Authorized Orion material remains governed by the repository's provenance and license. The owner selected Apache-2.0 for Teluni source and documentation; [ADR-0022](../adr/0022-license-teluni-under-apache-2-0.md) records that decision and [PH-06](human-actions.md#ph-06) records its verification. SaaS pricing and customer terms remain separate commercial decisions.

## Audience and use cases

| Segment                                   | Representative use case                                       |
| ----------------------------------------- | ------------------------------------------------------------- |
| Restaurants, snack bars, pizzerias, cafes | Menus, featured products, opening-period promotions           |
| Supermarkets and retail                   | Offers, prices, announcements, local campaigns                |
| Gyms and sports centers                   | Class schedules, instructions, promotions                     |
| Clinics, practices, hospitals             | General service information and approved public announcements |
| Hotels and hospitality                    | Guest information, services, events                           |
| Offices and corporate environments        | Internal communications and visual announcements              |
| Chains and franchises                     | Central publication with authorized branch-level operation    |

These are target use cases, not implemented integrations or an invitation to process sensitive patient or employee records. Sector-specific needs belong in specialized features without making the signage core restaurant-specific. One company with one branch must remain simple to operate; many branches and large device fleets must fit the conceptual ownership model, with supported capacity established through measurement.

## Actors and core journeys

The [security model](security-and-i18n.md#actors-and-authorization) routes to the selected human access policies and their pending technical enforcement. The product journeys are:

1. A verified eligible registrant creates a new company through public automatic activation and becomes its responsible administrator, subject to commercial/privacy/abuse readiness. The platform retains a controlled assisted-enrollment path without claiming existing companies by name or domain.
2. A company administrator creates branches and delegates permitted operations to members.
3. An authorized operator pairs a display using a temporary code shown by the player and assigns it to the correct branch.
4. An authorized publisher uploads media, configures typed catalogs/fields/records (for example products or a weekly agenda), composes regional content/schedules, previews and publishes.
5. Authorized price saves automatically publish affected already-published data bindings, without releasing unrelated drafts or recreating artwork. Other draft edits retain explicit publication.
6. The player stages complete consistent versions and continues local media/catalog rendering through the selected offline/clock envelope, with independent areas or optional coordinated pages.
7. A scoped operator sees last contact, synchronization progress and actionable failures without unrestricted remote access. Actual player observation is distinct from server intent.

Acceptance of these journeys is specified in [release requirements](mvp.md). The owner selected [human identity/access policies](identity-and-access.md), including public signup with automatic company activation, Google-only external login, multi-company memberships, a responsible administrator and customizable scoped profiles. The owner accepted the architecture ADRs and completed PH-11 decision selection; actual Keycloak/session qualification and external readiness remain pending; no signup/session flow is implemented.

## Product objectives

| Objective                       | Intended outcome                                                                                                                                          | Verification owner                                                    |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Centralized remote operation    | Manage displays, reusable media, playlists, and scheduling from one panel                                                                                 | MVP acceptance                                                        |
| Reliable presentation           | Continuous local playback with controlled publication and recovery                                                                                        | Playback/sync acceptance                                              |
| Simultaneous presentation       | Freeform regional content/schedules, optional page coordination, multiple videos/audio and isolated recovery on one TV                                    | FR-10 acceptance and qualified device profile                         |
| Configurable structured content | Users define catalog fields/records and bind products/prices, weekly agendas or other approved data into layouts; designated prices publish automatically | FR-11 acceptance, schema/reference safety and consistent publications |
| Simple commercial use           | A nontechnical pilot operator can complete the core journey                                                                                               | Pilot usability session                                               |
| Tenant and branch ownership     | Support independent companies and authorized branch scopes                                                                                                | Security acceptance                                                   |
| Operational visibility          | Explain stale devices and synchronization failures safely                                                                                                 | Monitoring acceptance                                                 |
| Sustainable growth              | Measure storage, traffic, processing, support, and capacity before expansion                                                                              | Pilot operating review                                                |
| Extensibility                   | Extend presentation authoring, dynamic prices, integrations, and player platforms without coupling the core to one sector                                 | Architecture review                                                   |

The [release targets](release-targets.md) select task-time, continuity, rendering, storage and reference-fleet goals under completed PH-09. Actual pilot/hardware/load results remain pending; no supported-device capacity, SLA, unlimited resources or operating-cost result is promised. [Release policies](release-policies.md) own the approved behaviors and owner/delegated decision provenance.

## Commercial hypotheses

**Decided for planning on 2026-10-18:** the owner approved all PH-12 questionnaire recommendations. [Commercial policies](commercial-policies.md) own the 30-day accompanied pilot, 14-day automatic public trial, per-output license definition, single initial monthly offer, BRL validation prices, delegated quota qualification, support and cancellation conditions. PH-12 owner policy selection is complete; actual cost/support, customer acceptance and offer readiness remain PH-18, with fiscal/billing readiness PH-19.

The selected validation price is BRL 79.90/company/month for up to two licenses and BRL 29.90 per additional license. This is an approved validation hypothesis, not a public offer, profitable operation or accepted customer contract. Public automatic signup receives the bounded trial only after capacity/security/privacy readiness; P16 delegates dimensioning, so the proposed paid resource table must not be sold as qualified capacity. Conditional support channels/hours do not establish actual coverage.

Basic manual commercial authorization/licensing is an initial-release requirement under PJ-27; automatic billing, payment-gateway integration, annual offers, financial referral incentives and foreign sales remain future evaluation. The pilot must collect actual costs and willingness to continue. International presentation follows the [localization requirements](security-and-i18n.md#internationalization).

There is currently no cloud-service budget. Residential hosting is the accepted entry architecture with explicit [operational gates and risks](operations.md), not a commitment to production availability.
