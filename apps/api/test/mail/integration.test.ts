import { randomBytes, randomUUID } from "node:crypto";
import { Writable } from "node:stream";
import pg from "pg";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../../src/database.js";
import { MailDispatcher } from "../../src/features/mail/dispatcher.js";
import type {
  MailTemplate,
  SendOutcome,
} from "../../src/features/mail/domain.js";
import { MailKeyRing } from "../../src/features/mail/mail-crypto.js";
import { createMailModule } from "../../src/features/mail/module.js";
import { PrismaMailRepository } from "../../src/features/mail/prisma-repository.js";
import type {
  MailTransport,
  OutgoingEmail,
} from "../../src/features/mail/smtp.js";
import { activateModules, type MailSettings } from "../../src/module.js";
import { withMailpit } from "../../scripts/keycloak.js";
import { withMigratedDatabase } from "../../scripts/migrated-database.js";

// The outbox against migrated PostgreSQL (restricted runtime role) and a
// disposable Mailpit SMTP sink. Fake transports inject relay outcomes.
let database: Database;
let sql: pg.Client;
let mailpit: { smtpHost: string; smtpPort: number; apiUrl: string };
let release: () => void;
let stopped: Promise<void>;

const keys = [{ id: "m1", key: randomBytes(32) }];
const template: MailTemplate = ({ locale, parameters, secret }) => ({
  subject: `Synthetic ${parameters.name} (${locale})`,
  text: `Code ${secret ?? "none"} for ${parameters.name}`,
  html: `<p>Code ${secret ?? "none"}</p>`,
});

function settings(): MailSettings {
  return {
    environment: "test",
    publicOrigin: "http://127.0.0.1:5173",
    smtp: { host: mailpit.smtpHost, port: mailpit.smtpPort, security: "none" },
    from: "no-reply@teluni.test",
    keys,
  };
}

beforeAll(async () => {
  let ready!: () => void;
  const started = new Promise<void>((resolve) => (ready = resolve));
  stopped = withMigratedDatabase((runtimeUrl, migrationUrl) =>
    withMailpit(async (mail) => {
      mailpit = mail;
      database = createDatabase(runtimeUrl);
      sql = new pg.Client({ connectionString: migrationUrl });
      await sql.connect();
      ready();
      await new Promise<void>((resolve) => (release = resolve));
      await database.$disconnect();
      await sql.end();
    }),
  );
  await Promise.race([started, stopped]);
}, 180_000);

afterAll(async () => {
  release?.();
  await stopped;
}, 60_000);

function moduleWith(options: Parameters<typeof createMailModule>[0] = {}) {
  const mail = createMailModule(options);
  mail.registerTemplate("test.message", template);
  activateModules([mail.module], { database, mail: settings() }, "test");
  return mail;
}

async function enqueue(
  mail: ReturnType<typeof createMailModule>,
  recipient: string,
  secret?: string,
) {
  return database.$transaction((tx) =>
    mail.outbox.enqueue(tx, {
      producer: "test",
      producerReference: randomUUID(),
      template: "test.message",
      locale: "pt-BR",
      recipient,
      parameters: { name: recipient.split("@")[0] },
      ...(secret ? { secret } : {}),
    }),
  );
}

async function row(id: string) {
  const { rows } = await sql.query<{
    status: string;
    attempts: number;
    sealed_secret: Buffer | null;
    last_failure: string | null;
    last_reply_code: number | null;
    finalized_at: Date | null;
  }>(
    "SELECT status::text AS status, attempts, sealed_secret, last_failure, last_reply_code, finalized_at FROM outbound_emails WHERE id = $1",
    [id],
  );
  return rows[0];
}

async function makeDue(id: string) {
  await sql.query(
    "UPDATE outbound_emails SET next_attempt_at = now() - interval '1 second' WHERE id = $1",
    [id],
  );
}

function scripted(outcomes: SendOutcome[]): MailTransport & {
  sent: OutgoingEmail[];
} {
  const sent: OutgoingEmail[] = [];
  return {
    sent,
    send(message) {
      sent.push(message);
      return Promise.resolve(outcomes.shift() ?? { kind: "sent" });
    },
    close: () => undefined,
  };
}

describe("mail outbox", () => {
  it("delivers a committed message through SMTP and erases its secret", async () => {
    const mail = moduleWith();
    const recipient = `ana-${randomUUID().slice(0, 8)}@example.test`;
    const secret = randomBytes(32).toString("base64url");
    const id = await enqueue(mail, recipient, secret);
    const stored = await row(id);
    expect(stored.status).toBe("PENDING");
    expect(stored.sealed_secret?.includes(Buffer.from(secret))).toBe(false);
    expect(await mail.runOnce()).toBeGreaterThanOrEqual(1);
    expect(await row(id)).toMatchObject({
      status: "SENT",
      attempts: 1,
      sealed_secret: null,
    });
    expect((await mail.outbox.states([id])).get(id)).toBe("SENT");
    const list = (await (
      await fetch(`${mailpit.apiUrl}/api/v1/search?query=to:${recipient}`)
    ).json()) as { messages: { ID: string; Subject: string }[] };
    expect(list.messages).toHaveLength(1);
    expect(list.messages[0].Subject).toBe(
      `Synthetic ${recipient.split("@")[0]} (pt-BR)`,
    );
    const message = (await (
      await fetch(`${mailpit.apiUrl}/api/v1/message/${list.messages[0].ID}`)
    ).json()) as { Text: string; MessageID: string; From: { Address: string } };
    expect(message.Text).toContain(`Code ${secret}`);
    expect(message.MessageID).toBe(`${id}@teluni.test`);
    expect(message.From.Address).toBe("no-reply@teluni.test");
  });

  it("enqueues nothing when the producer's transaction rolls back", async () => {
    const mail = moduleWith();
    const recipient = `rollback-${randomUUID()}@example.test`;
    await expect(
      database.$transaction(async (tx) => {
        await mail.outbox.enqueue(tx, {
          producer: "test",
          producerReference: randomUUID(),
          template: "test.message",
          locale: "en-US",
          recipient,
          parameters: { name: "rollback" },
        });
        throw new Error("producer failed");
      }),
    ).rejects.toThrow("producer failed");
    const { rows } = await sql.query(
      "SELECT 1 FROM outbound_emails WHERE recipient = $1",
      [recipient],
    );
    expect(rows).toHaveLength(0);
    await expect(
      database.$transaction((tx) =>
        mail.outbox.enqueue(tx, {
          producer: "test",
          producerReference: randomUUID(),
          template: "unknown",
          locale: "en-US",
          recipient,
          parameters: {},
        }),
      ),
    ).rejects.toThrow("Unknown mail template");
  });

  it("retries transient failures on the schedule, then fails after the last attempt", async () => {
    const transport = scripted(
      Array.from({ length: 8 }, () => ({
        kind: "transient" as const,
        failure: "connection" as const,
        replyCode: null,
      })),
    );
    const mail = moduleWith({ transport, random: () => 0.5 });
    const id = await enqueue(mail, "retry@example.test", "secret-value");
    await mail.runOnce();
    const { rows } = await sql.query<{ wait: number }>(
      "SELECT EXTRACT(EPOCH FROM next_attempt_at - now())::float8 AS wait FROM outbound_emails WHERE id = $1",
      [id],
    );
    expect(rows[0].wait).toBeGreaterThan(50);
    expect(rows[0].wait).toBeLessThanOrEqual(60);
    expect(await row(id)).toMatchObject({
      status: "PENDING",
      attempts: 1,
      last_failure: "connection",
    });
    for (let attempt = 2; attempt <= 8; attempt++) {
      await makeDue(id);
      await mail.runOnce();
    }
    expect(await row(id)).toMatchObject({
      status: "FAILED",
      attempts: 8,
      sealed_secret: null,
      last_failure: "connection",
    });
    expect(transport.sent.filter((sent) => sent.messageId === id)).toHaveLength(
      8,
    );
    await makeDue(id);
    await mail.runOnce();
    expect(transport.sent.filter((sent) => sent.messageId === id)).toHaveLength(
      8,
    );
  });

  it("fails a permanent rejection at once and never sends a cancelled message", async () => {
    const transport = scripted([
      { kind: "permanent", failure: "rejected", replyCode: 550 },
    ]);
    const mail = moduleWith({ transport });
    const rejected = await enqueue(mail, "rejected@example.test", "secret");
    await mail.runOnce();
    expect(await row(rejected)).toMatchObject({
      status: "FAILED",
      attempts: 1,
      last_failure: "rejected",
      last_reply_code: 550,
      sealed_secret: null,
    });
    const cancelled = await enqueue(mail, "cancelled@example.test", "secret");
    await database.$transaction((tx) => mail.outbox.cancel(tx, cancelled));
    await mail.runOnce();
    expect(await row(cancelled)).toMatchObject({
      status: "CANCELLED",
      attempts: 0,
      sealed_secret: null,
    });
    expect(transport.sent.some((sent) => sent.messageId === cancelled)).toBe(
      false,
    );
  });

  it("keeps a cancellation made during an attempt and ignores a stale claim", async () => {
    const repository = new PrismaMailRepository(
      database,
      new MailKeyRing(keys),
    );
    const mail = moduleWith();
    const id = await enqueue(mail, "race@example.test", "secret");
    const claims = await repository.claim(100);
    const claim = claims.find((claimed) => claimed.id === id)!;
    await database.$transaction((tx) => mail.outbox.cancel(tx, id));
    expect(await repository.complete(claim, { state: "SENT" })).toBe(false);
    expect((await row(id)).status).toBe("CANCELLED");

    const second = await enqueue(mail, "stale@example.test");
    const first = (await repository.claim(100)).find(
      (claimed) => claimed.id === second,
    )!;
    await sql.query(
      "UPDATE outbound_emails SET lease_expires_at = now() - interval '1 second' WHERE id = $1",
      [second],
    );
    const reclaimed = (await repository.claim(100)).find(
      (claimed) => claimed.id === second,
    )!;
    expect(reclaimed.attempts).toBe(2);
    expect(await repository.complete(first, { state: "SENT" })).toBe(false);
    expect(await repository.complete(reclaimed, { state: "SENT" })).toBe(true);
    expect((await row(second)).status).toBe("SENT");
  });

  it("never lets competing dispatchers send one claim twice", async () => {
    const sends = new Map<string, number>();
    const slow: MailTransport = {
      async send(message) {
        sends.set(message.messageId, (sends.get(message.messageId) ?? 0) + 1);
        await new Promise((resolve) => setTimeout(resolve, 20));
        return { kind: "sent" };
      },
      close: () => undefined,
    };
    const one = moduleWith({ transport: slow });
    const two = moduleWith({ transport: slow });
    const ids = await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        enqueue(one, `burst-${index}@example.test`),
      ),
    );
    while ((await Promise.all([one.runOnce(), two.runOnce()])).some(Boolean));
    for (const id of ids) expect(sends.get(id)).toBe(1);
  });

  it("purges final messages after retention and logs no address or secret", async () => {
    const lines: string[] = [];
    const log = pino(
      { level: "info" },
      new Writable({
        write(chunk: Buffer, _encoding, done) {
          lines.push(chunk.toString());
          done();
        },
      }),
    );
    const repository = new PrismaMailRepository(
      database,
      new MailKeyRing(keys),
    );
    const recipient = "private-person@example.test";
    const secret = randomBytes(32).toString("base64url");
    const dispatcher = new MailDispatcher({
      repository,
      transport: scripted([
        { kind: "transient", failure: "timeout", replyCode: null },
      ]),
      templates: new Map([["test.message", template]]),
      log,
    });
    const mail = moduleWith();
    const id = await enqueue(mail, recipient, secret);
    await dispatcher.runOnce();
    await makeDue(id);
    await dispatcher.runOnce();
    expect((await row(id)).status).toBe("SENT");
    const output = lines.join("");
    expect(output).toContain("mail_message_retry");
    expect(output).toContain("mail_message_sent");
    expect(output).not.toContain(recipient);
    expect(output).not.toContain(secret);

    await sql.query(
      "UPDATE outbound_emails SET finalized_at = now() - interval '31 days' WHERE id = $1",
      [id],
    );
    const fresh = await enqueue(mail, "fresh@example.test");
    await database.$transaction((tx) => mail.outbox.cancel(tx, fresh));
    expect(await repository.purge(500)).toBeGreaterThanOrEqual(1);
    expect(await row(id)).toBeUndefined();
    expect((await row(fresh)).status).toBe("CANCELLED");
  });

  it("lets the runtime role neither forge final states nor change recipients", async () => {
    const mail = moduleWith();
    const id = await enqueue(mail, "constraints@example.test", "secret");
    await expect(
      sql.query("UPDATE outbound_emails SET status = 'SENT' WHERE id = $1", [
        id,
      ]),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      database.$executeRaw`UPDATE outbound_emails SET recipient = 'other@example.test' WHERE id = ${id}::uuid`,
    ).rejects.toThrow(/permission denied/i);
    expect((await row(id)).status).toBe("PENDING");
  });
});
