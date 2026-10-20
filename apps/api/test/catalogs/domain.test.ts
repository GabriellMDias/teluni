import { describe, expect, it } from "vitest";
import {
  canonicalDecimal,
  CatalogFailure,
  catalogName,
  currencyMinorUnits,
  effectivePrice,
  isLocalMinute,
  linksOf,
  planSchema,
  planValues,
  promotionsConflict,
  titleField,
  type FieldDefinition,
  type FieldInput,
  type Promotion,
} from "../../src/features/catalogs/domain.js";

let counter = 0;
const newId = () =>
  `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`;

const failure = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    if (error instanceof CatalogFailure)
      return { code: error.code, issues: error.issues };
    throw error;
  }
  return null;
};

const reasons = (run: () => unknown) =>
  failure(run)?.issues.map((issue) => `${issue.path} ${issue.reason}`);

const plan = (input: readonly FieldInput[], current: FieldDefinition[] = []) =>
  planSchema(current, input, newId);

describe("money", () => {
  it("keeps the minor units of every currency aligned with Intl", () => {
    for (const [code, digits] of Object.entries(currencyMinorUnits)) {
      const options = new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: code,
      }).resolvedOptions();
      expect([code, options.maximumFractionDigits]).toEqual([code, digits]);
    }
  });

  it("covers zero, two and three minor units (ADR-0032)", () => {
    expect(currencyMinorUnits.BRL).toBe(2);
    expect(currencyMinorUnits.USD).toBe(2);
    expect(currencyMinorUnits.JPY).toBe(0);
    expect(currencyMinorUnits.KWD).toBe(3);
  });

  it("accepts integer amounts from 0 to 10^12 only", () => {
    const field = plan([
      { label: "Price", type: "money", currency: "BRL" },
    ]).fields;
    expect(field[0]).toMatchObject({ currency: "BRL", promotions: true });
    expect(
      reasons(() => plan([{ label: "Price", type: "money", currency: "XXX" }])),
    ).toEqual(["/fields/0/currency CURRENCY_UNSUPPORTED"]);
    expect(
      reasons(() =>
        plan([
          { label: "Price", type: "money", currency: "BRL", required: true },
        ]),
      ),
    ).toEqual(["/fields/0/required REQUIRED_NOT_ALLOWED"]);
  });
});

describe("decimals", () => {
  it("canonicalizes without binary floats", () => {
    expect(canonicalDecimal("12.5", 2)).toBe("12.50");
    expect(canonicalDecimal("+007", 0)).toBe("7");
    expect(canonicalDecimal("-0.000", 2)).toBe("0.00");
    expect(canonicalDecimal("0.1", 4)).toBe("0.1000");
    expect(canonicalDecimal("1.230", 2)).toBe("1.23");
    expect(canonicalDecimal("1.235", 2)).toBeNull();
    expect(canonicalDecimal("1e3", 0)).toBeNull();
    expect(canonicalDecimal("1234567890123456", 0)).toBeNull();
    expect(canonicalDecimal("999999999999999.9999", 4)).toBe(
      "999999999999999.9999",
    );
  });
});

describe("schema plans", () => {
  const product: FieldInput[] = [
    { label: "Name", type: "text", required: true },
    { label: "Description", type: "longText" },
    { label: "Weight", type: "number", decimals: 3, minimum: "0" },
    {
      label: "Category",
      type: "selection",
      choices: [{ label: "Drinks" }, { label: "Food" }],
    },
    { label: "Price", type: "money", currency: "BRL" },
    { label: "Photo", type: "media" },
  ];

  it("assigns stable IDs, defaults and positions", () => {
    const result = plan(product);
    expect(result.fields.map((field) => field.type)).toEqual([
      "text",
      "longText",
      "number",
      "selection",
      "money",
      "media",
    ]);
    expect(result.fields[0]).toMatchObject({ maxLength: 120, required: true });
    expect(result.fields[1]).toMatchObject({ maxLength: 500 });
    expect(result.fields[2]).toMatchObject({
      decimals: 3,
      minimum: "0.000",
      maximum: null,
    });
    expect(result.fields[3].choices).toHaveLength(2);
    expect(result.changes.added).toHaveLength(6);
    expect(
      result.checks.filter((check) => check.kind === "missing"),
    ).toHaveLength(1);
  });

  it("keeps identity and refuses changing a field's meaning", () => {
    const current = plan(product).fields as FieldDefinition[];
    const same = current.map((field) => ({ ...field }));
    const renamed = plan(
      same.map((field, index) =>
        index === 0 ? { ...field, label: "Product name" } : field,
      ),
      current,
    );
    expect(renamed.fields[0].id).toBe(current[0].id);
    expect(renamed.changes.renamed).toEqual([current[0].id]);
    expect(renamed.checks).toEqual([]);
    expect(
      reasons(() =>
        plan(
          same.map((field, index) =>
            index === 1 ? { ...field, type: "text" } : field,
          ),
          current,
        ),
      ),
    ).toEqual(["/fields/1/type TYPE_IMMUTABLE"]);
    expect(
      reasons(() =>
        plan(
          same.map((field, index) =>
            index === 4 ? { ...field, currency: "USD" } : field,
          ),
          current,
        ),
      ),
    ).toEqual(["/fields/4/currency CURRENCY_IMMUTABLE"]);
    expect(
      reasons(() =>
        plan(
          same.map((field, index) =>
            index === 2 ? { ...field, decimals: 2, minimum: "0" } : field,
          ),
          current,
        ),
      ),
    ).toEqual(["/fields/2/decimals DECIMALS_IMMUTABLE"]);
    expect(
      reasons(() => plan([...same, { ...same[0], label: "Other" }], current)),
    ).toEqual(["/fields/6/id DUPLICATE_FIELD"]);
  });

  it("lists checks that depend on stored items", () => {
    const current = plan(product).fields as FieldDefinition[];
    const same = current.map((field) => ({ ...field }));
    const next = plan(
      [
        { ...same[0], maxLength: 60 },
        { ...same[1], required: true },
        { ...same[2], maximum: "10" },
        { ...same[3], choices: [same[3].choices![0]] },
        { ...same[4], promotions: false },
      ],
      current,
    );
    expect(next.checks.map((check) => check.kind).sort()).toEqual([
      "choices",
      "missing",
      "outOfRange",
      "promotions",
      "removed",
      "tooLong",
    ]);
    expect(next.changes.removed).toEqual([current[5].id]);
  });

  it("archives instead of losing values and checks restored required fields", () => {
    const current = plan(product).fields as FieldDefinition[];
    const same = current.map((field) => ({ ...field }));
    const archived = plan(
      same.map((field, index) =>
        index === 0 ? { ...field, archived: true } : field,
      ),
      current,
    );
    expect(archived.changes.archived).toEqual([current[0].id]);
    expect(archived.checks).toEqual([]);
    const restored = plan(same, archived.fields as FieldDefinition[]);
    expect(restored.changes.restored).toEqual([current[0].id]);
    expect(restored.checks.map((check) => check.kind)).toEqual(["missing"]);
  });

  it("validates settings, labels and choices", () => {
    expect(
      reasons(() =>
        plan([
          { label: "Name", type: "text", maxLength: 501 },
          { label: "name", type: "longText" },
          { label: "Flag", type: "boolean", maxLength: 3 },
          { label: "Kind", type: "selection", choices: [] },
          {
            label: "Size",
            type: "selection",
            choices: [{ label: "S" }, { label: "s" }],
          },
          { label: "Range", type: "number", minimum: "5", maximum: "1" },
          { label: " ", type: "date" },
          { label: "Link", type: "reference" },
        ]),
      ),
    ).toEqual([
      "/fields/0/maxLength SETTING_INVALID",
      "/fields/1/label LABEL_DUPLICATE",
      "/fields/2/maxLength SETTING_NOT_APPLICABLE",
      "/fields/3/choices CHOICES_INVALID",
      "/fields/4/choices/1/label LABEL_DUPLICATE",
      "/fields/5/maximum SETTING_INVALID",
      "/fields/6/label LABEL_INVALID",
      "/fields/7/targetCatalogId TARGET_INVALID",
    ]);
    expect(
      failure(() => plan(Array(61).fill({ label: "x", type: "text" }))),
    ).toEqual({
      code: "CATALOG_LIMIT_REACHED",
      issues: [],
    });
  });

  it("asks the service to check new reference targets", () => {
    const target = "11111111-1111-4111-8111-111111111111";
    const result = plan([
      { label: "Supplier", type: "reference", targetCatalogId: target },
    ]);
    expect(result.checks).toEqual([
      {
        kind: "target",
        fieldId: result.fields[0].id,
        path: "/fields/0",
        catalogId: target,
      },
    ]);
  });
});

describe("record values", () => {
  const fields = planSchema(
    [],
    [
      { label: "Name", type: "text", required: true, maxLength: 10 },
      { label: "Notes", type: "longText" },
      { label: "Weight", type: "number", decimals: 2, maximum: "100" },
      { label: "Vegan", type: "boolean" },
      { label: "Since", type: "date" },
      { label: "Opens", type: "time" },
      { label: "Days", type: "weekdays" },
      {
        label: "Category",
        type: "selection",
        choices: [{ label: "Drinks" }],
      },
      { label: "Price", type: "money", currency: "BRL" },
      { label: "Photo", type: "media" },
      {
        label: "Related",
        type: "reference",
        targetCatalogId: "11111111-1111-4111-8111-111111111111",
      },
      { label: "Old", type: "text", archived: true },
    ],
    newId,
  ).fields;
  const [
    name,
    notes,
    weight,
    vegan,
    since,
    opens,
    days,
    category,
    price,
    photo,
    related,
    old,
  ] = fields;
  const choice = category.choices![0].id;
  const media = "22222222-2222-4222-8222-222222222222";
  const other = "33333333-3333-4333-8333-333333333333";

  it("normalizes every type to its canonical value", () => {
    const result = planValues(
      fields,
      {
        [name.id]: "  Coffee ",
        [notes.id]: "Line one\r\nLine two",
        [weight.id]: "1.5",
        [vegan.id]: false,
        [since.id]: "2024-02-29",
        [opens.id]: "07:30",
        [days.id]: [5, 1, 3],
        [category.id]: choice,
        [photo.id]: media.toUpperCase(),
        [related.id]: other,
      },
      { [price.id]: 1990, [old.id]: "kept" },
    );
    expect(result.values).toEqual({
      [name.id]: "Coffee",
      [notes.id]: "Line one\nLine two",
      [weight.id]: "1.50",
      [vegan.id]: false,
      [since.id]: "2024-02-29",
      [opens.id]: "07:30",
      [days.id]: [1, 3, 5],
      [category.id]: choice,
      [price.id]: 1990,
      [photo.id]: media,
      [related.id]: other,
      [old.id]: "kept",
    });
    expect(linksOf(fields, result.values)).toEqual({
      media: new Map([[photo.id, media]]),
      references: new Map([[related.id, other]]),
    });
    expect(titleField(fields)?.id).toBe(name.id);
  });

  it("reports each invalid value with a stable reason", () => {
    const unknown = "44444444-4444-4444-8444-444444444444";
    expect(
      reasons(() =>
        planValues(
          fields,
          {
            [name.id]: "Coffee with milk",
            [notes.id]: "bell\u0007",
            [weight.id]: "100.01",
            [vegan.id]: "true",
            [since.id]: "2023-02-29",
            [opens.id]: "24:00",
            [days.id]: [1, 1],
            [category.id]: unknown,
            [price.id]: 100,
            [photo.id]: "not-an-id",
            [old.id]: "x",
            [unknown]: "x",
          },
          {},
        ),
      ),
    ).toEqual([
      `/values/${name.id} TOO_LONG`,
      `/values/${notes.id} CONTROL_CHARACTERS`,
      `/values/${weight.id} OUT_OF_RANGE`,
      `/values/${vegan.id} INVALID_TYPE`,
      `/values/${since.id} DATE_INVALID`,
      `/values/${opens.id} TIME_INVALID`,
      `/values/${days.id} WEEKDAYS_INVALID`,
      `/values/${category.id} CHOICE_UNKNOWN`,
      `/values/${price.id} PRICE_FIELD`,
      `/values/${photo.id} INVALID_TYPE`,
      `/values/${old.id} ARCHIVED_FIELD`,
      `/values/${unknown} UNKNOWN_FIELD`,
    ]);
  });

  it("requires required fields and bounds the stored size", () => {
    expect(reasons(() => planValues(fields, { [name.id]: "  " }, {}))).toEqual([
      `/values/${name.id} REQUIRED`,
    ]);
    const wide = planSchema(
      [],
      Array.from({ length: 10 }, (_, index) => ({
        label: `Text ${index}`,
        type: "longText" as const,
        maxLength: 2000,
      })),
      newId,
    ).fields;
    expect(
      reasons(() =>
        planValues(
          wide,
          Object.fromEntries(wide.map((field) => [field.id, "é".repeat(2000)])),
          {},
        ),
      ),
    ).toEqual(["/values RECORD_TOO_LARGE"]);
  });

  it("reports changed field IDs only", () => {
    const first = planValues(fields, { [name.id]: "Tea" }, {});
    const second = planValues(
      fields,
      { [name.id]: "Tea", [vegan.id]: true },
      first.values,
    );
    expect(second.changed).toEqual([vegan.id]);
  });
});

describe("promotions and effective prices", () => {
  const branchA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const branchB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const promotion = (
    id: string,
    branchId: string | null,
    startsAt: string,
    endsAt: string,
    amount = 999,
  ): Promotion => ({ id, branchId, amount, startsAt, endsAt });

  it("validates local minutes", () => {
    expect(isLocalMinute("2026-10-20T08:00")).toBe(true);
    expect(isLocalMinute("2026-02-30T08:00")).toBe(false);
    expect(isLocalMinute("2026-10-20T24:00")).toBe(false);
    expect(isLocalMinute("2026-10-20 08:00")).toBe(false);
  });

  it("conflicts when windows overlap and branch scopes intersect", () => {
    const week = promotion(
      "p1",
      branchA,
      "2026-11-02T00:00",
      "2026-11-09T00:00",
    );
    expect(
      promotionsConflict(
        week,
        promotion("p2", branchA, "2026-11-08T23:59", "2026-11-10T00:00"),
      ),
    ).toBe(true);
    expect(
      promotionsConflict(
        week,
        promotion("p2", null, "2026-11-05T00:00", "2026-11-06T00:00"),
      ),
    ).toBe(true);
    expect(
      promotionsConflict(
        week,
        promotion("p2", branchB, "2026-11-05T00:00", "2026-11-06T00:00"),
      ),
    ).toBe(false);
    expect(
      promotionsConflict(
        week,
        promotion("p2", branchA, "2026-11-09T00:00", "2026-11-10T00:00"),
      ),
    ).toBe(false);
  });

  it("prefers a promotion, then the branch price, then the base price", () => {
    const facts = {
      base: 1990,
      overrides: new Map([[branchA, 1790]]),
      promotions: [
        promotion("scope", null, "2026-11-01T00:00", "2026-11-02T00:00", 1490),
        promotion("b", branchB, "2026-11-03T18:00", "2026-11-03T22:00", 1290),
      ],
    };
    expect(effectivePrice(facts, null, "2026-10-31T23:59")).toEqual({
      amount: 1990,
      source: "base",
      promotionId: null,
    });
    expect(effectivePrice(facts, branchA, "2026-10-31T23:59")).toEqual({
      amount: 1790,
      source: "override",
      promotionId: null,
    });
    expect(effectivePrice(facts, branchA, "2026-11-01T00:00")).toEqual({
      amount: 1490,
      source: "promotion",
      promotionId: "scope",
    });
    expect(effectivePrice(facts, branchB, "2026-11-03T21:59")).toMatchObject({
      amount: 1290,
      source: "promotion",
    });
    expect(effectivePrice(facts, branchB, "2026-11-03T22:00")).toMatchObject({
      amount: 1990,
      source: "base",
    });
    expect(effectivePrice(facts, null, "2026-11-03T20:00")).toMatchObject({
      source: "base",
    });
    expect(
      effectivePrice(
        { base: null, overrides: new Map(), promotions: [] },
        branchA,
        "2026-11-03T20:00",
      ),
    ).toEqual({ amount: null, source: "none", promotionId: null });
  });
});

describe("names", () => {
  it("trims and bounds catalog names", () => {
    expect(catalogName("  Menu   do  dia ")).toBe("Menu do dia");
    expect(failure(() => catalogName(" "))?.code).toBe("VALIDATION_FAILED");
    expect(failure(() => catalogName("x".repeat(121)))?.code).toBe(
      "VALIDATION_FAILED",
    );
  });
});
