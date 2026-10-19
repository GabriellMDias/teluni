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
  pageEmpty:
    "Não há mais empresas nesta página. Volte à primeira página para atualizar a lista.",
  settingsTitle: "Configurações da empresa",
  membersTitle: "Membros",
  membersLead:
    "Gerencie o acesso a esta empresa. Os dados de contato são atualizados no último acesso de cada pessoa.",
  membersEmpty: "Nenhum membro nesta página.",
  memberYou: "Você",
  memberUnknown: "Nome indisponível",
  memberReference: "Referência do membro",
  memberNoRoles: "Sem papéis em vigor",
  memberSuspend: "Suspender",
  memberReactivate: "Reativar",
  memberRemove: "Remover acesso",
  memberConfirm: "Confirmar alteração",
  memberReauthenticate: "Confirmar identidade novamente",
  memberResponsibleProtected:
    "Responsável pela empresa. Transfira a responsabilidade antes de suspender ou remover este acesso.",
  memberStatuses: {
    ACTIVE: "Ativo",
    SUSPENDED: "Suspenso",
    REMOVED: "Removido",
  },
  grantsOf: "Papéis de",
  grantCompanyWide: "Toda a empresa",
  grantUntil: "até",
  grantAdd: "Adicionar papel",
  grantSubmit: "Conceder papel",
  grantRole: "Papel",
  grantScope: "Abrangência",
  grantScopeCompany: "Toda a empresa",
  grantScopeBranches: "Filiais selecionadas",
  grantBranches: "Filiais",
  grantNoBranches: "Nenhuma filial ativa para selecionar.",
  grantBranchesTruncated:
    "Mostrando as primeiras 100 filiais. Para as demais, conceda o papel para toda a empresa ou arquive filiais sem uso.",
  grantAdministratorCompanyWide:
    "A administração sempre vale para toda a empresa.",
  grantResponsibleOnly:
    "Somente o responsável pela empresa pode conceder administração.",
  grantExpiry: "Válido até (opcional)",
  grantExpiryHint:
    "Sem data, o papel vale até ser revogado. Papéis temporários não são renovados automaticamente.",
  grantRevoke: "Revogar papel",
  grantRevokeConfirmation:
    "A revogação encerra este papel imediatamente. Para restaurá-lo, conceda-o de novo.",
  grantRevokeConfirm: "Confirmar revogação",
  transferPropose: "Transferir responsabilidade",
  transferConfirmation:
    "A responsabilidade só passa para esta pessoa quando ela aceitar, em até 7 dias. Você continua administrador.",
  transferConfirm: "Propor transferência",
  transferOutgoing: (name: string, until: string) =>
    `Transferência de responsabilidade para ${name} aguardando aceite até ${until}.`,
  transferIncoming: (name: string, until: string) =>
    `${name} propôs transferir para você a responsabilidade por esta empresa. Aceite até ${until}. Como responsável, seu acesso não poderá ser suspenso nem removido até que você transfira a responsabilidade.`,
  transferAccept: "Aceitar responsabilidade",
  transferDecline: "Recusar transferência",
  transferCancel: "Cancelar transferência",
  memberConfirmations: {
    ACTIVE:
      "A reativação restaura os papéis ainda válidos deste membro nesta empresa.",
    SUSPENDED:
      "A suspensão interrompe o acesso deste membro a esta empresa até uma reativação.",
    REMOVED:
      "A remoção encerra o acesso deste membro a esta empresa e preserva o histórico. Esta ação não pode ser desfeita neste painel.",
  },
  editSettings: "Editar configurações",
  settingsSaved: "Configurações salvas.",
  saving: "Salvando…",
  historyTitle: "Histórico de alterações",
  historyEmpty: "Nenhuma alteração registrada.",
  historyLead:
    "Alterações na empresa e nas filiais, das mais recentes para as mais antigas.",
  historyYou: "Por você",
  historyMember: "Por outro membro",
  historyUnknown: "Organização alterada",
  historyRole: "Papel",
  historyActions: {
    "membership.status_changed": "Acesso de membro alterado",
    "grant.created": "Papel concedido",
    "grant.revoked": "Papel revogado",
    "responsibility.transfer_requested":
      "Transferência de responsabilidade proposta",
    "responsibility.transferred": "Responsabilidade transferida",
    "responsibility.transfer_declined":
      "Transferência de responsabilidade recusada",
    "responsibility.transfer_cancelled":
      "Transferência de responsabilidade cancelada",
    "company.created": "Empresa criada",
    "company.updated": "Configurações da empresa alteradas",
    "branch.created": "Filial criada",
    "branch.updated": "Filial alterada",
    "branch.archived": "Filial arquivada",
  } as Record<string, string>,
  historyFields: {
    displayName: "Nome da empresa",
    defaultLocale: "Idioma padrão",
    timeZone: "Fuso horário",
    name: "Nome da filial",
  } as Record<string, string>,
  loading: "Carregando…",
  reload: "Recarregar",
  backToCompanies: "Voltar para empresas",
  errors: {
    MEMBERSHIP_REMOVED: "Este acesso foi removido e não pode ser reativado.",
    RESPONSIBLE_ADMINISTRATOR_PROTECTED:
      "Transfira a responsabilidade antes de suspender ou remover o responsável.",
    LAST_ADMINISTRATOR_REQUIRED:
      "A empresa precisa manter um administrador ativo.",
    RESPONSIBLE_APPROVAL_REQUIRED:
      "Somente o responsável pela empresa pode aprovar esta mudança de administrador.",
    SUCCESSOR_NOT_ELIGIBLE:
      "A responsabilidade só pode passar para um administrador ativo desta empresa.",
    RESPONSIBILITY_TRANSFER_PENDING:
      "Já existe uma transferência de responsabilidade pendente. Cancele-a antes de propor outra.",
    RESPONSIBILITY_TRANSFER_NOT_PENDING:
      "Esta transferência não está mais pendente. Recarregue para ver a situação atual.",
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
  pageEmpty:
    "There are no more companies on this page. Return to the first page to refresh the list.",
  settingsTitle: "Company settings",
  membersTitle: "Members",
  membersLead:
    "Manage access to this company. Contact details are updated at each person's last sign-in.",
  membersEmpty: "No members on this page.",
  memberYou: "You",
  memberUnknown: "Name unavailable",
  memberReference: "Member reference",
  memberNoRoles: "No current roles",
  memberSuspend: "Suspend",
  memberReactivate: "Reactivate",
  memberRemove: "Remove access",
  memberConfirm: "Confirm change",
  memberReauthenticate: "Confirm identity again",
  memberResponsibleProtected:
    "Responsible for the company. Transfer responsibility before suspending or removing this access.",
  memberStatuses: {
    ACTIVE: "Active",
    SUSPENDED: "Suspended",
    REMOVED: "Removed",
  },
  grantsOf: "Roles of",
  grantCompanyWide: "Whole company",
  grantUntil: "until",
  grantAdd: "Add role",
  grantSubmit: "Grant role",
  grantRole: "Role",
  grantScope: "Scope",
  grantScopeCompany: "Whole company",
  grantScopeBranches: "Selected branches",
  grantBranches: "Branches",
  grantNoBranches: "No active branches to select.",
  grantBranchesTruncated:
    "Showing the first 100 branches. For the others, grant the role company-wide or archive unused branches.",
  grantAdministratorCompanyWide:
    "Administration always covers the whole company.",
  grantResponsibleOnly:
    "Only the company's responsible administrator can grant administration.",
  grantExpiry: "Valid until (optional)",
  grantExpiryHint:
    "Without a date, the role lasts until revoked. Temporary roles are never renewed automatically.",
  grantRevoke: "Revoke role",
  grantRevokeConfirmation:
    "Revocation ends this role immediately. To restore it, grant it again.",
  grantRevokeConfirm: "Confirm revocation",
  transferPropose: "Transfer responsibility",
  transferConfirmation:
    "Responsibility moves to this person only when they accept it, within 7 days. You remain an administrator.",
  transferConfirm: "Propose transfer",
  transferOutgoing: (name: string, until: string) =>
    `Responsibility transfer to ${name} awaiting acceptance until ${until}.`,
  transferIncoming: (name: string, until: string) =>
    `${name} proposed transferring responsibility for this company to you. Accept by ${until}. As the responsible administrator, your access cannot be suspended or removed until you transfer responsibility.`,
  transferAccept: "Accept responsibility",
  transferDecline: "Decline transfer",
  transferCancel: "Cancel transfer",
  memberConfirmations: {
    ACTIVE:
      "Reactivation restores this member's still-valid roles in this company.",
    SUSPENDED:
      "Suspension stops this member's access to this company until reactivation.",
    REMOVED:
      "Removal ends this member's access to this company and preserves history. This action cannot be undone in this panel.",
  },
  editSettings: "Edit settings",
  settingsSaved: "Settings saved.",
  saving: "Saving…",
  historyTitle: "Change history",
  historyEmpty: "No changes recorded.",
  historyLead: "Changes to the company and branches, from newest to oldest.",
  historyYou: "By you",
  historyMember: "By another member",
  historyUnknown: "Organization updated",
  historyRole: "Role",
  historyActions: {
    "membership.status_changed": "Member access changed",
    "grant.created": "Role granted",
    "grant.revoked": "Role revoked",
    "responsibility.transfer_requested": "Responsibility transfer proposed",
    "responsibility.transferred": "Responsibility transferred",
    "responsibility.transfer_declined": "Responsibility transfer declined",
    "responsibility.transfer_cancelled": "Responsibility transfer cancelled",
    "company.created": "Company created",
    "company.updated": "Company settings changed",
    "branch.created": "Branch created",
    "branch.updated": "Branch changed",
    "branch.archived": "Branch archived",
  },
  historyFields: {
    displayName: "Company name",
    defaultLocale: "Default language",
    timeZone: "Time zone",
    name: "Branch name",
  },
  loading: "Loading…",
  reload: "Reload",
  backToCompanies: "Back to companies",
  errors: {
    MEMBERSHIP_REMOVED:
      "This membership was removed and cannot be reactivated.",
    RESPONSIBLE_ADMINISTRATOR_PROTECTED:
      "Transfer responsibility before suspending or removing the responsible administrator.",
    LAST_ADMINISTRATOR_REQUIRED:
      "The company must retain an active administrator.",
    RESPONSIBLE_APPROVAL_REQUIRED:
      "Only the company's responsible administrator can approve this administrator change.",
    SUCCESSOR_NOT_ELIGIBLE:
      "Responsibility can only move to an active administrator of this company.",
    RESPONSIBILITY_TRANSFER_PENDING:
      "A responsibility transfer is already pending. Cancel it before proposing another.",
    RESPONSIBILITY_TRANSFER_NOT_PENDING:
      "This transfer is no longer pending. Reload to see the current state.",
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
