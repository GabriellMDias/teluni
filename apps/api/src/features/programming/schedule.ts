// Pure schedule rules and evaluation from the programming design
// (docs/project/programming-design.md) and ADR-0029: local-time windows,
// wall-clock conflict validation, zone resolution of DST gaps and repeated
// hours with the handoff clip, and the timeline of one output. Nothing here
// reads a clock or the process time zone; zones are explicit IANA names.
import { Temporal } from "temporal-polyfill";

const minutesPerDay = 1440;
const dayMs = 86_400_000;

/** A validated rule in local values; dates are ISO `YYYY-MM-DD`. */
export type ScheduleRule = Readonly<{
  id: string;
  playlistId: string;
  /** ISO weekdays on which a window starts, Monday 1 to Sunday 7. */
  weekdays: readonly number[];
  allDay: boolean;
  /** Minute of the local day; null when the rule is all-day. */
  startMinute: number | null;
  /** Minute of the local day; earlier than the start ends on the next day. */
  endMinute: number | null;
  startsOn: string;
  endsOn: string | null;
}>;

export type OutputProgram = Readonly<{
  rules: readonly ScheduleRule[];
  defaultPlaylistId: string | null;
}>;

export type RuleIssue = "invalid" | "times_equal";

const datePattern = /^(\d{4})-(\d{2})-(\d{2})$/;
const timePattern = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Days since 1970-01-01 of an ISO date, or null when it is not a date. */
export function epochDay(value: string): number | null {
  const match = datePattern.exec(value);
  if (!match) return null;
  const [year, month, day] = [
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
  ];
  if (year < 2000 || year > 2200) return null;
  const time = Date.UTC(year, month - 1, day);
  const check = new Date(time);
  if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day)
    return null;
  return time / dayMs;
}

/** The ISO date of a day number. */
export function isoDate(day: number): string {
  return new Date(day * dayMs).toISOString().slice(0, 10);
}

/** ISO weekday of a day number; 1970-01-01 was a Thursday. */
export function isoWeekday(day: number): number {
  return ((((day + 3) % 7) + 7) % 7) + 1;
}

/** Minute of the day of `HH:MM`, or null. */
export function parseTime(value: string): number | null {
  const match = timePattern.exec(value);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

export function formatTime(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(
    minute % 60,
  ).padStart(2, "0")}`;
}

/** What is wrong with a rule's own fields, if anything. */
export function ruleIssue(rule: ScheduleRule): RuleIssue | null {
  const weekdays = new Set(rule.weekdays);
  if (
    weekdays.size === 0 ||
    weekdays.size !== rule.weekdays.length ||
    [...weekdays].some((day) => !Number.isInteger(day) || day < 1 || day > 7)
  )
    return "invalid";
  const startsOn = epochDay(rule.startsOn);
  const endsOn = rule.endsOn === null ? null : epochDay(rule.endsOn);
  if (startsOn === null || (rule.endsOn !== null && endsOn === null))
    return "invalid";
  if (endsOn !== null && endsOn < startsOn) return "invalid";
  if (rule.allDay)
    return rule.startMinute === null && rule.endMinute === null
      ? null
      : "invalid";
  const minutes = [rule.startMinute, rule.endMinute];
  if (
    minutes.some(
      (minute) =>
        minute === null ||
        !Number.isInteger(minute) ||
        minute < 0 ||
        minute >= minutesPerDay,
    )
  )
    return "invalid";
  return rule.startMinute === rule.endMinute ? "times_equal" : null;
}

/** A window in local minutes since 1970-01-01, end exclusive. */
type LocalWindow = { start: number; end: number; anchor: number };

/** The window a rule starts on a local day, with the final-date clip. */
function windowOn(rule: ScheduleRule, day: number): LocalWindow | null {
  const startsOn = epochDay(rule.startsOn)!;
  const endsOn = rule.endsOn === null ? null : epochDay(rule.endsOn)!;
  if (day < startsOn || (endsOn !== null && day > endsOn)) return null;
  if (!rule.weekdays.includes(isoWeekday(day))) return null;
  const base = day * minutesPerDay;
  let start: number;
  let end: number;
  if (rule.allDay) {
    start = base;
    end = base + minutesPerDay;
  } else {
    const startMinute = rule.startMinute!;
    const endMinute = rule.endMinute!;
    start = base + startMinute;
    end =
      endMinute > startMinute
        ? base + endMinute
        : base + minutesPerDay + endMinute;
  }
  if (endsOn !== null) end = Math.min(end, (endsOn + 1) * minutesPerDay);
  return { start, end, anchor: day };
}

export type Conflict = Readonly<{
  first: number;
  second: number;
  /** Local date on which the earliest overlap begins. */
  date: string;
}>;

/** Anchor days on which two rules' windows may overlap, bounded. */
function candidateDays(a: ScheduleRule, b: ScheduleRule): number[] {
  const low = Math.max(epochDay(a.startsOn)!, epochDay(b.startsOn)!) - 1;
  const ends = [a.endsOn, b.endsOn]
    .filter((value): value is string => value !== null)
    .map((value) => epochDay(value)!);
  const high = ends.length ? Math.min(...ends) + 1 : null;
  if (high !== null && high < low) return [];
  const range = (from: number, to: number) =>
    Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => from + i);
  if (high !== null && high - low + 1 <= 21) return range(low, high);
  // The middle repeats weekly: ten days hold every weekday pairing.
  const days = range(low, low + 9);
  if (high !== null) days.push(...range(high - 9, high));
  return days;
}

/** The earliest wall-clock overlap of two rules, as a local day. */
function overlap(a: ScheduleRule, b: ScheduleRule): number | null {
  let earliest: number | null = null;
  for (const day of candidateDays(a, b)) {
    for (const [x, y] of [
      [a, b],
      [b, a],
    ] as const) {
      const own = windowOn(x, day);
      if (!own) continue;
      for (const shift of [-1, 0, 1]) {
        const other = windowOn(y, day + shift);
        if (!other) continue;
        const start = Math.max(own.start, other.start);
        if (start < Math.min(own.end, other.end)) {
          const date = Math.floor(start / minutesPerDay);
          if (earliest === null || date < earliest) earliest = date;
        }
      }
    }
  }
  return earliest;
}

/**
 * Every pair of rules of one output whose windows overlap in local
 * wall-clock time, independent of any zone; touching windows do not.
 */
export function findConflicts(rules: readonly ScheduleRule[]): Conflict[] {
  const conflicts: Conflict[] = [];
  for (let i = 0; i < rules.length; i += 1)
    for (let j = i + 1; j < rules.length; j += 1) {
      const day = overlap(rules[i], rules[j]);
      if (day !== null)
        conflicts.push({ first: i, second: j, date: isoDate(day) });
    }
  return conflicts;
}

export type Resolution = "gap" | "repeated";

export type ResolutionNote = Readonly<{
  ruleId: string;
  boundary: "start" | "end";
  resolution: Resolution;
  /** The rule's local wall-clock boundary, `YYYY-MM-DDTHH:MM`. */
  local: string;
  /** The instant it resolved to. */
  instant: string;
}>;

export type SegmentSource =
  | Readonly<{ kind: "rule"; ruleId: string; playlistId: string }>
  | Readonly<{ kind: "default"; playlistId: string }>
  | Readonly<{ kind: "none" }>;

export type Segment = Readonly<{
  start: string;
  end: string;
  localStart: string;
  localEnd: string;
  source: SegmentSource;
}>;

export type Timeline = Readonly<{
  segments: Segment[];
  notes: ResolutionNote[];
}>;

function plainDateTime(localMinute: number): Temporal.PlainDateTime {
  const day = Math.floor(localMinute / minutesPerDay);
  const minute = localMinute - day * minutesPerDay;
  const date = new Date(day * dayMs);
  return new Temporal.PlainDateTime(
    date.getUTCFullYear(),
    date.getUTCMonth() + 1,
    date.getUTCDate(),
    Math.floor(minute / 60),
    minute % 60,
  );
}

/**
 * Resolves a local boundary in a zone: a gap gives its first valid instant,
 * a repeated hour the earlier occurrence for a start and the later for an
 * end.
 */
export function resolveLocal(
  local: Temporal.PlainDateTime,
  zone: string,
  boundary: "start" | "end",
): { instant: Temporal.Instant; resolution: Resolution | null } {
  const earlier = local.toZonedDateTime(zone, { disambiguation: "earlier" });
  const later = local.toZonedDateTime(zone, { disambiguation: "later" });
  if (earlier.epochNanoseconds === later.epochNanoseconds)
    return { instant: earlier.toInstant(), resolution: null };
  if (!Temporal.PlainDateTime.compare(earlier.toPlainDateTime(), local)) {
    const chosen = boundary === "start" ? earlier : later;
    return { instant: chosen.toInstant(), resolution: "repeated" };
  }
  // In a gap, `earlier` lies before the transition that skips the time.
  const transition = earlier.getTimeZoneTransition("next");
  if (!transition) throw new Error("A skipped local time has no transition");
  return { instant: transition.toInstant(), resolution: "gap" };
}

function localString(instant: Temporal.Instant, zone: string): string {
  return instant
    .toZonedDateTimeISO(zone)
    .toString({ timeZoneName: "never", smallestUnit: "second" });
}

export class TimelineTooLarge extends Error {
  constructor() {
    super("The timeline has more segments than allowed");
    this.name = "TimelineTooLarge";
  }
}

type ResolvedWindow = {
  rule: ScheduleRule;
  order: number;
  start: Temporal.Instant;
  end: Temporal.Instant;
  notes: ResolutionNote[];
};

/**
 * The ordered, non-overlapping segments covering [from, to) for one output
 * in one zone: rule windows, then the default playlist or neutral output in
 * between. A window's end never passes the next window's start (handoff).
 */
export function evaluate(
  program: OutputProgram,
  zone: string,
  from: Temporal.Instant,
  to: Temporal.Instant,
  maxSegments: number,
): Timeline {
  if (Temporal.Instant.compare(from, to) >= 0)
    return { segments: [], notes: [] };
  const toDay = (instant: Temporal.Instant) =>
    epochDay(instant.toZonedDateTimeISO(zone).toPlainDate().toString())!;
  const firstDay = toDay(from) - 1;
  const lastDay = toDay(to);
  const windows: ResolvedWindow[] = [];
  program.rules.forEach((rule, order) => {
    for (let day = firstDay; day <= lastDay; day += 1) {
      const local = windowOn(rule, day);
      if (!local) continue;
      const notes: ResolutionNote[] = [];
      const resolve = (minute: number, boundary: "start" | "end") => {
        const value = plainDateTime(minute);
        const resolved = resolveLocal(value, zone, boundary);
        if (resolved.resolution)
          notes.push({
            ruleId: rule.id,
            boundary,
            resolution: resolved.resolution,
            local: value.toString({ smallestUnit: "minute" }),
            instant: resolved.instant.toString(),
          });
        return resolved.instant;
      };
      const start = resolve(local.start, "start");
      const end = resolve(local.end, "end");
      if (Temporal.Instant.compare(start, end) < 0)
        windows.push({ rule, order, start, end, notes });
    }
  });
  windows.sort(
    (a, b) => Temporal.Instant.compare(a.start, b.start) || a.order - b.order,
  );
  for (let i = 0; i + 1 < windows.length; i += 1)
    if (Temporal.Instant.compare(windows[i].end, windows[i + 1].start) > 0)
      windows[i].end = windows[i + 1].start;

  const segments: Segment[] = [];
  const notes: ResolutionNote[] = [];
  const push = (
    start: Temporal.Instant,
    end: Temporal.Instant,
    source: SegmentSource,
  ) => {
    if (Temporal.Instant.compare(start, end) >= 0) return;
    if (segments.length >= maxSegments) throw new TimelineTooLarge();
    segments.push({
      start: start.toString(),
      end: end.toString(),
      localStart: localString(start, zone),
      localEnd: localString(end, zone),
      source,
    });
  };
  const fill: SegmentSource = program.defaultPlaylistId
    ? { kind: "default", playlistId: program.defaultPlaylistId }
    : { kind: "none" };
  let cursor = from;
  for (const window of windows) {
    if (Temporal.Instant.compare(window.end, window.start) <= 0) continue;
    if (Temporal.Instant.compare(window.end, from) <= 0) continue;
    if (Temporal.Instant.compare(window.start, to) >= 0) break;
    const start =
      Temporal.Instant.compare(window.start, cursor) > 0
        ? window.start
        : cursor;
    const end = Temporal.Instant.compare(window.end, to) < 0 ? window.end : to;
    push(cursor, start, fill);
    push(start, end, {
      kind: "rule",
      ruleId: window.rule.id,
      playlistId: window.rule.playlistId,
    });
    notes.push(...window.notes);
    cursor = end;
  }
  push(cursor, to, fill);
  return { segments, notes };
}
