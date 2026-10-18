import type { Locale } from "../locale.js";
import type { Role } from "./api.js";

// Localized copy for companies and branches. Keys and role identifiers are
// stable code; only the text varies by locale.

const ptBR = {
  navCompanies: "Empresas",
  companiesEyebrow: "Organização",
  companiesTitle: "Suas empresas",
  companiesLead: "Empresas às quais você tem acesso.",
  companiesEmpty:
    "Você ainda não participa de nenhuma empresa. Crie a primeira abaixo.",
  signInRequired: "Entre para ver suas empresas.",
  signIn: "Entrar",
  createTitle: "Criar empresa",
  fieldCompanyName: "Nome da empresa",
  fieldTimeZone: "Fuso horário",
  fieldLocale: "Idioma padrão",
  localeNames: {
    "pt-BR": "Português (Brasil)",
    "en-US": "English (United States)",
  },
  createCompany: "Criar empresa",
  creating: "Criando…",
  roles: {
    COMPANY_ADMINISTRATOR: "Administrador",
    BRANCH_MANAGER: "Gerente de filial",
    OPERATOR: "Operador",
  } satisfies Record<Role, string>,
  responsible: "Responsável pela empresa",
  yourAccess: "Seu acesso",
  stepUpNotice:
    "Seu papel nesta empresa exige verificação em duas etapas antes de administrar.",
  stepUpButton: "Verificar em duas etapas",
  branchesTitle: "Filiais",
  branchesEmpty: "Nenhuma filial ainda.",
  fieldBranchName: "Nome da filial",
  addBranch: "Adicionar filial",
  adding: "Adicionando…",
  rename: "Renomear",
  save: "Salvar",
  cancel: "Cancelar",
  archive: "Arquivar",
  statusActive: "Ativa",
  statusArchived: "Arquivada",
  nextPage: "Próxima página",
  firstPage: "Primeira página",
  loading: "Carregando…",
  reload: "Recarregar",
  backToCompanies: "Voltar para empresas",
  errors: {
    AUTHENTICATION_REQUIRED: "Sua sessão terminou. Entre novamente.",
    PERMISSION_DENIED: "Você não tem permissão para esta ação.",
    COMPANY_SUSPENDED:
      "Esta empresa está suspensa. Fale com o suporte do Teluni.",
    STRONG_AUTHENTICATION_REQUIRED:
      "Esta ação exige verificação em duas etapas.",
    RECENT_AUTHENTICATION_REQUIRED:
      "Confirme sua identidade novamente para continuar.",
    RESOURCE_VERSION_CONFLICT:
      "Os dados mudaram enquanto você editava. Recarregue antes de tentar de novo.",
    BRANCH_NAME_IN_USE: "Já existe uma filial ativa com esse nome.",
    BRANCH_ARCHIVED: "Esta filial está arquivada e não pode ser alterada.",
    IDEMPOTENCY_KEY_REUSED:
      "Os dados da criação mudaram. Recarregue a página antes de criar de novo.",
    VALIDATION_FAILED: "Confira os campos e tente de novo.",
    RESOURCE_NOT_FOUND: "Empresa ou filial não encontrada.",
    RATE_LIMITED: "Muitas solicitações. Aguarde um momento e tente de novo.",
    SERVICE_UNAVAILABLE:
      "O serviço está indisponível. Tente novamente em instantes.",
    CSRF_VALIDATION_FAILED:
      "Não foi possível verificar a solicitação. Recarregue a página.",
    SESSION_LIMIT_REACHED: "Encerre outra sessão para continuar nesta.",
  } as Record<string, string>,
  network: "Não foi possível conectar. Verifique a conexão e tente novamente.",
  unknownCreate:
    "Não foi possível confirmar a criação. Tente de novo: a mesma solicitação não cria duas empresas.",
  unknownWrite:
    "Não foi possível confirmar se a ação foi concluída. Recarregue antes de tentar de novo.",
  generic: "Não foi possível concluir a solicitação.",
};

export type OrganizationMessages = typeof ptBR;

const enUS: OrganizationMessages = {
  navCompanies: "Companies",
  companiesEyebrow: "Organization",
  companiesTitle: "Your companies",
  companiesLead: "Companies you have access to.",
  companiesEmpty:
    "You are not part of any company yet. Create the first one below.",
  signInRequired: "Sign in to see your companies.",
  signIn: "Sign in",
  createTitle: "Create a company",
  fieldCompanyName: "Company name",
  fieldTimeZone: "Time zone",
  fieldLocale: "Default language",
  localeNames: {
    "pt-BR": "Português (Brasil)",
    "en-US": "English (United States)",
  },
  createCompany: "Create company",
  creating: "Creating…",
  roles: {
    COMPANY_ADMINISTRATOR: "Administrator",
    BRANCH_MANAGER: "Branch manager",
    OPERATOR: "Operator",
  },
  responsible: "Responsible for the company",
  yourAccess: "Your access",
  stepUpNotice:
    "Your role in this company requires two-step verification before administering it.",
  stepUpButton: "Verify in two steps",
  branchesTitle: "Branches",
  branchesEmpty: "No branches yet.",
  fieldBranchName: "Branch name",
  addBranch: "Add branch",
  adding: "Adding…",
  rename: "Rename",
  save: "Save",
  cancel: "Cancel",
  archive: "Archive",
  statusActive: "Active",
  statusArchived: "Archived",
  nextPage: "Next page",
  firstPage: "First page",
  loading: "Loading…",
  reload: "Reload",
  backToCompanies: "Back to companies",
  errors: {
    AUTHENTICATION_REQUIRED: "Your session ended. Sign in again.",
    PERMISSION_DENIED: "You do not have permission for this action.",
    COMPANY_SUSPENDED: "This company is suspended. Contact Teluni support.",
    STRONG_AUTHENTICATION_REQUIRED:
      "This action requires two-step verification.",
    RECENT_AUTHENTICATION_REQUIRED: "Confirm your identity again to continue.",
    RESOURCE_VERSION_CONFLICT:
      "The data changed while you were editing. Reload before trying again.",
    BRANCH_NAME_IN_USE: "Another active branch already uses that name.",
    BRANCH_ARCHIVED: "This branch is archived and cannot change.",
    IDEMPOTENCY_KEY_REUSED:
      "The creation details changed. Reload the page before creating again.",
    VALIDATION_FAILED: "Check the fields and try again.",
    RESOURCE_NOT_FOUND: "Company or branch not found.",
    RATE_LIMITED: "Too many requests. Wait a moment and try again.",
    SERVICE_UNAVAILABLE: "The service is unavailable. Try again in a moment.",
    CSRF_VALIDATION_FAILED:
      "The request could not be verified. Reload the page.",
    SESSION_LIMIT_REACHED: "End another session to continue in this one.",
  },
  network:
    "The service could not be reached. Check the connection and try again.",
  unknownCreate:
    "Creation could not be confirmed. Try again: the same request never creates two companies.",
  unknownWrite:
    "The outcome could not be confirmed. Reload before trying again.",
  generic: "The request could not be completed.",
};

export const organizationMessages: Readonly<
  Record<Locale, OrganizationMessages>
> = {
  "pt-BR": ptBR,
  "en-US": enUS,
};

/** Common Brazilian zones first, then UTC; the browser's own zone is added when different. */
export const timeZoneChoices: readonly string[] = [
  "America/Sao_Paulo",
  "America/Manaus",
  "America/Cuiaba",
  "America/Campo_Grande",
  "America/Belem",
  "America/Fortaleza",
  "America/Recife",
  "America/Bahia",
  "America/Porto_Velho",
  "America/Boa_Vista",
  "America/Rio_Branco",
  "America/Noronha",
  "UTC",
];
