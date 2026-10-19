import { escapeHtml, type MailTemplate } from "../mail/public.js";
import type { AccessRole } from "./domain.js";

// The invitation message (D-13 "Abuse limits and content"): fixed wording,
// no inviter-supplied text, escaped tenant-chosen names and one link to the
// configured panel origin. Rendered by the mail dispatcher when it sends.

const copy = {
  "pt-BR": {
    roles: {
      COMPANY_ADMINISTRATOR: "administrador",
      BRANCH_MANAGER: "gerente de filial",
      OPERATOR: "operador",
    },
    subject: (company: string) =>
      `Convite para participar de “${company}” no Teluni`,
    invited: (inviter: string, company: string, role: string) =>
      inviter
        ? `${inviter} convidou você para participar da empresa “${company}” no Teluni como ${role}.`
        : `Você recebeu um convite para participar da empresa “${company}” no Teluni como ${role}.`,
    howTo:
      "Para aceitar, abra o link abaixo e entre com este endereço de e-mail.",
    action: "Aceitar convite",
    validity: (until: string) => `O convite vale até ${until}.`,
    ignore:
      "Se você não esperava este convite, pode ignorar esta mensagem com segurança.",
    reason: (company: string) =>
      `Esta mensagem foi enviada porque alguém da empresa “${company}” pediu o convite no Teluni.`,
  },
  "en-US": {
    roles: {
      COMPANY_ADMINISTRATOR: "an administrator",
      BRANCH_MANAGER: "a branch manager",
      OPERATOR: "an operator",
    },
    subject: (company: string) => `Invitation to join “${company}” on Teluni`,
    invited: (inviter: string, company: string, role: string) =>
      inviter
        ? `${inviter} invited you to join the company “${company}” on Teluni as ${role}.`
        : `You have been invited to join the company “${company}” on Teluni as ${role}.`,
    howTo:
      "To accept, open the link below and sign in with this email address.",
    action: "Accept invitation",
    validity: (until: string) => `The invitation is valid until ${until}.`,
    ignore:
      "If you did not expect this invitation, you can safely ignore this message.",
    reason: (company: string) =>
      `You received this message because someone in the company “${company}” requested the invitation on Teluni.`,
  },
} as const;

/** Single-line, length-limited text for insertion into fixed wording. */
function plain(value: string | undefined, max: number): string {
  // eslint-disable-next-line no-control-regex
  const single = (value ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
  return single.length > max ? `${single.slice(0, max - 1)}…` : single;
}

export const renderInvitationEmail: MailTemplate = ({
  locale,
  parameters,
  secret,
}) => {
  if (!secret) throw new Error("An invitation message needs its credential");
  const text = copy[locale];
  const company = plain(parameters.companyName, 120);
  const inviter = plain(parameters.inviterName, 80);
  const role = text.roles[parameters.role as AccessRole] ?? text.roles.OPERATOR;
  const until = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: parameters.timeZone || "UTC",
    timeZoneName: "short",
  }).format(new Date(parameters.expiresAt ?? ""));
  const link = `${parameters.acceptUrl}#${secret}`;
  const lines = [
    text.invited(inviter, company, role),
    "",
    text.howTo,
    link,
    "",
    text.validity(until),
    text.ignore,
    "",
    text.reason(company),
  ];
  const html = `<!doctype html><html lang="${locale}"><body style="font-family:Arial,sans-serif;color:#172b3c;line-height:1.5">
<p>${escapeHtml(text.invited(inviter, company, role))}</p>
<p>${escapeHtml(text.howTo)}</p>
<p><a href="${escapeHtml(link)}" style="display:inline-block;padding:10px 16px;background:#1d4f7a;color:#ffffff;text-decoration:none;border-radius:6px">${escapeHtml(text.action)}</a></p>
<p style="word-break:break-all;font-size:13px">${escapeHtml(link)}</p>
<p>${escapeHtml(text.validity(until))}<br>${escapeHtml(text.ignore)}</p>
<p style="font-size:12px;color:#536879">${escapeHtml(text.reason(company))}</p>
</body></html>`;
  return {
    subject: plain(text.subject(company), 200),
    text: lines.join("\n"),
    html,
  };
};
