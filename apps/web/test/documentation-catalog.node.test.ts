import { expect, test } from "vitest";
import { catalogPage } from "../src/documentation/catalog-model.js";
import type { Entry } from "../src/documentation/types.js";

function entry(id: string, tags?: string[]): Entry {
  return {
    id,
    title: id,
    kind: "repository",
    group: "Guides",
    source: `${id}.md`,
    file: `${id}.json`,
    summary: "",
    headings: [],
    tags,
  };
}

test("bounds sibling folders and direct pages together without losing entries", () => {
  const inventory = [
    ...Array.from({ length: 1000 }, (_, index) =>
      entry(`repository/folder-${index}/guide`),
    ),
    entry("repository/start"),
    entry("repository/folder-0/another"),
    entry("api/other"),
  ];
  const seen: string[] = [];
  for (let page = 1; page <= 42; page++) {
    const result = catalogPage(inventory, "repository", page, "");
    expect(result.folders.length + result.entries.length).toBeLessThanOrEqual(
      24,
    );
    expect(result.entryCount).toBe(1002);
    seen.push(
      ...result.folders.map((folder) => folder.name),
      ...result.entries.map((item) => item.id),
    );
  }
  expect(seen).toHaveLength(1001);
  expect(new Set(seen).size).toBe(1001);
  expect(catalogPage(inventory, "repository", 1, "").folders[0].count).toBe(2);
  expect(catalogPage(inventory, "repository", 100, "").current).toBe(42);
});

test("API group filtering precedes pagination and keeps other groups discoverable", () => {
  const inventory = Array.from({ length: 50 }, (_, index) =>
    entry(`api/op-${index}`, [index % 2 ? "Health" : "Requests"]),
  );
  const result = catalogPage(inventory, "api", 2, "Requests");
  expect(result.groups).toEqual(["Requests", "Health"]);
  expect(result.pageCount).toBe(2);
  expect(result.entries).toHaveLength(1);
  expect(result.entries[0].tags).toEqual(["Requests"]);
  expect(catalogPage([], "api", 10, "")).toMatchObject({
    current: 1,
    pageCount: 1,
    entries: [],
    folders: [],
  });
});

test("component categories filter before pagination and keep legacy entries discoverable", () => {
  const inventory: Entry[] = Array.from({ length: 50 }, (_, index) => ({
    ...entry(`components/Action${index}`),
    kind: "component",
    category: "Actions",
  }));
  inventory.push({ ...entry("components/Legacy"), kind: "component" });
  const result = catalogPage(inventory, "components", 3, "Actions");
  expect(result.entries).toHaveLength(26 - 24);
  expect(result.pageCount).toBe(3);
  expect(result.groups).toEqual(["Actions", "Uncategorized"]);
  expect(
    catalogPage(inventory, "components", 1, "Uncategorized").entries[0].id,
  ).toBe("components/Legacy");
  expect(catalogPage(inventory, "components", 1, "Overlays").entries).toEqual(
    [],
  );
});
