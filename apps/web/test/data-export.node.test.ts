import { expect, test } from "vitest";
import { toCsv, type ExportTable } from "../src/data-export.js";

const table = (locale: ExportTable["locale"]): ExportTable => ({
  title: "Stores",
  locale,
  columns: [
    { header: "Name", width: 200, align: "start" },
    { header: "Screens", width: 120, align: "end" },
  ],
  rows: [
    ["Loja; Centro", 1.5],
    ['Ponto "A"\nNorte', 2],
    ["=HYPERLINK(1)", -3],
    ["+55 11", 1000],
  ],
  description: "",
  page: () => "",
});

test("Portuguese CSV uses the separator and decimal mark of Portuguese spreadsheets", () => {
  const csv = toCsv(table("pt-BR"));
  expect(csv.startsWith("\uFEFF")).toBe(true);
  expect(csv.slice(1).split("\r\n")).toEqual([
    "Name;Screens",
    '"Loja; Centro";1,5',
    '"Ponto ""A""\nNorte";2',
    // Text that a spreadsheet would run as a formula stays text; numbers keep their sign.
    "'=HYPERLINK(1);-3",
    "'+55 11;1000",
    "",
  ]);
});

test("English CSV uses commas and points", () => {
  const lines = toCsv(table("en-US")).slice(1).split("\r\n");
  expect(lines[0]).toBe("Name,Screens");
  expect(lines[1]).toBe("Loja; Centro,1.5");
  expect(lines[4]).toBe("'+55 11,1000");
});
