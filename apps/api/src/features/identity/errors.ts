import { coreErrors, defineErrors, errorResponder } from "../../errors.js";

// Public conditions owned by the identity module's session boundary. Other
// modules that use the boundary answer with these codes through their own
// responders but never redeclare them.
export const identityErrors = defineErrors({
  CSRF_VALIDATION_FAILED: {
    status: 403,
    message:
      "The request could not be verified as coming from the Teluni panel. Reload the page and try again.",
    category: "authentication",
    retryable: false,
  },
  STRONG_AUTHENTICATION_REQUIRED: {
    status: 403,
    message:
      "This action requires two-step verification. Confirm your identity and try again.",
    category: "authentication",
    retryable: false,
  },
  RECENT_AUTHENTICATION_REQUIRED: {
    status: 403,
    message:
      "This action requires a recent two-step verification. Confirm your identity and try again.",
    category: "authentication",
    retryable: false,
  },
  SESSION_LIMIT_REACHED: {
    status: 409,
    message:
      "You already have the maximum number of active sessions. End one of them to continue.",
    category: "conflict",
    retryable: false,
  },
});

export const respond = errorResponder({ ...coreErrors, ...identityErrors });
