// The identity module's public capability surface. Other modules import only
// this file; dependency rules reject imports of the module's internals.
import type { IncomingHttpHeaders } from "node:http";
import type { HumanContext } from "./domain.js";

export {
  requireRecentAuthentication,
  SessionFailure,
  type HumanContext,
} from "./domain.js";
export type { SessionFailureCode } from "./domain.js";
export { identityErrors } from "./errors.js";

/** Authenticates a human request through the server-managed session boundary. */
export type HumanSessionPort = Readonly<{
  /**
   * Resolves the verified human behind a request or throws `SessionFailure`
   * with a public code: missing/expired/revoked session, failed CSRF/Origin
   * check for unsafe methods, a pending session limit or provider outage.
   */
  authenticate(
    request: Readonly<{ method: string; headers: IncomingHttpHeaders }>,
  ): Promise<HumanContext>;
}>;

/** Presentation snapshots from the last verified login, never authority. */
export type HumanProfile = Readonly<{
  principalId: string;
  displayName: string | null;
  email: string | null;
}>;

/** Callers must first authorize every principal through their own resources. */
export type HumanProfilePort = Readonly<{
  getMany(principalIds: readonly string[]): Promise<readonly HumanProfile[]>;
}>;
