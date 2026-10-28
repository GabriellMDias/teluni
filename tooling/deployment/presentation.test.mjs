import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { spawnSync } from "node:child_process";
import { createPrivateKey, X509Certificate } from "node:crypto";
import {
  chmodSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { URL, fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { test } from "node:test";
import { parseServerConfig } from "../../apps/api/src/config.ts";
import {
  composeArgs,
  initialize,
  loadInstallation,
  originFrom,
  tunnelSettings,
} from "./presentation.mjs";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
function fixture(run) {
  const parent = mkdtempSync(join(tmpdir(), "teluni-presentation-test-"));
  const directory = join(parent, "private configuration");
  try {
    return run(directory, parent);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
}
const env = (directory, name) =>
  parseEnv(readFileSync(join(directory, name), "utf8"));

test("generates private, schema-valid configuration with separate credentials and verified TLS", () =>
  fixture((directory) => {
    const metadata = initialize(directory, "https://demo.example.test");
    assert.equal(lstatSync(directory).mode & 0o777, 0o700);
    for (const file of [
      "api.env",
      "postgres.env",
      "release.env",
      "keycloak.env",
      "compose.env",
      "operator.env",
      "mailpit.env",
      "mailpit.key",
      "installation.json",
    ])
      assert.equal(lstatSync(join(directory, file)).mode & 0o777, 0o600);
    const api = env(directory, "api.env");
    const release = env(directory, "release.env");
    const postgres = env(directory, "postgres.env");
    const keycloak = env(directory, "keycloak.env");
    const parsed = parseServerConfig({
      ...api,
      TELUNI_KEYCLOAK_ADMIN_URL: "http://keycloak:8080/identity",
    });
    assert.equal(parsed.environment, "production");
    assert.equal(
      parsed.tokenIssuer,
      "https://demo.example.test/identity/realms/teluni",
    );
    assert.equal(parsed.mailSmtpSecurity, "starttls");
    assert.equal(
      api.TELUNI_OIDC_CLIENT_SECRET,
      release.TELUNI_OIDC_CLIENT_SECRET,
    );
    assert.equal(
      api.TELUNI_IDENTITY_PROVISIONER_CLIENT_SECRET,
      release.TELUNI_IDENTITY_PROVISIONER_CLIENT_SECRET,
    );
    assert.equal(keycloak.KC_DB_PASSWORD, postgres.KEYCLOAK_DB_PASSWORD);
    assert.equal(
      new URL(api.ORION_DATABASE_URL).password,
      postgres.TELUNI_DB_RUNTIME_PASSWORD,
    );
    assert.equal(
      new URL(release.ORION_MIGRATION_DATABASE_URL).password,
      postgres.TELUNI_DB_OWNER_PASSWORD,
    );
    assert.equal(new Set(Object.values(postgres)).size, 4);
    assert.equal(
      new Set([
        api.TELUNI_SESSION_KEYS.slice(3),
        api.TELUNI_MAIL_KEYS.slice(3),
        api.TELUNI_DEVICE_CODE_KEYS.slice(3),
      ]).size,
      3,
    );
    const key = createPrivateKey({
      key: Buffer.from(api.TELUNI_SYNC_SIGNING_KEYS.split(":")[1], "base64url"),
      type: "pkcs8",
      format: "der",
    });
    assert.equal(key.asymmetricKeyType, "ec");
    const cert = new X509Certificate(
      readFileSync(join(directory, "certificates/mailpit.crt")),
    );
    assert.equal(cert.checkHost("mailpit"), "mailpit");
    assert.equal(
      env(directory, "mailpit.env").MP_SMTP_AUTH,
      `teluni:${api.TELUNI_MAIL_SMTP_PASSWORD}`,
    );
    assert.equal(
      loadInstallation(directory).metadata.installation,
      metadata.installation,
    );
    const route = tunnelSettings(directory);
    assert.equal(route.service, "https://localhost:18443");
    assert.equal(route.originRequest.noTLSVerify, false);
    assert.equal(route.originRequest.originServerName, "demo.example.test");
    assert.equal(
      JSON.stringify(route).includes(api.TELUNI_OIDC_CLIENT_SECRET),
      false,
    );
  }));

test("refuses existing installations, symlinks, insecure permissions and inconsistent metadata", () =>
  fixture((directory, parent) => {
    initialize(directory, "https://demo.example.test");
    const original = readFileSync(join(directory, "api.env"));
    assert.throws(() => initialize(directory, "https://other.example.test"));
    assert.deepEqual(readFileSync(join(directory, "api.env")), original);
    const link = join(parent, "link");
    symlinkSync(directory, link);
    assert.throws(() => initialize(link, "https://demo.example.test"));
    assert.throws(() => loadInstallation(link));
    chmodSync(join(directory, "api.env"), 0o644);
    assert.throws(() => loadInstallation(directory), /private regular files/);
    chmodSync(join(directory, "api.env"), 0o600);
    writeFileSync(
      join(directory, "compose.env"),
      "TELUNI_CONFIG_DIR=/different\n",
    );
    assert.throws(() => loadInstallation(directory), /disagree/);
  }));

test("rejects unsafe origins, ports and output paths before writing secrets", () =>
  fixture((directory) => {
    for (const value of [
      "http://demo.test",
      "https://localhost",
      "https://127.0.0.1",
      "https://user:pass@demo.test",
      "https://demo.test/path",
      "https://demo.test/",
      "https://demo.test?",
      "https://demo.test#",
      "https://demo.test:8443",
      "https://demo.test\nanything",
    ])
      assert.throws(() => originFrom(value));
    for (const port of [0, 443, 65536, NaN, 1024.5])
      assert.throws(() =>
        initialize(directory, "https://demo.example.test", port),
      );
    assert.throws(
      () =>
        initialize(
          join(repository, "private-test-configuration"),
          "https://demo.example.test",
        ),
      /outside the repository/,
    );
    assert.throws(() => initialize("relative", "https://demo.example.test"));
  }));

test("the imported composition publishes only a loopback TLS origin and preserves runtime hardening", () =>
  fixture((directory) => {
    const metadata = initialize(directory, "https://demo.example.test", 19443);
    const result = spawnSync(
      "docker",
      composeArgs(directory, [
        "config",
        "--format",
        "json",
        "--no-env-resolution",
      ]),
      {
        env: { ...process.env, ...loadInstallation(directory).env },
        encoding: "utf8",
      },
    );
    assert.equal(result.status, 0, result.stderr);
    const configuration = JSON.parse(result.stdout);
    assert.equal(configuration.name, metadata.project);
    const { services } = configuration;
    for (const name of ["postgres", "keycloak", "api", "release", "mailpit"])
      assert.equal(
        services[name].ports?.length ?? 0,
        0,
        `${name} must stay private`,
      );
    assert.deepEqual(
      services.proxy.ports.map(({ host_ip, published, target }) => ({
        host_ip,
        published,
        target,
      })),
      [{ host_ip: "127.0.0.1", published: "19443", target: 443 }],
    );
    assert.equal(services.api.read_only, true);
    assert.equal(
      services.api.environment.TELUNI_KEYCLOAK_ADMIN_URL,
      "http://keycloak:8080/identity",
    );
    assert.equal(
      services.api.environment.TELUNI_TRUSTED_PROXIES,
      "172.30.20.2",
    );
    assert.equal(
      services.keycloak.environment.KC_HTTP_RELATIVE_PATH,
      "/identity",
    );
    assert.equal(
      services.keycloak.build.args.KEYCLOAK_HTTP_RELATIVE_PATH,
      "/identity",
    );
    assert.equal(
      services.keycloak.image,
      "teluni/keycloak:presentation-presentation",
    );
    assert.equal(
      configuration.networks.front.ipam.config[0].gateway,
      "172.30.20.1",
    );
    assert.equal(configuration.networks.back.internal, true);
    assert.equal(services.proxy.depends_on, undefined);
    assert.equal(services.api.build.context, repository);
    assert.equal(
      services.mailpit.image,
      /export const mailpitImage =\s*\n?\s*"([^"]+)"/.exec(
        readFileSync(join(repository, "apps/api/scripts/keycloak.ts"), "utf8"),
      )[1],
    );
  }));

test("CLI failure does not print credentials or replace an existing installation", () =>
  fixture((directory) => {
    initialize(directory, "https://demo.example.test");
    const before = readFileSync(join(directory, "operator.env"), "utf8");
    const result = spawnSync(
      process.execPath,
      [
        join(repository, "tooling/deployment/presentation.mjs"),
        "init",
        directory,
        "https://demo.example.test",
      ],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert(
      !result.stderr.includes(
        env(directory, "operator.env").TELUNI_PRESENTATION_PASSWORD,
      ),
    );
    assert.equal(readFileSync(join(directory, "operator.env"), "utf8"), before);
  }));
