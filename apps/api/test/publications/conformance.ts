// Inputs of the player protocol conformance fixtures, shared by the writer
// (scripts/conformance.ts) and the test that verifies the committed file.
import type { PriceFacts } from "../../src/features/catalogs/domain.js";
import type {
  LayoutPublicationContent,
  ManifestHeader,
  PublicationContent,
} from "../../src/features/publications/domain.js";
import {
  zoneOffsets,
  type ZoneOffsets,
} from "../../src/features/programming/schedule.js";

const ids = {
  company: "0b7d9a52-58a4-4a35-9f53-6c1e2f3a4b5c",
  program: "1c8e0b63-69b5-4b46-8a64-7d2f3a4b5c6d",
  publication: "2d9f1c74-7ac6-4c57-9b75-8e3a4b5c6d7e",
  weekdays: "3ea02d85-8bd7-4d68-8c86-9f4b5c6d7e8f",
  weekend: "4fb13e96-9ce8-4e79-9d97-a05c6d7e8f90",
  image: "50c24fa7-adf9-4f8a-8ea8-b16d7e8f9001",
  video: "61d350b8-be0a-409b-9fb9-c27e8f900112",
  layoutProgram: "72e461c9-cf1b-41ac-80ca-d38f90011223",
  layoutPublication: "83f572da-d02c-42bd-81db-e49001122334",
  catalog: "94a683eb-e13d-43ce-82ec-f5a011223345",
  title: "a5b794fc-f24e-44df-83fd-06b122334456",
  price: "b6c8a50d-035f-45e0-84ae-17c233445567",
  section: "c7d9b61e-1460-46f1-85bf-28d344556678",
  drinks: "d8eac72f-2571-4702-86c0-39e455667789",
  food: "e9fbd830-3682-4813-87d1-4af56677889a",
  coffee: "fa0ce941-4793-4924-88e2-5b067788990b",
  juice: "0b1dfa52-58a4-4a35-89f3-6c178899aa1c",
  bread: "1c2e0b63-69b5-4b46-8a04-7d2899aabb2d",
  promotion: "2d3f1c74-7ac6-4c57-8b15-8e39aabbcc3e",
  branchCentro: "3e402d85-8bd7-4d68-8c26-9f4abbccdd4f",
  branchBairro: "4f513e96-9ce8-4e79-8d37-a05bccddee50",
};

/** A protocol 1 publication with every kind of rule, item and media. */
export const conformanceManifest: {
  header: ManifestHeader;
  content: PublicationContent;
} = {
  header: {
    publicationId: ids.publication,
    companyId: ids.company,
    programId: ids.program,
    generation: 3,
    publishedAt: new Date("2026-10-19T12:00:00.000Z"),
  },
  content: {
    outputs: [
      {
        key: "screen",
        defaultPlaylistId: ids.weekend,
        rules: [
          {
            id: "r1",
            playlistId: ids.weekdays,
            weekdays: [1, 2, 3, 4, 5],
            allDay: false,
            startTime: "08:00",
            endTime: "18:00",
            startsOn: "2026-10-20",
            endsOn: null,
          },
          {
            id: "r2",
            playlistId: ids.weekdays,
            weekdays: [5],
            allDay: false,
            startTime: "22:00",
            endTime: "02:00",
            startsOn: "2026-10-20",
            endsOn: "2026-12-31",
          },
          {
            id: "r3",
            playlistId: ids.weekend,
            weekdays: [6, 7],
            allDay: true,
            startsOn: "2026-10-24",
            endsOn: null,
          },
        ],
      },
    ],
    playlists: [
      {
        id: ids.weekdays,
        transition: { kind: "CUT" },
        items: [
          { mediaId: ids.image, durationMs: 10_000 },
          { mediaId: ids.video, durationMs: null },
        ],
      },
      {
        id: ids.weekend,
        transition: { kind: "CUT" },
        items: [{ mediaId: ids.image, durationMs: 15_000 }],
      },
    ],
    media: [
      {
        id: ids.image,
        kind: "IMAGE",
        contentType: "image/jpeg",
        size: 482_113,
        sha256:
          "8f434346648f6b96df89dda901c5176b10a6d83961dd3c1ac88b59b2dc327aa4",
        width: 1920,
        height: 1080,
        durationMs: null,
        hasAudio: false,
      },
      {
        id: ids.video,
        kind: "VIDEO",
        contentType: "video/mp4",
        size: 18_734_002,
        sha256:
          "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        width: 1920,
        height: 1080,
        durationMs: 31_500,
        hasAudio: true,
      },
    ],
  },
};

/**
 * A protocol 2 publication: a page-controlled media area and a grouped
 * menu that pages itself, with a branch price and a promotion.
 */
export const conformanceLayoutManifest: {
  header: ManifestHeader;
  content: LayoutPublicationContent;
} = {
  header: {
    publicationId: ids.layoutPublication,
    companyId: ids.company,
    programId: ids.layoutProgram,
    generation: 1,
    publishedAt: new Date("2026-10-20T12:00:00.000Z"),
  },
  content: {
    layout: {
      orientation: "landscape",
      width: 1920,
      height: 1080,
      audioMixConfirmed: false,
      areas: [
        {
          key: "video",
          x: 0,
          y: 0,
          width: 1280,
          height: 1080,
          z: 0,
          background: "#000000",
          fit: "contain",
          muted: true,
          volume: 100,
          kind: "media",
          pageControlled: true,
          view: null,
        },
        {
          key: "menu",
          x: 1280,
          y: 0,
          width: 640,
          height: 1080,
          z: 1,
          background: "#1F2933",
          fit: "contain",
          muted: true,
          volume: 100,
          kind: "catalog",
          pageControlled: false,
          view: {
            catalogId: ids.catalog,
            fields: [
              { fieldId: ids.title, role: "title" },
              { fieldId: ids.price, role: "price" },
              { fieldId: ids.section, role: "group" },
            ],
            presentation: "menu",
            textSize: 40,
            unavailable: "hide",
            pageSeconds: 10,
            pages: [
              [
                { recordId: ids.coffee, group: ids.drinks },
                { recordId: ids.juice, group: ids.drinks },
                { recordId: ids.bread, group: ids.food },
              ],
            ],
            groups: [],
          },
        },
      ],
      pages: [
        {
          durationSeconds: 15,
          contents: [
            {
              areaKey: "video",
              mediaId: ids.image,
              viewPage: null,
              groupChoiceId: null,
            },
          ],
        },
        {
          durationSeconds: 45,
          contents: [
            {
              areaKey: "video",
              mediaId: ids.video,
              viewPage: null,
              groupChoiceId: null,
            },
          ],
        },
      ],
    },
    outputs: [
      {
        key: "video",
        default: null,
        rules: [
          {
            id: "r1",
            playlistId: ids.weekdays,
            weekdays: [1, 2, 3, 4, 5],
            allDay: false,
            startTime: "12:00",
            endTime: "14:00",
            startsOn: "2026-10-20",
            endsOn: null,
          },
        ],
      },
      { key: "menu", default: { view: true }, rules: [] },
    ],
    catalogs: [
      {
        id: ids.catalog,
        fields: [
          { id: ids.title, type: "text", label: "Nome" },
          { id: ids.price, type: "money", label: "Preço", currency: "BRL" },
          {
            id: ids.section,
            type: "selection",
            label: "Seção",
            choices: [
              { id: ids.drinks, label: "Bebidas" },
              { id: ids.food, label: "Lanches" },
            ],
          },
        ],
        records: [
          {
            id: ids.coffee,
            available: true,
            values: { [ids.title]: "Café", [ids.section]: ids.drinks },
          },
          {
            id: ids.bread,
            available: true,
            values: { [ids.title]: "Pão de queijo", [ids.section]: ids.food },
          },
          {
            id: ids.juice,
            available: true,
            values: { [ids.title]: "Suco", [ids.section]: ids.drinks },
          },
        ],
        prices: [
          {
            recordId: ids.coffee,
            fieldId: ids.price,
            base: 500,
            overrides: [{ branchId: ids.branchCentro, amount: 450 }],
            promotions: [
              {
                id: ids.promotion,
                branchId: null,
                amount: 400,
                startsAt: "2026-10-26T08:00",
                endsAt: "2026-10-26T12:00",
              },
            ],
          },
          {
            recordId: ids.bread,
            fieldId: ids.price,
            base: 750,
            overrides: [],
            promotions: [],
          },
          {
            recordId: ids.juice,
            fieldId: ids.price,
            base: null,
            overrides: [],
            promotions: [],
          },
        ],
      },
    ],
    playlists: conformanceManifest.content.playlists,
    media: conformanceManifest.content.media,
  },
};

/** Page cycles: durations in seconds and a local second of the day. */
export const conformancePageCycles: readonly Readonly<{
  id: string;
  durations: readonly number[];
  secondOfDay: number;
}>[] = [
  { id: "midnight", durations: [15, 45], secondOfDay: 0 },
  { id: "second-page", durations: [15, 45], secondOfDay: 20 },
  { id: "next-cycle", durations: [15, 45], secondOfDay: 75 },
  { id: "morning", durations: [15, 45], secondOfDay: 8 * 3600 + 14 },
  { id: "view-pages", durations: [10, 10, 10], secondOfDay: 12 * 3600 + 25 },
  { id: "cut-at-midnight", durations: [7, 70], secondOfDay: 86_399 },
  { id: "one-page", durations: [30], secondOfDay: 3_601 },
];

const coffeePrices: PriceFacts = {
  base: 500,
  overrides: new Map([[ids.branchCentro, 450]]),
  promotions: [
    {
      id: ids.promotion,
      branchId: null,
      amount: 400,
      startsAt: "2026-10-26T08:00",
      endsAt: "2026-10-26T12:00",
    },
    {
      id: "5a624fa7-adf9-4f8a-8ea8-b16d7e8f9002",
      branchId: ids.branchBairro,
      amount: 350,
      startsAt: "2026-10-27T00:00",
      endsAt: "2026-10-28T00:00",
    },
  ],
};

/** Effective prices: facts, a branch (null for the whole scope) and a local minute. */
export const conformancePrices: readonly Readonly<{
  id: string;
  facts: PriceFacts;
  branchId: string | null;
  at: string;
}>[] = [
  {
    id: "base",
    facts: coffeePrices,
    branchId: ids.branchBairro,
    at: "2026-10-25T09:00",
  },
  {
    id: "override",
    facts: coffeePrices,
    branchId: ids.branchCentro,
    at: "2026-10-25T09:00",
  },
  {
    id: "promotion-start",
    facts: coffeePrices,
    branchId: ids.branchCentro,
    at: "2026-10-26T08:00",
  },
  {
    id: "promotion-end-excluded",
    facts: coffeePrices,
    branchId: ids.branchCentro,
    at: "2026-10-26T12:00",
  },
  {
    id: "branch-promotion",
    facts: coffeePrices,
    branchId: ids.branchBairro,
    at: "2026-10-27T10:00",
  },
  {
    id: "other-branch-promotion",
    facts: coffeePrices,
    branchId: ids.branchCentro,
    at: "2026-10-27T10:00",
  },
  {
    id: "whole-scope",
    facts: coffeePrices,
    branchId: null,
    at: "2026-10-27T10:00",
  },
  {
    id: "no-price",
    facts: { base: null, overrides: new Map(), promotions: [] },
    branchId: ids.branchCentro,
    at: "2026-10-25T09:00",
  },
];

/** Zones whose offsets and local-time resolutions the player must match. */
export const conformanceZones: readonly Readonly<{
  timeZone: string;
  from: string;
  until: string;
  locals: readonly Readonly<{ local: string; boundary: "start" | "end" }>[];
}>[] = [
  {
    timeZone: "America/Sao_Paulo",
    from: "2027-01-01T00:00:00.000Z",
    until: "2027-02-05T00:00:00.000Z",
    locals: [
      { local: "2027-01-04T08:00", boundary: "start" },
      { local: "2027-01-04T18:00", boundary: "end" },
    ],
  },
  {
    // Spring forward: 02:00-03:00 does not exist on 2027-03-14.
    timeZone: "America/New_York",
    from: "2027-03-12T00:00:00.000Z",
    until: "2027-04-16T00:00:00.000Z",
    locals: [
      { local: "2027-03-14T01:59", boundary: "start" },
      { local: "2027-03-14T02:30", boundary: "start" },
      { local: "2027-03-14T02:30", boundary: "end" },
      { local: "2027-03-14T03:00", boundary: "end" },
    ],
  },
  {
    // Fall back: 01:00-02:00 happens twice on 2027-11-07.
    timeZone: "America/New_York",
    from: "2027-11-05T00:00:00.000Z",
    until: "2027-12-10T00:00:00.000Z",
    locals: [
      { local: "2027-11-07T01:30", boundary: "start" },
      { local: "2027-11-07T01:30", boundary: "end" },
      { local: "2027-11-07T02:00", boundary: "start" },
    ],
  },
  {
    // A half-hour transition: 02:00 becomes 01:30 on 2027-04-04.
    timeZone: "Australia/Lord_Howe",
    from: "2027-04-02T00:00:00.000Z",
    until: "2027-05-07T00:00:00.000Z",
    locals: [
      { local: "2027-04-04T01:45", boundary: "start" },
      { local: "2027-04-04T01:45", boundary: "end" },
    ],
  },
];

type ScheduleFixtures = Readonly<{
  timelines: readonly Readonly<{
    id: string;
    timeZone: string;
    from: string;
    to: string;
  }>[];
}>;

const marginMs = 3 * 86_400_000;

/**
 * The offsets each shared schedule fixture needs, by fixture: its range
 * widened by three days, more than the evaluator reads around it.
 */
export function scheduleFixtureOffsets(
  fixtures: ScheduleFixtures,
): Record<string, ZoneOffsets> {
  return Object.fromEntries(
    fixtures.timelines.map((timeline) => [
      timeline.id,
      zoneOffsets(
        timeline.timeZone,
        new Date(new Date(timeline.from).getTime() - marginMs),
        new Date(new Date(timeline.to).getTime() + marginMs),
      ),
    ]),
  );
}
