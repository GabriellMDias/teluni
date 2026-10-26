import { keycloakAdmin } from "./keycloak.js";

// Called only by tooling/deployment/presentation.mjs, against its isolated
// synthetic installation. No application grant or MFA waiver is created.
function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing presentation setting ${name}`);
  return value;
}
const email = required("TELUNI_PRESENTATION_USERNAME");
const password = required("TELUNI_PRESENTATION_PASSWORD");
const installation = required("TELUNI_PRESENTATION_INSTALLATION");
const expectedId = process.argv[2];
if (
  email !== "presenter@example.test" ||
  !/^[a-f0-9-]{36}$/.test(installation) ||
  password.length < 32
)
  throw new Error("Invalid synthetic operator configuration");
const admin = keycloakAdmin(required("TELUNI_KEYCLOAK_ADMIN_URL"), {
  username: required("TELUNI_KEYCLOAK_ADMIN_USERNAME"),
  password: required("TELUNI_KEYCLOAK_ADMIN_PASSWORD"),
});
const found = await admin.request(
  "GET",
  `/realms/teluni/users?email=${encodeURIComponent(email)}&exact=true`,
);
if (!found.ok) throw new Error("Synthetic operator lookup failed");
const users = (await found.json()) as {
  id: string;
}[];
let operatorId: string;
if (users.length) {
  if (users.length !== 1 || !expectedId || users[0].id !== expectedId)
    throw new Error("Refusing to replace an existing identity");
  // Preserve this installation's identity, chosen password and OTP enrollment.
  operatorId = users[0].id;
} else {
  if (expectedId)
    throw new Error("Refusing to replace a missing installation identity");
  const created = await admin.request("POST", "/realms/teluni/users", {
    username: email,
    email,
    emailVerified: true,
    enabled: true,
    firstName: "Synthetic",
    lastName: "Presenter",
    credentials: [{ type: "password", value: password, temporary: false }],
  });
  if (created.status !== 201)
    throw new Error("Synthetic operator creation failed");
  operatorId = created.headers.get("location")!.split("/").pop()!;
}

// This installation only has fictitious identities and a private mail sink.
// Keep the product realm's public-signup policy unchanged in every other profile.
const configured = await admin.request("PUT", "/realms/teluni", {
  registrationAllowed: false,
});
if (configured.status !== 204)
  throw new Error("Synthetic realm configuration failed");
console.log(JSON.stringify({ operatorId }));
