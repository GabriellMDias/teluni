import type { Locale } from "../locale.js";
import type { Erasure, Rotation } from "./api.js";

// Localized copy for screens (devices). Keys are stable code; only the text
// varies by locale.

const ptBR = {
  title: "Telas",
  lead: "Telas pareadas nas filiais que você pode ver.",
  backToCompany: "Voltar para a empresa",
  backToScreens: "Voltar para telas",
  empty: "Nenhuma tela pareada ainda.",
  pageEmpty:
    "Não há mais telas nesta página. Volte à primeira página para atualizar a lista.",
  nextPage: "Próxima página",
  firstPage: "Primeira página",
  filterBranch: "Filtrar por filial",
  filterStatus: "Filtrar por situação",
  filterAll: "Todas",
  statusActive: "Pareada",
  statusRevoked: "Desvinculada",
  erasure: {
    NONE: "",
    PENDING: "Limpeza pendente",
    CONFIRMED: "Limpeza confirmada pela tela",
    RESET_RECORDED: "Redefinição registrada",
  } satisfies Record<Erasure, string>,
  lastSeen: "Último contato",
  neverSeen: "Ainda não fez contato",
  authorizedUntil: "Pode exibir sem conexão até, no máximo",
  rotationLabel: "Rotação",
  timeZoneLabel: "Fuso horário",
  timeZoneHint: (zone: string) =>
    `Deixe em branco para seguir o fuso da filial (${zone}). Use um nome IANA, como America/Sao_Paulo.`,
  branchTimeZone: (zone: string) => `${zone} (da filial)`,
  programmingLink: "Ver a programação desta tela",
  rotations: {
    0: "Normal (0°)",
    90: "90°",
    180: "Invertida (180°)",
    270: "270°",
  } satisfies Record<Rotation, string>,
  pairTitle: "Parear uma tela",
  pairLead:
    "Abra o Teluni na TV e digite o código que aparece na tela. O código vale por 10 minutos.",
  fieldCode: "Código da TV",
  fieldName: "Nome da tela",
  fieldBranch: "Filial",
  pair: "Parear tela",
  pairing: "Pareando…",
  paired: "Tela pareada.",
  noBranches:
    "Nenhuma filial ativa disponível. Crie ou peça acesso a uma filial antes de parear.",
  branchesTruncated:
    "Apenas as primeiras 100 filiais aparecem aqui. Fale com o suporte se precisar de outra.",
  detailsTitle: "Detalhes",
  reportedModel: "Modelo informado",
  reportedDisplay: "Resolução informada",
  reportedApp: "Versão do aplicativo",
  pairedAt: "Pareada em",
  revokedAt: "Desvinculada em",
  reportNote:
    "Modelo, resolução e rotações são informados pela própria tela e não indicam suporte homologado.",
  editTitle: "Configurar",
  save: "Salvar",
  saving: "Salvando…",
  saved: "Alterações salvas.",
  moveTitle: "Mover para outra filial",
  moveTo: "Filial de destino",
  move: "Mover",
  moved: "Tela movida.",
  unlinkTitle: "Desvincular",
  unlinkLead:
    "A tela para de receber conteúdo e apaga seus dados quando se conectar de novo. Não é possível desfazer: para usá-la de novo, pareie-a outra vez.",
  unlink: "Desvincular tela",
  unlinkConfirm: (name: string) =>
    `Confirmo que quero desvincular “${name}” de forma definitiva.`,
  unlinked: "Tela desvinculada. A limpeza fica pendente até a tela confirmar.",
  resetTitle: "Registrar redefinição",
  resetLead:
    "Use se a tela não vai mais se conectar e foi redefinida manualmente. O registro fica separado da confirmação feita pela própria tela.",
  reset: "Registrar redefinição",
  resetRecorded: "Redefinição registrada.",
  cancel: "Cancelar",
  loading: "Carregando…",
  reload: "Recarregar",
  stepUpNotice:
    "Parear e administrar telas exige verificação em duas etapas nesta empresa.",
  stepUpButton: "Verificar em duas etapas",
  errors: {
    PAIRING_CODE_INVALID:
      "Código inválido ou expirado. Confira o código na TV ou gere um novo.",
    ROTATION_UNSUPPORTED: "Esta tela não informou suporte a essa rotação.",
    DEVICE_UNLINKED: "Esta tela já foi desvinculada e não pode ser alterada.",
    DEVICE_ERASURE_NOT_PENDING:
      "Não há limpeza pendente para esta tela. Recarregue para ver a situação atual.",
    BRANCH_ARCHIVED: "A filial escolhida está arquivada.",
    AUTHENTICATION_REQUIRED: "Sua sessão terminou. Entre novamente.",
    PERMISSION_DENIED: "Você não tem permissão para esta ação nesta filial.",
    COMPANY_SUSPENDED:
      "Esta empresa está suspensa. Fale com o suporte do Teluni.",
    STRONG_AUTHENTICATION_REQUIRED:
      "Esta ação exige verificação em duas etapas.",
    RESOURCE_VERSION_CONFLICT:
      "A tela mudou enquanto você editava. Recarregue antes de tentar de novo.",
    VALIDATION_FAILED: "Confira os campos e tente de novo.",
    RESOURCE_NOT_FOUND: "Tela ou filial não encontrada.",
    RATE_LIMITED: "Muitas tentativas. Aguarde alguns minutos e tente de novo.",
    SERVICE_UNAVAILABLE:
      "O serviço está indisponível. Tente novamente em instantes.",
    CSRF_VALIDATION_FAILED:
      "Não foi possível verificar a solicitação. Recarregue a página.",
  } as Record<string, string>,
  network: "Não foi possível conectar. Verifique a conexão e tente novamente.",
  unknownWrite:
    "Não foi possível confirmar se a ação foi concluída. Recarregue antes de tentar de novo.",
  generic: "Não foi possível concluir a solicitação.",
};

type Messages = Omit<typeof ptBR, "unlinkConfirm"> & {
  unlinkConfirm: (name: string) => string;
};

const enUS: Messages = {
  title: "Screens",
  lead: "Screens paired in the branches you can see.",
  backToCompany: "Back to the company",
  backToScreens: "Back to screens",
  empty: "No screens paired yet.",
  pageEmpty:
    "There are no more screens on this page. Go back to the first page to refresh the list.",
  nextPage: "Next page",
  firstPage: "First page",
  filterBranch: "Filter by branch",
  filterStatus: "Filter by status",
  filterAll: "All",
  statusActive: "Paired",
  statusRevoked: "Unlinked",
  erasure: {
    NONE: "",
    PENDING: "Erasure pending",
    CONFIRMED: "Erasure confirmed by the screen",
    RESET_RECORDED: "Reset recorded",
  },
  lastSeen: "Last seen",
  neverSeen: "Not seen yet",
  authorizedUntil: "May play offline until at most",
  rotationLabel: "Rotation",
  timeZoneLabel: "Time zone",
  timeZoneHint: (zone: string) =>
    `Leave empty to follow the branch's time zone (${zone}). Use an IANA name such as America/Sao_Paulo.`,
  branchTimeZone: (zone: string) => `${zone} (from the branch)`,
  programmingLink: "See this screen's programming",
  rotations: {
    0: "Normal (0°)",
    90: "90°",
    180: "Upside down (180°)",
    270: "270°",
  },
  pairTitle: "Pair a screen",
  pairLead:
    "Open Teluni on the TV and enter the code it shows. The code is valid for 10 minutes.",
  fieldCode: "TV code",
  fieldName: "Screen name",
  fieldBranch: "Branch",
  pair: "Pair screen",
  pairing: "Pairing…",
  paired: "Screen paired.",
  noBranches:
    "No active branch is available. Create a branch or ask for access before pairing.",
  branchesTruncated:
    "Only the first 100 branches are listed here. Contact support if you need another one.",
  detailsTitle: "Details",
  reportedModel: "Reported model",
  reportedDisplay: "Reported resolution",
  reportedApp: "App version",
  pairedAt: "Paired",
  revokedAt: "Unlinked",
  reportNote:
    "Model, resolution and rotations are reported by the screen itself and do not mean qualified support.",
  editTitle: "Configure",
  save: "Save",
  saving: "Saving…",
  saved: "Changes saved.",
  moveTitle: "Move to another branch",
  moveTo: "Destination branch",
  move: "Move",
  moved: "Screen moved.",
  unlinkTitle: "Unlink",
  unlinkLead:
    "The screen stops receiving content and erases its data when it next connects. This cannot be undone: to use it again, pair it again.",
  unlink: "Unlink screen",
  unlinkConfirm: (name: string) =>
    `I confirm I want to unlink “${name}” permanently.`,
  unlinked: "Screen unlinked. Erasure stays pending until the screen confirms.",
  resetTitle: "Record a reset",
  resetLead:
    "Use this when the screen will not connect again and was reset by hand. The record stays distinct from the screen's own confirmation.",
  reset: "Record reset",
  resetRecorded: "Reset recorded.",
  cancel: "Cancel",
  loading: "Loading…",
  reload: "Reload",
  stepUpNotice:
    "Pairing and managing screens requires two-step verification in this company.",
  stepUpButton: "Verify with two steps",
  errors: {
    PAIRING_CODE_INVALID:
      "Invalid or expired code. Check the code on the TV or get a new one.",
    ROTATION_UNSUPPORTED:
      "This screen did not report support for that rotation.",
    DEVICE_UNLINKED: "This screen was already unlinked and cannot change.",
    DEVICE_ERASURE_NOT_PENDING:
      "No erasure is pending for this screen. Reload to see its current state.",
    BRANCH_ARCHIVED: "The chosen branch is archived.",
    AUTHENTICATION_REQUIRED: "Your session ended. Sign in again.",
    PERMISSION_DENIED: "You are not allowed to do this in this branch.",
    COMPANY_SUSPENDED: "This company is suspended. Contact Teluni support.",
    STRONG_AUTHENTICATION_REQUIRED:
      "This action requires two-step verification.",
    RESOURCE_VERSION_CONFLICT:
      "The screen changed while you were editing. Reload before trying again.",
    VALIDATION_FAILED: "Check the fields and try again.",
    RESOURCE_NOT_FOUND: "Screen or branch not found.",
    RATE_LIMITED: "Too many attempts. Wait a few minutes and try again.",
    SERVICE_UNAVAILABLE: "The service is unavailable. Try again shortly.",
    CSRF_VALIDATION_FAILED:
      "The request could not be verified. Reload the page.",
  },
  network: "Could not connect. Check your connection and try again.",
  unknownWrite:
    "Could not confirm whether the action finished. Reload before trying again.",
  generic: "The request could not be completed.",
};

export const deviceMessages: Record<Locale, Messages> = {
  "pt-BR": ptBR,
  "en-US": enUS,
};
