import { describe, expect, it } from "vitest";
import { ProgrammingFailure } from "../../src/features/programming/domain.js";
import {
  fitView,
  layoutDocument,
  planLayout,
  roleAccepts,
  rowsPerPage,
  textWidth,
  wrappedLines,
  type AreaInput,
  type FitRecord,
  type LayoutInput,
} from "../../src/features/programming/layouts.js";

const catalogId = "11111111-1111-4111-8111-111111111111";
const titleField = "22222222-2222-4222-8222-222222222222";
const priceField = "33333333-3333-4333-8333-333333333333";
const groupField = "44444444-4444-4444-8444-444444444444";

const reasons = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    if (error instanceof ProgrammingFailure)
      return error.issues.map((issue) => `${issue.path} ${issue.reason}`);
    throw error;
  }
  return [];
};

const video: AreaInput = {
  key: "video",
  name: "Vídeo",
  x: 0,
  y: 0,
  width: 1280,
  height: 1080,
  z: 0,
  kind: "media",
};
const menu: AreaInput = {
  key: "menu",
  name: "Cardápio",
  x: 1280,
  y: 0,
  width: 640,
  height: 1080,
  z: 1,
  kind: "catalog",
  view: {
    catalogId,
    fields: [
      { fieldId: titleField, role: "title" },
      { fieldId: priceField, role: "price" },
    ],
    presentation: "menu",
    textSize: 40,
  },
};

const layout = (overrides: Partial<LayoutInput> = {}): LayoutInput => ({
  orientation: "landscape",
  areas: [video, menu],
  ...overrides,
});

describe("layout structure", () => {
  it("normalizes a layout with defaults", () => {
    const planned = planLayout(layout());
    expect(planned.areas[0]).toMatchObject({
      background: "#000000",
      fit: "contain",
      muted: true,
      volume: 100,
      pageControlled: false,
      view: null,
    });
    expect(planned.areas[1].view).toMatchObject({
      unavailable: "hide",
      pageSeconds: 10,
      textSize: 40,
    });
    expect(planned.pages).toEqual([]);
  });

  it("keeps areas on the canvas with unique keys and stacking", () => {
    expect(
      reasons(() =>
        planLayout(
          layout({
            areas: [
              { ...video, width: 1921 },
              { ...video, key: "video", z: 0 },
              { ...video, key: "Bad Key", z: 2, x: 1900, width: 40 },
              { ...video, key: "small", z: 3, width: 39 },
              {
                ...video,
                key: "tall",
                z: 4,
                orientation: undefined,
                height: 40,
                y: 1041,
              } as AreaInput,
            ],
          }),
        ),
      ),
    ).toEqual([
      "/areas/0 GEOMETRY_INVALID",
      "/areas/1/key KEY_DUPLICATE",
      "/areas/1/z STACK_DUPLICATE",
      "/areas/2/key KEY_INVALID",
      "/areas/2 OUTSIDE_CANVAS",
      "/areas/3 GEOMETRY_INVALID",
      "/areas/4 OUTSIDE_CANVAS",
    ]);
    expect(
      reasons(() => planLayout(layout({ orientation: "portrait" }))),
    ).toEqual(["/areas/0 GEOMETRY_INVALID", "/areas/1 GEOMETRY_INVALID"]);
    expect(reasons(() => planLayout(layout({ areas: [] })))).toEqual([
      "/areas AREA_COUNT",
    ]);
  });

  it("needs confirmation to mix audio from two areas", () => {
    const loud = { ...video, muted: false, volume: 80 };
    const music = { ...video, key: "music", z: 5, muted: false, volume: 30 };
    expect(reasons(() => planLayout(layout({ areas: [loud, music] })))).toEqual(
      ["/audioMixConfirmed AUDIO_MIX_UNCONFIRMED"],
    );
    expect(
      planLayout(layout({ areas: [loud, music], audioMixConfirmed: true }))
        .areas.length,
    ).toBe(2);
    expect(
      planLayout(layout({ areas: [loud, { ...music, volume: 0 }] })).areas,
    ).toHaveLength(2);
  });

  it("validates views by presentation", () => {
    expect(
      reasons(() =>
        planLayout(
          layout({
            areas: [
              { ...video, view: menu.view },
              { ...menu, view: null },
              {
                ...menu,
                key: "agenda",
                z: 7,
                view: {
                  catalogId,
                  fields: [
                    { fieldId: titleField, role: "title" },
                    { fieldId: titleField, role: "detail" },
                  ],
                  presentation: "agenda",
                  textSize: 20,
                  pageSeconds: 200,
                },
              },
              {
                ...menu,
                key: "nameless",
                z: 8,
                view: {
                  catalogId,
                  fields: [{ fieldId: priceField, role: "price" }],
                  presentation: "menu",
                  textSize: 40,
                },
              },
            ],
          }),
        ),
      ),
    ).toEqual([
      "/areas/0/view VIEW_NOT_APPLICABLE",
      "/areas/1/view VIEW_REQUIRED",
      "/areas/2/view/fields FIELD_DUPLICATE",
      "/areas/2/view/presentation GROUP_REQUIRED",
      "/areas/2/view/textSize TEXT_SIZE_INVALID",
      "/areas/2/view/pageSeconds PAGE_SECONDS_INVALID",
      "/areas/3/view/fields TITLE_REQUIRED",
    ]);
    expect(roleAccepts("price", "menu", "money")).toBe(true);
    expect(roleAccepts("title", "list", "money")).toBe(false);
    expect(roleAccepts("group", "list", "selection")).toBe(true);
    expect(roleAccepts("group", "agenda", "weekdays")).toBe(true);
    expect(roleAccepts("group", "agenda", "selection")).toBe(false);
    expect(roleAccepts("image", "list", "media")).toBe(true);
  });

  it("coordinates page-controlled areas through every page", () => {
    const pages = [
      {
        durationSeconds: 15,
        contents: [
          { areaKey: "video", mediaAssetId: catalogId },
          { areaKey: "menu", viewPage: 1 },
        ],
      },
      {
        durationSeconds: 15,
        contents: [
          { areaKey: "video", mediaAssetId: catalogId },
          { areaKey: "menu", viewPage: 2 },
        ],
      },
    ];
    const coordinated = layout({
      areas: [
        { ...video, pageControlled: true },
        { ...menu, pageControlled: true },
      ],
      pages,
    });
    expect(planLayout(coordinated).pages).toHaveLength(2);
    expect(
      reasons(() =>
        planLayout({
          ...coordinated,
          pages: [
            pages[0],
            {
              durationSeconds: 0,
              contents: [
                { areaKey: "video", viewPage: 1 },
                { areaKey: "ghost", mediaAssetId: catalogId },
              ],
            },
          ],
        }),
      ),
    ).toEqual([
      "/pages/1/durationSeconds DURATION_INVALID",
      "/pages/1/contents/0 CONTENT_INVALID",
      "/pages/1/contents/1/areaKey AREA_NOT_PAGE_CONTROLLED",
      "/pages/1/contents CONTENT_MISSING",
    ]);
    expect(
      reasons(() => planLayout({ ...coordinated, pages: [pages[0]] })),
    ).toEqual(["/pages PAGE_COUNT"]);
    expect(
      reasons(() =>
        planLayout(layout({ areas: [{ ...video, pageControlled: true }] })),
      ),
    ).toEqual(["/areas/0/pageControlled NO_PAGES"]);
  });

  it("prefixes issue paths for imported documents", () => {
    expect(
      reasons(() => planLayout(layout({ areas: [] }), "/document")),
    ).toEqual(["/document/areas AREA_COUNT"]);
  });

  it("exports versioned JSON that plans back to the same layout", () => {
    const planned = planLayout(layout());
    const document = layoutDocument("Vitrine", planned);
    expect(document).toMatchObject({
      format: "teluni.layout",
      schema: 1,
      name: "Vitrine",
    });
    const copy = JSON.parse(JSON.stringify(document)) as typeof document;
    expect(planLayout(copy)).toEqual(planned);
  });
});

describe("text measure", () => {
  it("is conservative for wide letters and narrow punctuation", () => {
    expect(textWidth("MW", 10)).toBe(20);
    expect(textWidth("il", 10)).toBeCloseTo(7.2);
    expect(textWidth("Café", 10)).toBe(textWidth("Cafe", 10));
    expect(textWidth("寿司", 10)).toBe(22);
  });

  it("wraps between words and refuses a word wider than the line", () => {
    expect(wrappedLines("Pão de queijo", 40, 1000)).toBe(1);
    expect(wrappedLines("Pão de queijo mineiro", 40, 300)).toBe(2);
    expect(wrappedLines("Supercalifragilístico", 40, 300)).toBeNull();
  });
});

describe("catalog view fit", () => {
  const record = (
    index: number,
    overrides: Partial<FitRecord> = {},
  ): FitRecord => ({
    id: `r${index}`,
    available: true,
    title: `Item ${index}`,
    subtitle: null,
    details: [],
    price: "R$ 19,90",
    hasImage: false,
    group: null,
    time: null,
    ...overrides,
  });
  const view = {
    presentation: "menu" as const,
    textSize: 40,
    unavailable: "hide" as const,
    fields: [
      { fieldId: titleField, role: "title" as const },
      { fieldId: priceField, role: "price" as const },
    ],
  };
  const area = { width: 640, height: 1080 };

  it("paginates rows by the area's height", () => {
    // (1080 - 40) / 50 = 20 rows per page.
    expect(rowsPerPage(view, area)).toBe(20);
    const many = Array.from({ length: 45 }, (_, index) => record(index));
    expect(fitView(view, area, many)).toEqual({
      pages: 3,
      records: 45,
      overflow: [],
    });
    expect(fitView(view, area, [])).toEqual({
      pages: 0,
      records: 0,
      overflow: [],
    });
  });

  it("hides unavailable records unless the view shows them", () => {
    const records = [record(1), record(2, { available: false })];
    expect(fitView(view, area, records).records).toBe(1);
    expect(
      fitView({ ...view, unavailable: "show" }, area, records).records,
    ).toBe(2);
  });

  it("names records whose title or price cannot fit, never clipping them", () => {
    const fit = fitView(view, area, [
      record(1, { title: "Hambúrguer artesanal duplo com queijo e bacon" }),
      record(2, { title: "Superextraordinariamente" }),
      record(3, { price: "R$ 10.000.000.000,00" }),
      record(4, { details: ["Muito longo ".repeat(30)] }),
    ]);
    expect(fit.overflow).toEqual([
      { recordId: "r1", reason: "TITLE_OVERFLOW" },
      { recordId: "r2", reason: "TITLE_OVERFLOW" },
      { recordId: "r3", reason: "PRICE_OVERFLOW" },
      { recordId: "r4", reason: "DETAIL_OVERFLOW" },
    ]);
  });

  it("wraps titles to two lines and counts group headings", () => {
    const grouped = {
      ...view,
      fields: [...view.fields, { fieldId: groupField, role: "group" as const }],
    };
    const fit = fitView(grouped, { width: 640, height: 300 }, [
      record(1, { group: 0 }),
      record(2, { group: 0, title: "Pão de queijo mineiro" }),
      record(3, { group: 1 }),
    ]);
    // 260 units of content: heading 50 + row 50 + row 100 fill one page,
    // and the second group needs a new one.
    expect(fit).toEqual({ pages: 2, records: 3, overflow: [] });
  });

  it("orders an agenda by weekday then time", () => {
    const agenda = {
      ...view,
      presentation: "agenda" as const,
      fields: [
        { fieldId: titleField, role: "title" as const },
        { fieldId: groupField, role: "group" as const },
      ],
    };
    const fit = fitView(agenda, { width: 1000, height: 140 }, [
      record(1, { group: 3, time: "19:00", price: null }),
      record(2, { group: 1, time: "08:00", price: null }),
    ]);
    expect(fit).toMatchObject({ pages: 2, records: 2, overflow: [] });
  });

  it("refuses a row taller than the area", () => {
    expect(
      fitView(view, { width: 640, height: 80 }, [record(1)]).overflow,
    ).toEqual([{ recordId: "r1", reason: "ROW_TOO_TALL" }]);
  });
});
