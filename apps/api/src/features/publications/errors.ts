import { coreErrors, defineErrors, errorResponder } from "../../errors.js";
import { deviceErrors } from "../devices/public.js";
import { identityErrors } from "../identity/public.js";
import { mediaErrors } from "../media/public.js";
import { organizationErrors } from "../organizations/public.js";
import { programmingErrors } from "../programming/public.js";

// Public conditions owned by the publications module. Why a program cannot
// be published is not an error detail: the check operation lists it.
export const publicationErrors = defineErrors({
  PUBLICATION_INVALID: {
    status: 409,
    message:
      "This programming cannot be published as it is. Check it to see what must change first.",
    category: "conflict",
    retryable: false,
  },
  PUBLICATION_NOT_RESTORABLE: {
    status: 409,
    message:
      "This publication is no longer kept and cannot be restored. Publish the current programming instead.",
    category: "conflict",
    retryable: false,
  },
  PROTOCOL_UNSUPPORTED: {
    status: 409,
    message:
      "This player supports no synchronization protocol the server offers. Update the player.",
    category: "conflict",
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
  ...publicationErrors,
});
