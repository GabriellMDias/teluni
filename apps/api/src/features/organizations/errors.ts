import { coreErrors, defineErrors, errorResponder } from "../../errors.js";
import { identityErrors } from "../identity/public.js";

// Public conditions owned by the organizations module. PERMISSION_DENIED is
// the shared denial for tenant-scoped capabilities; modules that use the
// organizations capability answer with it through their own responders.
export const organizationErrors = defineErrors({
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

export const respond = errorResponder({
  ...coreErrors,
  ...identityErrors,
  ...organizationErrors,
});
