// Framework-independent programming rules from the programming design
// (docs/project/programming-design.md): playlist items and transitions
// (AT-01), group spans, schedule rule input and the limits.
import {
  findConflicts,
  formatTime,
  parseTime,
  ruleIssue,
  type Conflict,
  type ScheduleRule,
} from "./schedule.js";

export type Transition = "CUT" | "FADE";
/** The full-screen output; layout areas (PJ-20) add further keys. */
export type OutputKey = "screen";
export const outputKeys: readonly OutputKey[] = ["screen"];

/** Engineering defaults; changing one is a reviewed code change. */
export const programmingPolicy = Object.freeze({
  minImageMs: 1_000,
  maxImageMs: 3_600_000,
  defaultImageMs: 10_000,
  minFadeMs: 250,
  maxFadeMs: 2_000,
  maxPlaylistsPerCompany: 1_000,
  maxGroupsPerCompany: 100,
  maxProgramsPerCompany: 2_000,
  maxItemsPerPlaylist: 500,
  maxRulesPerOutput: 200,
  maxTimelineDays: 31,
  maxTimelineSegments: 2_000,
});

export type ProgrammingFailureCode =
  | "RESOURCE_NOT_FOUND"
  | "VALIDATION_FAILED"
  | "RESOURCE_VERSION_CONFLICT"
  | "PROGRAMMING_LIMIT_REACHED"
  | "PLAYLIST_IN_USE"
  | "PLAYLIST_SCOPE_MISMATCH"
  | "GROUP_NAME_IN_USE"
  | "GROUP_HAS_MEMBERS"
  | "GROUP_SPAN_EXCLUDES_DEVICE"
  | "SCHEDULE_TIMES_EQUAL"
  | "SCHEDULE_CONFLICT"
  | "ASSIGNMENT_CONFIRMATION_REQUIRED"
  | "TIMELINE_TOO_LARGE";

export class ProgrammingFailure extends Error {
  readonly code: ProgrammingFailureCode;
  constructor(code: ProgrammingFailureCode) {
    super(`Programming failure: ${code}`);
    this.name = "ProgrammingFailure";
    this.code = code;
  }
}

const controlCharacters = /\p{Cc}/u;

/** Trims and collapses whitespace; 1 to `max` characters, no controls. */
export function displayName(value: string, max: number): string {
  if (controlCharacters.test(value.replace(/[\t\n\r]/g, " ")))
    throw new ProgrammingFailure("VALIDATION_FAILED");
  const name = value.replace(/\s+/g, " ").trim();
  if (name.length < 1 || [...name].length > max)
    throw new ProgrammingFailure("VALIDATION_FAILED");
  return name;
}

export const playlistName = (value: string) => displayName(value, 120);
export const groupName = (value: string) => displayName(value, 80);

/** Validates a transition; a fade needs its duration and a cut has none. */
export function transition(
  kind: Transition,
  fadeMs: number | null,
): { kind: Transition; fadeMs: number | null } {
  if (kind === "CUT") {
    if (fadeMs !== null) throw new ProgrammingFailure("VALIDATION_FAILED");
    return { kind, fadeMs: null };
  }
  if (
    fadeMs === null ||
    !Number.isInteger(fadeMs) ||
    fadeMs < programmingPolicy.minFadeMs ||
    fadeMs > programmingPolicy.maxFadeMs
  )
    throw new ProgrammingFailure("VALIDATION_FAILED");
  return { kind, fadeMs };
}

export type ItemInput = Readonly<{
  mediaAssetId: string;
  /** Whole seconds for an image; absent for a video. */
  durationSeconds?: number | null;
}>;

/** Validates an item list's shape; media kinds are checked on selection. */
export function itemList(items: readonly ItemInput[]): ItemInput[] {
  if (items.length > programmingPolicy.maxItemsPerPlaylist)
    throw new ProgrammingFailure("PROGRAMMING_LIMIT_REACHED");
  return items.map((item) => {
    const seconds = item.durationSeconds ?? null;
    if (
      seconds !== null &&
      (!Number.isInteger(seconds) ||
        seconds * 1000 < programmingPolicy.minImageMs ||
        seconds * 1000 > programmingPolicy.maxImageMs)
    )
      throw new ProgrammingFailure("VALIDATION_FAILED");
    return { mediaAssetId: item.mediaAssetId, durationSeconds: seconds };
  });
}

/** An image item's stored duration; a video item has none. */
export function itemDurationMs(
  kind: "IMAGE" | "VIDEO",
  durationSeconds: number | null,
): number | null {
  if (kind === "VIDEO") {
    if (durationSeconds !== null)
      throw new ProgrammingFailure("VALIDATION_FAILED");
    return null;
  }
  return durationSeconds === null
    ? programmingPolicy.defaultImageMs
    : durationSeconds * 1000;
}

/** A group covers the whole company or one to 100 distinct branches. */
export function groupSpan(
  allBranches: boolean,
  branchIds: readonly string[],
): { allBranches: boolean; branchIds: string[] } {
  const unique = [...new Set(branchIds)].sort();
  if (allBranches) {
    if (unique.length > 0) throw new ProgrammingFailure("VALIDATION_FAILED");
    return { allBranches, branchIds: [] };
  }
  if (
    unique.length < 1 ||
    unique.length > 100 ||
    unique.length !== branchIds.length
  )
    throw new ProgrammingFailure("VALIDATION_FAILED");
  return { allBranches, branchIds: unique };
}

export type RuleInput = Readonly<{
  playlistId: string;
  weekdays: readonly number[];
  allDay: boolean;
  startTime?: string | null;
  endTime?: string | null;
  startsOn: string;
  endsOn?: string | null;
}>;

/** Converts API rule input, rejecting malformed and equal times. */
export function scheduleRule(id: string, input: RuleInput): ScheduleRule {
  const minute = (value: string | null | undefined) => {
    if (value === null || value === undefined) return null;
    const parsed = parseTime(value);
    if (parsed === null) throw new ProgrammingFailure("VALIDATION_FAILED");
    return parsed;
  };
  const rule: ScheduleRule = {
    id,
    playlistId: input.playlistId,
    weekdays: [...input.weekdays].sort((a, b) => a - b),
    allDay: input.allDay,
    startMinute: minute(input.startTime),
    endMinute: minute(input.endTime),
    startsOn: input.startsOn,
    endsOn: input.endsOn ?? null,
  };
  const issue = ruleIssue(rule);
  if (issue === "times_equal")
    throw new ProgrammingFailure("SCHEDULE_TIMES_EQUAL");
  if (issue) throw new ProgrammingFailure("VALIDATION_FAILED");
  return rule;
}

/** Validates a whole rule set of one output and returns its conflicts. */
export function checkRules(inputs: readonly RuleInput[]): {
  rules: ScheduleRule[];
  conflicts: Conflict[];
} {
  if (inputs.length > programmingPolicy.maxRulesPerOutput)
    throw new ProgrammingFailure("PROGRAMMING_LIMIT_REACHED");
  const rules = inputs.map((input, index) =>
    scheduleRule(String(index), input),
  );
  return { rules, conflicts: findConflicts(rules) };
}

/** The API representation of a stored rule's times. */
export function ruleTimes(rule: {
  allDay: boolean;
  startMinute: number | null;
  endMinute: number | null;
}): { startTime: string | null; endTime: string | null } {
  return rule.allDay
    ? { startTime: null, endTime: null }
    : {
        startTime: formatTime(rule.startMinute!),
        endTime: formatTime(rule.endMinute!),
      };
}

/** Weekday set as a bitmask, bit 0 for Monday. */
export const weekdayMask = (weekdays: readonly number[]) =>
  weekdays.reduce((mask, day) => mask | (1 << (day - 1)), 0);

export const weekdaysOf = (mask: number) =>
  [1, 2, 3, 4, 5, 6, 7].filter((day) => mask & (1 << (day - 1)));
