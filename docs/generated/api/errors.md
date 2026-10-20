# API Error Registry

<!-- Generated from apps/api/src/errors.ts and composed module errors. Run pnpm -C apps/api references:write; do not edit. -->

[Error contract](../../api/error-contract.md) · [API runtime](../../../apps/api/README.md)

| Code | HTTP status | Category | Retryable | Public message |
| --- | --- | --- | --- | --- |
| `AUTHENTICATION_REQUIRED` | 401 | authentication | no | Authentication is required. |
| `VALIDATION_FAILED` | 400 | validation | no | The request is invalid. |
| `RESOURCE_NOT_FOUND` | 404 | not_found | no | The resource was not found. |
| `RATE_LIMITED` | 429 | rate_limit | yes | Too many requests. Try again later. |
| `INTERNAL_ERROR` | 500 | internal | no | An unexpected error occurred. |
| `SERVICE_UNAVAILABLE` | 503 | availability | yes | The service is unavailable. |
| `CSRF_VALIDATION_FAILED` | 403 | authentication | no | The request could not be verified as coming from the Teluni panel. Reload the page and try again. |
| `STRONG_AUTHENTICATION_REQUIRED` | 403 | authentication | no | This action requires two-step verification. Confirm your identity and try again. |
| `RECENT_AUTHENTICATION_REQUIRED` | 403 | authentication | no | This action requires a recent two-step verification. Confirm your identity and try again. |
| `SESSION_LIMIT_REACHED` | 409 | conflict | no | You already have the maximum number of active sessions. End one of them to continue. |
| `MEMBERSHIP_REMOVED` | 409 | conflict | no | This membership was removed and cannot be reactivated. |
| `RESPONSIBLE_ADMINISTRATOR_PROTECTED` | 409 | conflict | no | Transfer responsibility before suspending or removing the responsible administrator. |
| `LAST_ADMINISTRATOR_REQUIRED` | 409 | conflict | no | The company must retain an active administrator. |
| `RESPONSIBLE_APPROVAL_REQUIRED` | 403 | authorization | no | Only the company's responsible administrator can approve this administrator change. |
| `SUCCESSOR_NOT_ELIGIBLE` | 409 | conflict | no | Responsibility can only pass to another active company administrator. |
| `RESPONSIBILITY_TRANSFER_PENDING` | 409 | conflict | no | A responsibility transfer is already waiting for acceptance. Cancel it first. |
| `RESPONSIBILITY_TRANSFER_NOT_PENDING` | 409 | conflict | no | This responsibility transfer was already decided or has expired. |
| `PERMISSION_DENIED` | 403 | authorization | no | You do not have permission to perform this action. |
| `COMPANY_SUSPENDED` | 403 | authorization | no | This company is suspended. Contact Teluni support. |
| `RESOURCE_VERSION_CONFLICT` | 409 | conflict | no | The resource changed; reload it before trying again. |
| `IDEMPOTENCY_KEY_REUSED` | 409 | conflict | no | The creation key was used for different content. |
| `BRANCH_NAME_IN_USE` | 409 | conflict | no | Another active branch of this company already uses that name. |
| `BRANCH_ARCHIVED` | 409 | conflict | no | The branch is archived and cannot be changed. |
| `PROFILE_NAME_IN_USE` | 409 | conflict | no | Another active access profile of this company already uses that name. |
| `PROFILE_ARCHIVED` | 409 | conflict | no | The access profile is archived and cannot be changed. |
| `PROFILE_IN_USE` | 409 | conflict | no | Members still hold this access profile. Revoke their grants before archiving it. |
| `PROFILE_LIMIT_REACHED` | 409 | conflict | no | The company already has the maximum number of active access profiles. |
| `BRANCH_IN_USE` | 409 | conflict | no | The branch still has active resources, such as paired screens. Move or unlink them before archiving it. |
| `INVITATION_PENDING` | 409 | conflict | no | A pending invitation for this address already exists. Resend it instead. |
| `INVITATION_NO_LONGER_VALID` | 409 | conflict | no | This invitation is no longer valid. Ask for a new one. |
| `INVITATION_RECIPIENT_MISMATCH` | 403 | authorization | no | This invitation was sent to another email address. Sign in with that address to accept it. |
| `MEMBERSHIP_SUSPENDED` | 409 | conflict | no | Your access to this company is suspended. Contact a company administrator. |
| `PAIRING_CODE_INVALID` | 409 | conflict | no | This code is not valid. Check the code shown on the screen, or restart pairing on the screen to get a new one. |
| `ENROLLMENT_REJECTED` | 409 | conflict | no | This credential cannot be used. Generate a new credential on the device. |
| `ROTATION_UNSUPPORTED` | 409 | conflict | no | The screen did not report support for this rotation. |
| `DEVICE_UNAUTHORIZED` | 401 | authentication | no | The device credential is not valid for this operation. |
| `DEVICE_UNLINKED` | 409 | conflict | no | This screen was unlinked and can no longer change. |
| `DEVICE_ERASURE_NOT_PENDING` | 409 | conflict | no | This screen has no pending erasure to record. |
| `MEDIA_TYPE_UNSUPPORTED` | 400 | validation | no | This file type is not supported. Use a JPEG, PNG or WebP image, or an MP4, MOV, WebM or MKV video. |
| `MEDIA_TOO_LARGE` | 400 | validation | no | This file is too large. Images may have up to 20 MiB and videos up to 1 GiB. |
| `MEDIA_UPLOAD_INCOMPLETE` | 400 | validation | yes | The upload did not deliver exactly the declared file. Send the whole file again. |
| `MEDIA_NOT_UPLOADING` | 409 | conflict | no | This media item already received its file. |
| `MEDIA_NOT_READY` | 409 | conflict | yes | This media item is not ready to be shown yet. |
| `MEDIA_IN_USE` | 409 | conflict | no | This media item is still used by programming or a publication and cannot be deleted. |
| `MEDIA_STORAGE_FULL` | 503 | availability | yes | The media storage is nearly full, so new uploads are paused. Contact support. |
| `MEDIA_INVALID_STATE` | 409 | conflict | no | This media item cannot do that in its current state. |
| `CATALOG_SCHEMA_INVALID` | 409 | conflict | no | The fields cannot be saved this way. Each issue names the field and the reason, with how many items cause it when stored data does. |
| `CATALOG_RECORD_INVALID` | 409 | conflict | no | The item's values do not match the catalog's fields. Each issue names the field and the reason. |
| `CATALOG_RECORD_REFERENCED` | 409 | conflict | no | Other items refer to this item, so it cannot be deleted. Change those items first. |
| `CATALOG_PROMOTION_CONFLICT` | 409 | conflict | no | Another promotion of this price overlaps this period for the same branches. |
| `CATALOG_LIMIT_REACHED` | 409 | conflict | no | A catalog limit was reached: 200 catalogs per company, 60 fields or 5,000 items per catalog, or 100 promotions per price. |
| `CATALOG_ARCHIVED` | 409 | conflict | no | This catalog is archived. Restore it before changing it. |
| `CATALOG_NOT_EMPTY` | 409 | conflict | no | Only an empty catalog can be deleted. Delete its items first. |
| `CATALOG_IN_USE` | 409 | conflict | no | A field of another catalog or a layout uses this catalog, so it cannot be deleted. |
| `PROGRAMMING_LIMIT_REACHED` | 409 | conflict | no | This company reached a programming limit: 1,000 playlists, 500 layouts, 100 groups, 2,000 programs, 500 items per playlist or 200 schedules per output. |
| `PLAYLIST_IN_USE` | 409 | conflict | no | This playlist is still used by a schedule or a default and cannot be deleted. |
| `PLAYLIST_SCOPE_MISMATCH` | 409 | conflict | no | This playlist or media item belongs to a branch the programming does not cover. Use company content or content of that single branch. |
| `GROUP_NAME_IN_USE` | 409 | conflict | no | Another programming group of this company already has this name. |
| `GROUP_HAS_MEMBERS` | 409 | conflict | no | Remove the screens from this group before deleting it. |
| `GROUP_SPAN_EXCLUDES_DEVICE` | 409 | conflict | no | The group does not cover the screen's branch. Change the group's branches or choose another group. |
| `SCHEDULE_TIMES_EQUAL` | 400 | validation | no | A schedule cannot start and end at the same time. Use the all-day option for a whole day. |
| `SCHEDULE_CONFLICT` | 409 | conflict | no | Two schedules of the same screen output overlap. Check the schedules to find them. |
| `ASSIGNMENT_CONFIRMATION_REQUIRED` | 409 | conflict | no | The chosen programming is not published yet, so the screen will show neutral output. Confirm to continue. |
| `LAYOUT_INVALID` | 409 | conflict | no | The layout cannot be saved this way. Each issue names the area, view or page and the reason. |
| `LAYOUT_IN_USE` | 409 | conflict | no | Programs use this layout. Choose another layout for them before deleting it. |
| `LAYOUT_SCOPE_MISMATCH` | 409 | conflict | no | This layout belongs to a branch the programming does not cover. Use a company layout or a layout of that single branch. |
| `LAYOUT_CHANGE_CONFIRMATION_REQUIRED` | 409 | conflict | no | This change removes schedules or defaults of areas that no longer exist or no longer take a default playlist. Each issue names the output; confirm to remove them. |
| `TIMELINE_TOO_LARGE` | 400 | validation | no | This period has too many schedule changes to show at once. Choose a shorter period. |
| `PUBLICATION_INVALID` | 409 | conflict | no | This programming cannot be published as it is. Check it to see what must change first. |
| `PUBLICATION_NOT_RESTORABLE` | 409 | conflict | no | This publication is no longer kept and cannot be restored. Publish the current programming instead. |
| `PROTOCOL_UNSUPPORTED` | 409 | conflict | no | This player supports no synchronization protocol the server offers. Update the player. |
