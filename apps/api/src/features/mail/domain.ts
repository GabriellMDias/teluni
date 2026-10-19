// Framework-independent delivery rules for the transactional outbox
// (ADR-0026; docs/project/invitation-delivery-design.md#durable-email-delivery).

export type MailLocale = "pt-BR" | "en-US";

/** A message rendered from a producer's template when it is sent. */
export type RenderedEmail = Readonly<{
  subject: string;
  text: string;
  html: string;
}>;

/**
 * A producer-owned template. It receives only the allowlisted parameters
 * and, when the message has one, the unsealed secret parameter.
 */
export type MailTemplate = (input: {
  locale: MailLocale;
  parameters: Readonly<Record<string, string>>;
  secret: string | null;
}) => RenderedEmail;

export type FailureClass =
  | "connection"
  | "timeout"
  | "tls"
  | "authentication"
  | "rejected"
  | "unexpected";

/** Outcome of one SMTP submission. */
export type SendOutcome =
  | { kind: "sent" }
  | {
      kind: "permanent" | "transient";
      failure: FailureClass;
      replyCode: number | null;
    };

/** Attempts per message; the last failure makes it FAILED. */
export const maxAttempts = 8;
/** How long a claim stays exclusive before another dispatcher may retry it. */
export const leaseMs = 120_000;
/** Connection and whole-submission deadline of one attempt. */
export const sendTimeoutMs = 30_000;
/** Days a final message is kept before deletion (provisional until PH-13). */
export const finalRetentionDays = 30;

// Waits after attempts 1..7: about 1, 5, 15 and 60 minutes, then 3, 6 and
// 12 hours, which ends near 22 hours, well inside a seven-day invitation.
const retryDelaysMs = [
  60_000, 300_000, 900_000, 3_600_000, 10_800_000, 21_600_000, 43_200_000,
] as const;

/**
 * Delay before the next attempt after a transient failure, with ±20 %
 * jitter, or null when the attempts are exhausted.
 */
export function retryDelay(
  attempts: number,
  random: () => number = Math.random,
): number | null {
  if (attempts >= maxAttempts) return null;
  const base = retryDelaysMs[Math.max(0, attempts - 1)];
  return Math.round(base * (0.8 + 0.4 * random()));
}

/**
 * Classifies a submission error. An SMTP 5xx reply rejects the message for
 * good; authentication, TLS, connection and timeout problems, 4xx replies
 * and unknown errors are retried, so a corrected relay configuration still
 * delivers pending messages.
 */
export function classifySendError(error: unknown): SendOutcome {
  const detail = (error ?? {}) as { code?: unknown; responseCode?: unknown };
  const replyCode =
    typeof detail.responseCode === "number" ? detail.responseCode : null;
  const code = typeof detail.code === "string" ? detail.code : "";
  if (code === "EAUTH")
    return { kind: "transient", failure: "authentication", replyCode };
  if (replyCode !== null && replyCode >= 500 && replyCode < 600)
    return { kind: "permanent", failure: "rejected", replyCode };
  if (replyCode !== null && replyCode >= 400 && replyCode < 500)
    return { kind: "transient", failure: "rejected", replyCode };
  if (code === "ETIMEDOUT")
    return { kind: "transient", failure: "timeout", replyCode };
  if (code === "ETLS") return { kind: "transient", failure: "tls", replyCode };
  if (code === "ECONNECTION" || code === "ESOCKET" || code === "EDNS")
    return { kind: "transient", failure: "connection", replyCode };
  return { kind: "transient", failure: "unexpected", replyCode };
}

/** Escapes text for insertion into an HTML template. */
export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
