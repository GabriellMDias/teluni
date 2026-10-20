import { coreErrors, defineErrors, errorResponder } from "../../errors.js";
import { deviceErrors } from "../devices/public.js";
import { identityErrors } from "../identity/public.js";
import { mediaErrors } from "../media/public.js";
import { organizationErrors } from "../organizations/public.js";

// Public conditions owned by the programming module. Conflicting rule pairs
// are not error details: the rule check operation returns them.
export const programmingErrors = defineErrors({
  PROGRAMMING_LIMIT_REACHED: {
    status: 409,
    message:
      "This company reached a programming limit: 1,000 playlists, 500 layouts, 100 groups, 2,000 programs, 500 items per playlist or 200 schedules per output.",
    category: "conflict",
    retryable: false,
  },
  PLAYLIST_IN_USE: {
    status: 409,
    message:
      "This playlist is still used by a schedule or a default and cannot be deleted.",
    category: "conflict",
    retryable: false,
  },
  PLAYLIST_SCOPE_MISMATCH: {
    status: 409,
    message:
      "This playlist or media item belongs to a branch the programming does not cover. Use company content or content of that single branch.",
    category: "conflict",
    retryable: false,
  },
  GROUP_NAME_IN_USE: {
    status: 409,
    message: "Another programming group of this company already has this name.",
    category: "conflict",
    retryable: false,
  },
  GROUP_HAS_MEMBERS: {
    status: 409,
    message: "Remove the screens from this group before deleting it.",
    category: "conflict",
    retryable: false,
  },
  GROUP_SPAN_EXCLUDES_DEVICE: {
    status: 409,
    message:
      "The group does not cover the screen's branch. Change the group's branches or choose another group.",
    category: "conflict",
    retryable: false,
  },
  SCHEDULE_TIMES_EQUAL: {
    status: 400,
    message:
      "A schedule cannot start and end at the same time. Use the all-day option for a whole day.",
    category: "validation",
    retryable: false,
  },
  SCHEDULE_CONFLICT: {
    status: 409,
    message:
      "Two schedules of the same screen output overlap. Check the schedules to find them.",
    category: "conflict",
    retryable: false,
  },
  ASSIGNMENT_CONFIRMATION_REQUIRED: {
    status: 409,
    message:
      "The chosen programming is not published yet, so the screen will show neutral output. Confirm to continue.",
    category: "conflict",
    retryable: false,
  },
  LAYOUT_INVALID: {
    status: 409,
    message:
      "The layout cannot be saved this way. Each issue names the area, view or page and the reason.",
    category: "conflict",
    retryable: false,
  },
  LAYOUT_IN_USE: {
    status: 409,
    message:
      "Programs use this layout. Choose another layout for them before deleting it.",
    category: "conflict",
    retryable: false,
  },
  LAYOUT_SCOPE_MISMATCH: {
    status: 409,
    message:
      "This layout belongs to a branch the programming does not cover. Use a company layout or a layout of that single branch.",
    category: "conflict",
    retryable: false,
  },
  LAYOUT_CHANGE_CONFIRMATION_REQUIRED: {
    status: 409,
    message:
      "This change removes schedules or defaults of areas that no longer exist or no longer take a default playlist. Each issue names the output; confirm to remove them.",
    category: "conflict",
    retryable: false,
  },
  TIMELINE_TOO_LARGE: {
    status: 400,
    message:
      "This period has too many schedule changes to show at once. Choose a shorter period.",
    category: "validation",
    retryable: false,
  },
});

export const respond = errorResponder({
  ...coreErrors,
  ...identityErrors,
  ...organizationErrors,
  ...mediaErrors,
  ...deviceErrors,
  ...programmingErrors,
});
