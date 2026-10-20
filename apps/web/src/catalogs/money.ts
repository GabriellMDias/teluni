import type { Locale } from "../locale.js";

// Money in the panel (ADR-0032): amounts are integer minor units of the
// field's currency. People type and read them in their locale; the amount
// itself never goes through a binary float.

/** Minor units of a currency, as Intl formats it. */
export function minorUnits(currency: string): number {
  return (
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
    }).resolvedOptions().maximumFractionDigits ?? 2
  );
}

function separators(locale: Locale) {
  const parts = new Intl.NumberFormat(locale).formatToParts(12345.6);
  return {
    decimal: parts.find((part) => part.type === "decimal")?.value ?? ".",
    group: parts.find((part) => part.type === "group")?.value ?? ",",
  };
}

/** `1990` with two minor units is `"19.90"`, exactly. */
function decimalText(amount: number, digits: number): string {
  const text = String(amount).padStart(digits + 1, "0");
  return digits === 0
    ? text
    : `${text.slice(0, -digits)}.${text.slice(-digits)}`;
}

/** An amount for people, such as `R$ 19,90` in pt-BR. */
export function formatAmount(
  amount: number,
  currency: string,
  locale: Locale,
): string {
  // A decimal string keeps the exact amount; Intl formats it as written.
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(
    decimalText(amount, minorUnits(currency)) as Intl.StringNumericLiteral,
  );
}

/** An amount to edit in an input: `19,90` in pt-BR, `19.90` in en-US. */
export function amountInput(
  amount: number,
  currency: string,
  locale: Locale,
): string {
  const text = decimalText(amount, minorUnits(currency));
  return text.replace(".", separators(locale).decimal);
}

/**
 * Parses what a person typed into minor units: `"19,9"` in pt-BR and
 * `"19.90"` in en-US are both 1990 for BRL. Group separators and spaces
 * are ignored. Returns null for empty input and undefined when the text is
 * not an amount, has more decimals than the currency or exceeds 10^12.
 */
export function parseAmount(
  text: string,
  currency: string,
  locale: Locale,
): number | null | undefined {
  const { decimal, group } = separators(locale);
  const compact = text
    .replace(/[\s\u00a0\u202f]/g, "")
    .split(group)
    .join("");
  if (compact === "") return null;
  const normalized = decimal === "." ? compact : compact.replace(decimal, ".");
  const match = /^(\d{1,13})(?:\.(\d+))?$/.exec(normalized);
  if (!match) return undefined;
  const digits = minorUnits(currency);
  const fraction = match[2] ?? "";
  if (fraction.length > digits) return undefined;
  const amount = Number(`${match[1]}${fraction.padEnd(digits, "0")}`);
  return Number.isSafeInteger(amount) && amount <= 1_000_000_000_000
    ? amount
    : undefined;
}

/** A canonical decimal (`"12.50"`) shown in the locale (`"12,50"`). */
export function decimalInput(value: string, locale: Locale): string {
  return value.replace(".", separators(locale).decimal);
}

/** What a person typed as a decimal, in the API's canonical shape. */
export function decimalValue(text: string, locale: Locale): string {
  const { decimal } = separators(locale);
  const trimmed = text.trim();
  return decimal === "." ? trimmed : trimmed.replace(decimal, ".");
}
