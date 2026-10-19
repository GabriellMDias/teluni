// The devices module's public capability surface. Modules that configure
// screens (programming, publications) import only this file: they read the
// screens they decide about and react to moves inside the move transaction.
import type { Prisma } from "../../generated/prisma/client.js";
import type { DeviceStatus } from "./domain.js";

export { DeviceFailure } from "./domain.js";
export { deviceErrors } from "./errors.js";

/** What another module may know about a screen. */
export type DeviceFacts = Readonly<{
  id: string;
  branchId: string;
  name: string;
  status: DeviceStatus;
  /** Explicit time zone; null follows the branch. */
  timeZone: string | null;
}>;

/**
 * Runs in a move's transaction after the device row changed and before the
 * move commits, so dependent state never disagrees with the device's branch.
 */
export type DeviceMoveHook = (
  tx: Prisma.TransactionClient,
  move: Readonly<{
    companyId: string;
    deviceId: string;
    branchId: string;
    actor: Readonly<{ principalId: string; membershipId: string }>;
  }>,
) => Promise<void>;

export type DevicePort = Readonly<{
  /** Registers a move hook; register before activation. */
  onMove(hook: DeviceMoveHook): void;
  /**
   * The named screens of one company. With a transaction they are
   * share-locked, so a concurrent move or unlink waits for the caller. It
   * authorizes nothing: callers decide visibility from the facts.
   */
  describe(
    tx: Prisma.TransactionClient | null,
    companyId: string,
    deviceIds: readonly string[],
  ): Promise<DeviceFacts[]>;
}>;
