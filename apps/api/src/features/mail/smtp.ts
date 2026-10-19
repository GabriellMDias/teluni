import nodemailer from "nodemailer";
import type { MailSettings } from "../../module.js";
import {
  classifySendError,
  sendTimeoutMs,
  type SendOutcome,
} from "./domain.js";

/** One message ready for submission. */
export type OutgoingEmail = Readonly<{
  messageId: string;
  to: string;
  subject: string;
  text: string;
  html: string;
}>;

/** Submits messages to the relay; the dispatcher owns retries. */
export type MailTransport = Readonly<{
  send(message: OutgoingEmail): Promise<SendOutcome>;
  close(): void;
}>;

/**
 * SMTP submission through nodemailer. TLS modes verify the relay's
 * certificate; `none` is accepted by configuration only for a loopback test
 * sink outside production.
 */
export function createSmtpTransport(settings: MailSettings): MailTransport {
  const { smtp } = settings;
  const transport = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.security === "tls",
    requireTLS: smtp.security === "starttls",
    ignoreTLS: smtp.security === "none",
    ...(smtp.username
      ? { auth: { user: smtp.username, pass: smtp.password ?? "" } }
      : {}),
    tls: { minVersion: "TLSv1.2", rejectUnauthorized: true },
    connectionTimeout: sendTimeoutMs,
    greetingTimeout: sendTimeoutMs,
    socketTimeout: sendTimeoutMs,
    // Diagnostics stay in the dispatcher's allowlisted events.
    logger: false,
    debug: false,
  });
  const domain = settings.from.split("@")[1] ?? "localhost";
  return {
    async send(message) {
      let timer: NodeJS.Timeout | undefined;
      try {
        await Promise.race([
          transport.sendMail({
            from: { name: "Teluni", address: settings.from },
            to: message.to,
            subject: message.subject,
            text: message.text,
            html: message.html,
            messageId: `<${message.messageId}@${domain}>`,
            disableFileAccess: true,
            disableUrlAccess: true,
          }),
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(
              () =>
                reject(
                  Object.assign(new Error("Timeout"), { code: "ETIMEDOUT" }),
                ),
              sendTimeoutMs,
            );
          }),
        ]);
        return { kind: "sent" };
      } catch (error) {
        return classifySendError(error);
      } finally {
        if (timer) clearTimeout(timer);
      }
    },
    close() {
      transport.close();
    },
  };
}
