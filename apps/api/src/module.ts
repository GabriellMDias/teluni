import type { KeyObject } from "node:crypto";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { FastifyInstance } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import type { Logger } from "pino";
import type { TSchema } from "typebox";
import type { AccessTokenVerifier } from "./authentication.js";
import type { Database } from "./database.js";
import type { ErrorDefinition } from "./errors.js";

export type AppInstance = FastifyInstance<
  Server,
  IncomingMessage,
  ServerResponse,
  Logger,
  TypeBoxTypeProvider
>;

/** Executable route metadata; the single source for routing and OpenAPI. */
export type ApiOperation = Readonly<{
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  url: string;
  operationId: string;
  description: string;
  schema: Readonly<{
    params?: TSchema;
    querystring?: TSchema;
    headers?: TSchema;
    body?: TSchema;
    response: Readonly<Record<number, TSchema>>;
  }>;
  expectedErrors?: readonly string[];
  /**
   * Authentication the operation requires. `public` operations accept
   * anonymous callers; `session` operations require the server-managed human
   * session cookie; `device` operations require a screen's device credential
   * as a bearer token (ADR-0027). Omitted, a module requiring
   * `authentication` uses bearer tokens.
   */
  access?: "public" | "session" | "device";
  /** Request body media type; JSON unless a protocol requires a form or bytes. */
  bodyContentType?:
    | "application/json"
    | "application/x-www-form-urlencoded"
    | "application/octet-stream";
  /**
   * Media type of successful responses that carry bytes instead of JSON,
   * such as a media file; their schema describes a binary string.
   */
  binaryResponse?: true;
}>;

export type ModuleRequirement =
  | "database"
  | "authentication"
  | "humanIdentity"
  | "mail"
  | "deviceEnrollment"
  | "mediaStorage"
  | "syncSigning";

/** Validated settings of the server-managed human session boundary. */
export type HumanIdentitySettings = Readonly<{
  environment: "development" | "test" | "production";
  issuer: string;
  publicOrigin: string;
  clientId: string;
  clientSecret: string;
  provisionerClientId: string;
  provisionerClientSecret: string;
  /** Private Keycloak base for administrative calls; public issuer is unchanged. */
  keycloakAdminUrl?: string;
  sessionKeys: readonly Readonly<{ id: string; key: Buffer }>[];
}>;

/** Validated settings of the transactional-email relay (ADR-0026). */
export type MailSettings = Readonly<{
  environment: "development" | "test" | "production";
  /** Browser-visible panel origin that email links point to. */
  publicOrigin: string;
  smtp: Readonly<{
    host: string;
    port: number;
    security: "tls" | "starttls" | "none";
    username?: string;
    password?: string;
  }>;
  from: string;
  keys: readonly Readonly<{ id: string; key: Buffer }>[];
}>;

/** Validated settings of screen enrollment (ADR-0027). */
export type DeviceEnrollmentSettings = Readonly<{
  /** Key ring of the pairing-code HMAC; the first key protects new codes. */
  codeKeys: readonly Readonly<{ id: string; key: Buffer }>[];
}>;

/** Validated settings of the media volume and its tools (ADR-0028). */
export type MediaStorageSettings = Readonly<{
  environment: "development" | "test" | "production";
  /** Absolute directory on durable storage holding objects and work files. */
  root: string;
  ffmpegPath: string;
  ffprobePath: string;
  /** Processing jobs run at once by this process. */
  concurrency: number;
}>;

/** Validated key ring of screen authorization statements (ADR-0030). */
export type SyncSigningSettings = Readonly<{
  /** EC P-256 private keys, newest first; the first key signs. */
  keys: readonly Readonly<{ id: string; privateKey: KeyObject }>[];
}>;

export type ModuleResources = Readonly<{
  database?: Database;
  verifier?: AccessTokenVerifier;
  humanIdentity?: HumanIdentitySettings;
  mail?: MailSettings;
  deviceEnrollment?: DeviceEnrollmentSettings;
  mediaStorage?: MediaStorageSettings;
  syncSigning?: SyncSigningSettings;
}>;

/** A module whose dependencies are satisfied and whose routes can mount. */
export type RegisteredModule = Readonly<{
  name: string;
  register(app: AppInstance): void;
  /**
   * Longest time one of the module's routes may take to receive its
   * request, for streamed uploads. Those routes set `config.longRequest`;
   * every other route keeps the standard 30 seconds.
   */
  requestTimeoutMs?: number;
}>;

/**
 * A cohesive API capability. The shared runtime knows modules only through
 * this contract; `modules.ts` lists the modules this repository composes.
 */
export type ApiModule = Readonly<{
  name: string;
  /** OpenAPI tag grouping the module's operations. */
  tag: string;
  requires: readonly ModuleRequirement[];
  /**
   * Names of modules whose public capabilities this module uses. They must
   * be listed earlier in the composition and activate first.
   */
  requiresModules?: readonly string[];
  operations: readonly ApiOperation[];
  errors: Readonly<Record<string, ErrorDefinition>>;
  /** Called only when every requirement is configured. */
  activate(resources: ModuleResources): RegisteredModule;
}>;

/**
 * Activates modules whose requirements are configured. Outside production an
 * unconfigured module stays unmounted; production refuses to start instead.
 */
export function activateModules(
  modules: readonly ApiModule[],
  resources: ModuleResources,
  environment: "development" | "test" | "production",
): RegisteredModule[] {
  const available: Record<ModuleRequirement, boolean> = {
    database: resources.database !== undefined,
    authentication: resources.verifier !== undefined,
    humanIdentity: resources.humanIdentity !== undefined,
    mail: resources.mail !== undefined,
    deviceEnrollment: resources.deviceEnrollment !== undefined,
    mediaStorage: resources.mediaStorage !== undefined,
    syncSigning: resources.syncSigning !== undefined,
  };
  const active: RegisteredModule[] = [];
  const activated = new Set<string>();
  for (const module of modules) {
    const missing: string[] = module.requires.filter(
      (requirement) => !available[requirement],
    );
    for (const name of module.requiresModules ?? [])
      if (!activated.has(name)) missing.push(`module ${name}`);
    if (missing.length === 0) {
      active.push(module.activate(resources));
      activated.add(module.name);
    } else if (environment === "production")
      throw new Error(
        `Invalid API configuration: ${module.name} requires ${missing.join(" and ")}`,
      );
  }
  return active;
}
