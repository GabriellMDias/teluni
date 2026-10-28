import type { Locale } from "../locale.js";
import type { MediaKind, MediaStatus, RejectionReason } from "./api.js";

// Localized copy for the media library. Keys are stable code; only the text
// varies by locale.

const ptBR = {
  title: "Mídia",
  lead: "Imagens e vídeos da empresa e das filiais que você pode ver.",
  backToCompany: "Voltar para a empresa",
  backToMedia: "Voltar para mídia",
  empty: "Nenhuma mídia aqui ainda.",
  pageEmpty:
    "Não há mais itens nesta página. Volte à primeira página para atualizar a lista.",
  nextPage: "Próxima página",
  firstPage: "Primeira página",
  viewsLabel: "Visões da mídia",
  views: {
    library: "Biblioteca",
    archived: "Arquivadas",
    trash: "Lixeira",
  },
  filterKind: "Tipo",
  filterScope: "Escopo",
  filterText: "Buscar por nome",
  search: "Buscar",
  filterAll: "Todos",
  kinds: { IMAGE: "Imagem", VIDEO: "Vídeo" } satisfies Record<
    MediaKind,
    string
  >,
  companyScope: "Empresa (todas as filiais)",
  statuses: {
    UPLOADING: "Enviando",
    PROCESSING: "Preparando",
    READY: "Pronta",
    REJECTED: "Recusada",
    FAILED: "Falhou",
    ARCHIVED: "Arquivada",
    DELETED: "Na lixeira",
  } satisfies Record<MediaStatus, string>,
  stages: {
    queued: "Na fila",
    probing: "Verificando o arquivo",
    converting: "Convertendo",
    verifying: "Conferindo o resultado",
  } as Record<string, string>,
  rejections: {
    MEDIA_TYPE_MISMATCH: "O conteúdo do arquivo não corresponde ao tipo dele.",
    MEDIA_TYPE_UNSUPPORTED: "Formato ou codificação não suportados.",
    MEDIA_TOO_LARGE: "O arquivo passa do tamanho permitido.",
    MEDIA_DIMENSIONS_EXCEEDED:
      "Resolução, quantidade de pixels ou quadros por segundo acima do permitido.",
    MEDIA_DURATION_EXCEEDED: "O vídeo passa de 60 minutos.",
    MEDIA_UNREADABLE: "O arquivo está corrompido ou não pôde ser lido.",
    MEDIA_CONVERSION_FAILED: "Não foi possível preparar este arquivo.",
  } satisfies Record<RejectionReason, string>,
  failedHint:
    "O preparo falhou depois de várias tentativas. Descarte e envie o arquivo de novo.",
  uploadTitle: "Enviar arquivos",
  uploadLead:
    "Imagens JPEG, PNG ou WebP até 20 MB e vídeos MP4, MOV, WebM ou MKV até 1 GB e 60 minutos. O Teluni prepara cada arquivo para as telas.",
  uploadFiles: "Arquivos",
  uploadScope: "Disponível para",
  upload: "Enviar",
  uploading: "Enviando…",
  dropHint: "Ou arraste arquivos para cá.",
  uploadDone: "Enviado. Preparando para as telas.",
  uploadTooLarge: "Arquivo grande demais para este tipo.",
  uploadUnsupported: "Tipo de arquivo não aceito.",
  progress: (percent: number) => `${percent}%`,
  dimensions: (width: number, height: number) => `${width}×${height}`,
  duration: (seconds: number) => {
    const minutes = Math.floor(seconds / 60);
    const rest = String(seconds % 60).padStart(2, "0");
    return `${minutes}:${rest}`;
  },
  detailsTitle: "Detalhes",
  fieldKind: "Tipo",
  fieldScope: "Escopo",
  fieldStatus: "Situação",
  fieldDimensions: "Dimensões",
  fieldDuration: "Duração",
  fieldAudio: "Áudio",
  fieldSize: "Tamanho enviado",
  fieldCreated: "Enviada em",
  fieldPurge: "Exclusão definitiva em",
  yes: "Sim",
  no: "Não",
  downloadOriginal: "Baixar o original",
  previewUnavailable: "A prévia aparece quando o arquivo estiver pronto.",
  editTitle: "Nome e etiquetas",
  fieldName: "Nome",
  fieldTags: "Etiquetas (separadas por vírgula, até 10)",
  tags: "Etiquetas",
  save: "Salvar",
  saving: "Salvando…",
  saved: "Alterações salvas.",
  archiveTitle: "Arquivar",
  archiveLead:
    "Itens arquivados saem das novas seleções, mas continuam onde já estão em uso.",
  archive: "Arquivar",
  archived: "Mídia arquivada.",
  restore: "Restaurar",
  restored: "Mídia restaurada.",
  deleteTitle: "Mover para a lixeira",
  deleteLead:
    "A mídia fica na lixeira por 30 dias e depois é excluída de vez. Mídia em uso não pode ser excluída.",
  deleteConfirm: (name: string) =>
    `Confirmo que quero mover “${name}” para a lixeira.`,
  delete: "Mover para a lixeira",
  deleted: "Mídia movida para a lixeira.",
  restoreDeleted: "Restaurar da lixeira",
  discardTitle: "Descartar",
  discardLead: "Remove este envio, que não pode ser usado.",
  discard: "Descartar",
  discarded: "Envio descartado.",
  loading: "Carregando…",
  reload: "Recarregar",
  errors: {
    MEDIA_TYPE_UNSUPPORTED: "Tipo de arquivo não aceito.",
    MEDIA_TOO_LARGE: "Arquivo grande demais para este tipo.",
    MEDIA_UPLOAD_INCOMPLETE:
      "O envio não chegou completo. Descarte e envie de novo.",
    MEDIA_NOT_UPLOADING: "Este item já recebeu o arquivo.",
    MEDIA_NOT_READY: "A mídia ainda não está pronta.",
    MEDIA_IN_USE:
      "Esta mídia está em uso em uma programação ou publicação e não pode ser excluída.",
    MEDIA_STORAGE_FULL:
      "O armazenamento de mídia está cheio. Fale com o suporte do Teluni.",
    MEDIA_INVALID_STATE:
      "Esta ação não vale para a situação atual da mídia. Recarregue a página.",
    BRANCH_ARCHIVED: "A filial escolhida está arquivada.",
    AUTHENTICATION_REQUIRED: "Sua sessão terminou. Entre novamente.",
    PERMISSION_DENIED: "Você não tem permissão para esta ação neste escopo.",
    COMPANY_SUSPENDED:
      "Esta empresa está suspensa. Fale com o suporte do Teluni.",
    RESOURCE_VERSION_CONFLICT:
      "A mídia mudou enquanto você editava. Recarregue antes de tentar de novo.",
    VALIDATION_FAILED: "Confira os campos e tente de novo.",
    RESOURCE_NOT_FOUND: "Mídia ou filial não encontrada.",
    RATE_LIMITED:
      "Muitos envios em andamento ou tentativas. Aguarde e tente de novo.",
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

type Messages = typeof ptBR;

const enUS: Messages = {
  title: "Media",
  lead: "Images and videos of the company and of the branches you can see.",
  backToCompany: "Back to the company",
  backToMedia: "Back to media",
  empty: "No media here yet.",
  pageEmpty:
    "There are no more items on this page. Go back to the first page to refresh the list.",
  nextPage: "Next page",
  firstPage: "First page",
  viewsLabel: "Media views",
  views: {
    library: "Library",
    archived: "Archived",
    trash: "Trash",
  },
  filterKind: "Kind",
  filterScope: "Scope",
  filterText: "Search by name",
  search: "Search",
  filterAll: "All",
  kinds: { IMAGE: "Image", VIDEO: "Video" },
  companyScope: "Company (all branches)",
  statuses: {
    UPLOADING: "Uploading",
    PROCESSING: "Preparing",
    READY: "Ready",
    REJECTED: "Rejected",
    FAILED: "Failed",
    ARCHIVED: "Archived",
    DELETED: "In the trash",
  },
  stages: {
    queued: "Queued",
    probing: "Checking the file",
    converting: "Converting",
    verifying: "Checking the result",
  },
  rejections: {
    MEDIA_TYPE_MISMATCH: "The file's content does not match its type.",
    MEDIA_TYPE_UNSUPPORTED: "Unsupported format or encoding.",
    MEDIA_TOO_LARGE: "The file is larger than allowed.",
    MEDIA_DIMENSIONS_EXCEEDED:
      "Resolution, pixel count or frame rate above the limit.",
    MEDIA_DURATION_EXCEEDED: "The video is longer than 60 minutes.",
    MEDIA_UNREADABLE: "The file is corrupted or could not be read.",
    MEDIA_CONVERSION_FAILED: "This file could not be prepared.",
  },
  failedHint:
    "Preparation failed after several attempts. Discard it and upload the file again.",
  uploadTitle: "Upload files",
  uploadLead:
    "JPEG, PNG or WebP images up to 20 MB and MP4, MOV, WebM or MKV videos up to 1 GB and 60 minutes. Teluni prepares each file for screens.",
  uploadFiles: "Files",
  uploadScope: "Available to",
  upload: "Upload",
  uploading: "Uploading…",
  dropHint: "Or drag files here.",
  uploadDone: "Uploaded. Preparing for screens.",
  uploadTooLarge: "File too large for its type.",
  uploadUnsupported: "File type not accepted.",
  progress: (percent: number) => `${percent}%`,
  dimensions: (width: number, height: number) => `${width}×${height}`,
  duration: (seconds: number) => {
    const minutes = Math.floor(seconds / 60);
    const rest = String(seconds % 60).padStart(2, "0");
    return `${minutes}:${rest}`;
  },
  detailsTitle: "Details",
  fieldKind: "Kind",
  fieldScope: "Scope",
  fieldStatus: "Status",
  fieldDimensions: "Dimensions",
  fieldDuration: "Duration",
  fieldAudio: "Audio",
  fieldSize: "Uploaded size",
  fieldCreated: "Uploaded",
  fieldPurge: "Permanently deleted on",
  yes: "Yes",
  no: "No",
  downloadOriginal: "Download the original",
  previewUnavailable: "The preview appears when the file is ready.",
  editTitle: "Name and tags",
  fieldName: "Name",
  fieldTags: "Tags (comma separated, up to 10)",
  tags: "Tags",
  save: "Save",
  saving: "Saving…",
  saved: "Changes saved.",
  archiveTitle: "Archive",
  archiveLead:
    "Archived items leave new selections but keep playing where they are already used.",
  archive: "Archive",
  archived: "Media archived.",
  restore: "Restore",
  restored: "Media restored.",
  deleteTitle: "Move to the trash",
  deleteLead:
    "Media stays in the trash for 30 days and is then permanently deleted. Media in use cannot be deleted.",
  deleteConfirm: (name: string) =>
    `I confirm I want to move “${name}” to the trash.`,
  delete: "Move to the trash",
  deleted: "Media moved to the trash.",
  restoreDeleted: "Restore from the trash",
  discardTitle: "Discard",
  discardLead: "Removes this upload, which cannot be used.",
  discard: "Discard",
  discarded: "Upload discarded.",
  loading: "Loading…",
  reload: "Reload",
  errors: {
    MEDIA_TYPE_UNSUPPORTED: "File type not accepted.",
    MEDIA_TOO_LARGE: "File too large for its type.",
    MEDIA_UPLOAD_INCOMPLETE:
      "The upload did not arrive complete. Discard it and upload again.",
    MEDIA_NOT_UPLOADING: "This item already received its file.",
    MEDIA_NOT_READY: "The media is not ready yet.",
    MEDIA_IN_USE:
      "This media is used by a schedule or publication and cannot be deleted.",
    MEDIA_STORAGE_FULL: "Media storage is full. Contact Teluni support.",
    MEDIA_INVALID_STATE:
      "This action does not apply to the media's current status. Reload the page.",
    BRANCH_ARCHIVED: "The chosen branch is archived.",
    AUTHENTICATION_REQUIRED: "Your session ended. Sign in again.",
    PERMISSION_DENIED: "You are not allowed to do this in this scope.",
    COMPANY_SUSPENDED: "This company is suspended. Contact Teluni support.",
    RESOURCE_VERSION_CONFLICT:
      "The media changed while you were editing. Reload before trying again.",
    VALIDATION_FAILED: "Check the fields and try again.",
    RESOURCE_NOT_FOUND: "Media or branch not found.",
    RATE_LIMITED:
      "Too many uploads in progress or attempts. Wait and try again.",
    SERVICE_UNAVAILABLE: "The service is unavailable. Try again shortly.",
    CSRF_VALIDATION_FAILED:
      "The request could not be verified. Reload the page.",
  },
  network: "Could not connect. Check your connection and try again.",
  unknownWrite:
    "Could not confirm whether the action finished. Reload before trying again.",
  generic: "The request could not be completed.",
};

export const mediaMessages: Record<Locale, Messages> = {
  "pt-BR": ptBR,
  "en-US": enUS,
};
