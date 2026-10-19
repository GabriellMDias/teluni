import { spawn, execFile, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { createServer as createNetServer } from "node:net";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import pg from "pg";
import { GenericContainer, Wait } from "testcontainers";

// Disposable local services shared by browser journeys and manual workflows.
// Nothing here is a deployment, persistent database, or real identity provider.
const run = promisify(execFile);
const webRoot = resolve(import.meta.dirname, "../..");
const repoRoot = resolve(webRoot, "../..");
const apiRoot = resolve(repoRoot, "apps/api");

export type Stoppable = { stop(): Promise<void> };

export async function freePort() {
  const listener = createNetServer();
  await new Promise<void>((ready) => listener.listen(0, "127.0.0.1", ready));
  const address = listener.address();
  if (!address || typeof address === "string")
    throw new Error("No available test port.");
  await new Promise<void>((done) => listener.close(() => done()));
  return address.port;
}

export function watchService(
  name: string,
  child: ChildProcess,
  secrets: readonly string[],
) {
  let diagnostics = "";
  let failure: Error | undefined;
  let onFailure: ((error: Error) => void) | undefined;
  function append(chunk: Buffer) {
    diagnostics = (diagnostics + chunk.toString()).slice(-8_000);
  }
  function safeDiagnostics() {
    let safeOutput = diagnostics;
    for (const secret of secrets)
      if (secret) safeOutput = safeOutput.replaceAll(secret, "[redacted]");
    return safeOutput
      .replace(/postgres(?:ql)?:\/\/\S+/gi, "[redacted database URL]")
      .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
      .replace(
        /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
        "[redacted token]",
      );
  }
  function fail(reason: string) {
    if (failure) return;
    const safeOutput = safeDiagnostics();
    failure = new Error(
      `${name} ${reason}${safeOutput ? `\nRecent output:\n${safeOutput}` : ""}`,
    );
    onFailure?.(failure);
  }
  child.stdout?.on("data", append);
  child.stderr?.on("data", append);
  child.once("error", (error) => fail(`failed to start: ${error.message}`));
  child.once("close", (code, signal) =>
    fail(`exited (code ${code ?? "none"}, signal ${signal ?? "none"})`),
  );
  return {
    get failure() {
      return failure;
    },
    safeDiagnostics,
    onFailure(callback: (error: Error) => void) {
      onFailure = callback;
      if (failure) callback(failure);
    },
  };
}
export type WatchedService = ReturnType<typeof watchService>;

export async function waitFor(url: string, service: WatchedService) {
  for (let attempt = 0; attempt < 300; attempt++) {
    if (service.failure) throw service.failure;
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return;
    } catch {
      /* Service startup is still in progress. */
    }
    await new Promise((done) => setTimeout(done, 200));
  }
  throw new Error(
    `Timed out waiting for ${new URL(url).pathname}${service.safeDiagnostics() ? `\nRecent output:\n${service.safeDiagnostics()}` : ""}`,
  );
}

/**
 * A migrated PostgreSQL container with a separate restricted runtime role.
 * Runtime grants come from apps/api/prisma/runtime-grants/*.sql.
 */
export async function startDatabase(): Promise<
  Stoppable & { migrationUrl: string; runtimeUrl: string }
> {
  const container = await new GenericContainer("postgres:16")
    .withEnvironment({
      POSTGRES_USER: "postgres",
      POSTGRES_PASSWORD: "test",
      POSTGRES_DB: "orion",
    })
    .withExposedPorts(5432)
    .withWaitStrategy(
      Wait.forLogMessage("database system is ready to accept connections", 2),
    )
    .start();
  try {
    const host = container.getHost();
    const port = container.getMappedPort(5432);
    const migrationUrl = `postgresql://postgres:test@${host}:${port}/orion`;
    const runtimeUrl = `postgresql://orion_runtime:runtime_test@${host}:${port}/orion`;
    await run(
      process.execPath,
      [
        resolve(apiRoot, "node_modules/prisma/build/index.js"),
        "migrate",
        "deploy",
      ],
      {
        cwd: apiRoot,
        env: { ...process.env, ORION_MIGRATION_DATABASE_URL: migrationUrl },
        timeout: 90_000,
      },
    );
    const admin = new pg.Client({ connectionString: migrationUrl });
    await admin.connect();
    try {
      await admin.query(
        "CREATE ROLE orion_runtime LOGIN PASSWORD 'runtime_test'",
      );
      await admin.query("GRANT USAGE ON SCHEMA public TO orion_runtime");
      const grants = resolve(apiRoot, "prisma/runtime-grants");
      const files = await readdir(grants).catch(() => [] as string[]);
      for (const file of files.filter((name) => name.endsWith(".sql")).sort())
        for (const statement of (await readFile(resolve(grants, file), "utf8"))
          .replace(/--[^\n]*/g, "")
          .split(";")
          .map((item) => item.trim())
          .filter(Boolean))
          await admin.query(statement);
    } finally {
      await admin.end();
    }
    return {
      migrationUrl,
      runtimeUrl,
      stop: async () => {
        await container.stop();
      },
    };
  } catch (error) {
    await container.stop();
    throw error;
  }
}

/**
 * A loopback JWKS issuer that signs synthetic access tokens. Named identities
 * can also be fetched by the development web proxy from `browserOrigin` only.
 */
export async function startIssuer({
  identities,
  browserOrigin,
  tokenLifetime = "15m",
  audience = "local-api",
}: {
  identities: Readonly<Record<string, { scope: string }>>;
  browserOrigin?: string;
  tokenLifetime?: string;
  audience?: string;
}): Promise<
  Stoppable & {
    url: string;
    issuer: string;
    audience: string;
    jwksUrl: string;
    tokens: Readonly<Record<string, string>>;
  }
> {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = await exportJWK(publicKey);
  const issuer = "https://synthetic-local-issuer.example.test/";
  const tokens: Record<string, string> = {};
  for (const [name, { scope }] of Object.entries(identities)) {
    const id = randomUUID();
    tokens[name] = await new SignJWT({
      sub: `synthetic-${id}`,
      orion_principal_id: id,
      orion_actor_type: "human",
      scope,
    })
      .setProtectedHeader({ alg: "RS256", typ: "at+jwt", kid: "local" })
      .setIssuer(issuer)
      .setAudience(audience)
      .setIssuedAt()
      .setExpirationTime(tokenLifetime)
      .sign(privateKey);
  }
  const server: Server = createServer((request, response) => {
    response.setHeader("content-type", "application/json");
    response.setHeader("cache-control", "no-store");
    response.setHeader("x-content-type-options", "nosniff");
    const identity = /^\/local-identity\/([a-z][a-z0-9-]*)$/.exec(
      request.url ?? "",
    )?.[1];
    if (request.method === "GET" && request.url === "/jwks") {
      response.end(
        JSON.stringify({
          keys: [{ ...jwk, alg: "RS256", kid: "local", use: "sig" }],
        }),
      );
    } else if (
      request.method === "GET" &&
      request.url === "/local-identity/available"
    ) {
      response.end(JSON.stringify({ available: browserOrigin !== undefined }));
    } else if (
      request.method === "POST" &&
      identity !== undefined &&
      identity in tokens
    ) {
      if (!browserOrigin || request.headers.origin !== browserOrigin) {
        response.statusCode = 403;
        response.end(JSON.stringify({ error: "Forbidden" }));
        return;
      }
      response.end(JSON.stringify({ accessToken: tokens[identity] }));
    } else {
      response.statusCode = 404;
      response.end(JSON.stringify({ error: "Not found" }));
    }
  });
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("No local issuer port.");
  const url = `http://127.0.0.1:${address.port}`;
  return {
    url,
    issuer,
    audience,
    jwksUrl: `${url}/jwks`,
    tokens,
    stop: () =>
      new Promise<void>((done, fail) =>
        server.close((error) => (error ? fail(error) : done())),
      ),
  };
}

/** Starts the emitted API (`pnpm build` first) with the given environment. */
export async function startApi({
  environment = "test",
  env = {},
  secrets = [],
  port: requestedPort,
}: {
  environment?: "development" | "test";
  env?: Readonly<Record<string, string>>;
  secrets?: readonly string[];
  /** A port chosen in advance, for example one an identity provider calls back. */
  port?: number;
} = {}): Promise<
  Stoppable & { url: string; child: ChildProcess; service: WatchedService }
> {
  const port = requestedPort ?? (await freePort());
  const child = spawn(process.execPath, [resolve(apiRoot, "dist/main.js")], {
    cwd: apiRoot,
    env: {
      ...process.env,
      ...env,
      ORION_ENV: environment,
      ORION_API_PORT: String(port),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const service = watchService("API", child, secrets);
  const url = `http://127.0.0.1:${port}`;
  const stop = () => stopProcess(child);
  try {
    await waitFor(`${url}/health/ready`, service);
  } catch (error) {
    await stop();
    throw error;
  }
  return { url, child, service, stop };
}

/** Starts the Vite web app proxying `/api` (and optional local identities). */
export async function startWeb({
  apiUrl,
  identityUrl,
  port,
  secrets = [],
}: {
  apiUrl: string;
  identityUrl?: string;
  port?: number;
  secrets?: readonly string[];
}): Promise<
  Stoppable & { url: string; child: ChildProcess; service: WatchedService }
> {
  const webPort = port ?? (await freePort());
  const child = spawn(
    process.execPath,
    [
      resolve(webRoot, "node_modules/vite/bin/vite.js"),
      "--host",
      "127.0.0.1",
      "--port",
      String(webPort),
      "--strictPort",
    ],
    {
      cwd: webRoot,
      env: {
        ...process.env,
        ORION_WEB_API_TARGET: apiUrl,
        ...(identityUrl
          ? { ORION_WEB_LOCAL_IDENTITY_TARGET: identityUrl }
          : {}),
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const service = watchService("Web", child, secrets);
  const url = `http://127.0.0.1:${webPort}`;
  const stop = () => stopProcess(child);
  try {
    await waitFor(`${url}/`, service);
  } catch (error) {
    await stop();
    throw error;
  }
  return { url, child, service, stop };
}

/** Terminates a child process and resolves once it has exited. */
function stopProcess(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }
    child.once("exit", () => resolve());
    child.kill();
  });
}

/** Stops every resource even when one fails, reporting all failures. */
export async function stopAll(resources: readonly (Stoppable | undefined)[]) {
  const results = await Promise.allSettled(
    resources.map((resource) => resource?.stop() ?? Promise.resolve()),
  );
  const failures = results.flatMap((result) =>
    result.status === "rejected" ? [result.reason as unknown] : [],
  );
  if (failures.length)
    throw new AggregateError(failures, "Local resource cleanup failed.");
}
