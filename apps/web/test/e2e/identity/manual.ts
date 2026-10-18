import { startIdentityStack } from "./stack.ts";

// Starts the disposable identity stack for manual exploration: migrated
// PostgreSQL, Keycloak with a synthetic user, Mailpit, the emitted API and
// Vite. Run `pnpm -C apps/api build` first. Nothing persists after Ctrl+C.
const stack = await startIdentityStack();
const keepAlive = setInterval(() => undefined, 60_000);
process.stdout.write(
  [
    "",
    "Teluni local identity stack is running (synthetic, disposable).",
    `  Panel:        ${stack.webUrl}/sign-in`,
    `  Mail inbox:   ${stack.mailUrl}`,
    `  Sign in as:   ${stack.user.email}`,
    `  Password:     ${stack.user.password}`,
    "  You can also create an account on the sign-in page; the verification",
    "  email arrives in the mail inbox above.",
    "Press Ctrl+C to stop and discard everything.",
    "",
  ].join("\n"),
);
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  clearInterval(keepAlive);
  await stack.stop();
  process.exit(0);
}
process.once("SIGINT", () => void stop());
process.once("SIGTERM", () => void stop());
