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
  input: { name?: string; rotation?: Rotation },
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
