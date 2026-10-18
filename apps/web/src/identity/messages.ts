// Localized copy for the identity workflow. Message keys are stable code
// identifiers; translations never become persisted values or business rules.
// No i18n library is selected yet (D-10); this typed catalog keeps the
// boundary explicit for the initial pt-BR and en-US locales.

export type Locale = "pt-BR" | "en-US";

export type LoginErrorReason =
  | "login_failed"
  | "login_expired"
  | "email_unverified"
  | "account_unavailable"
  | "provider_unavailable";

export const loginErrorReasons: readonly LoginErrorReason[] = [
  "login_failed",
  "login_expired",
  "email_unverified",
  "account_unavailable",
  "provider_unavailable",
];

const ptBR = {
  navSignIn: "Entrar",
  navSessions: "Sessões",
  navSignOut: "Sair",
  signingOut: "Saindo…",
  signInEyebrow: "Acesso",
  signInTitle: "Entrar no Teluni",
  signInLead:
    "Use sua conta para gerenciar empresas, filiais, telas e conteúdo.",
  signInButton: "Entrar com segurança",
  signInHint:
    "Você será levado à página de acesso do Teluni e voltará para cá depois de entrar.",
  alreadySignedIn: "Você já está conectado.",
  manageSessions: "Gerenciar sessões",
  loginErrors: {
    login_failed: "Não foi possível concluir a entrada. Tente novamente.",
    login_expired:
      "A tentativa de entrada expirou ou já foi usada. Comece de novo.",
    email_unverified: "Confirme seu e-mail antes de entrar.",
    account_unavailable:
      "Esta conta não pode entrar no momento. Fale com o suporte se o problema continuar.",
    provider_unavailable:
      "O serviço de acesso está indisponível. Tente novamente em instantes.",
  } satisfies Record<LoginErrorReason, string>,
  sessionsEyebrow: "Conta",
  sessionsTitle: "Suas sessões",
  sessionsLead:
    "Estas são as sessões ativas da sua conta. Encerre as que você não reconhece.",
  sessionsPending:
    "Você atingiu o limite de 5 sessões ativas. Encerre uma delas para continuar nesta.",
  sessionsRequireSignIn: "Entre para ver suas sessões.",
  sessionCurrent: "Esta sessão",
  sessionOther: "Outra sessão",
  sessionCreated: "Iniciada em",
  sessionLastActivity: "Última atividade",
  sessionExpires: "Expira em",
  endSession: "Encerrar",
  endAllSessions: "Encerrar todas as sessões",
  endAllHint:
    "Encerra também esta sessão e as sessões abertas em outros dispositivos.",
  loading: "Carregando…",
  reload: "Recarregar",
  errors: {
    network:
      "Não foi possível conectar. Verifique a conexão e tente novamente.",
    unavailable: "O serviço está indisponível. Tente novamente em instantes.",
    signedOut: "Sua sessão terminou. Entre novamente.",
    csrf: "Não foi possível verificar a solicitação. Recarregue a página e tente de novo.",
    limit: "Encerre outra sessão para continuar nesta.",
    notFound: "Essa sessão não existe mais.",
    rateLimited: "Muitas solicitações. Aguarde um momento e tente de novo.",
    unknownWrite:
      "Não foi possível confirmar se a ação foi concluída. Recarregue a lista antes de tentar de novo.",
    generic: "Não foi possível concluir a solicitação.",
  },
};

export type IdentityMessages = typeof ptBR;

const enUS: IdentityMessages = {
  navSignIn: "Sign in",
  navSessions: "Sessions",
  navSignOut: "Sign out",
  signingOut: "Signing out…",
  signInEyebrow: "Access",
  signInTitle: "Sign in to Teluni",
  signInLead:
    "Use your account to manage companies, branches, screens and content.",
  signInButton: "Sign in securely",
  signInHint:
    "You will go to the Teluni sign-in page and return here after signing in.",
  alreadySignedIn: "You are already signed in.",
  manageSessions: "Manage sessions",
  loginErrors: {
    login_failed: "Sign-in could not be completed. Try again.",
    login_expired:
      "The sign-in attempt expired or was already used. Start again.",
    email_unverified: "Confirm your email address before signing in.",
    account_unavailable:
      "This account cannot sign in right now. Contact support if this continues.",
    provider_unavailable:
      "The sign-in service is unavailable. Try again in a moment.",
  },
  sessionsEyebrow: "Account",
  sessionsTitle: "Your sessions",
  sessionsLead:
    "These are your account's active sessions. End any you do not recognize.",
  sessionsPending:
    "You reached the limit of 5 active sessions. End one of them to continue in this one.",
  sessionsRequireSignIn: "Sign in to see your sessions.",
  sessionCurrent: "This session",
  sessionOther: "Other session",
  sessionCreated: "Started",
  sessionLastActivity: "Last activity",
  sessionExpires: "Expires",
  endSession: "End",
  endAllSessions: "End all sessions",
  endAllHint: "Also ends this session and sessions open on other devices.",
  loading: "Loading…",
  reload: "Reload",
  errors: {
    network:
      "The service could not be reached. Check the connection and try again.",
    unavailable: "The service is unavailable. Try again in a moment.",
    signedOut: "Your session ended. Sign in again.",
    csrf: "The request could not be verified. Reload the page and try again.",
    limit: "End another session to continue in this one.",
    notFound: "That session no longer exists.",
    rateLimited: "Too many requests. Wait a moment and try again.",
    unknownWrite:
      "The outcome could not be confirmed. Reload the list before trying again.",
    generic: "The request could not be completed.",
  },
};

export const identityMessages: Readonly<Record<Locale, IdentityMessages>> = {
  "pt-BR": ptBR,
  "en-US": enUS,
};

/** Brazil is the initial market: Portuguese unless the browser prefers English. */
export function preferredLocale(languages: readonly string[]): Locale {
  for (const language of languages) {
    const normalized = language.toLowerCase();
    if (normalized.startsWith("pt")) return "pt-BR";
    if (normalized.startsWith("en")) return "en-US";
  }
  return "pt-BR";
}

export function browserLocale(): Locale {
  return preferredLocale(
    typeof navigator === "undefined" ? [] : navigator.languages,
  );
}
