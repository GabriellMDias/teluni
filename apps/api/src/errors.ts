import { Type, type Static } from "typebox";

export type ErrorDefinition = Readonly<{
  status: number;
  message: string;
  category: string;
  retryable: boolean;
}>;

export function defineErrors<
  const Registry extends Record<string, ErrorDefinition>,
>(registry: Registry): Readonly<Registry> {
  for (const definition of Object.values(registry)) Object.freeze(definition);
  return Object.freeze(registry);
}

// Codes the shared runtime can emit itself. Modules declare their own
// business codes and merge them into the generated public registry.
export const coreErrors = defineErrors({
  AUTHENTICATION_REQUIRED: {
    status: 401,
    message: "Authentication is required.",
    category: "authentication",
    retryable: false,
  },
  VALIDATION_FAILED: {
    status: 400,
    message: "The request is invalid.",
    category: "validation",
    retryable: false,
  },
  RESOURCE_NOT_FOUND: {
    status: 404,
    message: "The resource was not found.",
    category: "not_found",
    retryable: false,
  },
  RATE_LIMITED: {
    status: 429,
    message: "Too many requests. Try again later.",
    category: "rate_limit",
    retryable: true,
  },
  INTERNAL_ERROR: {
    status: 500,
    message: "An unexpected error occurred.",
    category: "internal",
    retryable: false,
  },
  SERVICE_UNAVAILABLE: {
    status: 503,
    message: "The service is unavailable.",
    category: "availability",
    retryable: true,
  },
});

export type CoreErrorCode = keyof typeof coreErrors;

/** Most issues one envelope carries; further ones are omitted. */
export const maxErrorIssues = 50;

// One problem with a request that a module reports for codes whose
// consumers act per field. `path` is a JSON Pointer into the request body,
// `reason` a stable code, `fieldId` a stored field absent from the body and
// `count` how many stored items cause the problem. Never submitted values.
export const errorIssueSchema = Type.Object(
  {
    path: Type.String({ maxLength: 200 }),
    reason: Type.String({ pattern: "^[A-Z][A-Z0-9_]*$", maxLength: 64 }),
    fieldId: Type.Optional(Type.String({ maxLength: 64 })),
    count: Type.Optional(Type.Integer({ minimum: 0 })),
  },
  { additionalProperties: false },
);
export type ErrorIssue = Static<typeof errorIssueSchema>;

export const errorEnvelopeSchema = Type.Object(
  {
    error: Type.Object(
      {
        code: Type.String({ pattern: "^[A-Z][A-Z0-9_]*$" }),
        message: Type.String(),
        requestId: Type.String(),
        traceId: Type.Optional(Type.String()),
        errorId: Type.Optional(Type.String()),
        issues: Type.Optional(
          Type.Array(errorIssueSchema, { maxItems: maxErrorIssues }),
        ),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);
export type ErrorEnvelope = Static<typeof errorEnvelopeSchema>;

/** Builds public envelopes for one registry, rejecting unregistered codes. */
export function errorResponder<
  Registry extends Record<string, ErrorDefinition>,
>(registry: Registry) {
  return (
    code: keyof Registry & string,
    requestId: string,
    traceId?: string,
    errorId?: string,
    issues?: readonly ErrorIssue[],
  ): { status: number; body: ErrorEnvelope } => {
    const definition = registry[code];
    if (!definition) throw new Error(`Unregistered public error ${code}`);
    return {
      status: definition.status,
      body: {
        error: {
          code,
          message: definition.message,
          requestId,
          ...(traceId ? { traceId } : {}),
          ...(errorId ? { errorId } : {}),
          ...(issues && issues.length > 0
            ? {
                issues: issues
                  .slice(0, maxErrorIssues)
                  .map((issue) => ({ ...issue })),
              }
            : {}),
        },
      },
    };
  };
}

const respond = errorResponder(coreErrors);
export function publicError(
  code: CoreErrorCode,
  requestId: string,
  traceId?: string,
  errorId?: string,
): ErrorEnvelope {
  return respond(code, requestId, traceId, errorId).body;
}
