# ADR-0032: Represent Money as Integer Minor Units with a Currency per Field

**Status:** accepted
**Date:** 2026-10-20

**Acceptance scope:** The owner delegated every pending decision to the agent on 2026-10-20 (recorded with PH-25). The agent accepted this decision under that delegation together with the [catalog and composition design](../project/catalog-composition-design.md); merging the pull request that adds it is the repository review. It settles the monetary representation that D-10 left open for catalogs, prices, publications and the player. It does not select a currency conversion service, because the policies forbid conversion.

## Context

Catalogs need monetary fields for prices, with company base values, branch overrides and promotions (FR-11, P06, P07). Several runtimes must agree exactly on those amounts:

- the TypeScript API, which validates, stores and snapshots them;
- the web panel, which edits and previews them in the person's locale;
- the Kotlin player, which shows them offline.

The policies require explicit currency, exact representation, no automatic conversion, and locale-independent meaning. D-10 left the representation open. PostgreSQL `numeric`, JavaScript numbers and JSON numbers all differ in precision or parsing, and currencies differ in minor units: BRL has 2, JPY 0, KWD 3.

## Decision

- An amount is an integer count of the currency's minor units: `1990` BRL is R$ 19,90, and `1990` JPY is ¥1,990. It is stored as PostgreSQL `bigint` and transported in JSON as an integer within ±(2^53 − 1) and in practice far below. The API refuses values outside 0 to 10^12 minor units.
- The currency is an ISO 4217 alphabetic code fixed on the money field when the field is created. Every value, override and promotion of that field uses it. A field's currency never changes; changing currency means adding a field.
- The number of minor units comes from a table in the API, checked against `Intl.NumberFormat` in tests and copied to the player. The input `"19,9"` in `pt-BR` or `"19.90"` in `en-US` is parsed by the panel into minor units, rejecting more decimals than the currency has.
- Formatting for people uses the locale, through `Intl.NumberFormat` in the web panel and `java.text.NumberFormat`/`Currency` on the player, with the field's currency. Locale never changes the amount or the currency. Amounts are never converted between currencies.
- Non-monetary decimals (`number` fields) are canonical decimal strings with a fixed number of places, never floats.

## Rationale

- Integer minor units are exact, compare and sort trivially, and mean the same in SQL, JSON, TypeScript and Kotlin without a decimal library.
- A currency per field rules out mixing currencies inside one price list by construction. That is the common case for a business operating in one country, and the policies forbid conversion anyway.
- The cost is that a business pricing the same product in two currencies needs two fields, which is honest about the meaning.

## Alternatives Considered

### PostgreSQL numeric and decimal strings everywhere

Exact, but every runtime then needs a decimal implementation and a rule for scale. A value like `19.9` versus `19.90` invites accidental inequality. Minor units carry the scale in the currency.

### A currency on each value

More flexible, but it allows a price list in mixed currencies that cannot be compared or validated, and nothing in the product needs it.

### Floating-point numbers

Cannot represent most decimal amounts exactly, so totals and comparisons drift. Rejected.

## Consequences

### Positive

- Prices are exact and identical in the API, the panel preview, the publication snapshot and the player.
- Validation and promotion comparisons are integer operations.

### Negative

- The currency table must stay aligned across the API and the player; a test checks the API table against `Intl`, and the player's copy is checked by the protocol fixtures.
- Changing a field's currency requires a new field and copying values.

### Operational or Migration Impact

- No existing data. The first catalog migration creates `bigint` amount columns and a currency column on money fields.

## References

- [Catalog and composition design](../project/catalog-composition-design.md)
- [Configurable catalogs policy](../project/release-policies.md#configurable-catalogs)
- [Security and internationalization](../project/security-and-i18n.md)
- [ADR-0023](0023-propose-versioned-catalog-and-composition-publications.md)
