import { execFileSync, spawnSync } from "node:child_process";
import { generateKeyPairSync, randomBytes, randomUUID } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statfsSync,
  writeFileSync,
} from "node:fs";
import { isIP } from "node:net";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { setTimeout } from "node:timers/promises";
import { URL, fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const profile = join(repository, "infra/presentation");
const caPath = "/data/caddy/pki/authorities/local/root.crt";
const privateMode = 0o600;
class PresentationError extends Error {}

export function originFrom(value) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.origin !== value ||
    url.port ||
    isIP(url.hostname) !== 0 ||
    !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9-]+$/.test(url.hostname)
  )
    throw new PresentationError(
      "Use an HTTPS origin with a DNS hostname, no port, credentials, path, query or fragment.",
    );
  return url;
}

function privateFile(path, value) {
  writeFileSync(path, value, { flag: "wx", mode: privateMode, flush: true });
}
function envText(values) {
  return (
    Object.entries(values)
      .map(([key, value]) => `${key}=${JSON.stringify(String(value))}`)
      .join("\n") + "\n"
  );
}
function secret() {
  return randomBytes(32).toString("base64url");
}
function keyRing(id) {
  return `${id}:${secret()}`;
}

export function initialize(
  directory,
  origin,
  port = 18443,
  release = "presentation",
) {
  const url = originFrom(origin);
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw new PresentationError(
      "The loopback port must be between 1024 and 65535.",
    );
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(release))
    throw new PresentationError("Invalid release identifier.");
  if (!isAbsolute(directory) || /[\r\n$]/.test(directory))
    throw new PresentationError(
      "Use an absolute configuration path without line breaks or dollar signs.",
    );
  directory = join(
    realpathSync(dirname(directory)),
    directory.split("/").at(-1),
  );
  const inRepository = relative(repository, directory);
  if (!inRepository.startsWith("..") && !isAbsolute(inRepository))
    throw new PresentationError(
      "Configuration must stay outside the repository and Docker build context.",
    );
  // No recursive mkdir or overwrite: an existing installation and symlinks
  // must never be replaced, including after an interrupted initialization.
  mkdirSync(directory, { mode: 0o700 });
  try {
    mkdirSync(join(directory, "certificates"), { mode: 0o755 });
    const password = {
      postgres: secret(),
      owner: secret(),
      runtime: secret(),
      keycloak: secret(),
      admin: secret(),
      web: secret(),
      provisioner: secret(),
      smtp: secret(),
    };
    const installation = randomUUID();
    const metadata = {
      version: 1,
      installation,
      origin,
      port,
      release,
      project: `teluni-presentation-${installation.slice(0, 8)}`,
    };
    const smtp = {
      TELUNI_MAIL_SMTP_HOST: "mailpit",
      TELUNI_MAIL_SMTP_PORT: 1025,
      TELUNI_MAIL_SMTP_SECURITY: "starttls",
      TELUNI_MAIL_SMTP_USERNAME: "teluni",
      TELUNI_MAIL_SMTP_PASSWORD: password.smtp,
      TELUNI_MAIL_FROM: "no-reply@example.test",
    };
    const { privateKey } = generateKeyPairSync("ec", {
      namedCurve: "prime256v1",
    });
    const signingKey = privateKey
      .export({ type: "pkcs8", format: "der" })
      .toString("base64url");
    privateFile(
      join(directory, "compose.env"),
      envText({
        TELUNI_CONFIG_DIR: directory,
        TELUNI_APP_HOST: url.hostname,
        // Compose interpolates the entire imported pilot file. These two
        // unused values satisfy it; the origin uses internal TLS and no apex.
        TELUNI_AUTH_HOST: url.hostname,
        TELUNI_APEX_HOST: "unused.invalid",
        TELUNI_ACME_EMAIL: "unused@example.invalid",
        TELUNI_RELEASE: release,
        TELUNI_PRESENTATION_PROJECT: metadata.project,
        TELUNI_PRESENTATION_PORT: port,
      }),
    );
    privateFile(
      join(directory, "postgres.env"),
      envText({
        POSTGRES_PASSWORD: password.postgres,
        TELUNI_DB_OWNER_PASSWORD: password.owner,
        TELUNI_DB_RUNTIME_PASSWORD: password.runtime,
        KEYCLOAK_DB_PASSWORD: password.keycloak,
      }),
    );
    privateFile(
      join(directory, "keycloak.env"),
      envText({
        KC_DB_PASSWORD: password.keycloak,
        KC_BOOTSTRAP_ADMIN_USERNAME: "bootstrap-admin",
        KC_BOOTSTRAP_ADMIN_PASSWORD: password.admin,
      }),
    );
    privateFile(
      join(directory, "release.env"),
      envText({
        ORION_MIGRATION_DATABASE_URL: `postgresql://teluni_owner:${password.owner}@postgres:5432/teluni`,
        TELUNI_KEYCLOAK_ADMIN_URL: "http://keycloak:8080/identity",
        TELUNI_KEYCLOAK_ADMIN_USERNAME: "bootstrap-admin",
        TELUNI_KEYCLOAK_ADMIN_PASSWORD: password.admin,
        TELUNI_PUBLIC_ORIGIN: origin,
        ORION_TOKEN_AUDIENCE: "teluni-api",
        TELUNI_OIDC_CLIENT_SECRET: password.web,
        TELUNI_IDENTITY_PROVISIONER_CLIENT_SECRET: password.provisioner,
        ...smtp,
      }),
    );
    privateFile(
      join(directory, "api.env"),
      envText({
        ORION_ENV: "production",
        ORION_DATABASE_URL: `postgresql://orion_runtime:${password.runtime}@postgres:5432/teluni`,
        ORION_TOKEN_ISSUER: `${origin}/identity/realms/teluni`,
        ORION_TOKEN_JWKS_URL: `${origin}/identity/realms/teluni/protocol/openid-connect/certs`,
        ORION_TOKEN_AUDIENCE: "teluni-api",
        TELUNI_PUBLIC_ORIGIN: origin,
        TELUNI_OIDC_CLIENT_ID: "teluni-web",
        TELUNI_OIDC_CLIENT_SECRET: password.web,
        TELUNI_IDENTITY_PROVISIONER_CLIENT_ID: "teluni-provisioner",
        TELUNI_IDENTITY_PROVISIONER_CLIENT_SECRET: password.provisioner,
        TELUNI_SESSION_KEYS: keyRing("s1"),
        TELUNI_MAIL_KEYS: keyRing("m1"),
        TELUNI_DEVICE_CODE_KEYS: keyRing("d1"),
        TELUNI_SYNC_SIGNING_KEYS: `k1:${signingKey}`,
        ...smtp,
      }),
    );
    privateFile(
      join(directory, "mailpit.env"),
      envText({ MP_SMTP_AUTH: `teluni:${password.smtp}` }),
    );
    privateFile(
      join(directory, "operator.env"),
      envText({
        TELUNI_PRESENTATION_USERNAME: "presenter@example.test",
        TELUNI_PRESENTATION_PASSWORD: `Synthetic-${secret()}`,
        TELUNI_PRESENTATION_INSTALLATION: installation,
      }),
    );
    // Only filenames and public certificate subject/SAN reach argv. OpenSSL
    // diagnostics are captured; private key material is never printed.
    execFileSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:3072",
        "-noenc",
        "-sha256",
        "-days",
        "365",
        "-subj",
        "/CN=mailpit",
        "-addext",
        "subjectAltName=DNS:mailpit",
        "-keyout",
        join(directory, "mailpit.key"),
        "-out",
        join(directory, "certificates/mailpit.crt"),
      ],
      { stdio: "pipe" },
    );
    chmodSync(join(directory, "mailpit.key"), privateMode);
    privateFile(
      join(directory, "installation.json"),
      JSON.stringify(metadata, null, 2) + "\n",
    );
    return metadata;
  } catch {
    rmSync(directory, { recursive: true, force: true });
    throw new PresentationError(
      "Initialization failed; no existing installation was changed. Check OpenSSL and directory access.",
    );
  }
}

export function loadInstallation(directory) {
  const info = lstatSync(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || info.mode & 0o077)
    throw new PresentationError(
      "The installation must be a private, real directory (mode 0700).",
    );
  for (const file of [
    "installation.json",
    "compose.env",
    "postgres.env",
    "keycloak.env",
    "release.env",
    "api.env",
    "operator.env",
    "mailpit.env",
    "mailpit.key",
  ]) {
    const entry = lstatSync(join(directory, file));
    if (!entry.isFile() || entry.isSymbolicLink() || entry.mode & 0o077)
      throw new PresentationError(
        "Installation files must be private regular files (mode 0600).",
      );
  }
  const metadata = JSON.parse(
    readFileSync(join(directory, "installation.json"), "utf8"),
  );
  originFrom(metadata.origin);
  if (
    metadata.version !== 1 ||
    !/^teluni-presentation-[a-f0-9]{8}$/.test(metadata.project) ||
    !Number.isInteger(metadata.port) ||
    metadata.port < 1024 ||
    metadata.port > 65535 ||
    (metadata.operatorId !== undefined &&
      !/^[a-f0-9-]{36}$/.test(metadata.operatorId))
  )
    throw new PresentationError("Invalid installation metadata.");
  const env = parseEnv(readFileSync(join(directory, "compose.env"), "utf8"));
  if (
    env.TELUNI_CONFIG_DIR !== realpathSync(directory) ||
    env.TELUNI_PRESENTATION_PROJECT !== metadata.project ||
    env.TELUNI_APP_HOST !== new URL(metadata.origin).hostname ||
    env.TELUNI_PRESENTATION_PORT !== String(metadata.port) ||
    env.TELUNI_RELEASE !== metadata.release
  )
    throw new PresentationError(
      "Installation metadata and Compose configuration disagree.",
    );
  return { metadata, env };
}

export function composeArgs(directory, args) {
  const { metadata } = loadInstallation(directory);
  return [
    "compose",
    "--project-directory",
    profile,
    "--file",
    join(profile, "compose.yaml"),
    "--env-file",
    join(directory, "compose.env"),
    "--project-name",
    metadata.project,
    ...args,
  ];
}
function compose(directory, args, capture = false, allowFailure = false) {
  const { env } = loadInstallation(directory);
  const result = spawnSync("docker", composeArgs(directory, args), {
    env: { ...process.env, ...env },
    stdio: capture ? "pipe" : "inherit",
    encoding: "utf8",
  });
  if (allowFailure && (result.error || result.status !== 0)) return "";
  if (result.error || result.status !== 0)
    throw new PresentationError(
      "Docker Compose failed. The installation and durable volumes were preserved.",
    );
  return result.stdout ?? "";
}

export function tunnelSettings(directory) {
  const { metadata } = loadInstallation(directory);
  return {
    hostname: new URL(metadata.origin).hostname,
    service: `https://localhost:${metadata.port}`,
    originRequest: {
      originServerName: new URL(metadata.origin).hostname,
      httpHostHeader: new URL(metadata.origin).hostname,
      caPool: join(realpathSync(directory), "certificates/origin-ca.crt"),
      noTLSVerify: false,
    },
  };
}

async function main(args) {
  const [command, directory, ...options] = args;
  if (command === "help" || !command) {
    process.stdout
      .write(`Synthetic-data presentation only. Requires Node.js 24.13+, OpenSSL and Docker Compose 2.24.4+.
Run from this checkout, using a private configuration directory outside it:
  node tooling/deployment/presentation.mjs init /etc/teluni-presentation https://YOUR_HOST [18443] [RELEASE_ID]
  node tooling/deployment/presentation.mjs up /etc/teluni-presentation
  node tooling/deployment/presentation.mjs check /etc/teluni-presentation
  node tooling/deployment/presentation.mjs tunnel /etc/teluni-presentation
  node tooling/deployment/presentation.mjs status /etc/teluni-presentation
  node tooling/deployment/presentation.mjs down /etc/teluni-presentation
Use a root-owned configuration directory on the server. Init refuses to overwrite it. Up applies reviewed migrations and provisions the realm and a fictitious account, with public signup disabled. Credentials remain in operator.env; MFA is enrolled through the normal panel flow. The private inbox never sends external mail. Down preserves all volumes.
Tunnel prints one origin route to add to the EXISTING connector. Keep certificate verification enabled, make caPool readable by that connector, bypass edge cache for /api/* and /identity/*, and leave player routes free of browser-only challenges/Access login. The player endpoint is the public origin plus /api.
Use images and catalogs for this restricted presentation: public Tunnel upload/video limits still apply. Real-customer operation follows infra/pilot and its independent readiness gates.
`);
    return;
  }
  if (!directory || !isAbsolute(directory))
    throw new PresentationError(
      "An absolute installation directory is required.",
    );
  if (command === "init") {
    if (!options[0] || options.length > 3)
      throw new PresentationError(
        "Init requires an HTTPS origin, optional port and release identifier.",
      );
    initialize(
      directory,
      options[0],
      options[1] === undefined ? 18443 : Number(options[1]),
      options[2],
    );
    process.stdout.write(
      "Private installation configuration created. Credentials were not printed.\n",
    );
    return;
  }
  if (options.length)
    throw new PresentationError("Unexpected command arguments.");
  const { metadata } = loadInstallation(directory);
  if (command === "tunnel") {
    if (!existsSync(join(directory, "certificates/origin-ca.crt")))
      throw new PresentationError(
        "Start the installation before exporting its tunnel route.",
      );
    process.stdout.write(
      JSON.stringify(tunnelSettings(directory), null, 2) + "\n",
    );
  } else if (command === "status") compose(directory, ["ps"]);
  else if (command === "down") compose(directory, ["down"]);
  else if (command === "check") {
    if (!metadata.operatorId)
      throw new PresentationError("Run up before qualifying the installation.");
    for (const option of [[], [`--operator=${metadata.operatorId}`]])
      compose(directory, [
        "run",
        "--rm",
        "--no-deps",
        "--entrypoint",
        "node",
        "release",
        "--import",
        "tsx",
        "test/identity/pilot-check.ts",
        ...option,
      ]);
    compose(directory, [
      "run",
      "--rm",
      "--no-deps",
      "--entrypoint",
      "node",
      "release",
      "--import",
      "tsx",
      "test/identity/presentation-check.ts",
    ]);
  } else if (command === "up") {
    compose(directory, ["config", "--quiet"]);
    // Fail before a large image build fills the daemon's filesystem. The
    // operator can relocate Docker storage; no host configuration is edited.
    const root = execFileSync(
      "docker",
      ["info", "--format", "{{.DockerRootDir}}"],
      { encoding: "utf8" },
    ).trim();
    const disk = statfsSync(root);
    if (disk.bavail * disk.bsize < 6 * 1024 ** 3)
      throw new PresentationError(
        "Docker needs at least 6 GiB free before building. Free or relocate its storage, then retry; no services were changed.",
      );
    compose(directory, ["build"]);
    compose(directory, ["up", "--detach", "--wait", "proxy"]);
    let ready = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      const result = compose(
        directory,
        [
          "exec",
          "-T",
          "proxy",
          "sh",
          "-c",
          `test -s ${caPath} && cat ${caPath}`,
        ],
        true,
        true,
      );
      if (result.includes("BEGIN CERTIFICATE")) {
        writeFileSync(join(directory, "certificates/origin-ca.crt"), result, {
          mode: 0o644,
        });
        const smtpCa = readFileSync(
          join(directory, "certificates/mailpit.crt"),
          "utf8",
        );
        writeFileSync(
          join(directory, "certificates/ca-bundle.pem"),
          result + smtpCa,
          { mode: 0o644 },
        );
        ready = true;
        break;
      }
      await setTimeout(1000);
    }
    if (!ready)
      throw new PresentationError(
        "Origin CA did not become ready; durable state was preserved.",
      );
    compose(directory, [
      "up",
      "--detach",
      "--wait",
      "--wait-timeout",
      "300",
      "postgres",
      "keycloak",
      "mailpit",
    ]);
    compose(directory, ["run", "--rm", "release", "realm"]);
    compose(directory, ["up", "--detach", "--wait", "--wait-timeout", "300"]);
    const seeded = compose(
      directory,
      [
        "run",
        "--rm",
        "--no-deps",
        "--entrypoint",
        "node",
        "release",
        "--import",
        "tsx",
        "scripts/presentation-user.ts",
        ...(metadata.operatorId ? [metadata.operatorId] : []),
      ],
      true,
    );
    const { operatorId } = JSON.parse(seeded);
    if (typeof operatorId !== "string" || !/^[a-f0-9-]{36}$/.test(operatorId))
      throw new PresentationError(
        "Invalid synthetic identity result; installation preserved.",
      );
    if (!metadata.operatorId) {
      // Commit ownership only after the provider confirms creation. A failed
      // or ambiguous first creation never overwrites an existing account.
      const pending = join(directory, `installation-${randomUUID()}.tmp`);
      privateFile(
        pending,
        JSON.stringify({ ...metadata, operatorId }, null, 2) + "\n",
      );
      renameSync(pending, join(directory, "installation.json"));
    }
    process.stdout.write(
      "Presentation services ready. Credentials remain in operator.env. Export the route with the tunnel command.\n",
    );
  } else throw new PresentationError("Unknown command. Use help.");
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main(process.argv.slice(2)).catch((error) => {
    // Errors from OpenSSL, Docker and filesystem operations can carry secret
    // environment values or buffers. The CLI never serializes them.
    process.stderr.write(
      error instanceof PresentationError
        ? error.message + "\n"
        : "Presentation command failed. Check the command, private configuration, Docker prerequisites and available space. Existing data was preserved.\n",
    );
    process.exitCode = 1;
  });
}
