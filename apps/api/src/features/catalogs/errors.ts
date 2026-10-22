import { coreErrors, defineErrors, errorResponder } from "../../errors.js";
import { identityErrors } from "../identity/public.js";
import { mediaErrors } from "../media/public.js";
import { organizationErrors } from "../organizations/public.js";

// Public conditions owned by the catalogs module. CATALOG_SCHEMA_INVALID and
// CATALOG_RECORD_INVALID carry the envelope's issues, one per problem, with
// stable reason codes listed in the operation descriptions.
export const catalogErrors = defineErrors({
  CATALOG_SCHEMA_INVALID: {
    status: 409,
    message:
      "The fields cannot be saved this way. Each issue names the field and the reason, with how many items cause it when stored data does.",
    category: "conflict",
    retryable: false,
  },
  CATALOG_RECORD_INVALID: {
    status: 409,
    message:
      "The item's values do not match the catalog's fields. Each issue names the field and the reason.",
    category: "conflict",
    retryable: false,
  },
  CATALOG_RECORD_REFERENCED: {
    status: 409,
    message:
      "Other items refer to this item, so it cannot be deleted. Change those items first.",
    category: "conflict",
    retryable: false,
  },
  CATALOG_PROMOTION_CONFLICT: {
    status: 409,
    message:
      "Another promotion of this price overlaps this period for the same branches.",
    category: "conflict",
    retryable: false,
  },
  CATALOG_LIMIT_REACHED: {
    status: 409,
    message:
      "A catalog limit was reached: 200 catalogs per company, 60 fields or 5,000 items per catalog, or 100 promotions per price.",
    category: "conflict",
    retryable: false,
  },
  CATALOG_ARCHIVED: {
    status: 409,
    message: "This catalog is archived. Restore it before changing it.",
    category: "conflict",
    retryable: false,
  },
  CATALOG_NOT_EMPTY: {
    status: 409,
    message: "Only an empty catalog can be deleted. Delete its items first.",
    category: "conflict",
    retryable: false,
  },
  CATALOG_IN_USE: {
    status: 409,
    message:
      "A field of another catalog or a layout uses this catalog, so it cannot be deleted.",
    category: "conflict",
    retryable: false,
  },
  PRICE_TARGET_FORBIDDEN: {
    status: 403,
    message:
      "Screens show this catalog through programs you cannot publish, so its prices cannot change from your account. Ask someone who can publish them.",
    category: "authorization",
    retryable: false,
  },
});

export const respond = errorResponder({
  ...coreErrors,
  ...identityErrors,
  ...organizationErrors,
  ...mediaErrors,
  ...catalogErrors,
});
