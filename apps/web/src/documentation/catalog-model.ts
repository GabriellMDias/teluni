import type { Entry } from "./types.js";

export function catalogPage(
  inventory: readonly Entry[],
  id: string,
  page: number,
  group: string,
) {
  const prefix = `${id}/`;
  const folders = new Map<string, number>();
  const direct: Entry[] = [];
  let entryCount = 0;
  for (const entry of inventory) {
    if (!entry.id.startsWith(prefix)) continue;
    entryCount++;
    const suffix = entry.id.slice(prefix.length);
    const separator = suffix.indexOf("/");
    if (separator < 0) direct.push(entry);
    else {
      const name = suffix.slice(0, separator);
      folders.set(name, (folders.get(name) ?? 0) + 1);
    }
  }
  const listed = group
    ? direct.filter((entry) =>
        id === "components"
          ? (entry.category ?? "Uncategorized") === group
          : entry.tags?.includes(group),
      )
    : direct;
  const size = 24;
  const pageCount = Math.max(
    1,
    Math.ceil((folders.size + listed.length) / size),
  );
  const current = Math.min(Math.max(page, 1), pageCount);
  const start = (current - 1) * size;
  const end = current * size;
  return {
    entryCount,
    current,
    pageCount,
    folders: [...folders]
      .slice(start, end)
      .map(([name, count]) => ({ name, count })),
    entries: listed.slice(
      Math.max(0, start - folders.size),
      Math.max(0, end - folders.size),
    ),
    groups:
      id === "components"
        ? [
            ...new Set(
              direct.map((entry) => entry.category ?? "Uncategorized"),
            ),
          ].sort()
        : id === "api"
          ? [...new Set(direct.flatMap((entry) => entry.tags ?? []))]
          : [],
  };
}
