# Teluni Product Vision

[Project documentation](README.md) · [MVP scope](mvp.md) · [Delivery phases](implementation-plan.md#phase-sequence-and-exit-criteria)

## Purpose and positioning

**Decided:** Teluni is a multi-tenant digital signage SaaS for centralized management of visual content on televisions, monitors, and other display devices. It should combine simple operation, reliable continuous playback, flexible presentation, and eventually dynamic commercial content. Brazil is the initial market, with international commercialization anticipated.

| Locale | Intended slogan |
| --- | --- |
| `pt-BR` | Todas as suas telas. Um só lugar. |
| `en-US` | Every screen. One place. |

Teluni is the intended product name. Trademark registration and final domain availability are **pending** verification under [PH-07](human-actions.md#ph-07). The existing neutral brand assets are placeholders; this stage does not replace them.

## Origin and pilot

The initial opportunity is a snack bar considering televisions for products, images, videos, and promotions. It is a candidate pilot, not a confirmed customer or an exclusive definition of the product.

The owner's experience with PDT Display provides conceptual learning only. Teluni must have independent architecture, identity, and implementation. Do not copy PDT Display code, assets, credentials, customer data, private designs, or proprietary information without authorization. Authorized Orion material remains governed by the repository's provenance and license. Teluni's own licensing remains [PH-06](human-actions.md#ph-06).

## Audience and use cases

| Segment | Representative use case |
| --- | --- |
| Restaurants, snack bars, pizzerias, cafes | Menus, featured products, opening-period promotions |
| Supermarkets and retail | Offers, prices, announcements, local campaigns |
| Gyms and sports centers | Class schedules, instructions, promotions |
| Clinics, practices, hospitals | General service information and approved public announcements |
| Hotels and hospitality | Guest information, services, events |
| Offices and corporate environments | Internal communications and visual announcements |
| Chains and franchises | Central publication with authorized branch-level operation |

These are target use cases, not implemented integrations or an invitation to process sensitive patient or employee records. Sector-specific needs belong in specialized features without making the signage core restaurant-specific. One company with one branch must remain simple to operate; many branches and large device fleets must fit the conceptual ownership model, with supported capacity established through measurement.

## Actors and core journeys

The [security model](security-and-i18n.md#actors-and-authorization) defines proposed privileges. The product journeys are:

1. A platform administrator establishes a customer company and its initial company administrator.
2. A company administrator creates branches and delegates permitted operations to members.
3. An authorized operator pairs a display using a temporary code shown by the player and assigns it to the correct branch.
4. An authorized publisher uploads images/videos, composes and previews a playlist and schedule, and explicitly publishes it.
5. The player stages a complete version and continues local playback through a network/server outage.
6. A scoped operator sees last contact, synchronization progress, and actionable failure information without obtaining unrestricted remote access.

Acceptance of these journeys is specified in [MVP requirements](mvp.md); the exact enrollment and permission policies remain review items there.

## Product objectives

| Objective | Intended outcome | Verification owner |
| --- | --- | --- |
| Centralized remote operation | Manage displays, reusable media, playlists, and scheduling from one panel | MVP acceptance |
| Reliable presentation | Continuous local playback with controlled publication and recovery | Playback/sync acceptance |
| Simple commercial use | A nontechnical pilot operator can complete the core journey | Pilot usability session |
| Tenant and branch ownership | Support independent companies and authorized branch scopes | Security acceptance |
| Operational visibility | Explain stale devices and synchronization failures safely | Monitoring acceptance |
| Sustainable growth | Measure storage, traffic, processing, support, and capacity before expansion | Pilot operating review |
| Extensibility | Add layouts, dynamic prices, integrations, and player platforms without coupling the core to one sector | Architecture review |

Targets for task completion time, playback continuity, supported fleet size, and operating cost are **pending** pilot/hardware evidence; no SLA or unlimited capacity is promised.

## Commercial hypotheses

**Decided:** recurring SaaS is the intended business model. **Proposed:** charge primarily by number of screens, potentially with a company minimum and feature-based plans. BRL 79.90/month for up to two screens is an exploratory price only, not an approved offer, entitlement, tax treatment, or billing rule.

Prices, plans, storage/traffic/processing limits, support hours, installation fees, cancellation, costs, and partner/referral arrangements require [PH-12](human-actions.md#ph-12). The snack bar pilot should provide evidence of usability, reliability, support demand, willingness to pay, and actual costs. Automatic billing and payment-gateway integration are **future**, not MVP prerequisites. International currencies and presentation follow the [localization requirements](security-and-i18n.md#internationalization).

There is currently no cloud-service budget. Residential hosting is an entry proposal with explicit [operational gates and risks](operations.md), not a commitment to production availability.
