import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createSmtpTransport } from "../../src/features/mail/smtp.js";
import { keycloakAdmin } from "../../scripts/keycloak.js";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing presentation check setting ${name}`);
  return value;
}
const origin = required("TELUNI_PUBLIC_ORIGIN");
const admin = keycloakAdmin(required("TELUNI_KEYCLOAK_ADMIN_URL"), {
  username: required("TELUNI_KEYCLOAK_ADMIN_USERNAME"),
  password: required("TELUNI_KEYCLOAK_ADMIN_PASSWORD"),
});
const transport = createSmtpTransport({
  environment: "production",
  publicOrigin: origin,
  keys: [],
  from: required("TELUNI_MAIL_FROM"),
  smtp: {
    host: required("TELUNI_MAIL_SMTP_HOST"),
    port: Number(required("TELUNI_MAIL_SMTP_PORT")),
    security: "starttls",
    username: required("TELUNI_MAIL_SMTP_USERNAME"),
    password: required("TELUNI_MAIL_SMTP_PASSWORD"),
  },
});
try {
  const id = randomUUID();
  assert.deepEqual(
    await transport.send({
      messageId: id,
      to: "smtp-check@example.test",
      subject: "Synthetic transport check",
      text: "Synthetic content",
      html: "<p>Synthetic content</p>",
    }),
    { kind: "sent" },
  );
  const email = `provider-check-${randomUUID()}@example.test`;
  const created = await admin.request("POST", "/realms/teluni/users", {
    username: email,
    email,
    emailVerified: true,
    enabled: true,
  });
  assert.equal(created.status, 201);
  const userId = created.headers.get("location")!.split("/").pop()!;
  try {
    const sent = await admin.request(
      "PUT",
      `/realms/teluni/users/${userId}/execute-actions-email`,
      ["UPDATE_PASSWORD"],
    );
    assert.equal(
      sent.status,
      204,
      "Keycloak must send mail using verified TLS",
    );
    for (const recipient of [email, "smtp-check@example.test"]) {
      const inbox = await fetch(
        `http://mailpit:8025/api/v1/search?query=to:${encodeURIComponent(recipient)}`,
      );
      assert.equal(inbox.status, 200);
      const result = (await inbox.json()) as { messages: unknown[] };
      assert(
        result.messages.length > 0,
        "The private inbox must receive the synthetic message",
      );
    }
  } finally {
    assert.equal(
      (await admin.request("DELETE", `/realms/teluni/users/${userId}`)).status,
      204,
    );
  }
  // Only a verified host connector may supply the edge client address. An
  // internal client cannot evade the enrollment limit with forged headers.
  for (let attempt = 0; attempt < 21; attempt++) {
    const response = await fetch(`${origin}/api/device-enrollments`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "CF-Connecting-IP": `198.51.100.${attempt + 1}`,
        "X-Forwarded-For": `203.0.113.${attempt + 1}`,
      },
      body: "{}",
    });
    assert.equal(
      response.status,
      attempt < 20 ? 400 : 429,
      "Internal peers must not be trusted as the edge",
    );
  }
  console.log("presentation_transport_passed");
} finally {
  transport.close();
}
