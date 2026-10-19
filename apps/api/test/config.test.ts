import { describe, expect, it } from "vitest";
import {
  clientConfigFrom,
  configReference,
  parseServerConfig,
  parseSessionKeys,
  serverConfigSchema,
} from "../src/config.js";

describe("API configuration boundary", () => {
  it("documents every schema field exactly once", () => {
    expect(configReference.map((entry) => entry.key).sort()).toEqual(
      Object.keys(serverConfigSchema.properties).sort(),
    );
    expect(new Set(configReference.map((entry) => entry.name)).size).toBe(
      configReference.length,
    );
  });
  it("requires an explicit environment before startup", () => {
    expect(() => parseServerConfig({})).toThrow("Invalid API configuration");
  });

  it("parses typed values, uses loopback defaults, and freezes the result", () => {
    const config = parseServerConfig({
      ORION_ENV: "test",
      ORION_API_PORT: "0",
      ORION_TRACE_SAMPLE_RATIO: "0.25",
    });
    expect(config).toMatchObject({
      environment: "test",
      releaseId: "local",
      host: "127.0.0.1",
      port: 0,
      traceSampleRatio: 0.25,
    });
    expect(Object.isFrozen(config)).toBe(true);
    expect(() => Object.assign(config, { port: 42 })).toThrow();
    expect(clientConfigFrom(config)).toEqual({});
    expect(Object.isFrozen(clientConfigFrom(config))).toBe(true);
  });

  it.each([
    { ORION_ENV: "other" },
    { ORION_ENV: "test", ORION_API_PORT: "abc" },
    { ORION_ENV: "test", ORION_API_PORT: "-1" },
    { ORION_ENV: "test", ORION_SHUTDOWN_TIMEOUT_MS: "0" },
    { ORION_ENV: "test", ORION_TRACE_SAMPLE_RATIO: "2" },
    { ORION_ENV: "test", ORION_RELEASE_ID: "candidate with spaces" },
    {
      ORION_ENV: "test",
      ORION_OTLP_ENDPOINT: "https://user:secret@example.test",
    },
    { ORION_ENV: "test", ORION_OTLP_ENDPOINT: "file:///tmp/collector" },
  ])("rejects unsafe or malformed configuration %#", (env) => {
    expect(() => parseServerConfig(env)).toThrow("Invalid API configuration");
  });

  it("classifies every setting and keeps the database credential restricted", () => {
    expect(
      configReference.every((item) => typeof item.secret === "boolean"),
    ).toBe(true);
    expect(
      configReference.find((item) => item.name === "ORION_DATABASE_URL"),
    ).toMatchObject({
      classification: "RESTRICTED",
      secret: true,
      visibility: "server",
    });
    expect(
      parseServerConfig({ ORION_ENV: "test", ORION_RELEASE_ID: "build.42" })
        .releaseId,
    ).toBe("build.42");
  });

  it("configures bearer verification as a complete server-only boundary independent of the database", () => {
    const identity = {
      ORION_ENV: "test",
      ORION_TOKEN_ISSUER: "https://issuer.example.test/",
      ORION_TOKEN_AUDIENCE: "example-api",
      ORION_TOKEN_JWKS_URL: "https://issuer.example.test/jwks",
    };
    expect(() => parseServerConfig(identity)).not.toThrow();
    for (const key of [
      "ORION_TOKEN_ISSUER",
      "ORION_TOKEN_AUDIENCE",
      "ORION_TOKEN_JWKS_URL",
    ])
      expect(() =>
        parseServerConfig({ ...identity, [key]: undefined }),
      ).toThrow("incomplete access-token verification");
    expect(() => parseServerConfig({ ORION_ENV: "production" })).not.toThrow();
    const databaseOnly = {
      ORION_ENV: "test",
      ORION_DATABASE_URL:
        "postgresql://runtime:synthetic@127.0.0.1:5432/example",
    };
    expect(() => parseServerConfig(databaseOnly)).not.toThrow();
    expect(
      clientConfigFrom(parseServerConfig({ ...identity, ...databaseOnly })),
    ).toEqual({});
    expect(() =>
      parseServerConfig({
        ...identity,
        ORION_ENV: "production",
        ORION_TOKEN_JWKS_URL: "http://issuer.example.test/jwks",
      }),
    ).toThrow();
    expect(() =>
      parseServerConfig({
        ...identity,
        ORION_TOKEN_JWKS_URL: "http://127.0.0.1:8080/jwks",
      }),
    ).not.toThrow();
  });

  it("does not expose migration credentials in runtime configuration", () => {
    const config = parseServerConfig({
      ORION_ENV: "test",
      ORION_MIGRATION_DATABASE_URL:
        "postgresql://migration:synthetic@127.0.0.1/example",
    });
    expect(JSON.stringify(config)).not.toContain("migration");
  });
});

describe("human identity configuration", () => {
  const key = Buffer.alloc(32, 7).toString("base64url");
  const complete = {
    ORION_ENV: "test",
    ORION_TOKEN_ISSUER: "http://localhost:8080/realms/teluni",
    ORION_TOKEN_AUDIENCE: "teluni-api",
    ORION_TOKEN_JWKS_URL:
      "http://localhost:8080/realms/teluni/protocol/openid-connect/certs",
    TELUNI_PUBLIC_ORIGIN: "http://127.0.0.1:5173",
    TELUNI_OIDC_CLIENT_ID: "teluni-web",
    TELUNI_OIDC_CLIENT_SECRET: "synthetic-client-secret",
    TELUNI_IDENTITY_PROVISIONER_CLIENT_ID: "teluni-provisioner",
    TELUNI_IDENTITY_PROVISIONER_CLIENT_SECRET: "synthetic-provisioner-secret",
    TELUNI_SESSION_KEYS: `k2:${key},k1:${Buffer.alloc(32, 1).toString("base64url")}`,
  };

  it("accepts a complete loopback development configuration and parses the key ring", () => {
    const config = parseServerConfig(complete);
    expect(config.publicOrigin).toBe("http://127.0.0.1:5173");
    expect(parseSessionKeys(config.sessionKeys!).map(({ id }) => id)).toEqual([
      "k2",
      "k1",
    ]);
  });

  it.each([
    { TELUNI_OIDC_CLIENT_SECRET: undefined },
    {
      ORION_TOKEN_ISSUER: undefined,
      ORION_TOKEN_AUDIENCE: undefined,
      ORION_TOKEN_JWKS_URL: undefined,
    },
    { TELUNI_PUBLIC_ORIGIN: "http://example.test" },
    { TELUNI_PUBLIC_ORIGIN: "http://127.0.0.1:5173/panel" },
    { TELUNI_PUBLIC_ORIGIN: "https://user@app.example.test" },
    { TELUNI_SESSION_KEYS: "k1:short" },
    { TELUNI_SESSION_KEYS: `k1:${key},k1:${key}` },
    { TELUNI_OIDC_CLIENT_SECRET: "short" },
  ])("rejects incomplete or unsafe human identity settings %#", (change) => {
    const env: Record<string, string | undefined> = { ...complete, ...change };
    for (const [name, value] of Object.entries(env))
      if (value === undefined) delete env[name];
    expect(() => parseServerConfig(env)).toThrow("Invalid API configuration");
  });

  it("requires an HTTPS public origin in production", () => {
    expect(() =>
      parseServerConfig({
        ...complete,
        ORION_ENV: "production",
        ORION_TOKEN_ISSUER: "https://id.example.test/realms/teluni",
        ORION_TOKEN_JWKS_URL:
          "https://id.example.test/realms/teluni/protocol/openid-connect/certs",
      }),
    ).toThrow("public origin");
    expect(
      parseServerConfig({
        ...complete,
        ORION_ENV: "production",
        ORION_TOKEN_ISSUER: "https://id.example.test/realms/teluni",
        ORION_TOKEN_JWKS_URL:
          "https://id.example.test/realms/teluni/protocol/openid-connect/certs",
        TELUNI_PUBLIC_ORIGIN: "https://app.example.test",
      }).publicOrigin,
    ).toBe("https://app.example.test");
  });
});

describe("transactional mail configuration", () => {
  const key = Buffer.alloc(32, 9).toString("base64url");
  const identity = {
    ORION_ENV: "test",
    ORION_TOKEN_ISSUER: "http://localhost:8080/realms/teluni",
    ORION_TOKEN_AUDIENCE: "teluni-api",
    ORION_TOKEN_JWKS_URL:
      "http://localhost:8080/realms/teluni/protocol/openid-connect/certs",
    TELUNI_PUBLIC_ORIGIN: "http://127.0.0.1:5173",
    TELUNI_OIDC_CLIENT_ID: "teluni-web",
    TELUNI_OIDC_CLIENT_SECRET: "synthetic-client-secret",
    TELUNI_IDENTITY_PROVISIONER_CLIENT_ID: "teluni-provisioner",
    TELUNI_IDENTITY_PROVISIONER_CLIENT_SECRET: "synthetic-provisioner-secret",
    TELUNI_SESSION_KEYS: `k1:${Buffer.alloc(32, 1).toString("base64url")}`,
  };
  const mail = {
    TELUNI_MAIL_SMTP_HOST: "127.0.0.1",
    TELUNI_MAIL_SMTP_PORT: "1025",
    TELUNI_MAIL_SMTP_SECURITY: "none",
    TELUNI_MAIL_FROM: "no-reply@teluni.test",
    TELUNI_MAIL_KEYS: `m1:${key}`,
  };

  it("accepts a loopback test sink and keeps mail optional", () => {
    expect(parseServerConfig({ ...identity, ...mail })).toMatchObject({
      mailSmtpHost: "127.0.0.1",
      mailSmtpPort: 1025,
      mailSmtpSecurity: "none",
    });
    expect(parseServerConfig(identity)).toMatchObject({
      mailSmtpPort: 587,
      mailSmtpSecurity: "starttls",
    });
    expect(parseServerConfig(identity).mailKeys).toBeUndefined();
  });

  it.each([
    { TELUNI_MAIL_FROM: undefined },
    { TELUNI_MAIL_KEYS: undefined },
    { TELUNI_PUBLIC_ORIGIN: undefined },
    { TELUNI_MAIL_FROM: "Teluni <no-reply@teluni.test>" },
    { TELUNI_MAIL_KEYS: "m1:short" },
    { TELUNI_MAIL_SMTP_USERNAME: "relay-user" },
    { TELUNI_MAIL_SMTP_PASSWORD: "relay-secret" },
    { TELUNI_MAIL_SMTP_HOST: "smtp.example.test" },
    { TELUNI_MAIL_SMTP_SECURITY: "plain" },
    { TELUNI_MAIL_SMTP_PORT: "0" },
  ])("rejects incomplete or unsafe mail settings %#", (change) => {
    const env: Record<string, string | undefined> = {
      ...identity,
      ...mail,
      ...change,
    };
    for (const [name, value] of Object.entries(env))
      if (value === undefined) delete env[name];
    expect(() => parseServerConfig(env)).toThrow("Invalid API configuration");
  });

  it("requires TLS to the relay in production", () => {
    const production = {
      ...identity,
      ...mail,
      ORION_ENV: "production",
      ORION_TOKEN_ISSUER: "https://id.example.test/realms/teluni",
      ORION_TOKEN_JWKS_URL:
        "https://id.example.test/realms/teluni/protocol/openid-connect/certs",
      TELUNI_PUBLIC_ORIGIN: "https://app.example.test",
    };
    expect(() => parseServerConfig(production)).toThrow(
      "mail transport security",
    );
    expect(
      parseServerConfig({
        ...production,
        TELUNI_MAIL_SMTP_HOST: "smtp.example.test",
        TELUNI_MAIL_SMTP_PORT: "465",
        TELUNI_MAIL_SMTP_SECURITY: "tls",
        TELUNI_MAIL_SMTP_USERNAME: "relay-user",
        TELUNI_MAIL_SMTP_PASSWORD: "relay-secret",
      }).mailSmtpSecurity,
    ).toBe("tls");
  });
});
