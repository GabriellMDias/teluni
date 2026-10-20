import { readFileSync } from "node:fs";
import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";
import {
  epochDay,
  evaluate,
  findConflicts,
  isoWeekday,
  parseTime,
  resolveLocal,
  ruleIssue,
  TimelineTooLarge,
  type ScheduleRule,
  type SegmentSource,
} from "../../src/features/programming/schedule.js";

type FixtureRule = {
  id: string;
  playlistId: string;
  weekdays: number[];
  allDay: boolean;
  startTime?: string;
  endTime?: string;
  startsOn: string;
  endsOn: string | null;
};

type Fixtures = {
  timelines: {
    id: string;
    timeZone: string;
    rules: FixtureRule[];
    defaultPlaylistId: string | null;
    from: string;
    to: string;
    expect: {
      segments: { start: string; end: string; source: string }[];
      notes: unknown[];
    };
  }[];
  validation: {
    id: string;
    rules: FixtureRule[];
    issues: { ruleId: string; issue: string }[];
    conflicts: { first: string; second: string; date: string }[];
  }[];
};

const fixtures = JSON.parse(
  readFileSync(new URL("./schedule-fixtures.json", import.meta.url), "utf8"),
) as Fixtures;

const rule = (input: FixtureRule): ScheduleRule => ({
  id: input.id,
  playlistId: input.playlistId,
  weekdays: input.weekdays,
  allDay: input.allDay,
  startMinute:
    input.startTime === undefined ? null : parseTime(input.startTime),
  endMinute: input.endTime === undefined ? null : parseTime(input.endTime),
  startsOn: input.startsOn,
  endsOn: input.endsOn,
});

const sourceName = (source: SegmentSource) =>
  source.kind === "rule" ? `rule:${source.ruleId}` : source.kind;

describe("shared schedule fixtures", () => {
  it.each(fixtures.timelines.map((item) => [item.id, item] as const))(
    "timeline %s",
    (_, item) => {
      const timeline = evaluate(
        {
          rules: item.rules.map(rule),
          defaultPlaylistId: item.defaultPlaylistId,
        },
        item.timeZone,
        Temporal.Instant.from(item.from),
        Temporal.Instant.from(item.to),
        2000,
      );
      expect(
        timeline.segments.map((segment) => ({
          start: segment.start,
          end: segment.end,
          source: sourceName(segment.source),
        })),
      ).toEqual(item.expect.segments);
      expect(timeline.notes).toEqual(item.expect.notes);
    },
  );

  it.each(fixtures.validation.map((item) => [item.id, item] as const))(
    "validation %s",
    (_, item) => {
      const rules = item.rules.map(rule);
      expect(
        rules.flatMap((value) => {
          const issue = ruleIssue(value);
          return issue ? [{ ruleId: value.id, issue }] : [];
        }),
      ).toEqual(item.issues);
      expect(
        findConflicts(rules).map((conflict) => ({
          first: rules[conflict.first].id,
          second: rules[conflict.second].id,
          date: conflict.date,
        })),
      ).toEqual(item.conflicts);
    },
  );
});

describe("schedule primitives", () => {
  it("parses dates, weekdays and times strictly", () => {
    expect(epochDay("1970-01-02")).toBeNull();
    expect(epochDay("2027-02-29")).toBeNull();
    expect(epochDay("2027-1-04")).toBeNull();
    expect(isoWeekday(epochDay("2027-01-04")!)).toBe(1);
    expect(isoWeekday(epochDay("2027-01-10")!)).toBe(7);
    expect(parseTime("23:59")).toBe(1439);
    expect(parseTime("24:00")).toBeNull();
    expect(parseTime("7:00")).toBeNull();
  });

  it("rejects malformed rules", () => {
    const base: ScheduleRule = {
      id: "r",
      playlistId: "p",
      weekdays: [1],
      allDay: false,
      startMinute: 60,
      endMinute: 120,
      startsOn: "2027-01-04",
      endsOn: null,
    };
    expect(ruleIssue(base)).toBeNull();
    expect(ruleIssue({ ...base, weekdays: [] })).toBe("invalid");
    expect(ruleIssue({ ...base, weekdays: [1, 1] })).toBe("invalid");
    expect(ruleIssue({ ...base, weekdays: [8] })).toBe("invalid");
    expect(ruleIssue({ ...base, endsOn: "2027-01-03" })).toBe("invalid");
    expect(ruleIssue({ ...base, allDay: true })).toBe("invalid");
    expect(ruleIssue({ ...base, endMinute: null })).toBe("invalid");
    expect(ruleIssue({ ...base, startMinute: 1440 })).toBe("invalid");
    expect(
      ruleIssue({ ...base, allDay: true, startMinute: null, endMinute: null }),
    ).toBeNull();
  });

  it("resolves local times without the host zone", () => {
    const local = Temporal.PlainDateTime.from("2027-06-01T12:00");
    expect(
      resolveLocal(local, "America/Sao_Paulo", "start").instant.toString(),
    ).toBe("2027-06-01T15:00:00Z");
    expect(resolveLocal(local, "Asia/Tokyo", "start").instant.toString()).toBe(
      "2027-06-01T03:00:00Z",
    );
  });

  it("bounds the number of segments", () => {
    expect(() =>
      evaluate(
        {
          rules: [
            {
              id: "r",
              playlistId: "p",
              weekdays: [1, 2, 3, 4, 5, 6, 7],
              allDay: false,
              startMinute: 0,
              endMinute: 30,
              startsOn: "2027-01-01",
              endsOn: null,
            },
          ],
          defaultPlaylistId: null,
        },
        "UTC",
        Temporal.Instant.from("2027-01-01T00:00:00Z"),
        Temporal.Instant.from("2027-01-31T00:00:00Z"),
        10,
      ),
    ).toThrow(TimelineTooLarge);
  });

  it("returns local representations with offsets", () => {
    const timeline = evaluate(
      { rules: [], defaultPlaylistId: "d" },
      "America/New_York",
      Temporal.Instant.from("2027-03-14T06:00:00Z"),
      Temporal.Instant.from("2027-03-14T08:00:00Z"),
      10,
    );
    expect(timeline.segments).toEqual([
      {
        start: "2027-03-14T06:00:00Z",
        end: "2027-03-14T08:00:00Z",
        localStart: "2027-03-14T01:00:00-05:00",
        localEnd: "2027-03-14T04:00:00-04:00",
        source: { kind: "default", playlistId: "d" },
      },
    ]);
  });
});
