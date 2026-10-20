// Framework-independent layout rules from the catalog and composition design
// (docs/project/catalog-composition-design.md#layouts): canvas geometry,
// areas, audio, pages, catalog views, the conservative text measure that
// decides how many records fit and which overflow, and the versioned
// `teluni.layout` text representation. It reads no clock and no database.
import { ProgrammingFailure, type Issue } from "./domain.js";

export type Orientation = "landscape" | "portrait";
export type AreaKind = "media" | "catalog";
export type MediaFit = "contain" | "cover";
export type ViewRole =
  "title" | "subtitle" | "price" | "image" | "detail" | "group";
export type Presentation = "list" | "table" | "menu" | "agenda";

/** Canvas units per orientation; screens scale the canvas to fit. */
export const canvases: Readonly<
  Record<Orientation, { width: number; height: number }>
> = {
  landscape: { width: 1920, height: 1080 },
  portrait: { width: 1080, height: 1920 },
};

/** Engineering defaults; changing one is a reviewed code change. */
export const layoutPolicy = Object.freeze({
  maxAreas: 12,
  minPages: 2,
  maxPages: 20,
  maxViews: 6,
  maxViewFields: 8,
  minAreaSize: 40,
  maxStackOrder: 99,
  minPageSeconds: 1,
  maxPageSeconds: 600,
  minTextSize: 24,
  maxTextSize: 200,
  minViewSeconds: 5,
  maxViewSeconds: 120,
  defaultViewSeconds: 10,
  /** Lines a title may wrap to before it overflows. */
  titleLines: 2,
  /** Lines a subtitle or detail may wrap to before it overflows. */
  detailLines: 3,
});

export type ViewField = Readonly<{ fieldId: string; role: ViewRole }>;

export type ViewDefinition = Readonly<{
  catalogId: string;
  fields: readonly ViewField[];
  presentation: Presentation;
  /** Canvas units; text never shrinks below it. */
  textSize: number;
  unavailable: "hide" | "show";
  /** Automatic pagination interval when the area is not page-controlled. */
  pageSeconds: number;
}>;

export type AreaDefinition = Readonly<{
  /** Stable within the layout; program outputs are keyed by it. */
  key: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Stacking order: higher draws above. Unique within the layout. */
  z: number;
  /** `#RRGGBB`. */
  background: string;
  fit: MediaFit;
  muted: boolean;
  volume: number;
  kind: AreaKind;
  pageControlled: boolean;
  view: ViewDefinition | null;
}>;

/** What one page-controlled area shows on one page. */
export type PageContent = Readonly<{
  areaKey: string;
  /** Media areas: the item the page shows. */
  mediaAssetId: string | null;
  /** Catalog areas: the view's page from 1, or a group's choice. */
  viewPage: number | null;
  groupChoiceId: string | null;
}>;

export type PageDefinition = Readonly<{
  durationSeconds: number;
  contents: readonly PageContent[];
}>;

export type LayoutDefinition = Readonly<{
  orientation: Orientation;
  audioMixConfirmed: boolean;
  areas: readonly AreaDefinition[];
  pages: readonly PageDefinition[];
}>;

/** Area input; settings that do not apply to the area's kind may be absent. */
export type AreaInput = Readonly<{
  key: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  z: number;
  background?: string;
  fit?: MediaFit;
  muted?: boolean;
  volume?: number;
  kind: AreaKind;
  pageControlled?: boolean;
  view?: Readonly<{
    catalogId: string;
    fields: readonly ViewField[];
    presentation: Presentation;
    textSize: number;
    unavailable?: "hide" | "show";
    pageSeconds?: number;
  }> | null;
}>;

export type PageInput = Readonly<{
  durationSeconds: number;
  contents: readonly Readonly<{
    areaKey: string;
    mediaAssetId?: string | null;
    viewPage?: number | null;
    groupChoiceId?: string | null;
  }>[];
}>;

export type LayoutInput = Readonly<{
  orientation: Orientation;
  audioMixConfirmed?: boolean;
  areas: readonly AreaInput[];
  pages?: readonly PageInput[];
}>;

const controlCharacters = /\p{Cc}/u;
const keyShape = /^[a-z][a-z0-9-]{0,15}$/;
const colorShape = /^#[0-9a-fA-F]{6}$/;

/** Trims and collapses whitespace; 1 to `max` characters, no controls. */
function label(value: string, max: number): string | null {
  if (controlCharacters.test(value.replace(/[\t\n\r]/g, " "))) return null;
  const text = value.replace(/\s+/g, " ").trim();
  return text.length < 1 || [...text].length > max ? null : text;
}

export function layoutName(value: string): string {
  const name = label(value, 120);
  if (name === null) throw new ProgrammingFailure("VALIDATION_FAILED");
  return name;
}

const integerIn = (value: number, min: number, max: number) =>
  Number.isInteger(value) && value >= min && value <= max;

/** Audible areas mix sound; more than one needs explicit confirmation. */
export const audible = (area: Pick<AreaDefinition, "muted" | "volume">) =>
  !area.muted && area.volume > 0;

/**
 * Validates a whole layout definition's structure and normalizes it. Checks
 * that need stored data (catalog fields, media kinds and durations, scope)
 * belong to the service. Throws LAYOUT_INVALID with the issues it finds;
 * paths are JSON Pointers below `prefix`.
 */
export function planLayout(input: LayoutInput, prefix = ""): LayoutDefinition {
  const issues: Issue[] = [];
  const issue = (path: string, reason: string) =>
    issues.push({ path: `${prefix}${path}`, reason });
  const canvas = canvases[input.orientation];
  if (input.areas.length < 1 || input.areas.length > layoutPolicy.maxAreas)
    issue("/areas", "AREA_COUNT");
  const keys = new Set<string>();
  const stack = new Set<number>();
  let views = 0;
  const pages = input.pages ?? [];
  const areas: AreaDefinition[] = input.areas.map((area, index) => {
    const path = `/areas/${index}`;
    if (!keyShape.test(area.key)) issue(`${path}/key`, "KEY_INVALID");
    else if (keys.has(area.key)) issue(`${path}/key`, "KEY_DUPLICATE");
    keys.add(area.key);
    const name = label(area.name, 40);
    if (name === null) issue(`${path}/name`, "NAME_INVALID");
    const geometry =
      integerIn(area.x, 0, canvas.width) &&
      integerIn(area.y, 0, canvas.height) &&
      integerIn(area.width, layoutPolicy.minAreaSize, canvas.width) &&
      integerIn(area.height, layoutPolicy.minAreaSize, canvas.height);
    if (!geometry) issue(path, "GEOMETRY_INVALID");
    else if (
      area.x + area.width > canvas.width ||
      area.y + area.height > canvas.height
    )
      issue(path, "OUTSIDE_CANVAS");
    if (!integerIn(area.z, 0, layoutPolicy.maxStackOrder))
      issue(`${path}/z`, "STACK_INVALID");
    else if (stack.has(area.z)) issue(`${path}/z`, "STACK_DUPLICATE");
    stack.add(area.z);
    const background = area.background ?? "#000000";
    if (!colorShape.test(background))
      issue(`${path}/background`, "COLOR_INVALID");
    const volume = area.volume ?? 100;
    if (!integerIn(volume, 0, 100)) issue(`${path}/volume`, "VOLUME_INVALID");
    const pageControlled = area.pageControlled ?? false;
    if (pageControlled && pages.length === 0)
      issue(`${path}/pageControlled`, "NO_PAGES");
    let view: ViewDefinition | null = null;
    if (area.kind === "media") {
      if (area.view) issue(`${path}/view`, "VIEW_NOT_APPLICABLE");
    } else if (!area.view) issue(`${path}/view`, "VIEW_REQUIRED");
    else {
      views += 1;
      view = planView(area.view, `${path}/view`, issue);
    }
    return {
      key: area.key,
      name: name ?? area.name,
      x: area.x,
      y: area.y,
      width: area.width,
      height: area.height,
      z: area.z,
      background: background.toUpperCase(),
      fit: area.fit ?? "contain",
      muted: area.muted ?? true,
      volume,
      kind: area.kind,
      pageControlled,
      view,
    };
  });
  if (views > layoutPolicy.maxViews) issue("/areas", "VIEW_COUNT");
  const audioMixConfirmed = input.audioMixConfirmed ?? false;
  if (areas.filter(audible).length > 1 && !audioMixConfirmed)
    issue("/audioMixConfirmed", "AUDIO_MIX_UNCONFIRMED");
  if (
    pages.length !== 0 &&
    (pages.length < layoutPolicy.minPages ||
      pages.length > layoutPolicy.maxPages)
  )
    issue("/pages", "PAGE_COUNT");
  const byKey = new Map(areas.map((area) => [area.key, area]));
  const controlled = areas.filter((area) => area.pageControlled);
  const planned: PageDefinition[] = pages.map((page, index) => {
    const path = `/pages/${index}`;
    if (
      !integerIn(
        page.durationSeconds,
        layoutPolicy.minPageSeconds,
        layoutPolicy.maxPageSeconds,
      )
    )
      issue(`${path}/durationSeconds`, "DURATION_INVALID");
    const seen = new Set<string>();
    const contents = page.contents.map((content, position) => {
      const at = `${path}/contents/${position}`;
      const area = byKey.get(content.areaKey);
      if (!area || !area.pageControlled)
        issue(`${at}/areaKey`, "AREA_NOT_PAGE_CONTROLLED");
      else if (seen.has(area.key)) issue(`${at}/areaKey`, "AREA_DUPLICATE");
      seen.add(content.areaKey);
      const mediaAssetId = content.mediaAssetId ?? null;
      const viewPage = content.viewPage ?? null;
      const groupChoiceId = content.groupChoiceId ?? null;
      if (area?.kind === "media") {
        if (
          mediaAssetId === null ||
          viewPage !== null ||
          groupChoiceId !== null
        )
          issue(at, "CONTENT_INVALID");
      } else if (area?.kind === "catalog") {
        const grouped = area.view?.fields.some(
          (field) => field.role === "group",
        );
        const valid =
          mediaAssetId === null &&
          ((viewPage !== null &&
            groupChoiceId === null &&
            integerIn(viewPage, 1, 1000)) ||
            (viewPage === null && groupChoiceId !== null && grouped));
        if (!valid) issue(at, "CONTENT_INVALID");
      }
      return {
        areaKey: content.areaKey,
        mediaAssetId,
        viewPage,
        groupChoiceId,
      };
    });
    for (const area of controlled)
      if (!seen.has(area.key)) issue(`${path}/contents`, "CONTENT_MISSING");
    return { durationSeconds: page.durationSeconds, contents };
  });
  if (issues.length > 0) throw new ProgrammingFailure("LAYOUT_INVALID", issues);
  return {
    orientation: input.orientation,
    audioMixConfirmed,
    areas,
    pages: planned,
  };
}

/** Roles each presentation needs; at most one of each but details. */
function planView(
  input: NonNullable<AreaInput["view"]>,
  path: string,
  issue: (path: string, reason: string) => void,
): ViewDefinition {
  const fields = input.fields;
  if (fields.length < 1 || fields.length > layoutPolicy.maxViewFields)
    issue(`${path}/fields`, "FIELD_COUNT");
  const ids = new Set(fields.map((field) => field.fieldId));
  if (ids.size !== fields.length) issue(`${path}/fields`, "FIELD_DUPLICATE");
  const count = (role: ViewRole) =>
    fields.filter((field) => field.role === role).length;
  if (count("title") !== 1) issue(`${path}/fields`, "TITLE_REQUIRED");
  for (const role of ["subtitle", "price", "image", "group"] as const)
    if (count(role) > 1) issue(`${path}/fields`, "ROLE_REPEATED");
  if (input.presentation === "menu" && count("price") !== 1)
    issue(`${path}/presentation`, "PRICE_REQUIRED");
  if (input.presentation === "agenda" && count("group") !== 1)
    issue(`${path}/presentation`, "GROUP_REQUIRED");
  if (
    !integerIn(
      input.textSize,
      layoutPolicy.minTextSize,
      layoutPolicy.maxTextSize,
    )
  )
    issue(`${path}/textSize`, "TEXT_SIZE_INVALID");
  const pageSeconds = input.pageSeconds ?? layoutPolicy.defaultViewSeconds;
  if (
    !integerIn(
      pageSeconds,
      layoutPolicy.minViewSeconds,
      layoutPolicy.maxViewSeconds,
    )
  )
    issue(`${path}/pageSeconds`, "PAGE_SECONDS_INVALID");
  return {
    catalogId: input.catalogId.toLowerCase(),
    fields: fields.map((field) => ({
      fieldId: field.fieldId.toLowerCase(),
      role: field.role,
    })),
    presentation: input.presentation,
    textSize: input.textSize,
    unavailable: input.unavailable ?? "hide",
    pageSeconds,
  };
}

/** Field types each role accepts; agenda groups by weekdays. */
export function roleAccepts(
  role: ViewRole,
  presentation: Presentation,
  type: string,
): boolean {
  switch (role) {
    case "title":
    case "subtitle":
    case "detail":
      return type !== "media" && type !== "money";
    case "price":
      return type === "money";
    case "image":
      return type === "media";
    case "group":
      return presentation === "agenda"
        ? type === "weekdays"
        : type === "selection";
  }
}

// Text measure

/**
 * Conservative advance widths in ems: the renderer must use a font whose
 * glyphs are never wider, so text the check accepts never overflows on a
 * screen. Characters are measured by their base letter after removing
 * diacritics.
 */
function advance(character: string): number {
  if (/\s/.test(character)) return 0.32;
  if (/['.,:;!|`]/.test(character)) return 0.32;
  if (/[iljI]/.test(character)) return 0.36;
  if (/[frt()[\]{}/\\-]/.test(character)) return 0.46;
  if (/[0-9]/.test(character)) return 0.62;
  if (/[mw]/.test(character)) return 0.92;
  if (/[MW@%]/.test(character)) return 1;
  if (/[a-z]/.test(character)) return 0.6;
  if (/[A-Z&#$€£¥]/.test(character)) return 0.8;
  if (/[ -ɏ]/.test(character)) return 0.8;
  return 1.1;
}

/** Estimated width of a text line at a text size, in canvas units. */
export function textWidth(text: string, size: number): number {
  let ems = 0;
  for (const character of text.normalize("NFD").replace(/\p{M}/gu, ""))
    ems += advance(character);
  return ems * size;
}

/**
 * Lines a text needs at a width when it wraps between words, or null when a
 * single word is wider than the line.
 */
export function wrappedLines(
  text: string,
  size: number,
  width: number,
): number | null {
  const words = text.split(/\s+/).filter((word) => word !== "");
  if (words.length === 0) return 1;
  const space = textWidth(" ", size);
  let lines = 1;
  let used = 0;
  for (const word of words) {
    const length = textWidth(word, size);
    if (length > width) return null;
    if (used === 0) used = length;
    else if (used + space + length <= width) used += space + length;
    else {
      lines += 1;
      used = length;
    }
  }
  return lines;
}

// Fit

/** One record as a view shows it, already formatted as text. */
export type FitRecord = Readonly<{
  id: string;
  available: boolean;
  title: string;
  subtitle: string | null;
  details: readonly string[];
  /** The widest price the record may show, formatted, or null. */
  price: string | null;
  hasImage: boolean;
  /** Group key in display order (choice position or weekday), or null. */
  group: number | null;
  /** Sort key inside an agenda group (`HH:MM`), or null. */
  time: string | null;
}>;

export type Overflow = Readonly<{
  recordId: string;
  reason:
    "TITLE_OVERFLOW" | "PRICE_OVERFLOW" | "DETAIL_OVERFLOW" | "ROW_TOO_TALL";
}>;

export type ViewFit = Readonly<{
  /** Pages of records the area cycles through (0 with no records). */
  pages: number;
  /** Records shown, after hiding unavailable ones when the view does. */
  records: number;
  overflow: readonly Overflow[];
}>;

/** Space around the view's content and between its columns. */
export const viewPadding = (textSize: number) => Math.round(textSize / 2);
export const lineHeight = (textSize: number) => textSize * 1.25;

/**
 * How a catalog view lays out its records in an area: rows in order (an
 * agenda groups by weekday, then sorts by time), group headings, titles and
 * details wrapped between words, prices on one line in their own column,
 * images as a square at the start of a row. A row that does not fit, a
 * title over two lines, a detail over three or a price too wide is an
 * overflow, never clipped.
 */
export function fitView(
  view: Pick<
    ViewDefinition,
    "presentation" | "textSize" | "unavailable" | "fields"
  >,
  area: Pick<AreaDefinition, "width" | "height">,
  input: readonly FitRecord[],
): ViewFit {
  const size = view.textSize;
  const padding = viewPadding(size);
  const line = lineHeight(size);
  const inner = {
    width: area.width - 2 * padding,
    height: area.height - 2 * padding,
  };
  const shown = input.filter(
    (record) => record.available || view.unavailable === "show",
  );
  const records =
    view.presentation === "agenda"
      ? [...shown].sort(
          (a, b) =>
            (a.group ?? 8) - (b.group ?? 8) ||
            (a.time ?? "99:99").localeCompare(b.time ?? "99:99"),
        )
      : shown;
  const grouped = view.fields.some((field) => field.role === "group");
  const priced = view.fields.some((field) => field.role === "price");
  const imaged = view.fields.some((field) => field.role === "image");
  const overflow: Overflow[] = [];
  const priceWidth = priced
    ? Math.max(
        0,
        ...records.map((record) =>
          record.price === null ? 0 : textWidth(record.price, size),
        ),
      )
    : 0;
  const timeWidth =
    view.presentation === "agenda" ? textWidth("00:00", size) + padding : 0;
  const heights = records.map((record) => {
    const imageSide = imaged ? line : 0;
    const content = inner.width - (imageSide > 0 ? imageSide + padding : 0);
    if (view.presentation === "table") {
      const columns = view.fields.filter(
        (field) => field.role !== "image" && field.role !== "group",
      ).length;
      const column = (content - (columns - 1) * padding) / Math.max(columns, 1);
      const cells = [
        record.title,
        ...(record.subtitle !== null ? [record.subtitle] : []),
        ...record.details,
      ];
      if (cells.some((cell) => textWidth(cell, size) > column))
        overflow.push({ recordId: record.id, reason: "TITLE_OVERFLOW" });
      if (record.price !== null && textWidth(record.price, size) > column)
        overflow.push({ recordId: record.id, reason: "PRICE_OVERFLOW" });
      return line;
    }
    // One price column, as wide as the widest price up to half the row; a
    // price wider than that half overflows on its own record only.
    const priceColumn = Math.min(priceWidth, content / 2);
    const titleWidth =
      content - timeWidth - (priced ? priceColumn + padding : 0);
    if (record.price !== null && textWidth(record.price, size) > content / 2)
      overflow.push({ recordId: record.id, reason: "PRICE_OVERFLOW" });
    const titleLines = wrappedLines(record.title, size, titleWidth);
    if (titleLines === null || titleLines > layoutPolicy.titleLines)
      overflow.push({ recordId: record.id, reason: "TITLE_OVERFLOW" });
    let lines = Math.min(titleLines ?? 1, layoutPolicy.titleLines);
    for (const text of [
      ...(record.subtitle !== null ? [record.subtitle] : []),
      ...record.details,
    ]) {
      const needed = wrappedLines(text, size, content - timeWidth);
      if (needed === null || needed > layoutPolicy.detailLines) {
        overflow.push({ recordId: record.id, reason: "DETAIL_OVERFLOW" });
        lines += layoutPolicy.detailLines;
      } else lines += needed;
    }
    return Math.max(lines * line, imageSide);
  });
  // Greedy pages; a group heading opens each group and repeats atop a page.
  let pages = records.length > 0 ? 1 : 0;
  let used = 0;
  let previous: number | null | undefined;
  records.forEach((record, index) => {
    const height = heights[index] ?? line;
    const heading = grouped && record.group !== previous ? line : 0;
    if (heading + height > inner.height) {
      overflow.push({ recordId: record.id, reason: "ROW_TOO_TALL" });
      return;
    }
    if (used > 0 && used + heading + height > inner.height) {
      pages += 1;
      used = 0;
    }
    // A grouped page always opens with one heading: the group's own or,
    // when the group continues from the previous page, its repetition.
    used += (used === 0 && grouped ? line : heading) + height;
    previous = record.group;
  });
  return {
    pages,
    records: records.length,
    overflow: [
      ...new Map(
        overflow.map((entry) => [`${entry.recordId}:${entry.reason}`, entry]),
      ).values(),
    ],
  };
}

/** Rows a view shows per page with no wrapping, for the editor's hint. */
export function rowsPerPage(
  view: Pick<ViewDefinition, "textSize" | "fields">,
  area: Pick<AreaDefinition, "height">,
): number {
  const size = view.textSize;
  const lines =
    1 +
    view.fields.filter(
      (field) => field.role === "subtitle" || field.role === "detail",
    ).length;
  return Math.max(
    0,
    Math.floor(
      (area.height - 2 * viewPadding(size)) / (lines * lineHeight(size)),
    ),
  );
}

// Text representation

export const layoutFormat = "teluni.layout";
export const layoutSchemaVersion = 1;

export type LayoutDocument = Readonly<{
  format: typeof layoutFormat;
  schema: typeof layoutSchemaVersion;
  name: string;
  orientation: Orientation;
  audioMixConfirmed: boolean;
  areas: readonly AreaDefinition[];
  pages: readonly PageDefinition[];
}>;

/** A layout as versioned JSON that can be copied, imported and exported. */
export function layoutDocument(
  name: string,
  definition: LayoutDefinition,
): LayoutDocument {
  return {
    format: layoutFormat,
    schema: layoutSchemaVersion,
    name,
    orientation: definition.orientation,
    audioMixConfirmed: definition.audioMixConfirmed,
    areas: definition.areas,
    pages: definition.pages,
  };
}
