import { coreErrors, defineErrors, errorResponder } from "../../errors.js";
import { identityErrors } from "../identity/public.js";
import { organizationErrors } from "../organizations/public.js";

// Public conditions owned by the media module. Rejections found while
// inspecting a file are a closed enumeration on the asset, not these errors.
export const mediaErrors = defineErrors({
  MEDIA_FOLDER_NOT_EMPTY: {
    status: 409,
    message:
      "Move the folder's contents elsewhere before removing it. Archived and trashed items also keep their folder.",
    category: "conflict",
    retryable: false,
  },
  MEDIA_INVALID_DESTINATION: {
    status: 409,
    message:
      "A folder cannot be moved or copied into itself or one of its descendants.",
    category: "conflict",
    retryable: false,
  },
  MEDIA_FOLDER_LIMIT: {
    status: 409,
    message:
      "The folder or operation exceeds the library's folder, depth or batch limits.",
    category: "conflict",
    retryable: false,
  },
  MEDIA_SCOPE_MISMATCH: {
    status: 409,
    message:
      "Moving an item must preserve its owning scope. Choose a folder of the same scope, or copy it with the required destination upload permission.",
    category: "conflict",
    retryable: false,
  },
  MEDIA_TYPE_UNSUPPORTED: {
    status: 400,
    message:
      "This file type is not supported. Use a JPEG, PNG or WebP image, or an MP4, MOV, WebM or MKV video.",
    category: "validation",
    retryable: false,
  },
  MEDIA_TOO_LARGE: {
    status: 400,
    message:
      "This file is too large. Images may have up to 20 MiB and videos up to 1 GiB.",
    category: "validation",
    retryable: false,
  },
  MEDIA_UPLOAD_INCOMPLETE: {
    status: 400,
    message:
      "The upload did not deliver exactly the declared file. Send the whole file again.",
    category: "validation",
    retryable: true,
  },
  MEDIA_NOT_UPLOADING: {
    status: 409,
    message: "This media item already received its file.",
    category: "conflict",
    retryable: false,
  },
  MEDIA_NOT_READY: {
    status: 409,
    message: "This media item is not ready to be shown yet.",
    category: "conflict",
    retryable: true,
  },
  MEDIA_IN_USE: {
    status: 409,
    message:
      "This media item is still used by programming or a publication and cannot be deleted.",
    category: "conflict",
    retryable: false,
  },
  MEDIA_STORAGE_FULL: {
    status: 503,
    message:
      "The media storage is nearly full, so new uploads are paused. Contact support.",
    category: "availability",
    retryable: true,
  },
  MEDIA_INVALID_STATE: {
    status: 409,
    message: "This media item cannot do that in its current state.",
    category: "conflict",
    retryable: false,
  },
});

export const respond = errorResponder({
  ...coreErrors,
  ...identityErrors,
  ...organizationErrors,
  ...mediaErrors,
});
