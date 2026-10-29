// Localized copy for the identity workflow. Message keys are stable code
// identifiers; translations never become persisted values or business rules.
// No i18n library is selected yet (D-10); this typed catalog keeps the
// boundary explicit for the initial pt-BR and en-US locales.

import type { Locale } from "../locale.js";

export { browserLocale, preferredLocale, type Locale } from "../locale.js";

export type LoginErrorReason =
  | "login_failed"
  | "login_expired"
  | "email_unverified"
  | "account_unavailable"
  | "assurance_not_met"
  | "provider_unavailable";

export const loginErrorReasons: readonly LoginErrorReason[] = [
  "login_failed",
  "login_expired",
  "email_unverified",
  "account_unavailable",
  "assurance_not_met",
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
  signUpPrompt: "Ainda não tem conta?",
  signUpLink: "Criar conta",
  signUpHint:
    "Informe seu nome e e-mail, confirme o endereço pelo link que enviamos e defina sua senha.",
  productTitle: "Sinalização digital para o seu negócio",
  productPoints: [
    "Organize empresas, filiais e equipes com acessos separados.",
    "Convide pessoas por e-mail e defina o que cada uma pode fazer.",
    "Gerencie telas, mídias e programação no espaço de cada empresa.",
  ],
  loginErrors: {
    login_failed: "Não foi possível concluir a entrada. Tente novamente.",
    login_expired:
      "A tentativa de entrada expirou ou já foi usada. Comece de novo.",
    email_unverified: "Confirme seu e-mail antes de entrar.",
    account_unavailable:
      "Esta conta não pode entrar no momento. Fale com o suporte se o problema continuar.",
    assurance_not_met:
      "Não foi possível confirmar sua identidade novamente. Tente outra vez para continuar.",
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
  twoStepTitle: "Verificação em duas etapas",
  twoStepEnabled:
    "Ativada. O Teluni pede o código do seu aplicativo autenticador sempre que você entra.",
  twoStepDisabled:
    "Desativada. Recomendamos ativar: além da senha, o Teluni pedirá um código do aplicativo autenticador do seu celular ao entrar.",
  twoStepEnable: "Ativar verificação em duas etapas",
  twoStepDisable: "Desativar verificação em duas etapas",
  twoStepEnableHint:
    "Você cadastrará um aplicativo autenticador, como Google Authenticator ou Microsoft Authenticator.",
  twoStepDisableHint:
    "Para desativar, confirme sua senha e o código atual do aplicativo.",
  welcomeEyebrow: "Conta pronta",
  welcomeTitle: "Proteja sua conta",
  welcomeLead:
    "Ative a verificação em duas etapas: além da senha, o Teluni pedirá um código do aplicativo autenticador do seu celular sempre que você entrar.",
  welcomeOptional:
    "É opcional. Você pode ativar ou desativar quando quiser na página Sessões.",
  welcomeEnable: "Configurar agora",
  welcomeSkip: "Agora não",
  loading: "Carregando…",
  reload: "Recarregar",
  errors: {
    network:
      "Não foi possível conectar. Verifique a conexão e tente novamente.",
    unavailable: "O serviço está indisponível. Tente novamente em instantes.",
    signedOut: "Sua sessão terminou. Entre novamente.",
    csrf: "Não foi possível verificar a solicitação. Recarregue a página e tente de novo.",
    limit: "Encerre outra sessão para continuar nesta.",
    recent: "Esta ação exige confirmar sua identidade novamente.",
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
  signUpPrompt: "No account yet?",
  signUpLink: "Create an account",
  signUpHint:
    "Enter your name and email, confirm the address through the link we send and choose a password.",
  productTitle: "Digital signage for your business",
  productPoints: [
    "Organize companies, branches and teams with separate access.",
    "Invite people by email and decide what each one can do.",
    "Manage screens, media and programming within each company's workspace.",
  ],
  loginErrors: {
    login_failed: "Sign-in could not be completed. Try again.",
    login_expired:
      "The sign-in attempt expired or was already used. Start again.",
    email_unverified: "Confirm your email address before signing in.",
    account_unavailable:
      "This account cannot sign in right now. Contact support if this continues.",
    assurance_not_met:
      "Your identity could not be confirmed again. Try again to continue.",
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
  twoStepTitle: "Two-step verification",
  twoStepEnabled:
    "On. Teluni asks for the code from your authenticator app every time you sign in.",
  twoStepDisabled:
    "Off. We recommend turning it on: besides your password, Teluni will ask for a code from the authenticator app on your phone when you sign in.",
  twoStepEnable: "Turn on two-step verification",
  twoStepDisable: "Turn off two-step verification",
  twoStepEnableHint:
    "You will register an authenticator app such as Google Authenticator or Microsoft Authenticator.",
  twoStepDisableHint:
    "To turn it off, confirm your password and the app's current code.",
  welcomeEyebrow: "Account ready",
  welcomeTitle: "Protect your account",
  welcomeLead:
    "Turn on two-step verification: besides your password, Teluni will ask for a code from the authenticator app on your phone every time you sign in.",
  welcomeOptional:
    "It is optional. You can turn it on or off at any time on the Sessions page.",
  welcomeEnable: "Set it up now",
  welcomeSkip: "Not now",
  loading: "Loading…",
  reload: "Reload",
  errors: {
    network:
      "The service could not be reached. Check the connection and try again.",
    unavailable: "The service is unavailable. Try again in a moment.",
    signedOut: "Your session ended. Sign in again.",
    csrf: "The request could not be verified. Reload the page and try again.",
    limit: "End another session to continue in this one.",
    recent: "This action requires you to confirm your identity again.",
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
