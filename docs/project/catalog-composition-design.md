# Teluni Catalog and Composition Design

[Release policies](release-policies.md) · [Acceptance targets](release-targets.md) · [Identity and access policies](identity-and-access.md#permission-model-and-default-matrix) · [Programming design](programming-design.md) · [Publication and synchronization design](publication-sync-design.md) · [Player design](player-design.md) · [Media library design](media-library-design.md) · [ADR-0023](../adr/0023-propose-versioned-catalog-and-composition-publications.md) · [ADR-0032](../adr/0032-represent-money-as-integer-minor-units-with-a-currency-per-field.md)

## Status and scope

**Decided detailed design for D-11 and the monetary part of D-10, 2026-10-20.** The owner delegated every pending decision to the agent on 2026-10-20 (recorded with [PH-25](human-actions.md#ph-25)). The agent took the [decisions](#decisions) below under that delegation, together with ADR-0032. Merging the pull request that adds this design is the repository review. The decisions authorize [PJ-21](implementation-plan.md#current-work) and [PJ-20](implementation-plan.md#current-work) in local and CI environments, increment by increment. They do not qualify any rendering profile; AT-04 and the device measurements remain [PH-08](human-actions.md#ph-08) evidence.

In scope:

- user-defined typed catalogs: schemas with stable fields, records and availability;
- monetary fields with exact values, branch overrides and promotions;
- layouts with freeform areas, catalog views and their pagination, and coordinated pages;
- programs that use a layout, with schedules per area;
- the publication protocol that carries layouts and catalog snapshots to screens (protocol 2);
- automatic publication when prices are saved (FR-10, FR-11).

Out of scope, with their owners:

- optional approval of prices (IA-12, PJ-24);
- commercial quotas on catalogs (PJ-27);
- import from external systems (Phase 4);
- rendering on the device (PJ-12, which this design states as protocol obligations);
- fades, which stay refused until a profile qualifies them (PH-08).

## Policy inputs

The design applies these policies without changing them:

- **Catalogs are configurable.** They are tenant-owned, user-configurable collections with typed fields and records. Products, menus and weekly agendas are configurations, not mandatory schemas ([configurable catalogs](release-policies.md#configurable-catalogs)).
- **Customization stays inside safe types.**
  - Field types cover text, numbers, booleans, dates and times, selections, money, authorized media and scoped record references.
  - Customization never runs code, SQL or markup.
  - Stable field identity preserves bindings, and renaming a label never changes meaning.
  - A destructive change needs explicit handling.
  - Published versions keep their own schema and values.
- **Money is exact and per branch.** Every amount has an explicit currency and exact representation, with no conversion. A company base price may be overridden per branch, and the effective branch value is previewed.
- **Promotions and availability.** A promotion applies only within its validity, then falls back to the normal price. Competing promotions for the same product and branch are rejected. Unavailable items are hidden by default, unless a view chooses to show them as unavailable. All of this must be evaluable offline.
- **Catalog views never hide text silently.** Views bind fields into lists, tables, menus or agendas, with automatic or manual pagination, grouping, and a minimum readable text size. Names and prices are never silently clipped; an overflow that cannot be resolved is a visible validation error.
- **Freeform composition** ([composition and regional playback](release-policies.md#composition-and-regional-playback)):
  - Areas can be positioned and resized freely.
  - Layouts are versioned text that can be copied, imported and exported.
  - Areas advance independently, with optional coordinated pages.
  - Each area has its own schedules and an optional default. A regional schedule survives page changes; when it ends, the area returns to the page, then to its default, then to neutral output.
  - Page durations never cut a full video.
  - Several videos can play at once on a measured profile.
  - New areas start muted, and audio is mixed only deliberately.
  - Area failures stay isolated.
- **Price saves publish.** An authorized price save automatically publishes the affected published content as a new version and never publishes unrelated drafts.
  - The save is accepted only if every affected target is authorized; otherwise the whole save is rejected, with no partial distribution.
  - Saved, queued, failed and published states are distinguished.
  - Duplicates and stale work never replay an older price.
  - A publication holds consistent layout, schema, record, price and media versions ([assignment and publication](release-policies.md#assignment-and-publication), [publication impact](identity-and-access.md#publication-impact-and-delayed-work)).
- **Permissions** follow the [matrix](identity-and-access.md#permission-model-and-default-matrix): "Author layouts, playlists and agendas", "Change prices with automatic publication", "Create shared company catalog/schema", and "Edit records without automatic publication". Anyone who may distribute prices automatically needs strong authentication.

## Concepts

- A **catalog** is a named collection owned by the company or by one branch, with a **schema**: an ordered list of **fields**. Each field has a stable identifier, a label that may change, a type that never changes, whether it is required, and type options. Every schema change increments the catalog's schema version.
- A **record** is one entry of a catalog. It has a value for each field, an availability flag, and a position. Records of money fields are the **prices**.
- A **price** is the base amount of a money field on a record. A **branch override** replaces it for one branch. A **promotion** replaces it within a local validity window, for the whole company or for one branch.
- A **layout** is a reusable canvas (landscape 1920×1080 or portrait 1080×1920 units) with **areas**. Each area has a rectangle, a stacking order, a background, audio settings and a kind:
  - **Media** areas play playlists.
  - **Catalog** areas show a **catalog view**, which binds catalog fields into a list, table, menu or agenda with pagination and grouping.
- A **program with a layout** has one output per area, instead of the single `screen` output. Each output has schedule rules and a default, exactly as programming defines them.
- **Pages** optionally coordinate some areas: a layout may define pages with durations. Page-controlled areas change content together at each page boundary, while independent areas keep their own timing.

## Catalogs

**Ownership and visibility** mirror playlists:

- A catalog belongs to the company or to one branch.
- A company catalog is visible to anyone with `catalogs.view` anywhere in the company, and its schema is editable only with company-wide `catalogs.manage`.
- A branch catalog needs the capability on its branch.
- A program may use a catalog only when every branch the program reaches is inside the catalog's scope, as programming requires for playlists.

**Field types**, with their stored and published values:

| Type | Options | Value |
| --- | --- | --- |
| `text` | maximum length 1–500 (120 by default) | string without control characters |
| `longText` | maximum length 1–2,000 (500 by default) | string; line breaks allowed |
| `number` | decimal places 0–4, optional minimum and maximum | canonical decimal string (`"12.50"` with two places), never a binary float |
| `boolean` | — | `true` or `false` |
| `date` | — | `YYYY-MM-DD` |
| `time` | — | `HH:MM` |
| `weekdays` | — | ISO weekdays 1–7, distinct and sorted, for agendas |
| `selection` | 1–100 options, each with a stable identifier and a label | an option identifier |
| `money` | ISO 4217 currency (fixed per field), whether promotions are allowed | integer amount in the currency's minor units (ADR-0032) |
| `media` | — | an image asset the catalog's scope may select (media port `requireSelectable`) |
| `reference` | target catalog of the same company | a record identifier of that catalog |

A required field must have a value on every record. Text values are trimmed, and empty text counts as absent. A schema allows at most 60 fields.

**Schema changes** are saved as the whole ordered field list with the expected catalog version, like rules.

- New fields get identifiers.
- A field's type and currency never change. To change either, a person adds a new field and archives the old one.
- Archiving a field keeps its values and hides it from editing and new bindings. Published versions keep their own schema copy.
- A field bound by a layout draft cannot be archived until the binding is removed; the error names the layouts.
- Making a field required is refused while any record lacks a value for it, and the error says how many records lack one.
- Selection options keep their identifiers. A removed option is refused while records use it.

**Records** are saved one at a time with the record's expected version.

- A record's values are a map from field identifier to value, validated against the current schema.
- Unknown and archived field identifiers are refused.
- References must point to an existing record of the target catalog that the caller may see.
- Records are listed in their stored order, with a cursor. Moving a record between positions is its own versioned operation.
- A record whose identifier another record references cannot be deleted (`CATALOG_RECORD_REFERENCED`); the error counts the referring records.
- Availability is a built-in flag, not a field. A view hides unavailable records unless it shows them as unavailable.
- A catalog holds at most 5,000 records, and a record's values at most 16 KiB of JSON.

**Prices.** A money value on the record is the **base price**. Overrides and promotions are separate rows, so each change is attributable and checked on its own:

- **Branch overrides** set an amount for one branch of the catalog's scope. They are possible only on company catalogs, because a branch catalog already has one branch.
- **Promotions** set an amount for a local window `[start, end)` (`YYYY-MM-DDTHH:MM`, evaluated in each screen's local time like schedules), for the whole scope or for one branch.
  - Two promotions of the same record and field are refused when their windows overlap and their branch scopes intersect. A company-wide promotion intersects every branch.
  - A promotion that already ended can be removed but not edited.
- **Effective price** for a branch at a local instant: an applicable promotion, otherwise the branch override, otherwise the base price. When a record has no base price and no override for the branch, the price is absent, and a view shows the field as empty.

Every price change (base, override or promotion) is a **price save** under the access policies: it needs `prices.edit` on the scope it affects and strong authentication. Increment 4 adds automatic publication. Until then, price saves are drafts like any other edit, because no published content binds catalogs yet.

## Layouts

**Layouts** are owned like catalogs and playlists, and authored with `programming.edit`, because the matrix groups layouts with playlists and agendas. A layout has:

- a name;
- an orientation;
- 1–12 areas;
- 0 or 2–20 pages;
- a version and a schema version.

**Areas:**

- **Geometry.** Integer canvas units with `x ≥ 0`, `y ≥ 0`, `width ≥ 40`, `height ≥ 40`, inside the canvas, and a unique stacking order. Overlap is allowed (for example, a logo over a video) and drawn by stacking order.
- **Appearance.** A background color in `#RRGGBB`, and a fit for media: `contain` by default, or `cover`, which crops but never distorts.
- **Audio.** Muted by default, with volume 0–100. Mixing two audible areas needs an explicit confirmation flag on the layout.
- **Kind.**
  - A **media** area plays playlists that its program output selects.
  - A **catalog** area shows a catalog view.

**Catalog views:**

- **Data.** A catalog, and the bound fields in order. Each bound field has a role: `title`, `subtitle`, `price`, `image`, `detail` or `group`.
- **Presentation.** `list`, `table`, `menu` (title and price aligned) or `agenda` (grouped by `weekdays`, then sorted by `time` fields).
- **Text.** A text size in canvas units (the minimum readable size is 24 units, about 2.2% of 1080). Text never shrinks below it.
- **Unavailable records.** Hidden, or shown as unavailable.
- **Grouping.** By a `selection` field, in option order.
- **Pagination.** Automatic every 5–120 seconds (10 by default), or by page when the area is page-controlled.
- **Overflow is validated.** The layout check computes how many records fit per page from the area's height, the text size and the fields shown. A title or price that does not fit its column at the chosen size fails validation and names the record. Records are never clipped or truncated, and a view with too many records only gains pages.

**Pages and coordination:**

- A layout with pages has explicit page durations (1–600 seconds).
- When the page-controlled media areas use a playlist, the check suggests a duration that covers its longest video, and rejects a duration shorter than any video those areas play on that page.
- A page-controlled media area names, for each page, one media item from the layout's scope. A shorter video holds its last frame.
- A page-controlled catalog area names the view page or the group to show.
- Independent areas ignore pages.
- A regional schedule on a page-controlled area overrides that area only while it lasts; the area then returns to the current page.

**Text representation:** a layout exports as versioned JSON (`teluni.layout`, schema 1) with areas, views, pages and bindings by stable identifier. Importing validates it like any save, inside the importer's scope. References to catalogs, fields or media that the importer cannot see are reported and must be remapped, never silently kept.

## Programs with layouts

- **Choosing a layout.** A program chooses either no layout, which keeps the single `screen` output, or one layout. Choosing a layout is a versioned program change.
- **Outputs.**
  - Each area becomes an output keyed by the area's stable key, with the existing rule and default model.
  - A media area output selects playlists.
  - A catalog area output may select playlists for its regional schedules, and its default is the area's view.
- **Changing the layout.**
  - Outputs of areas that no longer exist are removed only when the layout change is confirmed.
  - The response lists rules that would be lost, and the panel asks for confirmation.
- **Scope.** The program's reach must fit inside the scopes of the layout and of every catalog its views use, as playlists do.
- **Evaluation.** The evaluator is unchanged and runs per output. Coordinated pages are a pure function of the page durations and a cycle anchored at local midnight. Every screen of a group therefore shows the same page at the same local time, and the preview can show it.

## Publication protocol 2

A program without a layout keeps publishing protocol 1, byte for byte, so current screens are unaffected. A program with a layout publishes **protocol 2**, which adds the following to the manifest:

- **`layout`.** The canvas, the areas (geometry, stacking order, appearance, audio, kind), the catalog views and the pages, copied from the layout's draft at publication.
- **`outputs` per area.** Rules and defaults, with the catalog-view default marked as `{"view": true}`.
- **`catalogs`.** For each catalog a view uses:
  - a schema snapshot with only the bound fields;
  - every record with its values, availability and position;
  - each money field's base price, branch overrides and promotions limited to the branches the program reaches;
  - media referenced by `media` fields, in the publication's media list.

A screen receives the program's single manifest. To resolve overrides and promotions for its branch, it needs its `branchId`, which the sync response gains next to `rotation`. Effective prices, availability, pagination and pages are evaluated on the screen from the snapshot, trusted time and zone offsets, with fixtures shared by the API's preview and the player, like schedules.

Protocol negotiation is unchanged. A screen that supports only protocol 1 and desires a protocol 2 publication reports `INCOMPATIBLE` and keeps its active generation, and the panel shows why.

## Automatic price publication

A price save on a record of catalog C:

1. **Authorizes the save.** Base, override or promotion scope, with strong authentication.
2. **Finds the affected targets.** These are the programs whose latest publication includes C. The publication's catalog rows are indexed for this lookup.
3. **Authorizes every target.** The saver must hold `publications.publish` on each one. If any is outside their scope, the whole save is refused with `PRICE_TARGET_FORBIDDEN`, and nothing is saved or distributed.
4. **Commits the price and one durable intent per affected program** in the same transaction. Each intent holds the program, the price change's sequence number and the author.

A processor in the API (leased rows, like the mail outbox of ADR-0026) turns each intent into a new generation:

- It copies the program's latest publication content.
- It replaces only that catalog's price rows with the current prices: base, overrides and promotions.
- It publishes through the normal path with `restoredFromGeneration` null and `trigger: "price"`.
- It never takes drafts of rules, playlists, layouts or other records.

Intents are coalesced per program, so the newest price wins and an older intent never overwrites a newer generation. Each intent is processed at most once per program and price sequence, so a retry is safe. Failures retry with back-off and stay visible as `failed` with the reason.

The panel shows each price save as saved, queued, published or failed per program. A revoked author blocks intents not yet processed, as the access policies require.

## Permissions

| Capability | Company administrator | Branch manager | Operator | Delegable | Strong authentication |
| --- | --- | --- | --- | --- | --- |
| `catalogs.view`: see catalogs, schemas, records and prices | Company | Branches | Branches | Yes | As the role |
| `catalogs.edit`: create, edit, reorder and delete records, excluding prices | Company | Branches | Branches | Yes, with `catalogs.view` | As the role |
| `catalogs.manage`: create, rename, archive and delete catalogs; change schemas | Company | Branches (branch catalogs) | No (additional grant) | Yes, with `catalogs.view` | As the role |
| `prices.edit`: base prices, branch overrides and promotions | Company | Branches | No (additional grant) | Yes, with `catalogs.view` | Always |

Scope follows ownership: company catalogs need company scope for `catalogs.manage` and for base prices and company-wide promotions. A branch override or a branch promotion needs `prices.edit` on that branch, and record edits need `catalogs.edit` on the catalog's scope. From increment 4, a price save also needs `publications.publish` on every affected target.

## Abuse limits

Per company: 200 catalogs and 500 layouts. Per catalog: 60 fields and 5,000 records. Per selection field: 100 options. Per record and money field: 100 promotions. Per layout: 12 areas, 20 pages and 6 catalog views. Exceeding a limit answers `CATALOG_LIMIT_REACHED` or `PROGRAMMING_LIMIT_REACHED`, naming the limit. Record values are bounded by type and by 16 KiB per record.

## Audit

Events record the actor's membership, the catalog and the branches it concerns:

- `catalog.created`, `catalog.renamed`, `catalog.archived`, `catalog.restored`, `catalog.deleted` and `catalog.schema_changed` (fields added, renamed, archived);
- `catalog.record_created`, `catalog.record_updated` (changed field identifiers only, not values), `catalog.record_moved` and `catalog.record_deleted`;
- `catalog.price_changed`, `catalog.price_override_changed` and `catalog.promotion_changed`, with old and new amounts and currencies, because prices are business facts the policies require to audit.

Layout and program-layout changes use the programming audit with their own event types. Each event is written in the same transaction as its change.

## Data

| Table | Purpose |
| --- | --- |
| `catalogs` | Company, owning branch (null for the company), name, status (`ACTIVE`/`ARCHIVED`), version, schema version |
| `catalog_fields` | Catalog, stable identifier, label, type, required, position, options (JSON, validated), archived time |
| `catalog_records` | Catalog, position, availability, values (JSONB, validated), version, creator and updater memberships |
| `catalog_price_overrides` | Record, field, branch, amount in minor units, version |
| `catalog_promotions` | Record, field, branch (null for the whole scope), amount, local start and end, creator |
| `catalog_audit_events` | Append-only audit with the branches each event concerns |
| `layouts`, `layout_areas`, `layout_pages` (increment 2) | Layout drafts as validated rows plus the exported JSON schema version |
| `price_publication_intents` (increment 4) | Program, catalog, price sequence, author, state, attempts, lease |

Every table carries `company_id` with composite tenant references ([tenant data design](tenant-data-design.md)). Record values are `CONFIDENTIAL` business data, and catalogs keep no personal data fields by design. A field labeled with personal meaning is still only text, and the panel warns against it.

## Contracts

Versioned JSON operations under `/companies/{companyId}/catalogs`:

- list (scope and name filters, cursor), create, get, rename, archive, restore, delete (empty catalogs only);
- `PUT .../schema` with the whole field list and expected version;
- records: list (cursor, text search over text fields), create, get, update, move and delete;
- prices: `PUT .../records/{recordId}/prices/{fieldId}` with the base amount and the full set of branch overrides, and the expected record version;
- promotions: list, create and delete per record and field;
- `GET .../records/{recordId}/effective-prices?at=YYYY-MM-DDTHH:MM` for the preview of every branch.

New errors:

- `CATALOG_SCHEMA_INVALID` (with the field and reason codes);
- `CATALOG_RECORD_INVALID` (with field reason codes);
- `CATALOG_RECORD_REFERENCED`;
- `CATALOG_PROMOTION_CONFLICT`;
- `CATALOG_LIMIT_REACHED`;
- from increment 4, `PRICE_TARGET_FORBIDDEN`.

These come with the existing access, `RESOURCE_NOT_FOUND`, `RESOURCE_VERSION_CONFLICT`, `RATE_LIMITED` and `VALIDATION_FAILED`. The SDK and OpenAPI document are regenerated.

## Panel

A **Catálogos** area per company (en-US "Catalogs"), shown with `catalogs.view`:

- **List.** Catalogs with scope and record count. Creation offers three starting points: empty, products (name, description, image, category selection, price in BRL) and weekly agenda (title, weekdays, start and end times, details). These are presets that create ordinary fields.
- **Catalog page:**
  - a **Campos** tab: an ordered field editor with type-specific options and the archive action;
  - an **Itens** tab: a paginated table of records with an editor form per type;
  - the availability toggle and reorder.
- **Prices.** A section in the record editor for each money field:
  - the base price;
  - branch overrides in a table of the catalog's branches;
  - promotions, with their windows and the conflict errors;
  - the effective price per branch at a chosen local time.

  Amounts are typed and shown in the field's currency with the person's locale. Copy is in `pt-BR` and `en-US`.

Increment 2 adds the **Layouts** editor under Programação: a canvas preview with drag and resize, plus numeric inputs for keyboard users; the area list; the view editor with live pagination preview and overflow errors; pages; and JSON import and export.

## Verification

- **Domain tests:**
  - every field type's validation and canonical values;
  - money parsing and formatting against ADR-0032 fixtures (BRL, USD, JPY with zero decimals, KWD with three);
  - promotion overlap and effective-price fixtures across DST in the shared fixture style, which protocol 2 hands to the player;
  - schema change rules: type immutability, archiving, required with missing values, option removal.
- **Two-company integration tests against PostgreSQL** (as the runtime role):
  - scope and role denials for each capability;
  - strong authentication for prices;
  - version conflicts;
  - limits;
  - references across catalogs and companies;
  - deletion guards;
  - audit rows.
- **Browser component tests** for the field editor, the record editor with prices and promotions, and the effective-price preview.
- **An end-to-end journey** that creates a product catalog with a branch override and a promotion and reads the effective prices.
- **Later increments** add layout validation, pagination and overflow fixtures, the protocol 2 manifest bytes, the price-publication processor with crash points, and the player's conformance tests.

## Delivery increments

1. Catalogs (PJ-21): module, migration, capabilities, schema, records, prices, overrides, promotions, effective-price preview, audit, contracts and SDK, the panel's Catálogos pages, tests and journey.
2. Layouts and programs with layouts (PJ-20): layouts module or programming extension, geometry and view validation, pagination and overflow checks, pages, JSON import and export, per-area outputs, the panel editor and preview.
3. Protocol 2 publication: the manifest with layout and catalog snapshots, the media guard for catalog media, conformance fixtures, the sync answer's `branchId`, and the player `core` evaluation of areas, prices, availability, pagination and pages.
4. Automatic price publication: intents, processor, target authorization, panel states, and IA-11 tests.
5. Device rendering of protocol 2 (PJ-12 `app`), qualification on PH-08 hardware (AT-04), and fades.

## Implementation status

Not implemented. Increment 1 starts with this design.

## Decisions

The agent took these decisions on 2026-10-20 under the owner's delegation:

1. **Catalog model.** Company or branch ownership like playlists, and schemas of typed fields with stable identifiers and immutable types. Changes are whole-schema saves with versions, with archiving instead of destructive deletion. Availability is a built-in flag.
2. **Field types.** `text`, `longText`, `number` (canonical decimal strings), `boolean`, `date`, `time`, `weekdays`, `selection`, `money`, `media` and `reference`, with the bounds above. No formula, code or markup type.
3. **Money (ADR-0032).** Integer minor units with one ISO 4217 currency per field, no conversion, and display formatting by locale only. Every money field is a designated price.
4. **Prices.** Base price on the record, branch overrides and promotions as separate rows. Promotions use local windows evaluated per screen. Overlapping promotions with intersecting branch scopes are refused. The effective price is promotion, then override, then base.
5. **Permissions.** `catalogs.view`, `catalogs.edit`, `catalogs.manage` and `prices.edit` as in the table, with prices always under strong authentication. Layouts use `programming.edit`.
6. **Layouts.** Up to 12 freeform areas on a fixed canvas per orientation, with media and catalog areas, catalog views with roles, presentation, grouping and timed pagination, and overflow validated, never clipped. Muted by default, with mixed audio only after explicit confirmation. Versioned JSON import and export.
7. **Programs with layouts.** Areas become program outputs with the existing rules and evaluator. Catalog areas default to their view. Pages are a deterministic cycle anchored at local midnight.
8. **Protocol 2.** Added only for programs with a layout, carrying a layout copy, bound-field schema snapshots, records, prices, overrides and promotions for the branches reached, and the screen's `branchId` in the sync response. Protocol 1 stays unchanged for programs without a layout.
9. **Automatic price publication.** All-target authorization before commit, durable coalesced intents in PostgreSQL processed by a leased in-API worker, and new generations that change only the catalog's prices of the latest publication.

## Alternatives considered

- **A fixed product schema with optional extra fields.** Simpler queries, but it imposes product semantics on agendas and other catalogs, which the owner rejected (P05).
- **One JSON document per catalog.** Fewer tables, but every record edit would rewrite the document, concurrent editors would conflict constantly, and references and prices could not be checked or audited per row.
- **Decimal numbers or floats for money.** A float cannot represent cents exactly. A decimal type without a currency invites mixing currencies. Integer minor units with a currency per field are exact, simple to compare and portable to the player (ADR-0032).
- **Republishing every affected program from its current drafts on a price save.** Would ship unrelated drafts, which the policies forbid. Only the price rows change in the new generation.
- **Live catalog reads by screens.** Would make playback depend on the server and mix revisions; the publication snapshot keeps prices and layout consistent offline (ADR-0023).
- **A layout engine with free HTML or SVG.** Flexible, but executable markup is forbidden and its rendering cannot be validated for overflow or reproduced natively. Typed areas and views are validated data.
