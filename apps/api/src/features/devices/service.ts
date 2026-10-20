import type { Prisma } from "../../generated/prisma/client.js";
import type { HumanContext } from "../identity/public.js";
import {
  branchReach,
  decide,
  isTimeZone,
  OrganizationFailure,
  requireCapability,
  type CompanyAccess,
  type CompanyAccessPort,
} from "../organizations/public.js";
import {
  credentialHash,
  DeviceFailure,
  devicePolicy,
  deviceName,
  displayUserCode,
  generateUserCode,
  normalizeReport,
  normalizeUserCode,
  requireSupportedRotation,
  userCodeHmac,
  type DeviceReport,
  type DeviceStatus,
  type KeyRing,
  type Rotation,
} from "./domain.js";
import type {
  DeviceIdentity,
  DeviceRecord,
  PrismaDeviceRepository,
} from "./prisma-repository.js";
import type { DeviceMoveHook } from "./public.js";

export type DeviceView = DeviceRecord &
  Readonly<{ branchName: string; branchTimeZone: string }>;

type Cursor = { c: string; p: string; r: string; t: string; i: string };

function encodeCursor(value: Cursor): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

/** Cursors are bound to the company, caller, visible scope and filters. */
function decodeCursor(
  value: string | undefined,
  binding: { company: string; principal: string; scope: string },
): Cursor | undefined {
  if (value === undefined) return undefined;
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("encoding");
    const parsed = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    ) as Partial<Cursor> | null;
    if (
      parsed &&
      typeof parsed === "object" &&
      parsed.c === binding.company &&
      parsed.p === binding.principal &&
      parsed.r === binding.scope &&
      typeof parsed.t === "string" &&
      !Number.isNaN(new Date(parsed.t).getTime()) &&
      typeof parsed.i === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        parsed.i,
      )
    )
      return parsed as Cursor;
  } catch {
    // Malformed cursors answer like foreign ones.
  }
  throw new DeviceFailure("VALIDATION_FAILED");
}

/** Hidden devices answer RESOURCE_NOT_FOUND; visible ones explain denials. */
function requireManage(access: CompanyAccess, branchId: string): void {
  if (decide(access, "devices.view", branchId) === "deny")
    throw new DeviceFailure("RESOURCE_NOT_FOUND");
  requireCapability(access, "devices.manage", branchId);
}

/** Screen enrollment and lifecycle over the organizations access boundary. */
export class DeviceService {
  readonly #repository: PrismaDeviceRepository;
  readonly #companies: CompanyAccessPort;
  readonly #codeKeys: KeyRing;
  readonly #moveHooks: DeviceMoveHook[] = [];

  constructor(options: {
    repository: PrismaDeviceRepository;
    companies: CompanyAccessPort;
    codeKeys: KeyRing;
  }) {
    if (options.codeKeys.length === 0)
      throw new Error("The device code key ring is empty");
    this.#repository = options.repository;
    this.#companies = options.companies;
    this.#codeKeys = options.codeKeys;
  }

  async startEnrollment(input: {
    credentialHash: string;
    report: DeviceReport;
  }): Promise<{
    enrollmentId: string;
    userCode: string;
    expiresAt: Date;
    pollIntervalSeconds: number;
  }> {
    const hash = Buffer.from(input.credentialHash, "base64url");
    if (hash.length !== 32) throw new DeviceFailure("VALIDATION_FAILED");
    const report = normalizeReport(input.report);
    await this.#repository.purge();
    const [current] = this.#codeKeys;
    const started = await this.#repository.startEnrollment(hash, report, () => {
      const code = generateUserCode();
      return {
        code,
        hmac: userCodeHmac(current.key, code),
        keyId: current.id,
      };
    });
    return {
      enrollmentId: started.id,
      userCode: displayUserCode(started.code),
      expiresAt: started.expiresAt,
      pollIntervalSeconds: devicePolicy.pollIntervalSeconds,
    };
  }

  pollEnrollment(enrollmentId: string, credential: string) {
    const hash = credentialHash(credential);
    if (!hash) throw new DeviceFailure("DEVICE_UNAUTHORIZED");
    return this.#repository.pollEnrollment(enrollmentId, hash);
  }

  async pair(
    context: HumanContext,
    companyId: string,
    input: {
      userCode: string;
      name: string;
      branchId: string;
      rotation: Rotation;
    },
  ): Promise<DeviceView> {
    const name = deviceName(input.name);
    // Request-time checks; the transaction decides again under its locks.
    const access = await this.#companies.resolve(context, companyId);
    requireCapability(access, "devices.manage", input.branchId);
    const failures = await this.#repository.failedClaims(
      context.principalId,
      companyId,
    );
    if (
      failures.principal >= devicePolicy.failedClaimsPerPrincipal ||
      failures.company >= devicePolicy.failedClaimsPerCompany
    )
      throw new DeviceFailure("RATE_LIMITED");
    const code = normalizeUserCode(input.userCode);
    try {
      if (!code) throw new DeviceFailure("PAIRING_CODE_INVALID");
      const hmacs = this.#codeKeys.map(({ key }) => userCodeHmac(key, code));
      const device = await this.#repository.transaction(async (tx) => {
        const locked = await this.#companies.lockForWrite(
          tx,
          context,
          companyId,
          [input.branchId],
        );
        requireCapability(locked.access, "devices.manage", input.branchId);
        // Unknown, archived and other companies' branches are rejected alike.
        if (!locked.activeBranchIds.has(input.branchId))
          throw new DeviceFailure("VALIDATION_FAILED");
        const enrollment = await this.#repository.lockPendingEnrollment(
          tx,
          hmacs,
        );
        if (!enrollment) throw new DeviceFailure("PAIRING_CODE_INVALID");
        requireSupportedRotation(enrollment.report, input.rotation);
        return this.#repository.createDevice(
          tx,
          {
            principalId: context.principalId,
            membershipId: locked.access.membershipId,
          },
          {
            companyId,
            branchId: input.branchId,
            enrollmentId: enrollment.id,
            credentialHash: enrollment.credentialHash,
            report: enrollment.report,
            name,
            rotation: input.rotation,
          },
        );
      });
      return (await this.#views(companyId, [device]))[0];
    } catch (error) {
      if (
        error instanceof DeviceFailure &&
        error.code === "PAIRING_CODE_INVALID"
      )
        await this.#repository.recordFailedClaim(
          context.principalId,
          companyId,
        );
      throw error;
    }
  }

  async list(
    context: HumanContext,
    companyId: string,
    options: {
      limit: number;
      cursor?: string;
      branchId?: string;
      status?: DeviceStatus;
    },
  ): Promise<{ items: DeviceView[]; nextCursor: string | null }> {
    const access = await this.#companies.resolve(context, companyId);
    if (access.companyStatus === "SUSPENDED")
      throw new OrganizationFailure("COMPANY_SUSPENDED");
    const reach = branchReach(access, "devices.view");
    if (reach !== "all" && reach.size === 0)
      requireCapability(access, "devices.view");
    const scope = [
      reach === "all" ? "all" : [...reach].sort().join(","),
      options.branchId ?? "",
      options.status ?? "",
    ].join("|");
    const cursor = decodeCursor(options.cursor, {
      company: companyId,
      principal: context.principalId,
      scope,
    });
    const rows = await this.#repository.list(companyId, reach, {
      limit: options.limit + 1,
      ...(options.branchId ? { branchId: options.branchId } : {}),
      ...(options.status ? { status: options.status } : {}),
      ...(cursor
        ? { before: { pairedAt: new Date(cursor.t), id: cursor.i } }
        : {}),
    });
    const page = rows.slice(0, options.limit);
    const last = page.at(-1);
    return {
      items: await this.#views(companyId, page),
      nextCursor:
        rows.length > options.limit && last
          ? encodeCursor({
              c: companyId,
              p: context.principalId,
              r: scope,
              t: last.pairedAt.toISOString(),
              i: last.id,
            })
          : null,
    };
  }

  async get(
    context: HumanContext,
    companyId: string,
    deviceId: string,
  ): Promise<DeviceView> {
    const access = await this.#companies.resolve(context, companyId);
    if (access.companyStatus === "SUSPENDED")
      throw new OrganizationFailure("COMPANY_SUSPENDED");
    const device = await this.#repository.find(companyId, deviceId);
    if (!device || decide(access, "devices.view", device.branchId) !== "allow")
      throw new DeviceFailure("RESOURCE_NOT_FOUND");
    return (await this.#views(companyId, [device]))[0];
  }

  /** Registers work that runs in every move's transaction. */
  addMoveHook(hook: DeviceMoveHook): void {
    this.#moveHooks.push(hook);
  }

  describe(
    tx: Prisma.TransactionClient | null,
    companyId: string,
    deviceIds: readonly string[],
  ): Promise<DeviceRecord[]> {
    return this.#repository.describe(tx, companyId, deviceIds);
  }

  configure(
    context: HumanContext,
    companyId: string,
    deviceId: string,
    expectedVersion: number,
    changes: { name?: string; rotation?: Rotation; timeZone?: string | null },
  ): Promise<DeviceView> {
    if (
      changes.name === undefined &&
      changes.rotation === undefined &&
      changes.timeZone === undefined
    )
      throw new DeviceFailure("VALIDATION_FAILED");
    if (
      changes.timeZone !== undefined &&
      changes.timeZone !== null &&
      !isTimeZone(changes.timeZone)
    )
      throw new DeviceFailure("VALIDATION_FAILED");
    const name =
      changes.name === undefined ? undefined : deviceName(changes.name);
    return this.#change(
      context,
      companyId,
      deviceId,
      expectedVersion,
      [],
      (current) => {
        if (changes.rotation !== undefined)
          requireSupportedRotation(current.report, changes.rotation);
        return {
          kind: "configure",
          ...(name !== undefined ? { name } : {}),
          ...(changes.rotation !== undefined
            ? { rotation: changes.rotation }
            : {}),
          ...(changes.timeZone !== undefined
            ? { timeZone: changes.timeZone }
            : {}),
        };
      },
    );
  }

  move(
    context: HumanContext,
    companyId: string,
    deviceId: string,
    expectedVersion: number,
    branchId: string,
  ): Promise<DeviceView> {
    return this.#change(
      context,
      companyId,
      deviceId,
      expectedVersion,
      [branchId],
      (current, locked) => {
        if (current.branchId === branchId)
          throw new DeviceFailure("VALIDATION_FAILED");
        requireCapability(locked.access, "devices.manage", branchId);
        if (!locked.activeBranchIds.has(branchId))
          throw new DeviceFailure("VALIDATION_FAILED");
        return { kind: "move", branchId };
      },
      {
        after: async (tx, moved, locked) => {
          for (const hook of this.#moveHooks)
            await hook(tx, {
              companyId,
              deviceId,
              branchId,
              actor: {
                principalId: context.principalId,
                membershipId: locked.access.membershipId,
              },
            });
          return moved;
        },
      },
    );
  }

  unlink(
    context: HumanContext,
    companyId: string,
    deviceId: string,
    expectedVersion: number,
  ): Promise<DeviceView> {
    return this.#change(
      context,
      companyId,
      deviceId,
      expectedVersion,
      [],
      () => ({
        kind: "unlink",
      }),
    );
  }

  recordReset(
    context: HumanContext,
    companyId: string,
    deviceId: string,
    expectedVersion: number,
  ): Promise<DeviceView> {
    return this.#change(
      context,
      companyId,
      deviceId,
      expectedVersion,
      [],
      () => ({ kind: "reset" }),
      { allowRevoked: true },
    );
  }

  /** Resolves a bearer device credential, or throws DEVICE_UNAUTHORIZED. */
  async authenticate(
    authorization: string | undefined,
  ): Promise<{ identity: DeviceIdentity; hash: Buffer }> {
    const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(authorization ?? "");
    const hash = match ? credentialHash(match[1]) : null;
    if (!hash) throw new DeviceFailure("DEVICE_UNAUTHORIZED");
    const identity = await this.#repository.authenticate(hash);
    if (!identity) throw new DeviceFailure("DEVICE_UNAUTHORIZED");
    return { identity, hash };
  }

  async self(identity: DeviceIdentity) {
    const { device, now } = await this.#repository.self(identity);
    if (device.status === "REVOKED")
      return {
        id: device.id,
        status: "unlinked" as const,
        clearRequired: true,
        name: null,
        branch: null,
        timeZone: null,
        rotation: null,
        authorizedUntil: null,
        serverTime: now,
      };
    const description = await this.#companies.describe(device.companyId, [
      device.branchId,
    ]);
    const branch = description.branches.get(device.branchId);
    const suspended = description.companyStatus !== "ACTIVE";
    return {
      id: device.id,
      status: suspended ? ("suspended" as const) : ("active" as const),
      clearRequired: false,
      name: device.name,
      branch: branch
        ? { id: device.branchId, name: branch.name, timeZone: branch.timeZone }
        : null,
      timeZone: device.timeZone ?? branch?.timeZone ?? null,
      rotation: device.rotation,
      // A suspended company renews nothing; already issued leases run out.
      authorizedUntil: suspended
        ? null
        : new Date(
            now.getTime() +
              devicePolicy.offlineAuthorizationDays * 24 * 60 * 60 * 1000,
          ),
      serverTime: now,
    };
  }

  updateReport(identity: DeviceIdentity, report: DeviceReport): Promise<void> {
    if (identity.status !== "ACTIVE")
      throw new DeviceFailure("DEVICE_UNAUTHORIZED");
    return this.#repository.updateReport(identity, normalizeReport(report));
  }

  confirmErasure(identity: DeviceIdentity): Promise<void> {
    if (identity.status !== "REVOKED")
      throw new DeviceFailure("DEVICE_UNAUTHORIZED");
    return this.#repository.confirmErasure(identity);
  }

  rotateCredential(
    identity: DeviceIdentity,
    presented: Buffer,
    next: string,
  ): Promise<void> {
    if (identity.status !== "ACTIVE")
      throw new DeviceFailure("DEVICE_UNAUTHORIZED");
    const hash = Buffer.from(next, "base64url");
    if (hash.length !== 32) throw new DeviceFailure("VALIDATION_FAILED");
    return this.#repository.rotateCredential(identity, presented, hash);
  }

  /** The organizations archive guard: a branch with active devices stays. */
  branchInUse = (
    ...args: Parameters<PrismaDeviceRepository["branchHasActiveDevices"]>
  ): Promise<boolean> => this.#repository.branchHasActiveDevices(...args);

  async #change(
    context: HumanContext,
    companyId: string,
    deviceId: string,
    expectedVersion: number,
    branchIds: readonly string[],
    decideChange: (
      current: DeviceRecord,
      locked: Awaited<ReturnType<CompanyAccessPort["lockForWrite"]>>,
    ) => Parameters<PrismaDeviceRepository["change"]>[3],
    options: {
      allowRevoked?: boolean;
      after?: (
        tx: Prisma.TransactionClient,
        changed: DeviceRecord,
        locked: Awaited<ReturnType<CompanyAccessPort["lockForWrite"]>>,
      ) => Promise<DeviceRecord>;
    } = {},
  ): Promise<DeviceView> {
    const device = await this.#repository.transaction(async (tx) => {
      const locked = await this.#companies.lockForWrite(
        tx,
        context,
        companyId,
        branchIds,
      );
      const current = await this.#repository.lock(tx, companyId, deviceId);
      if (!current) throw new DeviceFailure("RESOURCE_NOT_FOUND");
      requireManage(locked.access, current.branchId);
      if (current.version !== expectedVersion)
        throw new DeviceFailure("RESOURCE_VERSION_CONFLICT");
      if (options.allowRevoked) {
        if (current.erasure !== "PENDING")
          throw new DeviceFailure("DEVICE_ERASURE_NOT_PENDING");
      } else if (current.status !== "ACTIVE")
        throw new DeviceFailure("DEVICE_UNLINKED");
      const changed = await this.#repository.change(
        tx,
        {
          principalId: context.principalId,
          membershipId: locked.access.membershipId,
        },
        current,
        decideChange(current, locked),
      );
      return options.after ? options.after(tx, changed, locked) : changed;
    });
    return (await this.#views(companyId, [device]))[0];
  }

  async #views(
    companyId: string,
    devices: readonly DeviceRecord[],
  ): Promise<DeviceView[]> {
    const description = await this.#companies.describe(
      companyId,
      devices.map((device) => device.branchId),
    );
    return devices.map((device) => ({
      ...device,
      branchName: description.branches.get(device.branchId)?.name ?? "",
      branchTimeZone:
        description.branches.get(device.branchId)?.timeZone ?? "UTC",
    }));
  }
}
