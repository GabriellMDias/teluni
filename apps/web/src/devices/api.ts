import type { paths } from "@teluni/sdk";
import { unwrap } from "../api-client.js";
import { sessionApiClient } from "../identity/api.js";
import { organizationErrorCodes } from "../organizations/api.js";

export const deviceErrorCodes: ReadonlySet<string> = new Set([
  ...organizationErrorCodes,
  "PAIRING_CODE_INVALID",
  "ROTATION_UNSUPPORTED",
  "DEVICE_UNLINKED",
  "DEVICE_ERASURE_NOT_PENDING",
]);

export type Device =
  paths["/companies/{companyId}/devices/{deviceId}"]["get"]["responses"][200]["content"]["application/json"];
export type DeviceStatus = Device["status"];
export type Erasure = Device["erasure"];
export type Rotation = Device["rotation"];
export type DeviceFilter = Readonly<{
  cursor?: string;
  branchId?: string;
  status?: DeviceStatus;
}>;

export type DeviceHistoryFilter = Readonly<{
  view?: "history";
  cursor?: string;
}>;
export const deviceAuditKey = (companyId: string, deviceId: string) =>
  ["devices", "audit", companyId, deviceId] as const;
export async function listDeviceAuditEvents(
  companyId: string,
  deviceId: string,
  cursor?: string,
) {
  return unwrap(
    await client().GET(
      "/companies/{companyId}/devices/{deviceId}/audit-events",
      {
        params: {
          path: { companyId, deviceId },
          query: { ...(cursor ? { cursor } : {}) },
        },
      },
    ),
    deviceErrorCodes,
  );
}

export const rotations: readonly Rotation[] = [0, 90, 180, 270];

/** Matches the server's offline authorization window (AT-15). */
export const offlineAuthorizationDays = 7;
/** The server records a check-in at most once per this interval. */
const lastSeenGranularityMs = 60_000;

export const devicesKey = (companyId: string) =>
  ["devices", "list", companyId] as const;
export const deviceKey = (companyId: string, deviceId: string) =>
  ["devices", "device", companyId, deviceId] as const;

const client = sessionApiClient;

export async function listDevices(companyId: string, filter: DeviceFilter) {
  return unwrap(
    await client().GET("/companies/{companyId}/devices", {
      params: { path: { companyId }, query: { ...filter } },
    }),
    deviceErrorCodes,
  );
}

export async function getDevice(
  companyId: string,
  deviceId: string,
): Promise<Device> {
  return unwrap(
    await client().GET("/companies/{companyId}/devices/{deviceId}", {
      params: { path: { companyId, deviceId } },
    }),
    deviceErrorCodes,
  );
}

/** The code travels only in the request body, never in a URL. */
export async function pairDevice(
  companyId: string,
  input: {
    userCode: string;
    name: string;
    branchId: string;
    rotation: Rotation;
  },
): Promise<Device> {
  return unwrap(
    await client().POST("/companies/{companyId}/devices", {
      params: { path: { companyId } },
      body: input,
    }),
    deviceErrorCodes,
  );
}

export async function configureDevice(
  companyId: string,
  device: Device,
  input: { name?: string; rotation?: Rotation; timeZone?: string | null },
): Promise<Device> {
  return unwrap(
    await client().PATCH("/companies/{companyId}/devices/{deviceId}", {
      params: { path: { companyId, deviceId: device.id } },
      body: { expectedVersion: device.version, ...input },
    }),
    deviceErrorCodes,
  );
}

export async function moveDevice(
  companyId: string,
  device: Device,
  branchId: string,
): Promise<Device> {
  return unwrap(
    await client().POST("/companies/{companyId}/devices/{deviceId}/move", {
      params: { path: { companyId, deviceId: device.id } },
      body: { expectedVersion: device.version, branchId },
    }),
    deviceErrorCodes,
  );
}

export async function unlinkDevice(
  companyId: string,
  device: Device,
): Promise<Device> {
  return unwrap(
    await client().POST("/companies/{companyId}/devices/{deviceId}/unlink", {
      params: { path: { companyId, deviceId: device.id } },
      body: { expectedVersion: device.version },
    }),
    deviceErrorCodes,
  );
}

export async function recordDeviceReset(
  companyId: string,
  device: Device,
): Promise<Device> {
  return unwrap(
    await client().POST(
      "/companies/{companyId}/devices/{deviceId}/reset-record",
      {
        params: { path: { companyId, deviceId: device.id } },
        body: { expectedVersion: device.version },
      },
    ),
    deviceErrorCodes,
  );
}

/**
 * The latest offline deadline an active screen could hold: its last check-in
 * plus the authorization window. A server-side bound, not the device's state.
 */
export function latestAuthorization(device: Device): Date | null {
  if (device.status !== "ACTIVE" || !device.lastSeenAt) return null;
  return new Date(
    Date.parse(device.lastSeenAt) +
      offlineAuthorizationDays * 86_400_000 +
      lastSeenGranularityMs,
  );
}

// Screen synchronization (PJ-11): what each screen should play and what it
// last reported. Reported values are the screen's own statements.

export type ScreenState =
  paths["/companies/{companyId}/devices/{deviceId}/sync-state"]["get"]["responses"][200]["content"]["application/json"];

export const syncStateKey = (companyId: string, deviceId: string) =>
  ["devices", "sync", companyId, deviceId] as const;
export const screenStatesKey = (companyId: string, deviceIds: string[]) =>
  ["devices", "sync-list", companyId, ...deviceIds] as const;

/** AT-14: an acknowledgement shows within 10 seconds of reaching the API. */
export const syncRefreshMs = 5_000;

export async function getSyncState(
  companyId: string,
  deviceId: string,
): Promise<ScreenState> {
  return unwrap(
    await client().GET("/companies/{companyId}/devices/{deviceId}/sync-state", {
      params: { path: { companyId, deviceId } },
    }),
    deviceErrorCodes,
  );
}

/** States of up to 100 screens; ones the caller cannot see are omitted. */
export async function listScreenStates(
  companyId: string,
  deviceIds: string[],
): Promise<Map<string, ScreenState>> {
  if (deviceIds.length === 0) return new Map();
  const body = unwrap(
    await client().GET("/companies/{companyId}/publications/screen-states", {
      params: { path: { companyId }, query: { deviceId: deviceIds } },
    }),
    deviceErrorCodes,
  );
  return new Map(body.items.map((item) => [item.deviceId, item]));
}
