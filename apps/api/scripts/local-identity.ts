import { randomBytes } from "node:crypto";
import { parseArgs } from "node:util";
import { Network, TestContainers } from "testcontainers";
import {
  provisionerClientId,
  provisionTeluniRealm,
  webClientId,
} from "./identity-realm.js";
import { withKeycloak, withMailpit } from "./keycloak.js";

// Starts a disposable Keycloak and Mailpit for local development and browser
// journeys, provisions the teluni realm with per-run synthetic client
// secrets, optionally creates synthetic verified users, writes one JSON line
// describing the stack to stdout and runs until SIGINT or SIGTERM. Nothing
// here is a deployment or uses real accounts.
const { values } = parseArgs({
  options: {
    "public-origin": { type: "string" },
    "api-port": { type: "string" },
    users: { type: "string", default: "[]" },
  },
});
const publicOrigin = values["public-origin"];
const apiPort = Number(values["api-port"]);
if (!publicOrigin || !Number.isInteger(apiPort) || apiPort <= 0)
  throw new Error(
    "Usage: local-identity --public-origin <origin> --api-port <port>",
  );
const users = JSON.parse(values.users) as { email: string; password: string }[];

const realm = "teluni";
const audience = "teluni-api";
let stop!: () => void;
const stopped = new Promise<void>((resolve) => (stop = resolve));
process.once("SIGINT", () => stop());
process.once("SIGTERM", () => stop());
// Signal listeners and some container-runtime sockets do not keep Node's
// event loop alive; this timer does until shutdown.
const keepAlive = setInterval(() => undefined, 60_000);

// Keycloak calls the API's back-channel logout route on this host port.
await TestContainers.exposeHostPorts(apiPort);
const network = await new Network().start();
try {
  await withMailpit(
    async (mail) =>
      withKeycloak(
        async (admin) => {
          const webClientSecret = randomBytes(24).toString("base64url");
          const provisionerClientSecret = randomBytes(24).toString("base64url");
          await provisionTeluniRealm(admin, {
            realm,
            publicOrigin,
            backchannelLogoutUrl: `http://host.testcontainers.internal:${apiPort}/auth/backchannel-logout`,
            apiAudience: audience,
            webClientSecret,
            provisionerClientSecret,
            smtp: {
              host: mail.smtpHost,
              port: mail.smtpPort,
              from: "no-reply@teluni.test",
            },
          });
          for (const user of users) {
            const created = await admin.request(
              "POST",
              `/realms/${realm}/users`,
              {
                username: user.email,
                email: user.email,
                emailVerified: true,
                enabled: true,
                firstName: "Synthetic",
                lastName: "User",
                credentials: [
                  { type: "password", value: user.password, temporary: false },
                ],
              },
            );
            if (created.status !== 201)
              throw new Error(
                `Synthetic user creation failed (${created.status})`,
              );
          }
          const issuer = `${admin.baseUrl}/realms/${realm}`;
          process.stdout.write(
            `${JSON.stringify({
              issuer,
              audience,
              jwksUrl: `${issuer}/protocol/openid-connect/certs`,
              webClientId,
              webClientSecret,
              provisionerClientId,
              provisionerClientSecret,
              mailUrl: mail.apiUrl,
              mailSmtpHost: mail.hostSmtpHost,
              mailSmtpPort: mail.hostSmtpPort,
              adminUrl: `${admin.baseUrl}/admin`,
            })}\n`,
          );
          await stopped;
        },
        { network, alias: "keycloak" },
      ),
    { network, alias: "mailpit" },
  );
} finally {
  await network.stop();
  clearInterval(keepAlive);
}
