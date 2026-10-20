import { describe, expect, test } from "vitest";
import {
  amountInput,
  decimalInput,
  decimalValue,
  formatAmount,
  minorUnits,
  parseAmount,
} from "../src/catalogs/money.js";

describe("catalog money (ADR-0032)", () => {
  test("reads the currency's minor units", () => {
    expect(minorUnits("BRL")).toBe(2);
    expect(minorUnits("JPY")).toBe(0);
    expect(minorUnits("KWD")).toBe(3);
  });

  test("parses what people type in their locale into minor units", () => {
    expect(parseAmount("19,9", "BRL", "pt-BR")).toBe(1990);
    expect(parseAmount("1.234,56", "BRL", "pt-BR")).toBe(123456);
    expect(parseAmount("19.90", "BRL", "en-US")).toBe(1990);
    expect(parseAmount("1,234.5", "USD", "en-US")).toBe(123450);
    expect(parseAmount("1 990", "JPY", "en-US")).toBe(1990);
    expect(parseAmount("0,125", "KWD", "pt-BR")).toBe(125);
    expect(parseAmount("0", "BRL", "pt-BR")).toBe(0);
    expect(parseAmount("  ", "BRL", "pt-BR")).toBeNull();
  });

  test("refuses more decimals than the currency, signs and huge amounts", () => {
    expect(parseAmount("19,999", "BRL", "pt-BR")).toBeUndefined();
    expect(parseAmount("19.5", "JPY", "en-US")).toBeUndefined();
    expect(parseAmount("-1", "BRL", "en-US")).toBeUndefined();
    expect(parseAmount("1e3", "BRL", "en-US")).toBeUndefined();
    expect(parseAmount("10000000000.01", "BRL", "en-US")).toBeUndefined();
    expect(parseAmount("10000000000", "BRL", "en-US")).toBe(1_000_000_000_000);
  });

  test("formats exactly with the field's currency and the person's locale", () => {
    const space = /[\s\u00a0]/g;
    expect(formatAmount(1990, "BRL", "pt-BR").replace(space, " ")).toBe(
      "R$ 19,90",
    );
    expect(formatAmount(1990, "BRL", "en-US")).toBe("R$19.90");
    expect(formatAmount(1990, "JPY", "en-US")).toBe("¥1,990");
    expect(formatAmount(5, "KWD", "en-US").replace(space, " ")).toBe(
      "KWD 0.005",
    );
    expect(formatAmount(1_000_000_000_000, "BRL", "en-US")).toBe(
      "R$10,000,000,000.00",
    );
    expect(amountInput(1990, "BRL", "pt-BR")).toBe("19,90");
    expect(amountInput(5, "USD", "en-US")).toBe("0.05");
  });

  test("shows canonical decimals in the locale and reads them back", () => {
    expect(decimalInput("12.50", "pt-BR")).toBe("12,50");
    expect(decimalValue(" 12,5 ", "pt-BR")).toBe("12.5");
    expect(decimalValue("12.5", "en-US")).toBe("12.5");
  });
});
