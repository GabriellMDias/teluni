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

A required field must have a value on every record. Text values are trimmed, and empty text counts as absent. A schema allows at most 60 fields, archived ones included. Money fields are never required, because prices are saved apart from other values by people who may edit prices.

**Schema changes** are saved as the whole ordered field list with the expected catalog version, like rules.

- New fields get identifiers.
- A field's type, currency, decimal places and reference target never change. To change one, a person adds a new field and archives the old one.
- Leaving a field out of the list deletes it only while no record, branch price or promotion holds a value for it; otherwise the save is refused with the count, and the field must be archived.
- Labels are unique among active fields, ignoring case. Shortening a text field's maximum length or narrowing a number's range is refused while stored values would break it, with their count.
- A reference field's target must be an active catalog whose scope covers the field's catalog: a company catalog for any catalog, or a catalog of the same branch.
- Archiving a field keeps its values and hides it from editing and new bindings. Published versions keep their own schema copy.
- A field bound by a layout draft cannot be archived until the binding is removed; the error names the layouts.
- Making a field required is refused while any record lacks a value for it, and the error says how many records lack one.
- Selection options keep their identifiers. A removed option is refused while records use it.

**Records** are saved one at a time with the record's expected version.

- A record's values are a map from field identifier to value, validated against the current schema.
- Unknown and archived field identifiers are refused.
- References must point to an existing record of the target catalog that the caller may see.
- Records are listed in their stored order, with a cursor. Moving a record after another one, or to the top, is its own versioned operation.
- A record's title is the value of the catalog's first active text field; lists and references show it.
- A record whose identifier another record references cannot be deleted (`CATALOG_RECORD_REFERENCED`); the error counts the referring records.
- Availability is a built-in flag, not a field. A view hides unavailable records unless it shows them as unavailable.
- A catalog holds at most 5,000 records, and a record's values at most 16 KiB of JSON.

**Prices.** A money value on the record is the **base price**. Overrides and promotions are separate rows, so each change is attributable and checked on its own. The base price and each branch override are saved one at a time with the record's version, which every price save increments:

- **Branch overrides** set an amount for one branch of the catalog's scope. They are possible only on company catalogs, because a branch catalog already has one branch.
- **Promotions** set an amount for a local window `[start, end)` (`YYYY-MM-DDTHH:MM`, evaluated in each screen's local time like schedules), for the whole scope or for one branch.
  - Two promotions of the same record and field are refused when their windows overlap and their branch scopes intersect. A company-wide promotion intersects every branch.
  - Promotions are never edited: a person removes one and adds another. They do not change the record's version.
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
- A page-controlled catalog area names the view page or the group to show: a `selection` choice, or an agenda's ISO weekday (`"1"` for Monday to `"7"`).
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

A screen receives the program's single manifest. To resolve overrides and promotions for its branch, it needs its `branchId`, which the sync response gains next to `rotation`. Effective prices and the page cycle are evaluated on the screen from the snapshot, trusted time and zone offsets, with fixtures shared by the API's preview and the player, like schedules. Pagination is computed once, at publication, with the layout's text measure: each view carries its pages of records (with each record's group) and, for groups that layout pages name, the records of each group, so screens never measure text to decide what a page holds.

Protocol negotiation is unchanged. The sync answer's `desired` names the desired publication's protocol, so a screen that supports only protocol 1 and desires a protocol 2 publication reports `INCOMPATIBLE` without downloading it and keeps its active generation, and the panel shows why.

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
| `catalog_price_overrides` | Record, field, branch, amount in minor units; saved under the record's version |
| `catalog_promotions` | Record, field, branch (null for the whole scope), amount, local start and end, creator |
| `catalog_record_media`, `catalog_record_references` | The media and records that record values name, mirrored in the same transaction so media deletion and record deletion can be guarded |
| `catalog_audit_events` | Append-only audit with the branches each event concerns |
| `layouts`, `layout_areas`, `layout_view_fields`, `layout_pages`, `layout_page_contents` (increment 2) | Layout drafts as validated rows: areas with their catalog view, the view's bound fields, pages, and what each page-controlled area shows |
| `price_publication_intents` (increment 4) | Program, catalog, price sequence, author, state, attempts, lease |

Every table carries `company_id` with composite tenant references to `(company_id, id)` ([tenant data design](tenant-data-design.md)). Price and link rows also carry their record's catalog; the module keeps it and their field's catalog equal to the record's, because a tenant reference never targets a wider key. Record values are `CONFIDENTIAL` business data, and catalogs keep no personal data fields by design. A field labeled with personal meaning is still only text, and the panel warns against it.

## Contracts

Versioned JSON operations under `/companies/{companyId}/catalogs`:

- list (scope, name and status filters, cursor), create (optionally with the first fields), get, update (rename, archive or restore; an archived catalog is read-only), delete (empty catalogs that no other catalog's field targets);
- `PUT .../schema` with the whole field list and expected version;
- records: list (cursor, text search over text fields), create, get, update, move and delete;
- prices: `PUT .../records/{recordId}/prices/{fieldId}` with the base amount, and `PUT .../records/{recordId}/prices/{fieldId}/branches/{branchId}` with one branch's amount, each with the expected record version and `null` to clear, so each save is authorized on exactly the scope it changes;
- promotions: list, create and delete per record and field;
- `GET .../records/{recordId}/effective-prices?at=YYYY-MM-DDTHH:MM` for the preview: the whole scope's price, and each visible branch with its own price or promotion.

New errors:

- `CATALOG_SCHEMA_INVALID` (with the field and reason codes);
- `CATALOG_RECORD_INVALID` (with field reason codes);
- `CATALOG_RECORD_REFERENCED` (counting the referring records);
- `CATALOG_PROMOTION_CONFLICT`;
- `CATALOG_LIMIT_REACHED`;
- `CATALOG_ARCHIVED`, `CATALOG_NOT_EMPTY` and `CATALOG_IN_USE` for archived and deletable catalogs;
- from increment 4, `PRICE_TARGET_FORBIDDEN`.

Field and record problems travel in the error envelope's bounded `issues` list (a JSON Pointer path, a stable reason and, for problems caused by stored data, a count), defined by the [error contract](../api/error-contract.md#validation-errors).

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

Increment 2 adds the **Layouts** editor under Programação: a canvas preview with drag and resize, plus numeric inputs and arrow keys for keyboard users; the area list; the view editor; the fit report with overflow by record; pages; and JSON import and export.

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
- **Later increments** add layout validation, pagination and overflow fixtures, the protocol 2 manifest bytes, page cycles and effective prices in the conformance fixtures, the price-publication processor with crash points, and the player's conformance tests.

## Delivery increments

1. Catalogs (PJ-21): module, migration, capabilities, schema, records, prices, overrides, promotions, effective-price preview, audit, contracts and SDK, the panel's Catálogos pages, tests and journey.
2. Layouts and programs with layouts (PJ-20): layouts module or programming extension, geometry and view validation, pagination and overflow checks, pages, JSON import and export, per-area outputs, the panel editor and preview.
3. Protocol 2 publication: the manifest with layout and catalog snapshots, the media guard for catalog media, conformance fixtures, the sync answer's `branchId`, and the player `core` evaluation of areas, prices, availability, pagination and pages.
4. Automatic price publication: intents, processor, target authorization, panel states, and IA-11 tests.
5. Device rendering of protocol 2 (PJ-12 `app`), qualification on PH-08 hardware (AT-04), and fades.

## Implementation status

**Increment 1 (catalogs, PJ-21) is implemented, 2026-10-20:**

| Capability | Source | Evidence |
| --- | --- | --- |
| Capabilities `catalogs.view`, `catalogs.edit`, `catalogs.manage` and `prices.edit` in the role presets, delegable through profiles; `prices.edit` always needs strong authentication | [organizations domain](../../apps/api/src/features/organizations/domain.ts) | [organizations tests](../../apps/api/test/organizations/domain.test.ts) |
| Reviewed migration, runtime grants and metadata for the eight catalog tables | [migration](../../apps/api/prisma/migrations/20261020000000_catalogs/migration.sql), [grants](../../apps/api/prisma/runtime-grants/catalogs.sql), [metadata](../../apps/api/prisma/metadata/catalogs.json) | The tenant structure test and the generated [database reference](../generated/database/schema.md) |
| Field types, schema plans with checks against stored records, value validation, money and the currency table, promotion overlap and the effective price | [`domain.ts`](../../apps/api/src/features/catalogs/domain.ts) | [Domain tests](../../apps/api/test/catalogs/domain.test.ts), including the currency table against `Intl.NumberFormat` |
| The `catalogs` API module: catalogs, schemas, records, order, base and branch prices, promotions, the effective-price preview, the `catalog-record` media guard and audit | [`src/features/catalogs/`](../../apps/api/src/features/catalogs/module.ts) | A [two-company integration suite](../../apps/api/test/catalogs/integration.test.ts) against PostgreSQL as the runtime role: scope and role denials, strong authentication for prices, version conflicts, schema checks with counts, references and deletion guards, media guards, promotions, effective prices, the catalog limit under concurrency and audit rows |
| The panel's Catálogos pages: list and creation with presets, the field editor, items with per-type editors, prices in the person's locale, branch prices, promotions and the effective-price preview | [`apps/web/src/catalogs/`](../../apps/web/src/catalogs/pages.tsx) | [Browser component tests](../../apps/web/test/catalogs.browser.test.tsx), [money tests](../../apps/web/test/catalogs-money.node.test.ts) and an [end-to-end journey](../../apps/web/test/e2e/catalogs/journey.spec.ts) |

Implementation decisions, taken under the owner's delegation:

- Base and branch prices are separate operations rather than one save with every override, so a branch manager's save is authorized on their branch only.
- Money fields are never required; record edits never carry prices.
- Record values and nullable amounts use JSON Schemas with several types, and the API's validator allows them, because request coercion inside `anyOf` would turn `null` into `0` and a boolean into text.
- Field removal is allowed while nothing holds a value for it; otherwise archiving is the only way.

**Increment 2, part A (layouts, PJ-20) is implemented, 2026-10-20:**

| Capability | Source | Evidence |
| --- | --- | --- |
| Reviewed migration, runtime grants and metadata for the five layout tables, with `layout` as a programming audit subject | [migration](../../apps/api/prisma/migrations/20261020010000_layouts/migration.sql), [grants](../../apps/api/prisma/runtime-grants/programming.sql), [metadata](../../apps/api/prisma/metadata/programming.json) | The tenant structure test and the generated [database reference](../generated/database/schema.md) |
| Layout rules: canvas geometry, stacking, audio, catalog views by role, pages and what they show, the conservative text measure, fit and overflow, and the `teluni.layout` schema 1 document | [`layouts.ts`](../../apps/api/src/features/programming/layouts.ts) | [Layout domain tests](../../apps/api/test/programming/layouts.test.ts) |
| Layouts in the programming API module: list, create, import, get, save, delete and export, with catalog, field and media checks in the layout's scope, the seconds that cover each page's videos, the fit report and audit; the catalogs module's port with usage guards (`CATALOG_IN_USE`, `FIELD_BOUND`) and the `layout-draft` media guard | [`layouts-service.ts`](../../apps/api/src/features/programming/layouts-service.ts), [catalogs port](../../apps/api/src/features/catalogs/public.ts) | A [two-company integration suite](../../apps/api/test/programming/layouts-integration.test.ts) against PostgreSQL as the runtime role: scope and role denials, the fit report and its titles, catalog, field and media guards, video durations, group choices, versions, export and import with remapping issues, audit rows and the layout limit under concurrency |
| The panel's Layouts section under Programação: list, creation, import, the canvas editor with drag, resize and arrow keys, area settings, the catalog view editor, pages, the audio confirmation, issues named by area and page, the fit report and export | [`layouts.tsx`](../../apps/web/src/programming/layouts.tsx) | [Browser component tests](../../apps/web/test/layouts.browser.test.tsx) and the [end-to-end journey](../../apps/web/test/e2e/catalogs/journey.spec.ts) |

Implementation decisions, taken under the owner's delegation:

- Layouts live in the programming module: they use `programming.edit`, its audit and its company limit lock, and programs will choose them. Programming reads catalogs only through the catalogs module's port, which also lets it guard catalogs and fields that layouts bind.
- Clients give area keys (`^[a-z][a-z0-9-]{0,15}$`), and saves keep them, because program outputs will be keyed by them. A save replaces the whole definition with the observed version.
- The text measure is a conservative table of advance widths per character class, in ems. The screen renderer must use a font whose glyphs are never wider, which AT-04 qualifies ([PH-08](human-actions.md#ph-08)). Titles wrap to two lines, subtitles and details to three, and a price stays on one line in a column at most half the row wide.
- The API computes the fit report on the stored layout and its current records, with record titles only for members who may view the catalog. The panel shows it after each save rather than a live preview, so the measure has one implementation. Because records change after a layout is saved, a save reports overflow and publication (increment 3) refuses it.
- An import never keeps a catalog, field or media item the importer cannot use; it reports each one as an issue to replace.
- The panel keeps the orientation chosen at creation or import.

**Increment 2, part B (programs with layouts, PJ-20) is implemented, 2026-10-20:**

| Capability | Source | Evidence |
| --- | --- | --- |
| A forward migration adds the program's layout (restricting layout deletion) and widens output keys from `screen` to the area key shape | [migration](../../apps/api/prisma/migrations/20261020020000_program_layouts/migration.sql), [grants](../../apps/api/prisma/runtime-grants/programming.sql), [metadata](../../apps/api/prisma/metadata/programming.json) | The tenant structure test and the generated [database reference](../generated/database/schema.md) |
| Layout choice for group and screen programs, outputs per area (a catalog area takes no default playlist), confirmation before schedules or defaults are dropped (by a layout choice or by a layout save), scope checks on choice and on span changes, `LAYOUT_IN_USE` on deletion, per-output timelines, and publication checks that refuse programs with a layout | [`service.ts`](../../apps/api/src/features/programming/service.ts), [publications service](../../apps/api/src/features/publications/service.ts) | The [layouts suite](../../apps/api/test/programming/layouts-integration.test.ts) (choice, outputs, confirmations, timelines, scope, deletion and audit) and the [publications suite](../../apps/api/test/publications/integration.test.ts) |
| The panel's layout choice on group and screen pages, with confirmation, schedules per area, a catalog area's view default, per-area previews and the layout editor's confirmation | [`pages.tsx`](../../apps/web/src/programming/pages.tsx), [`layouts.tsx`](../../apps/web/src/programming/layouts.tsx) | [Programming](../../apps/web/test/programming.browser.test.tsx) and [layout](../../apps/web/test/layouts.browser.test.tsx) browser component tests and the [end-to-end journey](../../apps/web/test/e2e/catalogs/journey.spec.ts) |

Implementation decisions, taken under the owner's delegation:

- Choosing a layout is its own versioned operation (`PUT .../program/layout`); outputs keep their key, so an area of the new layout with the key of a former output keeps its schedules. Empty outputs are dropped silently; outputs with schedules or a default, and a catalog area's former default playlist, are dropped only when the request confirms it, after an answer that names each one. A layout save that removes such areas from programs needs the same confirmation, and counts the programs each output affects.
- A layout and its programs lock in that order, so a program operation share-locks the layout before its program.
- A catalog area's output refuses a default playlist with `VALIDATION_FAILED`, because its default is its view; its timeline shows the view where nothing else plays.
- Until protocol 2 (increment 3), the publication check reports `LAYOUT_NOT_PUBLISHABLE` for a program with a layout rather than publishing only part of it. The coordinated page cycle moves to increment 3 with the fixtures that the preview and the player share. Increment 3, part A replaced that problem with protocol 2.

**Increment 3, part A (protocol 2 publication, PJ-20 with PJ-11) is implemented, 2026-10-20:**

| Capability | Source | Evidence |
| --- | --- | --- |
| A forward migration lets publications record protocol 2 | [migration](../../apps/api/prisma/migrations/20261020030000_publication_protocol_2/migration.sql), [metadata](../../apps/api/prisma/metadata/publications.json) | The tenant structure test and the generated [database reference](../generated/database/schema.md) |
| Pagination that keeps each page's records with their group, and the coordinated page cycle anchored at local midnight | [`layouts.ts`](../../apps/api/src/features/programming/layouts.ts) | [Layout domain tests](../../apps/api/test/programming/layouts.test.ts) |
| The protocol 2 manifest and content digest: the layout copy, per-area outputs with the view default, catalog snapshots with bound fields, records, prices limited to the branches reached, and the playlists and media of protocol 1 | [publications `domain.ts`](../../apps/api/src/features/publications/domain.ts) | [Publication domain tests](../../apps/api/test/publications/domain.test.ts) |
| The programming port's layout snapshot under the program's locks, with the catalogs read through their port and the problems that block publication | [`layouts-service.ts`](../../apps/api/src/features/programming/layouts-service.ts), [`service.ts`](../../apps/api/src/features/programming/service.ts) | The [publications suite](../../apps/api/test/publications/integration.test.ts) against PostgreSQL as the runtime role |
| Publication, restore and synchronization of protocol 2: the check's area problems, catalog media in the publication's media (so the `publication` media guard keeps them), the sync answer's `branchId` and `desired.protocol` | [publications service](../../apps/api/src/features/publications/service.ts), [contracts](../../apps/api/src/features/publications/contracts.ts) | The publications suite: exact outputs, pages, records and branch prices in the served manifest, protocol agreement with old and new players, restore within reach, overflow and missing pages |
| The protocol 2 manifest bytes, page cycles and effective prices in the player's conformance fixtures | [`conformance.json`](../../apps/api/test/publications/conformance.json), [writer](../../apps/api/scripts/conformance.ts) | The [conformance test](../../apps/api/test/publications/conformance.test.ts) keeps the file in step with the API's code |
| The panel's publication review names catalog problems by area | [`publications.tsx`](../../apps/web/src/programming/publications.tsx) | [Programming browser component tests](../../apps/web/test/programming.browser.test.tsx) |

Implementation decisions, taken under the owner's delegation:

- **Pagination at publication.** The API paginates each view with the layout's text measure and the records of the time, and carries the result: pages of `{recordId, group}` entries and, for groups a layout page names, their records. The measure therefore has one implementation, and every screen shows the same pages. Hidden unavailable records are left out of the pages.
- **The page cycle** is a pure function of the page durations and the local wall-clock second of the day: cycles start at local midnight, and the last cycle of the day is cut there, so a day with a daylight-saving change still starts at page 1.
- **Publication problems.** A program with a layout that no longer fits its reach reports `LAYOUT_OUT_OF_SCOPE`. Catalog views report `CATALOG_UNAVAILABLE` (missing or not active), `CATALOG_FIELD_UNAVAILABLE` (a bound field archived or removed), `CATALOG_OVERFLOW` (a record does not fit), `CATALOG_PAGE_MISSING` (a layout page names a view page the records do not fill) and `CATALOG_GROUP_OVERFLOW` (a named group needs more than one page), each with the area's key. A publication carries at most 10,000 catalog records over all views; more is `TOO_LARGE`.
- **Snapshot values.** Each catalog is read through the catalogs port in one repeatable-read snapshot, so a save committed meanwhile is either wholly in the publication or left for the next one. Records keep the values of bound fields other than money; a `reference` value becomes the referenced record's title, and a `media` value's item joins the publication's media. Prices carry the base amount and only the overrides and promotions of branches the program reaches (company-wide promotions included).
- **Synchronization.** The sync answer always carries the screen's `branchId` (null only in the answer to an unlinked screen) and `desired.protocol`. A player that supports only protocol 1 still agrees on protocol 1 and learns from `desired.protocol` that it cannot stage the publication.
- **Restore.** A protocol 2 publication is restored only while the program's reach stays within the branches it was published for, because its prices were limited to them; otherwise the restore answers `PUBLICATION_INVALID`.

**Increment 3, part B (the player `core`'s protocol 2, PJ-12) is implemented, 2026-10-20:**

| Capability | Source | Evidence |
| --- | --- | --- |
| Strict parsing and checks of protocol 2 manifests: canvas and area geometry, stacking, audio confirmation, views, pages and what they show, outputs per area, catalog fields, records, media values and prices | [`LayoutManifest.kt`](../../apps/player/core/src/main/kotlin/app/teluni/player/core/protocol/LayoutManifest.kt), [`Manifest.kt`](../../apps/player/core/src/main/kotlin/app/teluni/player/core/protocol/Manifest.kt) | [Layout manifest tests](../../apps/player/core/src/test/kotlin/app/teluni/player/core/protocol/LayoutManifestTest.kt) over the API's conformance bytes and edits of them |
| The page cycle and effective prices, ported from the API | [`Pages.kt`](../../apps/player/core/src/main/kotlin/app/teluni/player/core/playback/Pages.kt), [`Prices.kt`](../../apps/player/core/src/main/kotlin/app/teluni/player/core/catalog/Prices.kt) | [Composition tests](../../apps/player/core/src/test/kotlin/app/teluni/player/core/playback/CompositionTest.kt) against every shared page cycle and price case |
| A composed plan: what each area shows, in stacking order, until the next schedule, page, view page or price change | [`Planner.kt`](../../apps/player/core/src/main/kotlin/app/teluni/player/core/playback/Planner.kt) | Composition tests: the page cycle by local time, a regional schedule over a page-controlled area, branch prices and a promotion's start |
| Protocols 1 and 2 declared in the sync report, the screen's branch kept with the sync record (older records still read) | [`PlayerEngine.kt`](../../apps/player/core/src/main/kotlin/app/teluni/player/core/sync/PlayerEngine.kt) | [Engine tests](../../apps/player/core/src/test/kotlin/app/teluni/player/core/sync/PlayerEngineTest.kt) |

Implementation decisions, taken under the owner's delegation:

- **What an area shows.** A rule of the area's output wins while it lasts. Otherwise a page-controlled area shows what the current page names (a media item, a view page or a group), and other areas show their default: a playlist, the catalog view, or nothing.
- **A catalog view's own pages** advance every `pageSeconds` with the same cycle as layout pages, anchored at local midnight, so screens of a group page together.
- **Prices** are evaluated for the screen's branch from the sync answer at the local minute, and the plan is made again at the next promotion start or end of a record it shows.
- **Strictness.** Anything the API would never publish fails as `INVALID_MANIFEST`, and fades stay `INCOMPATIBLE`, as in protocol 1. Drawing areas, catalog text, images and mixed audio is the Android `app`'s, qualified on [PH-08](human-actions.md#ph-08) hardware (increment 5).

Increments 4 and 5 are not implemented.

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
