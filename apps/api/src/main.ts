import {
  parseKeyRing,
  parseServerConfig,
  parseSessionKeys,
  parseSigningKeyRing,
} from "./config.js";
import { createLogger } from "./logging.js";
import { errorDiagnostics } from "./error-diagnostics.js";
import { shutdownRuntime, withDeadline } from "./lifecycle.js";
import { initializeTelemetry } from "./telemetry.js";
import { serviceName } from "./service-identity.js";

let logger: ReturnType<typeof createLogger> | undefined;
let cleanup: (() => Promise<void>) | undefined;
let startupPhase = "configuration";

try {
  const config = parseServerConfig(process.env);
  startupPhase = "observability";
  logger = createLogger(config);
  const telemetry = initializeTelemetry(config, logger);
  cleanup = () => withDeadline(telemetry.shutdown(), config.shutdownTimeoutMs);
  startupPhase = "composition";
  // Load Fastify, Prisma, and modules only after instrumentation is registered.
  const { createApp } = await import("./app.js");
  const { createDatabase, checkDatabase } = await import("./database.js");
  const { createAccessTokenVerifier } = await import("./authentication.js");
  const { activateModules } = await import("./module.js");
  const { apiModules } = await import("./modules.js");
  const database = config.databaseUrl
    ? createDatabase(config.databaseUrl)
    : undefined;
  const resources = {
    shutdown: async () => {
      // Neither resource may prevent the other from starting its cleanup.
      const results = await Promise.allSettled([
        database?.$disconnect(),
        telemetry.shutdown(),
      ]);
      if (results.some((result) => result.status === "rejected"))
        throw new Error("Runtime cleanup failed");
    },
  };
  cleanup = () => withDeadline(resources.shutdown(), config.shutdownTimeoutMs);
  const verifier =
    config.tokenIssuer && config.tokenAudience && config.tokenJwksUrl
      ? createAccessTokenVerifier({
          issuer: config.tokenIssuer,
          audience: config.tokenAudience,
          jwksUrl: config.tokenJwksUrl,
        })
      : undefined;
  // parseServerConfig guarantees these settings are complete or all absent.
  const humanIdentity = config.sessionKeys
    ? {
        environment: config.environment,
        issuer: config.tokenIssuer!,
        publicOrigin: config.publicOrigin!,
        clientId: config.oidcClientId!,
        clientSecret: config.oidcClientSecret!,
        provisionerClientId: config.provisionerClientId!,
        provisionerClientSecret: config.provisionerClientSecret!,
        ...(config.keycloakAdminUrl === undefined
          ? {}
          : { keycloakAdminUrl: config.keycloakAdminUrl }),
        sessionKeys: parseSessionKeys(config.sessionKeys),
      }
    : undefined;
  const mail = config.mailKeys
    ? {
        environment: config.environment,
        publicOrigin: config.publicOrigin!,
        smtp: {
          host: config.mailSmtpHost!,
          port: config.mailSmtpPort,
          security: config.mailSmtpSecurity,
          ...(config.mailSmtpUsername
            ? {
                username: config.mailSmtpUsername,
                password: config.mailSmtpPassword!,
              }
            : {}),
        },
        from: config.mailFrom!,
        keys: parseKeyRing(config.mailKeys, "mail keys"),
      }
    : undefined;
  const deviceEnrollment = config.deviceCodeKeys
    ? { codeKeys: parseKeyRing(config.deviceCodeKeys, "device code keys") }
    : undefined;
  const mediaStorage = config.mediaStoragePath
    ? {
        environment: config.environment,
        root: config.mediaStoragePath,
        ffmpegPath: config.mediaFfmpegPath,
        ffprobePath: config.mediaFfprobePath,
        concurrency: config.mediaProcessingConcurrency,
      }
    : undefined;
  const syncSigning = config.syncSigningKeys
    ? { keys: parseSigningKeyRing(config.syncSigningKeys) }
    : undefined;
  const modules = activateModules(
    apiModules,
    {
      database,
      verifier,
      humanIdentity,
      mail,
      deviceEnrollment,
      mediaStorage,
      syncSigning,
    },
    config.environment,
  );
  const { app, lifecycle } = createApp(logger, undefined, {
    modules,
    trustedProxies: config.trustedProxies,
    ...(database ? { checkReady: () => checkDatabase(database) } : {}),
  });
  const runtimeLogger = logger;
  cleanup = () =>
    shutdownRuntime(
      app,
      lifecycle,
      resources,
      config.shutdownTimeoutMs,
      (boundary) =>
        runtimeLogger.warn({ boundary }, "shutdown_deadline_exceeded"),
    );
  const close = cleanup;
  let shuttingDown = false;
  async function shutdown(signal: string): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    runtimeLogger.info({ signal }, "shutdown_started");
    await close();
    process.exitCode = 0;
  }
  process.once("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.once("SIGTERM", () => {
    void shutdown("SIGTERM");
  });

  startupPhase = "database";
  if (database) await checkDatabase(database);
  startupPhase = "listen";
  await app.listen({ host: config.host, port: config.port });
  lifecycle.markReady();
  logger.info({ address: app.server.address() }, "api_ready");
} catch (error) {
  const diagnostic = { startupPhase, diagnostic: errorDiagnostics(error) };
  if (logger) logger.fatal(diagnostic, "api_startup_failed");
  else {
    // Configuration or logger initialization may fail before Pino exists.
    // This fixed projection must never include the raw environment/exception.
    process.stderr.write(
      `${JSON.stringify({
        level: 60,
        service: serviceName,
        msg: "api_startup_failed",
        ...diagnostic,
      })}\n`,
    );
  }
  try {
    await cleanup?.();
  } catch {
    logger?.warn("startup_cleanup_failed");
  }
  process.exitCode = 1;
}
