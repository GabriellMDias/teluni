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
