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
    sessionKeys: Type.Optional(Type.String({ minLength: 1 })),
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

export function parseServerConfig(
  env: Readonly<Record<string, string | undefined>>,
): ServerConfig {
  const candidate = {
    environment: env.ORION_ENV,
    releaseId: env.ORION_RELEASE_ID ?? "local",
    host: env.ORION_API_HOST ?? "127.0.0.1",
    port: numberFromEnv(env.ORION_API_PORT, 3000),
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
  if (identityValues.some(Boolean)) {
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
  return Object.freeze(candidate);
}

// No browser-consumable API configuration exists. This projection
// prevents server settings from leaking into a future client configuration.
export function clientConfigFrom(config: ServerConfig): ClientConfig {
  void config;
  return Object.freeze({});
}
