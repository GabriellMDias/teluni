// Inputs of the player protocol conformance fixtures, shared by the writer
// (scripts/conformance.ts) and the test that verifies the committed file.
import type {
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
