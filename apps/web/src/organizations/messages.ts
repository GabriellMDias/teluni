import type { Locale } from "../locale.js";
import type { DelegableCapability, Role } from "./api.js";

// Localized copy for companies and branches. Keys and role identifiers are
// stable code; only the text varies by locale.

const ptBR = {
  navCompanies: "Empresas",
  companiesEyebrow: "Organização",
  companiesTitle: "Suas empresas",
  companyUnavailableTitle: "Empresa indisponível",
  companyContext: "Empresa atual",
  switchCompany: "Trocar empresa",
  companiesLead: "Empresas às quais você tem acesso.",
  companiesEmpty:
    "Você ainda não participa de nenhuma empresa. Crie a primeira no formulário.",
  signInRequired: "Entre para ver suas empresas.",
  signIn: "Entrar",
  createTitle: "Criar empresa",
  companiesRecords: "Registros de empresas",
  companiesExport: "Empresas",
  copyName: (name: string) => `${name} (cópia)`,
  unsavedChanges:
    "Salve ou cancele as alterações do formulário para trocar de registro.",
  settingsReadOnly:
    "Você pode ver esta empresa, mas não alterar as configurações dela.",
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
  branchesTitle: "Filiais",
  screensTitle: "Telas",
  mediaTitle: "Mídia",
  programmingTitle: "Programação",
  catalogsTitle: "Catálogos",
  branchesEmpty: "Nenhuma filial ainda.",
  branchesRecords: "Registros de filiais",
  branchesExport: "Filiais",
  branchStatus: "Situação",
  branchReadOnly: "Só administradores da empresa alteram filiais.",
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
  grantRoleOrProfile: "Papel ou perfil",
  grantRolesGroup: "Papéis padrão",
  grantProfilesGroup: "Perfis personalizados",
  grantProfile: "Perfil",
  grantProfileIncludes: "Este perfil permite",
  grantProfilesUnavailable:
    "Não foi possível carregar os perfis personalizados. Os papéis padrão continuam disponíveis.",
  capabilities: {
    "branches.view": "Ver filiais",
    "invitations.manage": "Convidar pessoas",
    "audit.view": "Ver o histórico de alterações",
    "devices.view": "Ver telas",
    "devices.manage": "Parear e gerenciar telas",
    "media.view": "Ver e usar mídia",
    "media.upload": "Enviar e editar mídia",
    "media.archive": "Arquivar e restaurar mídia",
    "programming.view": "Ver programações",
    "programming.edit": "Montar playlists e programações",
    "programming.assign": "Escolher a programação das telas",
    "publications.publish": "Publicar programações nas telas",
    "catalogs.view": "Ver catálogos e preços",
    "catalogs.edit": "Editar itens de catálogos",
    "catalogs.manage": "Criar catálogos e alterar seus campos",
    "prices.edit": "Alterar preços e promoções",
  } satisfies Record<DelegableCapability, string>,
  profilesTitle: "Perfis de acesso",
  profilesLead:
    "Combine permissões em perfis com o nome que fizer sentido para a empresa e conceda-os aos membros, para toda a empresa ou para filiais. Administrar a empresa nunca faz parte de um perfil.",
  profilesEmpty: "Nenhum perfil criado ainda.",
  profileCreateTitle: "Criar perfil",
  profileName: "Nome do perfil",
  profileCapabilities: "Permissões",
  profileCapabilitiesHint:
    "Convidar pessoas, ver o histórico e gerenciar telas exigem verificação em duas etapas de quem recebe o perfil.",
  profileCreate: "Criar perfil",
  profileEdit: "Editar perfil",
  profileHolders: "Quem tem este perfil",
  profileNoHolders: "Nenhum membro tem este perfil agora.",
  profileHoldersTruncated: "Mostrando os primeiros 500 acessos.",
  profileChangeConfirmation: (members: number) =>
    members === 1
      ? "A mudança de permissões vale imediatamente para 1 membro com este perfil. Confirme para salvar."
      : `A mudança de permissões vale imediatamente para ${members} membros com este perfil. Confirme para salvar.`,
  profileChangeConfirm: "Confirmar mudança",
  profileUsage: (members: number, grants: number) =>
    `${members} ${members === 1 ? "membro" : "membros"} · ${grants} ${grants === 1 ? "acesso em vigor" : "acessos em vigor"}`,
  profileArchiveInUse:
    "Revogue os acessos em vigor com este perfil antes de arquivá-lo.",
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
  invitationsTitle: "Convites",
  invitationsLead:
    "Convide pessoas por e-mail. Cada convite vale por 7 dias e só pode ser aceito por quem entrar com o endereço convidado.",
  invitationsEmpty: "Nenhum convite ainda.",
  inviteTitle: "Convidar pessoa",
  inviteEmail: "E-mail da pessoa",
  inviteSubmit: "Enviar convite",
  inviteSent: "Convite criado. O e-mail será enviado em instantes.",
  inviteManagerHint:
    "Como gerente de filial, você convida operadores para as filiais que gerencia.",
  invitationStatuses: {
    PENDING: "Aguardando aceite",
    ACCEPTED: "Aceito",
    REVOKED: "Revogado",
    REPLACED: "Substituído por um reenvio",
    EXPIRED: "Expirado",
  },
  deliveryStates: {
    PENDING: "E-mail na fila de envio",
    SENT: "E-mail entregue ao serviço de envio",
    FAILED: "Falha no envio do e-mail; reenvie o convite",
    CANCELLED: "E-mail cancelado",
  },
  invitationAddressErased: "Endereço removido após o período de retenção",
  invitationUntil: "válido até",
  invitationBy: "Convidado por",
  invitationResend: "Reenviar convite",
  invitationRevoke: "Revogar convite",
  invitationRevokeConfirmation:
    "O link deste convite deixa de funcionar imediatamente.",
  acceptTitle: "Convite para uma empresa",
  acceptMissing:
    "Este link de convite está incompleto ou já foi usado neste navegador. Abra novamente o link recebido por e-mail.",
  acceptSignIn:
    "Entre com o endereço de e-mail que recebeu o convite para vê-lo e aceitá-lo.",
  acceptSignUp:
    "Ainda não tem conta? Crie uma com o endereço que recebeu o convite e abra o link de confirmação nesta mesma aba.",
  signUp: "Criar conta",
  acceptLead:
    "Ao aceitar, você passa a fazer parte desta empresa com o acesso abaixo.",
  acceptCompany: "Empresa",
  acceptAccess: "Acesso",
  acceptInvitedBy: "Convidado por",
  acceptExpires: "O convite vale até",
  acceptButton: "Aceitar convite",
  accepting: "Aceitando…",
  acceptAlready: "Você já aceitou este convite.",
  openCompany: "Abrir a empresa",
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
  historyLeadBranches:
    "Alterações que envolvem apenas as filiais que você gerencia, das mais recentes para as mais antigas.",
  historyYou: "Por você",
  historyMember: "Por outro membro",
  historyUnknown: "Organização alterada",
  historyRole: "Papel",
  historyProfile: "Perfil",
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
    "invitation.created": "Convite enviado",
    "invitation.resent": "Convite reenviado",
    "invitation.revoked": "Convite revogado",
    "invitation.accepted": "Convite aceito",
    "company.created": "Empresa criada",
    "company.updated": "Configurações da empresa alteradas",
    "branch.created": "Filial criada",
    "branch.updated": "Filial alterada",
    "branch.archived": "Filial arquivada",
    "profile.created": "Perfil de acesso criado",
    "profile.updated": "Perfil de acesso alterado",
    "profile.archived": "Perfil de acesso arquivado",
  } as Record<string, string>,
  historyFields: {
    displayName: "Nome da empresa",
    defaultLocale: "Idioma padrão",
    timeZone: "Fuso horário",
    name: "Nome da filial",
    profileName: "Nome do perfil",
    capabilities: "Permissões",
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
    INVITATION_PENDING:
      "Já existe um convite pendente para este e-mail. Reenvie-o em vez de criar outro.",
    INVITATION_NO_LONGER_VALID:
      "Este convite não é mais válido. Peça um novo convite a quem convidou você.",
    INVITATION_RECIPIENT_MISMATCH:
      "Este convite foi enviado para outro endereço de e-mail. Saia e entre com o endereço que recebeu o convite.",
    MEMBERSHIP_SUSPENDED:
      "Seu acesso a esta empresa está suspenso. Fale com um administrador da empresa.",
    AUTHENTICATION_REQUIRED: "Sua sessão terminou. Entre novamente.",
    PERMISSION_DENIED: "Você não tem permissão para esta ação.",
    COMPANY_SUSPENDED:
      "Esta empresa está suspensa. Fale com o suporte do Teluni.",
    RECENT_AUTHENTICATION_REQUIRED:
      "Confirme sua identidade novamente para continuar.",
    RESOURCE_VERSION_CONFLICT:
      "Os dados mudaram enquanto você editava. Recarregue antes de tentar de novo.",
    BRANCH_NAME_IN_USE: "Já existe uma filial ativa com esse nome.",
    BRANCH_ARCHIVED: "Esta filial está arquivada e não pode ser alterada.",
    BRANCH_IN_USE:
      "Esta filial ainda tem telas pareadas. Mova ou desvincule as telas antes de arquivá-la.",
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
    PROFILE_NAME_IN_USE: "Já existe um perfil ativo com esse nome.",
    PROFILE_ARCHIVED: "Este perfil está arquivado e não pode ser alterado.",
    PROFILE_IN_USE:
      "Este perfil ainda tem acessos em vigor. Revogue-os antes de arquivá-lo.",
    PROFILE_LIMIT_REACHED:
      "A empresa atingiu o limite de 50 perfis ativos. Arquive um perfil sem uso antes de criar outro.",
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
  companyUnavailableTitle: "Company unavailable",
  companyContext: "Current company",
  switchCompany: "Switch company",
  companiesLead: "Companies you have access to.",
  companiesEmpty:
    "You are not part of any company yet. Create the first one in the form.",
  signInRequired: "Sign in to see your companies.",
  signIn: "Sign in",
  createTitle: "Create a company",
  companiesRecords: "Company records",
  companiesExport: "Companies",
  copyName: (name: string) => `${name} (copy)`,
  unsavedChanges: "Save or cancel the form changes to switch records.",
  settingsReadOnly: "You can view this company but not change its settings.",
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
  branchesTitle: "Branches",
  screensTitle: "Screens",
  mediaTitle: "Media",
  programmingTitle: "Programming",
  catalogsTitle: "Catalogs",
  branchesEmpty: "No branches yet.",
  branchesRecords: "Branch records",
  branchesExport: "Branches",
  branchStatus: "Status",
  branchReadOnly: "Only company administrators change branches.",
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
  grantRoleOrProfile: "Role or profile",
  grantRolesGroup: "Standard roles",
  grantProfilesGroup: "Custom profiles",
  grantProfile: "Profile",
  grantProfileIncludes: "This profile allows",
  grantProfilesUnavailable:
    "Custom profiles could not be loaded. Standard roles remain available.",
  capabilities: {
    "branches.view": "View branches",
    "invitations.manage": "Invite people",
    "audit.view": "View the change history",
    "devices.view": "View screens",
    "devices.manage": "Pair and manage screens",
    "media.view": "View and use media",
    "media.upload": "Upload and edit media",
    "media.archive": "Archive and restore media",
    "programming.view": "View programming",
    "programming.edit": "Build playlists and programming",
    "programming.assign": "Choose the screens' programming",
    "publications.publish": "Publish programming to screens",
    "catalogs.view": "View catalogs and prices",
    "catalogs.edit": "Edit catalog items",
    "catalogs.manage": "Create catalogs and change their fields",
    "prices.edit": "Change prices and promotions",
  },
  profilesTitle: "Access profiles",
  profilesLead:
    "Combine permissions into profiles named the way your company works and grant them to members, company-wide or for branches. Company administration is never part of a profile.",
  profilesEmpty: "No profiles yet.",
  profileCreateTitle: "Create a profile",
  profileName: "Profile name",
  profileCapabilities: "Permissions",
  profileCapabilitiesHint:
    "Inviting people, viewing the history and managing screens require two-step verification from whoever holds the profile.",
  profileCreate: "Create profile",
  profileEdit: "Edit profile",
  profileHolders: "Who holds this profile",
  profileNoHolders: "No member holds this profile now.",
  profileHoldersTruncated: "Showing the first 500 grants.",
  profileChangeConfirmation: (members: number) =>
    members === 1
      ? "The permission change applies immediately to 1 member with this profile. Confirm to save."
      : `The permission change applies immediately to ${members} members with this profile. Confirm to save.`,
  profileChangeConfirm: "Confirm change",
  profileUsage: (members: number, grants: number) =>
    `${members} ${members === 1 ? "member" : "members"} · ${grants} ${grants === 1 ? "current grant" : "current grants"}`,
  profileArchiveInUse:
    "Revoke the current grants of this profile before archiving it.",
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
  invitationsTitle: "Invitations",
  invitationsLead:
    "Invite people by email. Each invitation is valid for 7 days and only the person who signs in with the invited address can accept it.",
  invitationsEmpty: "No invitations yet.",
  inviteTitle: "Invite someone",
  inviteEmail: "Email address",
  inviteSubmit: "Send invitation",
  inviteSent: "Invitation created. The email will be sent shortly.",
  inviteManagerHint:
    "As a branch manager, you invite operators to the branches you manage.",
  invitationStatuses: {
    PENDING: "Awaiting acceptance",
    ACCEPTED: "Accepted",
    REVOKED: "Revoked",
    REPLACED: "Replaced by a resend",
    EXPIRED: "Expired",
  },
  deliveryStates: {
    PENDING: "Email queued",
    SENT: "Email handed to the mail service",
    FAILED: "Email could not be sent; resend the invitation",
    CANCELLED: "Email cancelled",
  },
  invitationAddressErased: "Address removed after the retention period",
  invitationUntil: "valid until",
  invitationBy: "Invited by",
  invitationResend: "Resend invitation",
  invitationRevoke: "Revoke invitation",
  invitationRevokeConfirmation:
    "This invitation's link stops working immediately.",
  acceptTitle: "Company invitation",
  acceptMissing:
    "This invitation link is incomplete or was already used in this browser. Open the link from the email again.",
  acceptSignIn:
    "Sign in with the email address that received the invitation to see and accept it.",
  acceptSignUp:
    "No account yet? Create one with the address that received the invitation, and open the confirmation link in this same tab.",
  signUp: "Create an account",
  acceptLead: "By accepting, you join this company with the access below.",
  acceptCompany: "Company",
  acceptAccess: "Access",
  acceptInvitedBy: "Invited by",
  acceptExpires: "The invitation is valid until",
  acceptButton: "Accept invitation",
  accepting: "Accepting…",
  acceptAlready: "You already accepted this invitation.",
  openCompany: "Open the company",
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
  historyLeadBranches:
    "Changes that involve only the branches you manage, from newest to oldest.",
  historyYou: "By you",
  historyMember: "By another member",
  historyUnknown: "Organization updated",
  historyRole: "Role",
  historyProfile: "Profile",
  historyActions: {
    "membership.status_changed": "Member access changed",
    "grant.created": "Role granted",
    "grant.revoked": "Role revoked",
    "responsibility.transfer_requested": "Responsibility transfer proposed",
    "responsibility.transferred": "Responsibility transferred",
    "responsibility.transfer_declined": "Responsibility transfer declined",
    "responsibility.transfer_cancelled": "Responsibility transfer cancelled",
    "invitation.created": "Invitation sent",
    "invitation.resent": "Invitation resent",
    "invitation.revoked": "Invitation revoked",
    "invitation.accepted": "Invitation accepted",
    "company.created": "Company created",
    "company.updated": "Company settings changed",
    "branch.created": "Branch created",
    "branch.updated": "Branch changed",
    "branch.archived": "Branch archived",
    "profile.created": "Access profile created",
    "profile.updated": "Access profile changed",
    "profile.archived": "Access profile archived",
  },
  historyFields: {
    displayName: "Company name",
    defaultLocale: "Default language",
    timeZone: "Time zone",
    name: "Branch name",
    profileName: "Profile name",
    capabilities: "Permissions",
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
    INVITATION_PENDING:
      "A pending invitation for this email already exists. Resend it instead of creating another.",
    INVITATION_NO_LONGER_VALID:
      "This invitation is no longer valid. Ask the person who invited you for a new one.",
    INVITATION_RECIPIENT_MISMATCH:
      "This invitation was sent to another email address. Sign out and sign in with the address that received it.",
    MEMBERSHIP_SUSPENDED:
      "Your access to this company is suspended. Contact a company administrator.",
    AUTHENTICATION_REQUIRED: "Your session ended. Sign in again.",
    PERMISSION_DENIED: "You do not have permission for this action.",
    COMPANY_SUSPENDED: "This company is suspended. Contact Teluni support.",
    RECENT_AUTHENTICATION_REQUIRED: "Confirm your identity again to continue.",
    RESOURCE_VERSION_CONFLICT:
      "The data changed while you were editing. Reload before trying again.",
    BRANCH_NAME_IN_USE: "Another active branch already uses that name.",
    BRANCH_ARCHIVED: "This branch is archived and cannot change.",
    BRANCH_IN_USE:
      "This branch still has paired screens. Move or unlink them before archiving it.",
    IDEMPOTENCY_KEY_REUSED:
      "The creation details changed. Reload the page before creating again.",
    VALIDATION_FAILED: "Check the fields and try again.",
    RESOURCE_NOT_FOUND: "Company or branch not found.",
    RATE_LIMITED: "Too many requests. Wait a moment and try again.",
    SERVICE_UNAVAILABLE: "The service is unavailable. Try again in a moment.",
    CSRF_VALIDATION_FAILED:
      "The request could not be verified. Reload the page.",
    SESSION_LIMIT_REACHED: "End another session to continue in this one.",
    PROFILE_NAME_IN_USE: "Another active profile already uses that name.",
    PROFILE_ARCHIVED: "This profile is archived and cannot change.",
    PROFILE_IN_USE:
      "This profile still has current grants. Revoke them before archiving it.",
    PROFILE_LIMIT_REACHED:
      "The company reached the limit of 50 active profiles. Archive an unused profile before creating another.",
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
