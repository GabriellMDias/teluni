import type { Locale } from "../locale.js";

// Localized copy for the application's entry and home page.

const ptBR = {
  navHome: "Início",
  loading: "Carregando o Teluni…",
  homeEyebrow: "Início",
  homeTitle: "Boas-vindas ao Teluni",
  homeLead:
    "Organize suas telas, conteúdos e programação em um só lugar. Escolha uma empresa para começar.",
  companiesTitle: "Suas empresas",
  companiesEmpty:
    "Você ainda não participa de nenhuma empresa. Crie a primeira para começar, ou aceite um convite recebido por e-mail.",
  createFirst: "Criar minha primeira empresa",
  allCompanies: "Ver todas as empresas",
  createAnother: "Criar outra empresa",
  open: "Abrir",
  responsible: "Responsável",
  accountTitle: "Sua conta",
  accountSessions: "Sessões e dispositivos conectados",
  twoStepEnabled: "Verificação em duas etapas ativada.",
  twoStepDisabled:
    "A verificação em duas etapas está desativada. Recomendamos ativá-la para proteger sua conta.",
  twoStepButton: "Ativar verificação em duas etapas",
  companiesFailed: "Não foi possível carregar suas empresas.",
  reload: "Recarregar",
};

export type WorkspaceMessages = typeof ptBR;

const enUS: WorkspaceMessages = {
  navHome: "Home",
  loading: "Loading Teluni…",
  homeEyebrow: "Home",
  homeTitle: "Welcome to Teluni",
  homeLead:
    "Bring your screens, content and programming together. Choose a company to get started.",
  companiesTitle: "Your companies",
  companiesEmpty:
    "You are not part of any company yet. Create the first one to get started, or accept an invitation you received by email.",
  createFirst: "Create my first company",
  allCompanies: "See all companies",
  createAnother: "Create another company",
  open: "Open",
  responsible: "Responsible",
  accountTitle: "Your account",
  accountSessions: "Sessions and connected devices",
  twoStepEnabled: "Two-step verification is on.",
  twoStepDisabled:
    "Two-step verification is off. We recommend turning it on to protect your account.",
  twoStepButton: "Turn on two-step verification",
  companiesFailed: "Your companies could not be loaded.",
  reload: "Reload",
};

export const workspaceMessages: Readonly<Record<Locale, WorkspaceMessages>> = {
  "pt-BR": ptBR,
  "en-US": enUS,
};
