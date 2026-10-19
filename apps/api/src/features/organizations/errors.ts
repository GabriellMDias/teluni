import { coreErrors, defineErrors, errorResponder } from "../../errors.js";
import { identityErrors } from "../identity/public.js";

// Public conditions owned by the organizations module. PERMISSION_DENIED is
// the shared denial for tenant-scoped capabilities; modules that use the
// organizations capability answer with it through their own responders.
export const organizationErrors = defineErrors({
  MEMBERSHIP_REMOVED: {
    status: 409,
    message: "This membership was removed and cannot be reactivated.",
    category: "conflict",
    retryable: false,
  },
  RESPONSIBLE_ADMINISTRATOR_PROTECTED: {
    status: 409,
    message:
      "Transfer responsibility before suspending or removing the responsible administrator.",
    category: "conflict",
    retryable: false,
  },
  LAST_ADMINISTRATOR_REQUIRED: {
    status: 409,
    message: "The company must retain an active administrator.",
    category: "conflict",
    retryable: false,
  },
  RESPONSIBLE_APPROVAL_REQUIRED: {
    status: 403,
    message:
      "Only the company's responsible administrator can approve this administrator change.",
    category: "authorization",
    retryable: false,
  },
  SUCCESSOR_NOT_ELIGIBLE: {
    status: 409,
    message:
      "Responsibility can only pass to another active company administrator.",
    category: "conflict",
    retryable: false,
  },
  RESPONSIBILITY_TRANSFER_PENDING: {
    status: 409,
    message:
      "A responsibility transfer is already waiting for acceptance. Cancel it first.",
    category: "conflict",
    retryable: false,
  },
  RESPONSIBILITY_TRANSFER_NOT_PENDING: {
    status: 409,
    message: "This responsibility transfer was already decided or has expired.",
    category: "conflict",
    retryable: false,
  },
  PERMISSION_DENIED: {
    status: 403,
    message: "You do not have permission to perform this action.",
    category: "authorization",
    retryable: false,
  },
  COMPANY_SUSPENDED: {
    status: 403,
    message: "This company is suspended. Contact Teluni support.",
    category: "authorization",
    retryable: false,
  },
  RESOURCE_VERSION_CONFLICT: {
    status: 409,
    message: "The resource changed; reload it before trying again.",
    category: "conflict",
    retryable: false,
  },
  IDEMPOTENCY_KEY_REUSED: {
    status: 409,
    message: "The creation key was used for different content.",
    category: "conflict",
    retryable: false,
  },
  BRANCH_NAME_IN_USE: {
    status: 409,
    message: "Another active branch of this company already uses that name.",
    category: "conflict",
    retryable: false,
  },
  BRANCH_ARCHIVED: {
    status: 409,
    message: "The branch is archived and cannot be changed.",
    category: "conflict",
    retryable: false,
  },
});

// Public conditions owned by the invitations module of this feature.
export const invitationErrors = defineErrors({
  INVITATION_PENDING: {
    status: 409,
    message:
      "A pending invitation for this address already exists. Resend it instead.",
    category: "conflict",
    retryable: false,
  },
  INVITATION_NO_LONGER_VALID: {
    status: 409,
    message: "This invitation is no longer valid. Ask for a new one.",
    category: "conflict",
    retryable: false,
  },
  INVITATION_RECIPIENT_MISMATCH: {
    status: 403,
    message:
      "This invitation was sent to another email address. Sign in with that address to accept it.",
    category: "authorization",
    retryable: false,
  },
  MEMBERSHIP_SUSPENDED: {
    status: 409,
    message:
      "Your access to this company is suspended. Contact a company administrator.",
    category: "conflict",
    retryable: false,
  },
});

export const respond = errorResponder({
  ...coreErrors,
  ...identityErrors,
  ...organizationErrors,
  ...invitationErrors,
});
