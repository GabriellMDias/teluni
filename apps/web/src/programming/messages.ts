import type { Locale } from "../locale.js";
import type { Transition } from "./api.js";

// Localized copy for programming. Keys are stable code; only the text varies
// by locale.

const ptBR = {
  title: "Programação",
  lead: "Playlists, grupos de telas e horários. Tudo aqui é rascunho até ser publicado.",
  backToCompany: "Voltar para a empresa",
  backToProgramming: "Voltar para programação",
  viewsLabel: "Seções da programação",
  views: { playlists: "Playlists", groups: "Grupos" },
  loading: "Carregando…",
  reload: "Recarregar",
  filterText: "Buscar por nome",
  search: "Buscar",
  nextPage: "Próxima página",
  firstPage: "Primeira página",
  pageEmpty:
    "Não há mais itens nesta página. Volte à primeira página para atualizar a lista.",
  companyScope: "Empresa (todas as filiais)",
  fieldName: "Nome",
  fieldScope: "Disponível para",
  create: "Criar",
  creating: "Criando…",
  save: "Salvar",
  saving: "Salvando…",
  saved: "Alterações salvas.",
  playlistsEmpty: "Nenhuma playlist ainda.",
  createPlaylistTitle: "Nova playlist",
  playlistSummary: (items: number, duration: string, videos: number) =>
    `${items === 1 ? "1 item" : `${items} itens`} · ${duration}${
      videos > 0 ? ` · ${videos === 1 ? "1 vídeo" : `${videos} vídeos`}` : ""
    }`,
  settingsTitle: "Nome e transição",
  transitionLabel: "Transição entre itens",
  transitions: {
    CUT: "Corte seco",
    FADE: "Esmaecer",
  } satisfies Record<Transition, string>,
  fadeLabel: "Duração do esmaecimento (ms, de 250 a 2.000)",
  fadeHint:
    "Na publicação, o esmaecimento só vale para telas qualificadas para ele.",
  itemsTitle: "Itens",
  itemsLead:
    "Os itens tocam em ordem e a playlist recomeça ao final. Imagens ficam de 1 a 3.600 segundos na tela; vídeos tocam inteiros.",
  itemsEmpty: "A playlist está vazia.",
  itemPosition: (position: number, name: string) => `${position}. ${name}`,
  moveUp: "Subir",
  moveDown: "Descer",
  remove: "Remover",
  itemSeconds: (name: string) => `Segundos na tela: ${name}`,
  videoFull: "Vídeo inteiro",
  archivedItem: "Arquivada, continua tocando",
  unavailableItem: "Indisponível",
  pickerTitle: "Adicionar da biblioteca",
  pickerLead: "Aparecem só as mídias prontas que cabem nesta playlist.",
  pickerEmpty: "Nenhuma mídia pronta disponível.",
  add: (name: string) => `Adicionar ${name}`,
  saveItems: "Salvar itens",
  itemsSaved: "Itens salvos.",
  unsaved: "Há alterações não salvas.",
  deletePlaylistTitle: "Excluir playlist",
  deletePlaylistLead:
    "A exclusão é definitiva. Uma playlist usada em horários ou como padrão não pode ser excluída.",
  deletePlaylistConfirm: (name: string) =>
    `Confirmo que quero excluir a playlist “${name}”.`,
  deletePlaylist: "Excluir playlist",
  groupsEmpty: "Nenhum grupo ainda.",
  createGroupTitle: "Novo grupo",
  allBranches: "Todas as filiais da empresa",
  spanLabel: "Filiais do grupo",
  spanHint: "Só telas dessas filiais podem entrar no grupo.",
  spanAll: "Todas as filiais",
  memberCount: (count: number) => (count === 1 ? "1 tela" : `${count} telas`),
  membersTitle: "Telas do grupo",
  membersEmpty:
    "Nenhuma tela no grupo. Escolha o grupo na programação de cada tela.",
  groupSettingsTitle: "Nome e filiais",
  deleteGroupTitle: "Excluir grupo",
  deleteGroupLead:
    "Os horários do grupo são excluídos junto. Grupos com telas não podem ser excluídos.",
  deleteGroupConfirm: (name: string) =>
    `Confirmo que quero excluir o grupo “${name}”.`,
  deleteGroup: "Excluir grupo",
  schedulesTitle: "Horários",
  schedulesLead:
    "Cada horário vale no fuso de cada tela. O início conta e o fim não; um fim antes do início termina no dia seguinte. Horários não podem se sobrepor.",
  noPlaylists: "Crie uma playlist antes de montar horários.",
  addRule: "Adicionar horário",
  ruleLabel: (position: number) => `Horário ${position}`,
  rulePlaylist: "Playlist",
  choosePlaylist: "Escolha uma playlist",
  weekdaysLabel: "Dias em que começa",
  weekdays: {
    1: "Seg",
    2: "Ter",
    3: "Qua",
    4: "Qui",
    5: "Sex",
    6: "Sáb",
    7: "Dom",
  } as Record<number, string>,
  allDay: "Dia inteiro",
  startTime: "Início",
  endTime: "Fim",
  startsOn: "A partir de",
  endsOn: "Até (opcional)",
  removeRule: (position: number) => `Remover o horário ${position}`,
  defaultPlaylist: "Playlist padrão, quando nenhum horário vale",
  noDefault: "Nenhuma (tela neutra)",
  saveSchedules: "Salvar horários",
  schedulesSaved: "Horários salvos.",
  ruleIncomplete:
    "Escolha a playlist, ao menos um dia e, fora do dia inteiro, início e fim.",
  ruleTimesEqual: "Início e fim iguais. Para o dia todo, use Dia inteiro.",
  ruleConflict: (other: number, date: string) =>
    `Sobrepõe o horário ${other} a partir de ${date}.`,
  timelineTitle: "Prévia dos próximos 7 dias",
  timelineZone: (zone: string) => `Horários no fuso ${zone}.`,
  timelineZoneLabel: "Fuso da prévia",
  timelineStart: "Início",
  timelineEnd: "Fim",
  timelinePlays: "O que passa",
  segmentNone: "Tela neutra",
  segmentDefault: (name: string) => `${name} (padrão)`,
  noteGap: (local: string, resolved: string) =>
    `${local} não existe nesse dia por causa da mudança de horário; vale a partir de ${resolved}.`,
  noteRepeated: (local: string, resolved: string) =>
    `${local} acontece duas vezes por causa da mudança de horário; vale ${resolved}.`,
  sourceLabel: "Origem da programação",
  sources: { group: "Grupo", individual: "Programação própria" },
  zoneLabel: "Fuso horário",
  branchZone: (zone: string) => `${zone} (da filial)`,
  branchLabel: "Filial",
  assignmentTitle: "Grupo e programação própria",
  groupLabel: "Grupo",
  noGroup: "Nenhum grupo",
  individualLabel: "Usar a programação própria desta tela (continua no grupo)",
  confirmUnpublished:
    "Confirmo: ainda não há publicação, então a tela mostra a tela neutra até a programação ser publicada.",
  assign: "Salvar escolha",
  assigned: "Escolha salva.",
  groupSchedules: "Editar os horários do grupo",
  screenLink: "Voltar para a tela",
  stepUpNotice:
    "Escolher a programação das telas exige verificação em duas etapas nesta empresa.",
  stepUpButton: "Verificar em duas etapas",
  errors: {
    PROGRAMMING_LIMIT_REACHED:
      "A empresa chegou a um limite de programação: 1.000 playlists, 100 grupos, 2.000 programações, 500 itens por playlist ou 200 horários.",
    PLAYLIST_IN_USE:
      "Esta playlist é usada em horários ou como padrão e não pode ser excluída.",
    PLAYLIST_SCOPE_MISMATCH:
      "Uma playlist ou mídia é de uma filial que esta programação não cobre. Use conteúdo da empresa ou dessa única filial.",
    GROUP_NAME_IN_USE: "Já existe um grupo com este nome.",
    GROUP_HAS_MEMBERS: "Tire as telas do grupo antes de excluí-lo.",
    GROUP_SPAN_EXCLUDES_DEVICE:
      "O grupo não cobre a filial da tela. Mude as filiais do grupo ou escolha outro.",
    SCHEDULE_TIMES_EQUAL:
      "Um horário começa e termina na mesma hora. Para o dia todo, use Dia inteiro.",
    SCHEDULE_CONFLICT: "Dois horários se sobrepõem.",
    ASSIGNMENT_CONFIRMATION_REQUIRED:
      "Confirme que a tela vai mostrar a tela neutra até a publicação.",
    TIMELINE_TOO_LARGE:
      "O período tem mudanças demais para mostrar de uma vez.",
    MEDIA_NOT_READY: "Uma das mídias não está pronta ou foi arquivada.",
    DEVICE_UNLINKED: "Esta tela foi desvinculada.",
    BRANCH_ARCHIVED: "A filial escolhida está arquivada.",
    AUTHENTICATION_REQUIRED: "Sua sessão terminou. Entre novamente.",
    PERMISSION_DENIED: "Você não tem permissão para esta ação neste escopo.",
    COMPANY_SUSPENDED:
      "Esta empresa está suspensa. Fale com o suporte do Teluni.",
    STRONG_AUTHENTICATION_REQUIRED:
      "Esta ação exige verificação em duas etapas.",
    RESOURCE_VERSION_CONFLICT:
      "Isto mudou enquanto você editava. Recarregue antes de tentar de novo.",
    VALIDATION_FAILED: "Confira os campos e tente de novo.",
    RESOURCE_NOT_FOUND: "Item não encontrado.",
    RATE_LIMITED: "Muitas tentativas. Aguarde e tente de novo.",
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
  title: "Programming",
  lead: "Playlists, screen groups and schedules. Everything here is a draft until it is published.",
  backToCompany: "Back to the company",
  backToProgramming: "Back to programming",
  viewsLabel: "Programming sections",
  views: { playlists: "Playlists", groups: "Groups" },
  loading: "Loading…",
  reload: "Reload",
  filterText: "Search by name",
  search: "Search",
  nextPage: "Next page",
  firstPage: "First page",
  pageEmpty:
    "There are no more items on this page. Go back to the first page to refresh the list.",
  companyScope: "Company (all branches)",
  fieldName: "Name",
  fieldScope: "Available to",
  create: "Create",
  creating: "Creating…",
  save: "Save",
  saving: "Saving…",
  saved: "Changes saved.",
  playlistsEmpty: "No playlists yet.",
  createPlaylistTitle: "New playlist",
  playlistSummary: (items: number, duration: string, videos: number) =>
    `${items === 1 ? "1 item" : `${items} items`} · ${duration}${
      videos > 0 ? ` · ${videos === 1 ? "1 video" : `${videos} videos`}` : ""
    }`,
  settingsTitle: "Name and transition",
  transitionLabel: "Transition between items",
  transitions: { CUT: "Cut", FADE: "Fade" },
  fadeLabel: "Fade duration (ms, 250 to 2,000)",
  fadeHint: "At publication, fades apply only to screens qualified for them.",
  itemsTitle: "Items",
  itemsLead:
    "Items play in order and the playlist starts over at the end. Images stay on screen for 1 to 3,600 seconds; videos play in full.",
  itemsEmpty: "The playlist is empty.",
  itemPosition: (position: number, name: string) => `${position}. ${name}`,
  moveUp: "Move up",
  moveDown: "Move down",
  remove: "Remove",
  itemSeconds: (name: string) => `Seconds on screen: ${name}`,
  videoFull: "Whole video",
  archivedItem: "Archived, keeps playing",
  unavailableItem: "Unavailable",
  pickerTitle: "Add from the library",
  pickerLead: "Only ready media that fits this playlist is shown.",
  pickerEmpty: "No ready media available.",
  add: (name: string) => `Add ${name}`,
  saveItems: "Save items",
  itemsSaved: "Items saved.",
  unsaved: "There are unsaved changes.",
  deletePlaylistTitle: "Delete playlist",
  deletePlaylistLead:
    "Deletion is permanent. A playlist used by schedules or as a default cannot be deleted.",
  deletePlaylistConfirm: (name: string) =>
    `I confirm I want to delete the playlist “${name}”.`,
  deletePlaylist: "Delete playlist",
  groupsEmpty: "No groups yet.",
  createGroupTitle: "New group",
  allBranches: "All branches of the company",
  spanLabel: "Branches of the group",
  spanHint: "Only screens of these branches can join the group.",
  spanAll: "All branches",
  memberCount: (count: number) =>
    count === 1 ? "1 screen" : `${count} screens`,
  membersTitle: "Screens of the group",
  membersEmpty:
    "No screens in the group. Choose the group on each screen's programming.",
  groupSettingsTitle: "Name and branches",
  deleteGroupTitle: "Delete group",
  deleteGroupLead:
    "The group's schedules are deleted with it. Groups with screens cannot be deleted.",
  deleteGroupConfirm: (name: string) =>
    `I confirm I want to delete the group “${name}”.`,
  deleteGroup: "Delete group",
  schedulesTitle: "Schedules",
  schedulesLead:
    "Each schedule applies in each screen's time zone. The start is included and the end is not; an end before the start finishes on the next day. Schedules cannot overlap.",
  noPlaylists: "Create a playlist before building schedules.",
  addRule: "Add schedule",
  ruleLabel: (position: number) => `Schedule ${position}`,
  rulePlaylist: "Playlist",
  choosePlaylist: "Choose a playlist",
  weekdaysLabel: "Days it starts",
  weekdays: {
    1: "Mon",
    2: "Tue",
    3: "Wed",
    4: "Thu",
    5: "Fri",
    6: "Sat",
    7: "Sun",
  },
  allDay: "All day",
  startTime: "Start",
  endTime: "End",
  startsOn: "From",
  endsOn: "Until (optional)",
  removeRule: (position: number) => `Remove schedule ${position}`,
  defaultPlaylist: "Default playlist, when no schedule applies",
  noDefault: "None (neutral screen)",
  saveSchedules: "Save schedules",
  schedulesSaved: "Schedules saved.",
  ruleIncomplete:
    "Choose the playlist, at least one day and, unless all day, a start and an end.",
  ruleTimesEqual: "Start and end are equal. For the whole day, use All day.",
  ruleConflict: (other: number, date: string) =>
    `Overlaps schedule ${other} from ${date}.`,
  timelineTitle: "Preview of the next 7 days",
  timelineZone: (zone: string) => `Times in the ${zone} time zone.`,
  timelineZoneLabel: "Preview time zone",
  timelineStart: "Start",
  timelineEnd: "End",
  timelinePlays: "What plays",
  segmentNone: "Neutral screen",
  segmentDefault: (name: string) => `${name} (default)`,
  noteGap: (local: string, resolved: string) =>
    `${local} does not exist that day because of a clock change; it applies from ${resolved}.`,
  noteRepeated: (local: string, resolved: string) =>
    `${local} happens twice because of a clock change; ${resolved} applies.`,
  sourceLabel: "Programming source",
  sources: { group: "Group", individual: "Own programming" },
  zoneLabel: "Time zone",
  branchZone: (zone: string) => `${zone} (from the branch)`,
  branchLabel: "Branch",
  assignmentTitle: "Group and own programming",
  groupLabel: "Group",
  noGroup: "No group",
  individualLabel: "Use this screen's own programming (it stays in the group)",
  confirmUnpublished:
    "I confirm: nothing is published yet, so the screen shows a neutral screen until the programming is published.",
  assign: "Save choice",
  assigned: "Choice saved.",
  groupSchedules: "Edit the group's schedules",
  screenLink: "Back to the screen",
  stepUpNotice:
    "Choosing the screens' programming requires two-step verification in this company.",
  stepUpButton: "Verify with two steps",
  errors: {
    PROGRAMMING_LIMIT_REACHED:
      "The company reached a programming limit: 1,000 playlists, 100 groups, 2,000 programs, 500 items per playlist or 200 schedules.",
    PLAYLIST_IN_USE:
      "This playlist is used by schedules or as a default and cannot be deleted.",
    PLAYLIST_SCOPE_MISMATCH:
      "A playlist or media item belongs to a branch this programming does not cover. Use company content or content of that single branch.",
    GROUP_NAME_IN_USE: "A group with this name already exists.",
    GROUP_HAS_MEMBERS: "Remove the screens from the group before deleting it.",
    GROUP_SPAN_EXCLUDES_DEVICE:
      "The group does not cover the screen's branch. Change the group's branches or choose another group.",
    SCHEDULE_TIMES_EQUAL:
      "A schedule starts and ends at the same time. For the whole day, use All day.",
    SCHEDULE_CONFLICT: "Two schedules overlap.",
    ASSIGNMENT_CONFIRMATION_REQUIRED:
      "Confirm that the screen shows a neutral screen until publication.",
    TIMELINE_TOO_LARGE: "The period has too many changes to show at once.",
    MEDIA_NOT_READY: "One of the media items is not ready or was archived.",
    DEVICE_UNLINKED: "This screen was unlinked.",
    BRANCH_ARCHIVED: "The chosen branch is archived.",
    AUTHENTICATION_REQUIRED: "Your session ended. Sign in again.",
    PERMISSION_DENIED: "You are not allowed to do this in this scope.",
    COMPANY_SUSPENDED: "This company is suspended. Contact Teluni support.",
    STRONG_AUTHENTICATION_REQUIRED:
      "This action requires two-step verification.",
    RESOURCE_VERSION_CONFLICT:
      "This changed while you were editing. Reload before trying again.",
    VALIDATION_FAILED: "Check the fields and try again.",
    RESOURCE_NOT_FOUND: "Item not found.",
    RATE_LIMITED: "Too many attempts. Wait and try again.",
    SERVICE_UNAVAILABLE: "The service is unavailable. Try again shortly.",
    CSRF_VALIDATION_FAILED:
      "The request could not be verified. Reload the page.",
  },
  network: "Could not connect. Check your connection and try again.",
  unknownWrite:
    "Could not confirm whether the action finished. Reload before trying again.",
  generic: "The request could not be completed.",
};

export const programmingMessages: Record<Locale, Messages> = {
  "pt-BR": ptBR,
  "en-US": enUS,
};
