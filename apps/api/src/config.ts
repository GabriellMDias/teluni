import { createPrivateKey, type KeyObject } from "node:crypto";
import { isIP } from "node:net";
import { Type, type Static } from "typebox";
import { Value } from "typebox/value";

// This is the only application module that interprets environment values.
export const serverConfigSchema = Type.Object(
  {
    environment: Type.Union([
      Type.Literal("development"),
      Type.Literal("test"),
      Type.Literal("production"),
    ]),
    releaseId: Type.String({ pattern: "^[A-Za-z0-9._-]{1,128}$" }),
    host: Type.String({ minLength: 1 }),
    port: Type.Integer({ minimum: 0, maximum: 65535 }),
    trustedProxies: Type.Array(Type.String({ minLength: 1, maxLength: 64 }), {
      maxItems: 16,
    }),
    logLevel: Type.Union([
      Type.Literal("fatal"),
      Type.Literal("error"),
      Type.Literal("warn"),
      Type.Literal("info"),
      Type.Literal("debug"),
      Type.Literal("trace"),
    ]),
    shutdownTimeoutMs: Type.Integer({ minimum: 100, maximum: 30000 }),
    otlpEndpoint: Type.Optional(Type.String({ format: "uri" })),
    traceSampleRatio: Type.Number({ minimum: 0, maximum: 1 }),
    databaseUrl: Type.Optional(Type.String({ minLength: 1 })),
    tokenIssuer: Type.Optional(Type.String({ minLength: 1 })),
    tokenAudience: Type.Optional(Type.String({ minLength: 1 })),
    tokenJwksUrl: Type.Optional(Type.String({ minLength: 1 })),
    publicOrigin: Type.Optional(Type.String({ minLength: 1 })),
    oidcClientId: Type.Optional(
      Type.String({ pattern: "^[A-Za-z0-9._-]{1,255}$" }),
    ),
    oidcClientSecret: Type.Optional(Type.String({ minLength: 16 })),
    provisionerClientId: Type.Optional(
      Type.String({ pattern: "^[A-Za-z0-9._-]{1,255}$" }),
    ),
    provisionerClientSecret: Type.Optional(Type.String({ minLength: 16 })),
    keycloakAdminUrl: Type.Optional(Type.String({ minLength: 1 })),
    sessionKeys: Type.Optional(Type.String({ minLength: 1 })),
    developmentMfaMode: Type.Union([
      Type.Literal("required"),
      Type.Literal("optional"),
    ]),
    mailSmtpHost: Type.Optional(
      Type.String({ pattern: "^[A-Za-z0-9.-]{1,253}$" }),
    ),
    mailSmtpPort: Type.Integer({ minimum: 1, maximum: 65535 }),
    mailSmtpSecurity: Type.Union([
      Type.Literal("tls"),
      Type.Literal("starttls"),
      Type.Literal("none"),
    ]),
    mailSmtpUsername: Type.Optional(
      Type.String({ minLength: 1, maxLength: 256 }),
    ),
    mailSmtpPassword: Type.Optional(
      Type.String({ minLength: 1, maxLength: 512 }),
    ),
    mailFrom: Type.Optional(Type.String({ minLength: 3, maxLength: 254 })),
    mailKeys: Type.Optional(Type.String({ minLength: 1 })),
    deviceCodeKeys: Type.Optional(Type.String({ minLength: 1 })),
    mediaStoragePath: Type.Optional(
      Type.String({ minLength: 2, maxLength: 1024, pattern: "^/" }),
    ),
    mediaFfmpegPath: Type.String({ minLength: 1, maxLength: 1024 }),
    mediaFfprobePath: Type.String({ minLength: 1, maxLength: 1024 }),
    mediaProcessingConcurrency: Type.Integer({ minimum: 1, maximum: 4 }),
    syncSigningKeys: Type.Optional(Type.String({ minLength: 1 })),
  },
  { additionalProperties: false },
);

export type ServerConfig = Readonly<Static<typeof serverConfigSchema>>;
export type ClientConfig = Readonly<Record<string, never>>;

type ConfigMetadata = {
  key: keyof ServerConfig;
  name: string;
  type: string;
  required: boolean;
  default: string;
  visibility: "server";
  classification: "PUBLIC" | "INTERNAL" | "RESTRICTED";
  secret: boolean;
  purpose: string;
};

export const configReference = Object.freeze([
  {
    key: "developmentMfaMode",
    name: "TELUNI_DEV_MFA_MODE",
    type: "required | optional",
    required: false,
    default: "required",
    visibility: "server",
    classification: "INTERNAL",
    secret: false,
    purpose:
      "Optional MFA for local development only: simulates strong and recent assurance after normal authenticated-session checks, without persisting it. Requires development and loopback API, panel and issuer; rejected elsewhere. Restart the API after changing it.",
  },
  {
    key: "environment",
    name: "ORION_ENV",
    type: "development | test | production",
    required: true,
    default: "",
    visibility: "server",
    classification: "INTERNAL",
    secret: false,
    purpose: "Runtime environment.",
  },
  {
    key: "releaseId",
    name: "ORION_RELEASE_ID",
    type: "artifact identifier, 1..128 ASCII letters/digits/._-",
    required: false,
    default: "local",
    visibility: "server",
    classification: "INTERNAL",
    secret: false,
    purpose:
      "Actual artifact revision for correlated logs and traces; local for unversioned development.",
  },
  {
    key: "host",
    name: "ORION_API_HOST",
    type: "nonempty string",
    required: false,
    default: "127.0.0.1",
    visibility: "server",
    classification: "INTERNAL",
    secret: false,
    purpose: "Listen address; loopback by default.",
  },
  {
    key: "port",
    name: "ORION_API_PORT",
    type: "integer 0..65535",
    required: false,
    default: "3000",
    visibility: "server",
    classification: "INTERNAL",
    secret: false,
    purpose: "Listen port; zero selects an ephemeral port.",
  },
  {
    key: "trustedProxies",
    name: "TELUNI_TRUSTED_PROXIES",
    type: "comma-separated IP addresses or CIDR ranges, at most 16",
    required: false,
    default: "",
    visibility: "server",
    classification: "INTERNAL",
    secret: false,
    purpose:
      "Reverse proxies whose X-Forwarded-For and X-Forwarded-Proto headers are trusted, so request limits count the real client address; none by default.",
  },
  {
    key: "logLevel",
    name: "ORION_LOG_LEVEL",
    type: "Pino level",
    required: false,
    default: "info",
    visibility: "server",
    classification: "INTERNAL",
    secret: false,
    purpose: "Structured log threshold.",
  },
  {
    key: "shutdownTimeoutMs",
    name: "ORION_SHUTDOWN_TIMEOUT_MS",
    type: "integer 100..30000",
    required: false,
    default: "5000",
    visibility: "server",
    classification: "INTERNAL",
    secret: false,
    purpose: "Total graceful shutdown deadline.",
  },
  {
    key: "otlpEndpoint",
    name: "ORION_OTLP_ENDPOINT",
    type: "http(s) URL",
    required: false,
    default: "",
    visibility: "server",
    classification: "INTERNAL",
    secret: false,
    purpose: "Optional OTLP HTTP collector base URL.",
  },
  {
    key: "traceSampleRatio",
    name: "ORION_TRACE_SAMPLE_RATIO",
    type: "number 0..1",
    required: false,
    default: "1",
    visibility: "server",
    classification: "INTERNAL",
    secret: false,
    purpose: "Trace sampling probability.",
  },
  {
    key: "databaseUrl",
    name: "ORION_DATABASE_URL",
    type: "PostgreSQL URL",
    required: false,
    default: "",
    visibility: "server",
    classification: "RESTRICTED",
    secret: true,
    purpose:
      "Runtime PostgreSQL credential; enables the database for modules that require it and adds it to readiness.",
  },
  {
    key: "tokenIssuer",
    name: "ORION_TOKEN_ISSUER",
    type: "issuer URL",
    required: false,
    default: "",
    visibility: "server",
    classification: "INTERNAL",
    secret: false,
    purpose:
      "Expected access-token issuer; configure with audience and JWKS URL to enable bearer authentication.",
  },
  {
    key: "tokenAudience",
    name: "ORION_TOKEN_AUDIENCE",
    type: "nonempty string",
    required: false,
    default: "",
    visibility: "server",
    classification: "INTERNAL",
    secret: false,
    purpose: "Expected API access-token audience.",
  },
  {
    key: "tokenJwksUrl",
    name: "ORION_TOKEN_JWKS_URL",
    type: "http(s) URL",
    required: false,
    default: "",
    visibility: "server",
    classification: "INTERNAL",
    secret: false,
    purpose: "Trusted issuer public-key endpoint.",
  },
  {
    key: "publicOrigin",
    name: "TELUNI_PUBLIC_ORIGIN",
    type: "origin URL (scheme, host, optional port)",
    required: false,
    default: "",
    visibility: "server",
    classification: "INTERNAL",
    secret: false,
    purpose:
      "Browser-visible panel origin for OIDC callbacks, cookie security and CSRF origin checks; HTTPS outside loopback development.",
  },
  {
    key: "oidcClientId",
    name: "TELUNI_OIDC_CLIENT_ID",
    type: "client identifier",
    required: false,
    default: "",
    visibility: "server",
    classification: "INTERNAL",
    secret: false,
    purpose:
      "Confidential human-login OIDC client used by the server-managed session boundary.",
  },
  {
    key: "oidcClientSecret",
    name: "TELUNI_OIDC_CLIENT_SECRET",
    type: "secret string, at least 16 characters",
    required: false,
    default: "",
    visibility: "server",
    classification: "RESTRICTED",
    secret: true,
    purpose: "Credential of the human-login OIDC client.",
  },
  {
    key: "provisionerClientId",
    name: "TELUNI_IDENTITY_PROVISIONER_CLIENT_ID",
    type: "client identifier",
    required: false,
    default: "",
    visibility: "server",
    classification: "INTERNAL",
    secret: false,
    purpose:
      "Service-account client that writes the administrator-only application principal attribute.",
  },
  {
    key: "provisionerClientSecret",
    name: "TELUNI_IDENTITY_PROVISIONER_CLIENT_SECRET",
    type: "secret string, at least 16 characters",
    required: false,
    default: "",
    visibility: "server",
    classification: "RESTRICTED",
    secret: true,
    purpose: "Credential of the principal provisioner service account.",
  },
  {
    key: "keycloakAdminUrl",
    name: "TELUNI_KEYCLOAK_ADMIN_URL",
    type: "HTTP(S) base URL, optional context path, no trailing slash",
    required: false,
    default: "",
    visibility: "server",
    classification: "INTERNAL",
    secret: false,
    purpose:
      "Optional private Keycloak base URL for principal provisioning and administrative session termination; defaults to the public issuer's base. HTTP is only for a trusted private host/container network. Does not change OIDC discovery, token issuer or TLS verification. Requires complete human identity settings and an API restart.",
  },
  {
    key: "sessionKeys",
    name: "TELUNI_SESSION_KEYS",
    type: "comma-separated id:base64url 32-byte keys, newest first",
    required: false,
    default: "",
    visibility: "server",
    classification: "RESTRICTED",
    secret: true,
    purpose:
      "Key ring for provider-token encryption and CSRF tokens; the first key protects new values, all keys remain readable during rotation.",
  },
  {
    key: "mailSmtpHost",
    name: "TELUNI_MAIL_SMTP_HOST",
    type: "host name or address",
    required: false,
    default: "",
    visibility: "server",
    classification: "INTERNAL",
    secret: false,
    purpose:
      "SMTP submission relay for transactional email; configure with the sender and mail key ring to enable the mail module.",
  },
  {
    key: "mailSmtpPort",
    name: "TELUNI_MAIL_SMTP_PORT",
    type: "integer 1..65535",
    required: false,
    default: "587",
    visibility: "server",
    classification: "INTERNAL",
    secret: false,
    purpose: "SMTP submission relay port.",
  },
  {
    key: "mailSmtpSecurity",
    name: "TELUNI_MAIL_SMTP_SECURITY",
    type: "tls | starttls | none",
    required: false,
    default: "starttls",
    visibility: "server",
    classification: "INTERNAL",
    secret: false,
    purpose:
      "Implicit TLS or mandatory STARTTLS with certificate verification; none only for a loopback test sink outside production.",
  },
  {
    key: "mailSmtpUsername",
    name: "TELUNI_MAIL_SMTP_USERNAME",
    type: "string, 1..256 characters",
    required: false,
    default: "",
    visibility: "server",
    classification: "INTERNAL",
    secret: false,
    purpose:
      "SMTP authentication user; configured together with the password, or both omitted for an unauthenticated test sink.",
  },
  {
    key: "mailSmtpPassword",
    name: "TELUNI_MAIL_SMTP_PASSWORD",
    type: "secret string, 1..512 characters",
    required: false,
    default: "",
    visibility: "server",
    classification: "RESTRICTED",
    secret: true,
    purpose: "SMTP authentication credential of the mail relay.",
  },
  {
    key: "mailFrom",
    name: "TELUNI_MAIL_FROM",
    type: "email address",
    required: false,
    default: "",
    visibility: "server",
    classification: "INTERNAL",
    secret: false,
    purpose:
      "Sender address of transactional email; its domain must be authorized for the relay.",
  },
  {
    key: "mailKeys",
    name: "TELUNI_MAIL_KEYS",
    type: "comma-separated id:base64url 32-byte keys, newest first",
    required: false,
    default: "",
    visibility: "server",
    classification: "RESTRICTED",
    secret: true,
    purpose:
      "Key ring sealing secret message parameters, such as invitation credentials, until delivery ends; the first key protects new values.",
  },
  {
    key: "deviceCodeKeys",
    name: "TELUNI_DEVICE_CODE_KEYS",
    type: "comma-separated id:base64url 32-byte keys, newest first",
    required: false,
    default: "",
    visibility: "server",
    classification: "RESTRICTED",
    secret: true,
    purpose:
      "Key ring for the HMAC that stores screen pairing codes; the first key protects new codes, all keys remain readable during rotation. Enables the devices module.",
  },
  {
    key: "mediaStoragePath",
    name: "TELUNI_MEDIA_STORAGE_PATH",
    type: "absolute directory path",
    required: false,
    default: "",
    visibility: "server",
    classification: "INTERNAL",
    secret: false,
    purpose:
      "Directory on durable storage that holds media objects and work files on one filesystem; enables the media module.",
  },
  {
    key: "mediaFfmpegPath",
    name: "TELUNI_MEDIA_FFMPEG_PATH",
    type: "executable name or path",
    required: false,
    default: "ffmpeg",
    visibility: "server",
    classification: "INTERNAL",
    secret: false,
    purpose:
      "FFmpeg 6.1 or later executable that converts media in isolated child processes.",
  },
  {
    key: "mediaFfprobePath",
    name: "TELUNI_MEDIA_FFPROBE_PATH",
    type: "executable name or path",
    required: false,
    default: "ffprobe",
    visibility: "server",
    classification: "INTERNAL",
    secret: false,
    purpose:
      "ffprobe 6.1 or later executable that inspects uploaded media in isolated child processes.",
  },
  {
    key: "mediaProcessingConcurrency",
    name: "TELUNI_MEDIA_PROCESSING_CONCURRENCY",
    type: "integer 1..4",
    required: false,
    default: "1",
    visibility: "server",
    classification: "INTERNAL",
    secret: false,
    purpose: "Media processing jobs this API process runs at once.",
  },
  {
    key: "syncSigningKeys",
    name: "TELUNI_SYNC_SIGNING_KEYS",
    type: "comma-separated id:base64url PKCS#8 DER EC P-256 private keys, newest first",
    required: false,
    default: "",
    visibility: "server",
    classification: "RESTRICTED",
    secret: true,
    purpose:
      "Key ring that signs screen authorization statements (ADR-0030); the first key signs, and every key's public half stays available to screens during rotation. Enables the publications module.",
  },
] as const satisfies readonly ConfigMetadata[]);

const keyRingEntryPattern = /^[A-Za-z0-9_-]{1,32}:[A-Za-z0-9_-]{43}$/;

/** Parses a validated `id:key` ring; the first entry is current. */
export function parseKeyRing(
  value: string,
  label: string,
): readonly Readonly<{ id: string; key: Buffer }>[] {
  const entries = value.split(",").map((entry) => entry.trim());
  const ids = new Set<string>();
  const keys = entries.map((entry) => {
    if (!keyRingEntryPattern.test(entry))
      throw new Error(`Invalid API configuration: ${label}`);
    const [id, encoded] = entry.split(":") as [string, string];
    if (ids.has(id)) throw new Error(`Invalid API configuration: ${label}`);
    ids.add(id);
    const key = Buffer.from(encoded, "base64url");
    if (key.length !== 32)
      throw new Error(`Invalid API configuration: ${label}`);
    return Object.freeze({ id, key });
  });
  return Object.freeze(keys);
}

const signingKeyIdPattern = /^[A-Za-z0-9_-]{1,32}$/;

/**
 * Parses the synchronization signing key ring: `id:base64url(PKCS#8 DER)`
 * EC P-256 private keys, newest first, with unique IDs.
 */
export function parseSigningKeyRing(
  value: string,
): readonly Readonly<{ id: string; privateKey: KeyObject }>[] {
  const label = "Invalid API configuration: sync signing keys";
  const ids = new Set<string>();
  const keys = value.split(",").map((entry) => {
    const [id, encoded, ...rest] = entry.trim().split(":");
    if (
      rest.length > 0 ||
      !signingKeyIdPattern.test(id ?? "") ||
      !/^[A-Za-z0-9_-]+$/.test(encoded ?? "") ||
      ids.has(id)
    )
      throw new Error(label);
    ids.add(id);
    let privateKey: KeyObject;
    try {
      privateKey = createPrivateKey({
        key: Buffer.from(encoded, "base64url"),
        format: "der",
        type: "pkcs8",
      });
    } catch {
      throw new Error(label);
    }
    if (
      privateKey.asymmetricKeyType !== "ec" ||
      privateKey.asymmetricKeyDetails?.namedCurve !== "prime256v1"
    )
      throw new Error(label);
    return Object.freeze({ id, privateKey });
  });
  return Object.freeze(keys);
}

/** Parses the validated session key ring; the first entry is current. */
export function parseSessionKeys(
  value: string,
): readonly Readonly<{ id: string; key: Buffer }>[] {
  return parseKeyRing(value, "session keys");
}

// The same conservative shape as src/email-address.ts. This file has no local
// imports so repository tooling can load it directly.
const senderPattern = /^[^\s@<>",;]{1,64}@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;

function numberFromEnv(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (value.trim() === "") return Number.NaN;
  return Number(value);
}

function listFromEnv(value: string | undefined): string[] {
  if (value === undefined || value.trim() === "") return [];
  return value.split(",").map((entry) => entry.trim());
}

/** An IP address, or an address with a prefix length that fits its family. */
function isAddressOrRange(value: string): boolean {
  const [address = "", prefix, ...rest] = value.split("/");
  const family = isIP(address);
  if (family === 0 || rest.length > 0) return false;
  if (prefix === undefined) return true;
  if (!/^\d{1,3}$/.test(prefix)) return false;
  return Number(prefix) <= (family === 4 ? 32 : 128);
}

export function parseServerConfig(
  env: Readonly<Record<string, string | undefined>>,
): ServerConfig {
  const candidate = {
    environment: env.ORION_ENV,
    releaseId: env.ORION_RELEASE_ID ?? "local",
    host: env.ORION_API_HOST ?? "127.0.0.1",
    port: numberFromEnv(env.ORION_API_PORT, 3000),
    trustedProxies: listFromEnv(env.TELUNI_TRUSTED_PROXIES),
    logLevel: env.ORION_LOG_LEVEL ?? "info",
    shutdownTimeoutMs: numberFromEnv(env.ORION_SHUTDOWN_TIMEOUT_MS, 5000),
    ...(env.ORION_OTLP_ENDPOINT === undefined
      ? {}
      : { otlpEndpoint: env.ORION_OTLP_ENDPOINT }),
    traceSampleRatio: numberFromEnv(env.ORION_TRACE_SAMPLE_RATIO, 1),
    ...(env.ORION_DATABASE_URL === undefined
      ? {}
      : { databaseUrl: env.ORION_DATABASE_URL }),
    ...(env.ORION_TOKEN_ISSUER === undefined
      ? {}
      : { tokenIssuer: env.ORION_TOKEN_ISSUER }),
    ...(env.ORION_TOKEN_AUDIENCE === undefined
      ? {}
      : { tokenAudience: env.ORION_TOKEN_AUDIENCE }),
    ...(env.ORION_TOKEN_JWKS_URL === undefined
      ? {}
      : { tokenJwksUrl: env.ORION_TOKEN_JWKS_URL }),
    ...(env.TELUNI_PUBLIC_ORIGIN === undefined
      ? {}
      : { publicOrigin: env.TELUNI_PUBLIC_ORIGIN }),
    ...(env.TELUNI_OIDC_CLIENT_ID === undefined
      ? {}
      : { oidcClientId: env.TELUNI_OIDC_CLIENT_ID }),
    ...(env.TELUNI_OIDC_CLIENT_SECRET === undefined
      ? {}
      : { oidcClientSecret: env.TELUNI_OIDC_CLIENT_SECRET }),
    ...(env.TELUNI_IDENTITY_PROVISIONER_CLIENT_ID === undefined
      ? {}
      : { provisionerClientId: env.TELUNI_IDENTITY_PROVISIONER_CLIENT_ID }),
    ...(env.TELUNI_IDENTITY_PROVISIONER_CLIENT_SECRET === undefined
      ? {}
      : {
          provisionerClientSecret:
            env.TELUNI_IDENTITY_PROVISIONER_CLIENT_SECRET,
        }),
    ...(env.TELUNI_SESSION_KEYS === undefined
      ? {}
      : { sessionKeys: env.TELUNI_SESSION_KEYS }),
    ...(env.TELUNI_KEYCLOAK_ADMIN_URL === undefined
      ? {}
      : { keycloakAdminUrl: env.TELUNI_KEYCLOAK_ADMIN_URL }),
    developmentMfaMode: env.TELUNI_DEV_MFA_MODE ?? "required",
    ...(env.TELUNI_MAIL_SMTP_HOST === undefined
      ? {}
      : { mailSmtpHost: env.TELUNI_MAIL_SMTP_HOST }),
    mailSmtpPort: numberFromEnv(env.TELUNI_MAIL_SMTP_PORT, 587),
    mailSmtpSecurity: env.TELUNI_MAIL_SMTP_SECURITY ?? "starttls",
    ...(env.TELUNI_MAIL_SMTP_USERNAME === undefined
      ? {}
      : { mailSmtpUsername: env.TELUNI_MAIL_SMTP_USERNAME }),
    ...(env.TELUNI_MAIL_SMTP_PASSWORD === undefined
      ? {}
      : { mailSmtpPassword: env.TELUNI_MAIL_SMTP_PASSWORD }),
    ...(env.TELUNI_MAIL_FROM === undefined
      ? {}
      : { mailFrom: env.TELUNI_MAIL_FROM }),
    ...(env.TELUNI_MAIL_KEYS === undefined
      ? {}
      : { mailKeys: env.TELUNI_MAIL_KEYS }),
    ...(env.TELUNI_DEVICE_CODE_KEYS === undefined
      ? {}
      : { deviceCodeKeys: env.TELUNI_DEVICE_CODE_KEYS }),
    ...(env.TELUNI_MEDIA_STORAGE_PATH === undefined
      ? {}
      : { mediaStoragePath: env.TELUNI_MEDIA_STORAGE_PATH }),
    mediaFfmpegPath: env.TELUNI_MEDIA_FFMPEG_PATH ?? "ffmpeg",
    mediaFfprobePath: env.TELUNI_MEDIA_FFPROBE_PATH ?? "ffprobe",
    mediaProcessingConcurrency: numberFromEnv(
      env.TELUNI_MEDIA_PROCESSING_CONCURRENCY,
      1,
    ),
    ...(env.TELUNI_SYNC_SIGNING_KEYS === undefined
      ? {}
      : { syncSigningKeys: env.TELUNI_SYNC_SIGNING_KEYS }),
  };
  if (!Value.Check(serverConfigSchema, candidate)) {
    throw new Error("Invalid API configuration");
  }
  if (candidate.otlpEndpoint !== undefined) {
    let endpoint: URL;
    try {
      endpoint = new URL(candidate.otlpEndpoint);
    } catch {
      throw new Error("Invalid API configuration: /otlpEndpoint");
    }
    if (
      !["http:", "https:"].includes(endpoint.protocol) ||
      endpoint.username ||
      endpoint.password ||
      endpoint.search ||
      endpoint.hash
    ) {
      throw new Error("Invalid API configuration: /otlpEndpoint");
    }
  }
  const authValues = [
    candidate.tokenIssuer,
    candidate.tokenAudience,
    candidate.tokenJwksUrl,
  ];
  // Access-token verification is all-or-none; module requirements are
  // enforced when modules activate.
  if (authValues.some(Boolean) && authValues.some((value) => !value))
    throw new Error(
      "Invalid API configuration: incomplete access-token verification",
    );
  for (const value of [
    candidate.databaseUrl,
    candidate.tokenIssuer,
    candidate.tokenJwksUrl,
  ]) {
    if (!value) continue;
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      throw new Error("Invalid API configuration: URL");
    }
    const protocols =
      value === candidate.databaseUrl
        ? ["postgres:", "postgresql:"]
        : ["http:", "https:"];
    if (!protocols.includes(parsed.protocol))
      throw new Error("Invalid API configuration: URL protocol");
    if (value !== candidate.databaseUrl && parsed.protocol !== "https:") {
      if (
        candidate.environment === "production" ||
        !["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)
      )
        throw new Error("Invalid API configuration: token URL must use HTTPS");
    }
    if (
      !parsed.hostname ||
      (value !== candidate.databaseUrl &&
        (parsed.username || parsed.password || parsed.search || parsed.hash))
    )
      throw new Error("Invalid API configuration: URL components");
  }
  if (
    candidate.tokenAudience !== undefined &&
    candidate.tokenAudience.trim() === ""
  )
    throw new Error("Invalid API configuration: token audience");
  const identityValues = [
    candidate.publicOrigin,
    candidate.oidcClientId,
    candidate.oidcClientSecret,
    candidate.provisionerClientId,
    candidate.provisionerClientSecret,
    candidate.sessionKeys,
  ];
  // Human sessions are all-or-none and reuse the access-token issuer.
  if (
    identityValues.some(Boolean) ||
    candidate.keycloakAdminUrl !== undefined
  ) {
    if (identityValues.some((value) => !value) || !candidate.tokenIssuer)
      throw new Error(
        "Invalid API configuration: incomplete human identity settings",
      );
    let origin: URL;
    try {
      origin = new URL(candidate.publicOrigin!);
    } catch {
      throw new Error("Invalid API configuration: public origin");
    }
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(
      origin.hostname,
    );
    if (
      origin.origin !== candidate.publicOrigin ||
      (origin.protocol !== "https:" &&
        (origin.protocol !== "http:" ||
          !loopback ||
          candidate.environment === "production"))
    )
      throw new Error("Invalid API configuration: public origin");
    parseSessionKeys(candidate.sessionKeys!);
  }
  if (candidate.keycloakAdminUrl !== undefined) {
    let base: URL;
    try {
      base = new URL(candidate.keycloakAdminUrl);
    } catch {
      throw new Error("Invalid API configuration: Keycloak admin URL");
    }
    if (
      !["http:", "https:"].includes(base.protocol) ||
      !base.hostname ||
      base.username ||
      base.password ||
      base.href.includes("?") ||
      base.href.includes("#") ||
      base.port === "0" ||
      base.href.replace(/\/$/, "") !== candidate.keycloakAdminUrl ||
      !/\/realms\/[^/]+$/.test(new URL(candidate.tokenIssuer!).pathname)
    )
      throw new Error("Invalid API configuration: Keycloak admin URL");
  }
  if (candidate.developmentMfaMode === "optional") {
    const loopback = (value: string | undefined) =>
      value !== undefined &&
      ["localhost", "127.0.0.1", "[::1]"].includes(new URL(value).hostname);
    if (
      candidate.environment !== "development" ||
      !["localhost", "127.0.0.1", "::1"].includes(candidate.host) ||
      !candidate.sessionKeys ||
      !loopback(candidate.publicOrigin) ||
      !loopback(candidate.tokenIssuer)
    )
      throw new Error(
        "Invalid API configuration: optional MFA requires local development identity settings",
      );
  }
  const mailValues = [
    candidate.mailSmtpHost,
    candidate.mailFrom,
    candidate.mailKeys,
  ];
  // Mail is all-or-none; its links point to the human panel origin.
  if (
    mailValues.some(Boolean) ||
    candidate.mailSmtpUsername ||
    candidate.mailSmtpPassword
  ) {
    if (mailValues.some((value) => !value) || !candidate.publicOrigin)
      throw new Error("Invalid API configuration: incomplete mail settings");
    if (
      Boolean(candidate.mailSmtpUsername) !==
      Boolean(candidate.mailSmtpPassword)
    )
      throw new Error("Invalid API configuration: mail credentials");
    if (
      candidate.mailFrom!.length > 254 ||
      !senderPattern.test(candidate.mailFrom!)
    )
      throw new Error("Invalid API configuration: mail sender");
    const loopbackRelay = ["localhost", "127.0.0.1", "::1"].includes(
      candidate.mailSmtpHost!,
    );
    if (
      candidate.mailSmtpSecurity === "none" &&
      (candidate.environment === "production" || !loopbackRelay)
    )
      throw new Error("Invalid API configuration: mail transport security");
    parseKeyRing(candidate.mailKeys!, "mail keys");
  }
  if (candidate.deviceCodeKeys !== undefined)
    parseKeyRing(candidate.deviceCodeKeys, "device code keys");
  if (candidate.syncSigningKeys !== undefined)
    parseSigningKeyRing(candidate.syncSigningKeys);
  if (!candidate.trustedProxies.every(isAddressOrRange))
    throw new Error("Invalid API configuration: trusted proxies");
  // Tools run without a shell; a name is looked up on PATH, a path is used
  // as given. Neither may carry arguments.
  for (const tool of [candidate.mediaFfmpegPath, candidate.mediaFfprobePath])
    if (/[\s;&|`$<>]/.test(tool) || tool.includes("\0"))
      throw new Error("Invalid API configuration: media tool path");
  return Object.freeze(candidate);
}

// No browser-consumable API configuration exists. This projection
// prevents server settings from leaking into a future client configuration.
export function clientConfigFrom(config: ServerConfig): ClientConfig {
  void config;
  return Object.freeze({});
}
