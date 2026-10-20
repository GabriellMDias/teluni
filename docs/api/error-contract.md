# API Error Contract

[Task index](../README.md) · [API principles](principles.md) · [Error handling](../architecture/error-handling.md) · [Compatibility](versioning.md)

This policy owns public failure semantics. The API's [shared error registry, envelope schema, and responder](../../apps/api/src/errors.ts) and each composed module's registered codes are canonical; the [public registry composition](../../apps/api/src/error-registry.ts) gives each code exactly one owner and rejects any duplicate, even an identical definition, and the [generated error reference](../generated/api/errors.md) lists implemented codes, messages, categories, HTTP statuses, and retry classifications. Module route contracts declare expected operation errors. Follow [ADR-0007](../adr/0007-establish-api-contract-openapi-sdk-and-configuration-schema-strategy.md) when generating OpenAPI and SDK representations.

## Error Envelope

The implemented API envelope has a top-level `error` object with required `code`, `message`, and `requestId`, plus optional `traceId`, `errorId` and `issues`. The schema prohibits additional fields. A synthetic example is:

```json
{
  "error": {
    "code": "RESOURCE_VERSION_CONFLICT",
    "message": "The request changed; reload it before trying again.",
    "requestId": "req_00000000-0000-4000-8000-000000000001"
  }
}
```

The runtime generates fresh request IDs, adds trace correlation when available, and assigns unexpected failures an error occurrence ID. These are opaque support references, not credentials; knowing one must not grant telemetry access. See [request handling](../../apps/api/src/app.ts) for construction and reporting.

The envelope has **no retry object** and no free-form `details`. Its only structured extension is the optional `issues` list described under [validation errors](#validation-errors). Registry `retryable` metadata is documentation/classification, not a serialized promise that any write is safe to repeat. Rate limiting uses the HTTP `Retry-After` header. The extension rules below apply when consumers need additional structured information; do not implement hypothetical fields merely because examples in a policy mention them.

[Health probes](../../apps/api/src/health-contracts.ts) use their own documented status response, including when unavailable; do not confuse a probe status with an application error envelope.

## Error Code Format

Public codes use stable semantic `UPPER_SNAKE_CASE` names. Clients branch on codes and deliberately defined structured fields, never on message text or internal exception classes. Messages are safe human explanations and may change for clarity or product localization without changing the code's meaning. Canonical repository descriptions remain English.

Infrastructure identifiers such as SQLSTATE, ORM codes, provider exceptions, filesystem paths, or runtime class names are not public semantics. Map failures to the condition consumers need to understand. Reuse an existing code for the same meaning; do not create a code for every code path, collapse materially different consumer actions into one generic code, or reuse a retired code for a new meaning.

## Error Code Ownership

The feature/application owner defines business failures; the API boundary owns cross-cutting public mappings. The registry provides one canonical definition, and operation metadata refers to it. The registry enumerates stable public conditions, not every possible database/network/library exception. Do not maintain an independent manual registry in prose or generated clients.

For a new code, determine its semantic owner, expected/unexpected category, public disclosure safety, consumer action, status mapping, retry implications, optional details, and compatibility impact. Update canonical code, operation declarations, tests, and generated references together. Each module's implementation conventions explain its authorization-sensitive classification order.

## Validation Errors

The implemented validation response is `400 VALIDATION_FAILED` with the common envelope. Do not expose validator exceptions or echo submitted values. Structural validation is distinct from a valid request that conflicts with current domain state.

Field-level problems use the envelope's optional `issues`, defined once in the [shared envelope schema](../../apps/api/src/errors.ts):

- Each issue has a `path` (a JSON Pointer into the request body, never a database or ORM path) and a stable `UPPER_SNAKE_CASE` `reason`.
- An issue may add `fieldId`, naming a stored field that is absent from the body, and `count`, saying how many stored items cause the problem.
- An issue never echoes a submitted value.
- The responder keeps at most 50 issues, so an attacker-controlled payload cannot create an unbounded response. Unknown body fields still fail structural validation first.
- A module sends issues only for the codes whose operations document their reasons. Today these are the catalogs module's `CATALOG_SCHEMA_INVALID`, `CATALOG_RECORD_INVALID` and `CATALOG_RECORD_REFERENCED`. Other codes, including `VALIDATION_FAILED`, carry none.

Clients branch on `code` and may use `reason` to point at the field; they must tolerate unknown reasons. Adding a reason is additive; changing a reason's meaning follows [compatibility review](versioning.md).

## Mapping and disclosure

HTTP status conveys broad protocol meaning; public codes convey application semantics. The [generated registry](../generated/api/errors.md) is the current status mapping. Validation uses `400`, authentication `401`, permission denial `403`, absent/hidden resources `404`, state/version conflicts `409`, rate limiting `429`, unexpected failures `500`, and service unavailability `503` where declared.

- Authentication and authorization failures follow their [security policies](../security/authentication.md). Avoid account enumeration and disclosure of hidden resource existence, cross-tenant data, claims, or policy internals. An absent and inaccessible resource may deliberately share `404`; test that behavior.
- Expected domain conflicts, stale versions, and incompatible idempotency-key reuse are explicit outcomes. Distinguish safe replay from a conflicting new intent. They should not become internal incidents simply because code represents them as exceptions.
- Translate known database constraints at the persistence/application boundary according to business meaning. Unexpected database failures stay unexpected; do not disguise every exception as invalid user input.
- Translate provider business rejection separately from dependency unavailability, configuration failure, or unknown outcome. Expose vendor-specific distinctions only when consumers need them, never raw provider content.
- Use a safe generic error for unexpected failures. Never serialize arbitrary exceptions, stack traces, SQL, secret values, internal paths/hostnames, or diagnostic dumps. Do not return ordinary API failures as hidden error objects inside `200` responses.

Public status is not internal severity: expected denials may matter to security monitoring, and a transient dependency failure may be operationally serious. [Error reporting](../reliability/error-reporting.md) owns that distinction.

## Unknown Outcome

A timeout, disconnect, or commit error may leave the caller uncertain whether a write or external effect occurred. Retryability cannot be inferred from HTTP status or transient infrastructure failure alone. Define whether the operation is known not to have occurred, safely replayable, or requires state reconciliation. Introduce a distinct public unknown-outcome code only when consumers need different handling.

A public retry hint, if introduced, must be machine-readable, bounded, and accurate for the operation. Rate-limit guidance must not disclose anti-abuse internals. Never imply a non-idempotent write is safe to repeat merely because the registry classifies a failure as transient. Each module's recovery conventions own its create replay and mutation reconciliation behavior.

## Details and additional delivery modes

Every public details object needs a typed schema and a consumer purpose. Include only information safe for that caller; omit record dumps, protected resource/tenant identifiers, authorization evaluation, credentials, and provider payloads. Cross-cutting correlation/retry metadata should remain distinguishable from domain details. Once consumed, field meaning and shape are compatibility-sensitive.

When additional modes are introduced:

| Mode | Error requirement |
| --- | --- |
| Webhook or upload | Follow the operation/provider contract while minimizing signature-validation or scanning details. Bound and classify upload failures explicitly. |
| Asynchronous work | A successful acceptance response does not guarantee eventual success. Externally visible job status maps worker failures to stable public semantics, never worker exceptions. |
| Batch/partial success | Define atomic versus partial processing and item identity in an operation-specific result. Do not ambiguously overload the ordinary single-error envelope. |

## Diagnostics and consumer behavior

Report an unexpected occurrence once at its authoritative boundary. Preserve useful internal causal evidence only within [redaction rules](../security/telemetry-redaction.md); preservation never authorizes raw exception-message or stack export. The current runtime records allowlisted diagnostic fields rather than arbitrary error content. Expected validation, business, and access failures may contribute to safe metrics/security/audit signals without becoming unexpected incidents.

Clients and SDKs must preserve structured error semantics and correlation, and provide a safe fallback for unknown codes. Application consumers should not depend on framework-specific transport exceptions for business meaning. Product code decides whether to display safe server copy or localized client text; it must not parse that copy. The current thin SDK exposes generated response/error typing without adding a separate error-class hierarchy.

Code meaning, status mappings, details, categories where consumed, and retry behavior require [compatibility review](versioning.md). Adding a code can break exhaustive consumers; renaming/removing a code or changing meaning is potentially breaking. Optional details are only additive if actual clients tolerate them.

## Change and verification checklist

1. Inspect the registry, similar conditions, owning operation, actual consumers, authorization/disclosure policy, and compatibility commitments.
2. Define the safe semantic mapping and outcome/retry behavior. Add details only when needed, with explicit schema and size limits.
3. Verify the real transport envelope, status, code, safe message, correlation, hidden-resource handling, and relevant failure paths. Test absent/invalid/expired credentials and other lifecycle states only where that mechanism exists.
4. Inject unexpected failures and assert that secrets, SQL, provider data, input values, stacks, and internal paths do not escape. Verify one appropriate diagnostic event and safe retry metadata if present.
5. Regenerate and check the registry/OpenAPI/SDK references through [validation](../validation.md). Preserve current checks for registered unique codes, operation declarations, and freshness; extend checks for any new detail schemas or released compatibility obligations.
