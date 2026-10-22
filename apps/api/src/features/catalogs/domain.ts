// Framework-independent catalog rules from the catalog and composition design
// (docs/project/catalog-composition-design.md) and ADR-0032: field types and
// their settings, schema changes, record values, money, promotions and the
// effective price.
import { Temporal } from "temporal-polyfill";

export type FieldType =
  | "text"
  | "longText"
  | "number"
  | "boolean"
  | "date"
  | "time"
  | "weekdays"
  | "selection"
  | "money"
  | "media"
  | "reference";

export const fieldTypes: readonly FieldType[] = [
  "text",
  "longText",
  "number",
  "boolean",
  "date",
  "time",
  "weekdays",
  "selection",
  "money",
  "media",
  "reference",
];

/** Engineering defaults; changing one is a reviewed code change. */
export const catalogPolicy = Object.freeze({
  maxCatalogsPerCompany: 200,
  maxFieldsPerCatalog: 60,
  maxRecordsPerCatalog: 5_000,
  maxChoicesPerField: 100,
  maxPromotionsPerPrice: 100,
  maxRecordValueBytes: 16_384,
  maxAmount: 1_000_000_000_000,
  maxIssues: 50,
  textMaxLength: { min: 1, max: 500, default: 120 },
  longTextMaxLength: { min: 1, max: 2_000, default: 500 },
  maxDecimals: 4,
  maxIntegerDigits: 15,
});

/**
 * ISO 4217 minor units of the currencies money fields may use (ADR-0032).
 * Only currencies whose ISO and CLDR minor units agree are listed, so the
 * panel's and the player's locale formatting shows exactly the stored
 * amount; a test checks the table against Intl.NumberFormat.
 */
export const currencyMinorUnits: Readonly<Record<string, number>> =
  Object.freeze({
    AED: 2,
    AOA: 2,
    ARS: 2,
    AUD: 2,
    BHD: 3,
    BOB: 2,
    BRL: 2,
    CAD: 2,
    CHF: 2,
    CLP: 0,
    CNY: 2,
    COP: 2,
    CRC: 2,
    CVE: 2,
    CZK: 2,
    DKK: 2,
    DOP: 2,
    EGP: 2,
    EUR: 2,
    GBP: 2,
    GTQ: 2,
    HKD: 2,
    HNL: 2,
    HUF: 2,
    IDR: 2,
    ILS: 2,
    INR: 2,
    ISK: 0,
    JOD: 3,
    JPY: 0,
    KES: 2,
    KRW: 0,
    KWD: 3,
    MAD: 2,
    MXN: 2,
    MYR: 2,
    MZN: 2,
    NGN: 2,
    NIO: 2,
    NOK: 2,
    NZD: 2,
    OMR: 3,
    PAB: 2,
    PEN: 2,
    PHP: 2,
    PLN: 2,
    PYG: 0,
    QAR: 2,
    RON: 2,
    SAR: 2,
    SEK: 2,
    SGD: 2,
    THB: 2,
    TND: 3,
    TRY: 2,
    TWD: 2,
    UAH: 2,
    USD: 2,
    UYU: 2,
    VND: 0,
    XAF: 0,
    XOF: 0,
    ZAR: 2,
  });

export type CatalogFailureCode =
  | "RESOURCE_NOT_FOUND"
  | "VALIDATION_FAILED"
  | "RESOURCE_VERSION_CONFLICT"
  | "CATALOG_SCHEMA_INVALID"
  | "CATALOG_RECORD_INVALID"
  | "CATALOG_RECORD_REFERENCED"
  | "CATALOG_PROMOTION_CONFLICT"
  | "CATALOG_LIMIT_REACHED"
  | "CATALOG_ARCHIVED"
  | "CATALOG_NOT_EMPTY"
  | "CATALOG_IN_USE"
  | "PRICE_TARGET_FORBIDDEN";

/**
 * One problem with a request, located by a JSON Pointer into its body. The
 * reason is a stable code; `count` says how many stored records or prices
 * cause it, and `fieldId` names a field that is absent from the body.
 */
export type Issue = Readonly<{
  path: string;
  reason: string;
  fieldId?: string;
  count?: number;
}>;

export class CatalogFailure extends Error {
  readonly code: CatalogFailureCode;
  readonly issues: readonly Issue[];
  constructor(code: CatalogFailureCode, issues: readonly Issue[] = []) {
    super(`Catalog failure: ${code}`);
    this.name = "CatalogFailure";
    this.code = code;
    this.issues = issues.slice(0, catalogPolicy.maxIssues);
  }
}

const controlCharacters = /\p{Cc}/u;
const uuidShape =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const length = (value: string) => [...value].length;

/** Trims and collapses whitespace; 1 to `max` characters, no controls. */
function displayText(value: string, max: number): string | null {
  if (controlCharacters.test(value.replace(/[\t\n\r]/g, " "))) return null;
  const text = value.replace(/\s+/g, " ").trim();
  return text.length < 1 || length(text) > max ? null : text;
}

export function catalogName(value: string): string {
  const name = displayText(value, 120);
  if (name === null) throw new CatalogFailure("VALIDATION_FAILED");
  return name;
}

// Decimals

const decimalShape = /^([+-])?(\d+)(?:\.(\d+))?$/;

/**
 * The canonical form of a decimal string with exactly `decimals` places,
 * or null when it has more places, more than 15 integer digits or another
 * shape. Never goes through a binary float.
 */
export function canonicalDecimal(
  value: string,
  decimals: number,
): string | null {
  const match = decimalShape.exec(value.trim());
  if (!match) return null;
  const integer = match[2].replace(/^0+(?=\d)/, "");
  const fraction = match[3] ?? "";
  if (integer.length > catalogPolicy.maxIntegerDigits) return null;
  if (fraction.replace(/0+$/, "").length > decimals) return null;
  const places = fraction.padEnd(decimals, "0").slice(0, decimals);
  const zero = /^0+$/.test(integer + places);
  const sign = match[1] === "-" && !zero ? "-" : "";
  return decimals === 0 ? `${sign}${integer}` : `${sign}${integer}.${places}`;
}

/** A canonical decimal as an integer count of its smallest place. */
function scaled(value: string): bigint {
  return BigInt(value.replace(".", ""));
}

// Local dates, times and promotion windows

export function isLocalDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  try {
    Temporal.PlainDate.from(value, { overflow: "reject" });
    return true;
  } catch {
    return false;
  }
}

export function isLocalTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

/** `YYYY-MM-DDTHH:MM`, a local wall-clock minute. */
export function isLocalMinute(value: string): boolean {
  const [date, time] = value.split("T");
  return (
    value.length === 16 &&
    date !== undefined &&
    time !== undefined &&
    isLocalDate(date) &&
    isLocalTime(time)
  );
}

export function isAmount(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= catalogPolicy.maxAmount
  );
}

// Fields and schemas

export type Choice = Readonly<{ id: string; label: string }>;

/** A stored field with its normalized settings. */
export type FieldDefinition = Readonly<{
  id: string;
  label: string;
  type: FieldType;
  required: boolean;
  archived: boolean;
  /** text and longText. */
  maxLength?: number;
  /** number. */
  decimals?: number;
  minimum?: string | null;
  maximum?: string | null;
  /** selection. */
  choices?: readonly Choice[];
  /** money. */
  currency?: string;
  promotions?: boolean;
  /** reference. */
  targetCatalogId?: string;
}>;

/** A field as sent in a whole-schema save; new fields have no ID. */
export type FieldInput = Readonly<{
  id?: string;
  label: string;
  type: FieldType;
  required?: boolean;
  archived?: boolean;
  maxLength?: number;
  decimals?: number;
  minimum?: string | null;
  maximum?: string | null;
  choices?: readonly Readonly<{ id?: string; label: string }>[];
  currency?: string;
  promotions?: boolean;
  targetCatalogId?: string;
}>;

const settingNames = [
  "maxLength",
  "decimals",
  "minimum",
  "maximum",
  "choices",
  "currency",
  "promotions",
  "targetCatalogId",
] as const;

const applicable: Readonly<Record<FieldType, readonly string[]>> = {
  text: ["maxLength"],
  longText: ["maxLength"],
  number: ["decimals", "minimum", "maximum"],
  boolean: [],
  date: [],
  time: [],
  weekdays: [],
  selection: ["choices"],
  money: ["currency", "promotions"],
  media: [],
  reference: ["targetCatalogId"],
};

/**
 * A condition the service checks against stored records and prices before
 * accepting a schema. Each failing check becomes an issue with its count.
 */
export type SchemaCheck = Readonly<
  | { kind: "removed"; fieldId: string }
  | { kind: "missing"; fieldId: string; path: string }
  | { kind: "tooLong"; fieldId: string; path: string; maxLength: number }
  | {
      kind: "outOfRange";
      fieldId: string;
      path: string;
      minimum: string | null;
      maximum: string | null;
    }
  | { kind: "choices"; fieldId: string; path: string; removed: string[] }
  | { kind: "promotions"; fieldId: string; path: string }
  | { kind: "target"; fieldId: string; path: string; catalogId: string }
>;

export type SchemaPlan = Readonly<{
  fields: readonly FieldDefinition[];
  checks: readonly SchemaCheck[];
  /** Field IDs by change, for the audit event. */
  changes: Readonly<{
    added: string[];
    renamed: string[];
    archived: string[];
    restored: string[];
    removed: string[];
    changed: string[];
  }>;
}>;

function sameSettings(a: FieldDefinition, b: FieldDefinition): boolean {
  return (
    a.required === b.required &&
    a.maxLength === b.maxLength &&
    a.minimum === b.minimum &&
    a.maximum === b.maximum &&
    a.promotions === b.promotions &&
    JSON.stringify(a.choices ?? null) === JSON.stringify(b.choices ?? null)
  );
}

/**
 * Plans a whole-schema save: validates the ordered field list against the
 * current one, keeps stable identifiers and immutable meaning, assigns IDs
 * to new fields and choices, and lists the checks that depend on stored
 * data. Throws CATALOG_SCHEMA_INVALID with the issues it finds.
 */
export function planSchema(
  current: readonly FieldDefinition[],
  input: readonly FieldInput[],
  newId: () => string,
): SchemaPlan {
  if (input.length > catalogPolicy.maxFieldsPerCatalog)
    throw new CatalogFailure("CATALOG_LIMIT_REACHED");
  const issues: Issue[] = [];
  const checks: SchemaCheck[] = [];
  const byId = new Map(current.map((field) => [field.id, field]));
  const seen = new Set<string>();
  const labels = new Map<string, number>();
  const fields: FieldDefinition[] = [];
  const changes = {
    added: [] as string[],
    renamed: [] as string[],
    archived: [] as string[],
    restored: [] as string[],
    removed: [] as string[],
    changed: [] as string[],
  };
  input.forEach((entry, index) => {
    const path = `/fields/${index}`;
    const issue = (reason: string, property?: string) =>
      issues.push({ path: property ? `${path}/${property}` : path, reason });
    const before = entry.id === undefined ? undefined : byId.get(entry.id);
    if (entry.id !== undefined) {
      if (!before) return issue("UNKNOWN_FIELD", "id");
      if (seen.has(entry.id)) return issue("DUPLICATE_FIELD", "id");
      seen.add(entry.id);
    }
    const label = displayText(entry.label, 80);
    if (label === null) issue("LABEL_INVALID", "label");
    const type = entry.type;
    if (before && before.type !== type) return issue("TYPE_IMMUTABLE", "type");
    for (const name of settingNames)
      if (entry[name] !== undefined && !applicable[type].includes(name))
        issue("SETTING_NOT_APPLICABLE", name);
    const required = entry.required ?? false;
    const archived = entry.archived ?? false;
    if (required && type === "money") issue("REQUIRED_NOT_ALLOWED", "required");
    const id = before?.id ?? newId();
    let field: FieldDefinition = {
      id,
      label: label ?? entry.label,
      type,
      required,
      archived,
    };
    switch (type) {
      case "text":
      case "longText": {
        const bounds =
          type === "text"
            ? catalogPolicy.textMaxLength
            : catalogPolicy.longTextMaxLength;
        const maxLength =
          entry.maxLength ?? before?.maxLength ?? bounds.default;
        if (
          !Number.isInteger(maxLength) ||
          maxLength < bounds.min ||
          maxLength > bounds.max
        )
          issue("SETTING_INVALID", "maxLength");
        field = { ...field, maxLength };
        if (before?.maxLength !== undefined && maxLength < before.maxLength)
          checks.push({ kind: "tooLong", fieldId: id, path, maxLength });
        break;
      }
      case "number": {
        const decimals = entry.decimals ?? before?.decimals ?? 0;
        if (
          !Number.isInteger(decimals) ||
          decimals < 0 ||
          decimals > catalogPolicy.maxDecimals
        ) {
          issue("SETTING_INVALID", "decimals");
          break;
        }
        if (before && before.decimals !== decimals)
          issue("DECIMALS_IMMUTABLE", "decimals");
        const bound = (name: "minimum" | "maximum") => {
          const value = entry[name] ?? null;
          if (value === null) return null;
          const canonical = canonicalDecimal(value, decimals);
          if (canonical === null) issue("SETTING_INVALID", name);
          return canonical;
        };
        const minimum = bound("minimum");
        const maximum = bound("maximum");
        if (
          minimum !== null &&
          maximum !== null &&
          scaled(minimum) > scaled(maximum)
        )
          issue("SETTING_INVALID", "maximum");
        field = { ...field, decimals, minimum, maximum };
        const tighter =
          (minimum !== null &&
            (before?.minimum == null ||
              scaled(minimum) > scaled(before.minimum))) ||
          (maximum !== null &&
            (before?.maximum == null ||
              scaled(maximum) < scaled(before.maximum)));
        if (before && tighter)
          checks.push({
            kind: "outOfRange",
            fieldId: id,
            path,
            minimum,
            maximum,
          });
        break;
      }
      case "selection": {
        const choices = entry.choices ?? [];
        if (
          choices.length < 1 ||
          choices.length > catalogPolicy.maxChoicesPerField
        ) {
          issue("CHOICES_INVALID", "choices");
          break;
        }
        const known = new Set(before?.choices?.map((choice) => choice.id));
        const used = new Set<string>();
        const choiceLabels = new Set<string>();
        const normalized = choices.map((choice, position) => {
          const choiceLabel = displayText(choice.label, 80);
          const choicePath = `choices/${position}`;
          if (choiceLabel === null)
            issue("LABEL_INVALID", `${choicePath}/label`);
          else if (choiceLabels.has(choiceLabel.toLowerCase()))
            issue("LABEL_DUPLICATE", `${choicePath}/label`);
          else choiceLabels.add(choiceLabel.toLowerCase());
          if (choice.id !== undefined) {
            if (!known.has(choice.id) || used.has(choice.id))
              issue("CHOICES_INVALID", `${choicePath}/id`);
            used.add(choice.id);
          }
          return {
            id: choice.id ?? newId(),
            label: choiceLabel ?? choice.label,
          };
        });
        field = { ...field, choices: normalized };
        const removed = [...known].filter((choice) => !used.has(choice));
        if (removed.length > 0)
          checks.push({ kind: "choices", fieldId: id, path, removed });
        break;
      }
      case "money": {
        const currency = entry.currency ?? before?.currency;
        if (currency === undefined || !(currency in currencyMinorUnits))
          issue("CURRENCY_UNSUPPORTED", "currency");
        else if (before && before.currency !== currency)
          issue("CURRENCY_IMMUTABLE", "currency");
        const promotions = entry.promotions ?? before?.promotions ?? true;
        field = { ...field, currency: currency ?? "", promotions };
        if (before?.promotions && !promotions)
          checks.push({ kind: "promotions", fieldId: id, path });
        break;
      }
      case "reference": {
        const target = entry.targetCatalogId ?? before?.targetCatalogId;
        if (target === undefined || !uuidShape.test(target)) {
          issue("TARGET_INVALID", "targetCatalogId");
          break;
        }
        if (before && before.targetCatalogId !== target)
          issue("TARGET_IMMUTABLE", "targetCatalogId");
        field = { ...field, targetCatalogId: target.toLowerCase() };
        if (!before)
          checks.push({ kind: "target", fieldId: id, path, catalogId: target });
        break;
      }
      default:
        break;
    }
    if (!archived && label !== null) {
      const key = label.toLowerCase();
      if (labels.has(key)) issue("LABEL_DUPLICATE", "label");
      else labels.set(key, index);
    }
    const enforced = !archived && required;
    const wasEnforced =
      before !== undefined && !before.archived && before.required;
    if (enforced && !wasEnforced)
      checks.push({ kind: "missing", fieldId: id, path });
    if (!before) changes.added.push(id);
    else {
      if (before.label !== field.label) changes.renamed.push(id);
      if (!before.archived && archived) changes.archived.push(id);
      if (before.archived && !archived) changes.restored.push(id);
      if (!sameSettings(before, field)) changes.changed.push(id);
    }
    fields.push(field);
  });
  for (const field of current)
    if (!seen.has(field.id)) {
      changes.removed.push(field.id);
      checks.push({ kind: "removed", fieldId: field.id });
    }
  if (issues.length > 0)
    throw new CatalogFailure("CATALOG_SCHEMA_INVALID", issues);
  return { fields, checks, changes };
}

/** The first active text field gives records their title. */
export function titleField(
  fields: readonly FieldDefinition[],
): FieldDefinition | undefined {
  return fields.find((field) => field.type === "text" && !field.archived);
}

// Record values

/** A stored or wire value of one field. */
export type FieldValue = string | number | boolean | readonly number[];
export type Values = Readonly<Record<string, FieldValue>>;

export type ValuesPlan = Readonly<{
  values: Values;
  /** Field IDs whose values changed, for the audit event. */
  changed: readonly string[];
}>;

export type Links = Readonly<{
  /** Media IDs held by media fields, by field ID. */
  media: ReadonlyMap<string, string>;
  /** Record IDs held by reference fields, by field ID. */
  references: ReadonlyMap<string, string>;
}>;

/** The media and records that a record's values name, archived fields included. */
export function linksOf(
  fields: readonly FieldDefinition[],
  values: Values,
): Links {
  const media = new Map<string, string>();
  const references = new Map<string, string>();
  for (const field of fields) {
    const value = values[field.id];
    if (typeof value !== "string") continue;
    if (field.type === "media") media.set(field.id, value);
    if (field.type === "reference") references.set(field.id, value);
  }
  return { media, references };
}

function validValue(
  field: FieldDefinition,
  raw: unknown,
): { value?: FieldValue; reason?: string } {
  switch (field.type) {
    case "text":
    case "longText": {
      if (typeof raw !== "string") return { reason: "INVALID_TYPE" };
      const text =
        field.type === "text" ? raw.trim() : raw.replace(/\r\n?/g, "\n").trim();
      const allowed = field.type === "text" ? text : text.replace(/\n/g, " ");
      if (controlCharacters.test(allowed))
        return { reason: "CONTROL_CHARACTERS" };
      if (text === "") return {};
      if (length(text) > (field.maxLength ?? 0)) return { reason: "TOO_LONG" };
      return { value: text };
    }
    case "number": {
      if (typeof raw !== "string") return { reason: "INVALID_TYPE" };
      if (raw.trim() === "") return {};
      const canonical = canonicalDecimal(raw, field.decimals ?? 0);
      if (canonical === null) return { reason: "NUMBER_FORMAT" };
      const value = scaled(canonical);
      if (
        (field.minimum != null && value < scaled(field.minimum)) ||
        (field.maximum != null && value > scaled(field.maximum))
      )
        return { reason: "OUT_OF_RANGE" };
      return { value: canonical };
    }
    case "boolean":
      return typeof raw === "boolean"
        ? { value: raw }
        : { reason: "INVALID_TYPE" };
    case "date":
      if (typeof raw !== "string") return { reason: "INVALID_TYPE" };
      return isLocalDate(raw) ? { value: raw } : { reason: "DATE_INVALID" };
    case "time":
      if (typeof raw !== "string") return { reason: "INVALID_TYPE" };
      return isLocalTime(raw) ? { value: raw } : { reason: "TIME_INVALID" };
    case "weekdays": {
      if (!Array.isArray(raw)) return { reason: "INVALID_TYPE" };
      if (raw.length === 0) return {};
      const days = raw as unknown[];
      if (
        days.length > 7 ||
        !days.every(
          (day) =>
            typeof day === "number" &&
            Number.isInteger(day) &&
            day >= 1 &&
            day <= 7,
        ) ||
        new Set(days).size !== days.length
      )
        return { reason: "WEEKDAYS_INVALID" };
      return { value: [...(days as number[])].sort((a, b) => a - b) };
    }
    case "selection":
      if (typeof raw !== "string") return { reason: "INVALID_TYPE" };
      return field.choices?.some((choice) => choice.id === raw)
        ? { value: raw }
        : { reason: "CHOICE_UNKNOWN" };
    case "media":
    case "reference":
      if (typeof raw !== "string") return { reason: "INVALID_TYPE" };
      return uuidShape.test(raw)
        ? { value: raw.toLowerCase() }
        : { reason: "INVALID_TYPE" };
    case "money":
      return { reason: "PRICE_FIELD" };
  }
}

/**
 * Validates a record's editable values (every active field except money)
 * as a whole replacement of the previous ones. Archived fields and base
 * prices keep their stored values; null or empty input means absent.
 * Media and references are checked against stored data by the service.
 * Throws CATALOG_RECORD_INVALID with the issues it finds.
 */
export function planValues(
  fields: readonly FieldDefinition[],
  input: Readonly<Record<string, unknown>>,
  previous: Values,
): ValuesPlan {
  const issues: Issue[] = [];
  const byId = new Map(fields.map((field) => [field.id, field]));
  const values: Record<string, FieldValue> = {};
  for (const [id, value] of Object.entries(previous)) {
    const field = byId.get(id);
    if (field && (field.archived || field.type === "money")) values[id] = value;
  }
  for (const [id, raw] of Object.entries(input)) {
    const path = `/values/${id}`;
    const field = byId.get(id);
    if (!field) {
      issues.push({ path, reason: "UNKNOWN_FIELD" });
      continue;
    }
    if (field.archived) {
      issues.push({ path, reason: "ARCHIVED_FIELD" });
      continue;
    }
    if (field.type === "money") {
      issues.push({ path, reason: "PRICE_FIELD" });
      continue;
    }
    if (raw === null) continue;
    const result = validValue(field, raw);
    if (result.reason) issues.push({ path, reason: result.reason });
    else if (result.value !== undefined) values[id] = result.value;
  }
  for (const field of fields)
    if (
      field.required &&
      !field.archived &&
      values[field.id] === undefined &&
      !issues.some((issue) => issue.path === `/values/${field.id}`)
    )
      issues.push({ path: `/values/${field.id}`, reason: "REQUIRED" });
  if (
    Buffer.byteLength(JSON.stringify(values), "utf8") >
    catalogPolicy.maxRecordValueBytes
  )
    issues.push({ path: "/values", reason: "RECORD_TOO_LARGE" });
  if (issues.length > 0)
    throw new CatalogFailure("CATALOG_RECORD_INVALID", issues);
  const changed = [
    ...new Set([...Object.keys(previous), ...Object.keys(values)]),
  ]
    .filter((id) => JSON.stringify(previous[id]) !== JSON.stringify(values[id]))
    .sort();
  return { values, changed };
}

// Prices

export type Promotion = Readonly<{
  id: string;
  branchId: string | null;
  amount: number;
  /** Local `YYYY-MM-DDTHH:MM`, inclusive. */
  startsAt: string;
  /** Local `YYYY-MM-DDTHH:MM`, exclusive. */
  endsAt: string;
}>;

/** Windows overlap and branch scopes intersect (null is the whole scope). */
export function promotionsConflict(
  a: Omit<Promotion, "id" | "amount">,
  b: Omit<Promotion, "id" | "amount">,
): boolean {
  const scopes =
    a.branchId === null || b.branchId === null || a.branchId === b.branchId;
  return scopes && a.startsAt < b.endsAt && b.startsAt < a.endsAt;
}

export type PriceFacts = Readonly<{
  base: number | null;
  overrides: ReadonlyMap<string, number>;
  promotions: readonly Promotion[];
}>;

export type EffectivePrice = Readonly<{
  amount: number | null;
  source: "promotion" | "override" | "base" | "none";
  promotionId: string | null;
}>;

/**
 * The price a branch shows at a local minute: an applicable promotion, then
 * the branch override, then the base price. A null branch evaluates the
 * whole scope, where only scope-wide promotions apply.
 */
export function effectivePrice(
  facts: PriceFacts,
  branchId: string | null,
  at: string,
): EffectivePrice {
  const promotion = facts.promotions.find(
    (candidate) =>
      (candidate.branchId === null || candidate.branchId === branchId) &&
      candidate.startsAt <= at &&
      at < candidate.endsAt,
  );
  if (promotion)
    return {
      amount: promotion.amount,
      source: "promotion",
      promotionId: promotion.id,
    };
  const override =
    branchId === null ? undefined : facts.overrides.get(branchId);
  if (override !== undefined)
    return { amount: override, source: "override", promotionId: null };
  if (facts.base !== null)
    return { amount: facts.base, source: "base", promotionId: null };
  return { amount: null, source: "none", promotionId: null };
}
