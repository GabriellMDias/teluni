import { randomBytes } from "node:crypto";
import { GenericContainer, Wait, type StartedNetwork } from "testcontainers";

// Pinned by digest: the identity design qualifies this exact Keycloak build.
export const keycloakImage =
  "quay.io/keycloak/keycloak:26.8.1@sha256:79c623a22abacf3fe6c00a5fb30f5b7843d717b234033b80995891c06116d244";
export const mailpitImage =
  "axllent/mailpit:v1.31.3@sha256:ed9b00c609e77e99c79b93f1178255ebc271868920f2c69a8d166bd5634ed10d";

export type KeycloakAdmin = Readonly<{
  /** Base URL reachable from this process, without a trailing slash. */
  baseUrl: string;
  /** Calls the Admin REST API with a fresh master-realm administrator token. */
  request(method: string, path: string, body?: unknown): Promise<Response>;
}>;

/** Administrator access through the bootstrap account of a Keycloak server. */
export function keycloakAdmin(
  baseUrl: string,
  credentials: { username: string; password: string },
): KeycloakAdmin {
  async function token(): Promise<string> {
    const response = await fetch(
      `${baseUrl}/realms/master/protocol/openid-connect/token`,
      {
        method: "POST",
        body: new URLSearchParams({
          grant_type: "password",
          client_id: "admin-cli",
          username: credentials.username,
          password: credentials.password,
        }),
      },
    );
    if (!response.ok)
      throw new Error(
        `Keycloak administrator login failed: ${response.status}`,
      );
    return ((await response.json()) as { access_token: string }).access_token;
  }
  return {
    baseUrl,
    async request(method, path, body) {
      return fetch(`${baseUrl}/admin${path}`, {
        method,
        headers: {
          authorization: `Bearer ${await token()}`,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    },
  };
}

/**
 * Starts a disposable development-mode Keycloak with a random bootstrap
 * administrator. Only synthetic test realms and users may be created in it.
 */
export async function withKeycloak<T>(
  work: (admin: KeycloakAdmin) => Promise<T>,
  options: { network?: StartedNetwork; alias?: string } = {},
): Promise<T> {
  const password = randomBytes(18).toString("base64url");
  let container = new GenericContainer(keycloakImage)
    .withCommand(["start-dev"])
    .withEnvironment({
      KC_BOOTSTRAP_ADMIN_USERNAME: "bootstrap-admin",
      KC_BOOTSTRAP_ADMIN_PASSWORD: password,
      KC_HEALTH_ENABLED: "true",
    })
    .withExposedPorts(8080, 9000)
    .withWaitStrategy(Wait.forHttp("/health/ready", 9000))
    .withStartupTimeout(180_000);
  if (options.network) {
    container = container.withNetwork(options.network);
    if (options.alias) container = container.withNetworkAliases(options.alias);
  }
  const started = await container.start();
  try {
    const baseUrl = `http://${started.getHost()}:${started.getMappedPort(8080)}`;
    return await work(
      keycloakAdmin(baseUrl, { username: "bootstrap-admin", password }),
    );
  } finally {
    await started.stop();
  }
}

/** Starts Mailpit as a local SMTP sink for verification and recovery mail. */
export async function withMailpit<T>(
  work: (mail: {
    smtpHost: string;
    smtpPort: number;
    apiUrl: string;
  }) => Promise<T>,
  options: { network?: StartedNetwork; alias?: string } = {},
): Promise<T> {
  let container = new GenericContainer(mailpitImage)
    .withExposedPorts(1025, 8025)
    .withWaitStrategy(Wait.forHttp("/readyz", 8025));
  if (options.network) {
    container = container.withNetwork(options.network);
    if (options.alias) container = container.withNetworkAliases(options.alias);
  }
  const started = await container.start();
  try {
    return await work({
      smtpHost: options.alias ?? started.getHost(),
      smtpPort: options.alias ? 1025 : started.getMappedPort(1025),
      apiUrl: `http://${started.getHost()}:${started.getMappedPort(8025)}`,
    });
  } finally {
    await started.stop();
  }
}
