import type { Locale } from "../locale.js";

// Localized copy for the application's entry and home page.

const ptBR = {
  navHome: "Início",
  loading: "Carregando o Teluni…",
  homeEyebrow: "Início",
  homeTitle: "Boas-vindas ao Teluni",
  homeLead:
    "Gerencie suas empresas, filiais e equipes. Telas, mídias e programação chegam nas próximas versões.",
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
  twoStepDone: "Verificação em duas etapas concluída nesta sessão.",
  twoStepMissing:
    "Esta sessão não usou verificação em duas etapas, necessária para administrar empresas.",
  twoStepButton: "Verificar em duas etapas",
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
    "Manage your companies, branches and teams. Screens, media and programming arrive in upcoming versions.",
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
  twoStepDone: "Two-step verification completed in this session.",
  twoStepMissing:
    "This session did not use two-step verification, which administering companies requires.",
  twoStepButton: "Verify in two steps",
  companiesFailed: "Your companies could not be loaded.",
  reload: "Reload",
};

export const workspaceMessages: Readonly<Record<Locale, WorkspaceMessages>> = {
  "pt-BR": ptBR,
  "en-US": enUS,
};
