import { coreErrors, defineErrors, errorResponder } from "../../errors.js";
import { identityErrors } from "../identity/public.js";
import { organizationErrors } from "../organizations/public.js";

// Public conditions owned by the devices module. Every failed claim answers
// PAIRING_CODE_INVALID, whatever the reason, so the answer reveals nothing.
export const deviceErrors = defineErrors({
  PAIRING_CODE_INVALID: {
    status: 409,
    message:
      "This code is not valid. Check the code shown on the screen, or restart pairing on the screen to get a new one.",
    category: "conflict",
    retryable: false,
  },
  ENROLLMENT_REJECTED: {
    status: 409,
    message:
      "This credential cannot be used. Generate a new credential on the device.",
    category: "conflict",
    retryable: false,
  },
  ROTATION_UNSUPPORTED: {
    status: 409,
    message: "The screen did not report support for this rotation.",
    category: "conflict",
    retryable: false,
  },
  DEVICE_UNAUTHORIZED: {
    status: 401,
    message: "The device credential is not valid for this operation.",
    category: "authentication",
    retryable: false,
  },
  DEVICE_UNLINKED: {
    status: 409,
    message: "This screen was unlinked and can no longer change.",
    category: "conflict",
    retryable: false,
  },
  DEVICE_ERASURE_NOT_PENDING: {
    status: 409,
    message: "This screen has no pending erasure to record.",
    category: "conflict",
    retryable: false,
  },
});

export const respond = errorResponder({
  ...coreErrors,
  ...identityErrors,
  ...organizationErrors,
  ...deviceErrors,
});
