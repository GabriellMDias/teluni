import type { Locale } from "../locale.js";
import type { Transition } from "./api.js";

// Localized copy for programming. Keys are stable code; only the text varies
// by locale.

const ptBR = {
  title: "Programação",
  lead: "Playlists, layouts, grupos de telas e horários. Tudo aqui é rascunho até ser publicado.",
  backToCompany: "Voltar para a empresa",
  backToProgramming: "Voltar para programação",
  viewsLabel: "Seções da programação",
  views: { playlists: "Playlists", layouts: "Layouts", groups: "Grupos" },
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
  schedulesFor: (output: string) => `Horários: ${output}`,
  layoutTitle: "Layout da tela",
  layoutLead:
    "Sem layout, a programação tem uma única saída para a tela inteira. Com um layout, cada área tem os seus próprios horários.",
  layoutLabel: "Layout",
  noLayout: "Sem layout (tela inteira)",
  useLayout: "Usar este layout",
  layoutChosen: "Layout escolhido.",
  openLayout: (name: string) => `Abrir o layout ${name}`,
  layoutConfirmLead: "Estas saídas perdem horários ou a playlist padrão:",
  outputRemoved: (output: string, rules: number) =>
    `${output}: deixa de existir${
      rules > 0 ? ` (${rules === 1 ? "1 horário" : `${rules} horários`})` : ""
    }.`,
  defaultRemoved: (output: string) =>
    `${output}: perde a playlist padrão e passa a mostrar a visão do catálogo.`,
  layoutConfirm: "Confirmo que quero remover esses horários e padrões.",
  outputLabel: "Área",
  timelineOutputLabel: "Área na prévia",
  wholeScreen: "Tela inteira",
  areaOutput: (name: string, kind: string) => `${name} (${kind})`,
  outputKinds: { media: "mídia", catalog: "catálogo" },
  viewDefault:
    "O padrão desta área é a visão do catálogo; os horários podem trocá-la por playlists.",
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
  segmentView: "Visão do catálogo",
  hiddenPlaylist: "Playlist fora do seu acesso",
  hiddenPlaylists:
    "Esta programação usa playlists fora do seu acesso, como as da filial anterior da tela. Troque-as para salvar.",
  segmentDefault: (name: string) => `${name} (padrão)`,
  noteGap: (local: string, resolved: string) =>
    `${local} não existe nesse dia por causa da mudança de horário; vale a partir de ${resolved}.`,
  noteRepeated: (local: string, resolved: string) =>
    `${local} acontece duas vezes por causa da mudança de horário; vale ${resolved}.`,
  sourceLabel: "Origem da programação",
  sources: { group: "Grupo", individual: "Programação própria" },
  hiddenGroup: "Grupo com filiais fora do seu acesso",
  hiddenGroupSchedules:
    "Esta tela segue um grupo com filiais fora do seu acesso. Os horários dele são editados por quem tem acesso a todas essas filiais.",
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
  publishedDestination: (generation: number) =>
    `O destino escolhido tem a geração ${generation} publicada; a tela passa a exibi-la na próxima sincronização.`,
  publication: {
    title: "Publicação",
    lead: "Publicar torna o rascunho atual uma nova geração, que as telas recebem em até 30 segundos quando conectadas.",
    never:
      "Nada foi publicado ainda: as telas desta programação mostram a tela neutra.",
    current: (generation: number, when: string, byYou: boolean) =>
      `Geração ${generation}, publicada em ${when} ${byYou ? "por você" : "por outro membro"}.`,
    stepUp: "Publicar exige verificação em duas etapas.",
    review: "Revisar para publicar",
    reviewing: "Revisando…",
    reviewTitle: "Revisão da publicação",
    unchanged:
      "O rascunho é igual à geração publicada. Não há nada novo a publicar.",
    summary: (
      rules: number,
      playlists: number,
      items: number,
      media: number,
      size: string,
    ) =>
      `${rules === 1 ? "1 horário" : `${rules} horários`} · ${
        playlists === 1 ? "1 playlist" : `${playlists} playlists`
      } · ${items === 1 ? "1 item" : `${items} itens`} · ${
        media === 1 ? "1 mídia" : `${media} mídias`
      } (${size})`,
    followers: (count: number) =>
      count === 0
        ? "Nenhuma tela segue esta programação agora."
        : count === 1
          ? "1 tela segue esta programação e vai recebê-la."
          : `${count} telas seguem esta programação e vão recebê-la.`,
    problemsTitle: "Corrija antes de publicar",
    problems: {
      NOTHING_TO_PUBLISH: "Esta programação ainda não tem horários nem padrão.",
      LAYOUT_NOT_PUBLISHABLE:
        "Programações com layout serão publicadas pelo protocolo 2 das telas, que ainda não está disponível.",
      SCHEDULE_INVALID:
        "Os horários salvos não passam mais na validação. Revise-os e salve de novo.",
      PLAYLIST_OUT_OF_SCOPE:
        "Uma playlist é de uma filial que esta programação não cobre, como a filial anterior da tela.",
      MEDIA_UNAVAILABLE: "Uma mídia de uma playlist não está mais disponível.",
      TRANSITION_UNSUPPORTED:
        "Uma playlist usa a transição Esmaecer, que ainda não foi qualificada nas telas. Use Corte seco para publicar.",
      TOO_LARGE: "A publicação passa de 2.000 itens ou 1.000 mídias.",
    } as Record<string, string>,
    publish: "Publicar agora",
    publishing: "Publicando…",
    cancel: "Cancelar",
    published: (generation: number) =>
      `Geração ${generation} publicada. As telas conectadas recebem em até 30 segundos.`,
    alreadyPublished: (generation: number) =>
      `O conteúdo já era a geração ${generation}; nada mudou.`,
    changedSinceReview:
      "A programação mudou depois da revisão. Revise de novo antes de publicar.",
    historyTitle: "Gerações publicadas",
    historyEmpty: "Nenhuma geração ainda.",
    generation: (generation: number) => `Geração ${generation}`,
    restoredFrom: (generation: number) => `restaura a geração ${generation}`,
    byYou: "por você",
    byOther: "por outro membro",
    states: {
      current: "atual",
      retained: "pode ser restaurada",
      pruned: "não é mais guardada",
    },
    restore: "Restaurar",
    restoreConfirm: (generation: number) =>
      `Publicar de novo o conteúdo da geração ${generation}? Os rascunhos não mudam.`,
    restoreYes: "Restaurar como nova geração",
    restoring: "Restaurando…",
    restored: (generation: number) =>
      `Conteúdo restaurado como geração ${generation}.`,
    more: "Gerações anteriores",
    membersSync: "Sincronização das telas",
  },
  layouts: {
    listEmpty: "Nenhum layout ainda.",
    createTitle: "Novo layout",
    orientationLabel: "Orientação da tela",
    orientations: {
      landscape: "Horizontal (1920 × 1080)",
      portrait: "Vertical (1080 × 1920)",
    },
    firstAreaName: "Principal",
    summary: (areas: number, pages: number) =>
      `${areas === 1 ? "1 área" : `${areas} áreas`}${
        pages > 0 ? ` · ${pages} páginas` : ""
      }`,
    importTitle: "Importar layout",
    importLead:
      "Escolha um arquivo .json exportado do Teluni. Catálogos, campos e mídias que você não pode usar aparecem como problemas para trocar.",
    importFile: "Arquivo do layout",
    importing: "Importando…",
    import: "Importar",
    importUnreadable:
      "Não foi possível ler o arquivo. Use um .json exportado do Teluni, com até 512 KB.",
    canvasLabel: (name: string) => `Tela do layout ${name}`,
    canvasHint:
      "Arraste uma área para mover e o canto para redimensionar. Com a área selecionada, as setas movem 10 unidades e Shift + setas mudam o tamanho.",
    areaButton: (name: string, kind: string) => `${name} (${kind})`,
    kinds: { media: "Mídia", catalog: "Catálogo" },
    areasTitle: "Áreas",
    addMediaArea: "Adicionar área de mídia",
    addCatalogArea: "Adicionar área de catálogo",
    newAreaName: (number: number) => `Área ${number}`,
    selectedTitle: (name: string) => `Área “${name}”`,
    noSelection: "Selecione uma área na tela ou na lista.",
    areaName: "Nome da área",
    areaKey: "Chave",
    areaKeyHint:
      "A programação usa a chave para saber o que a área mostra; ela não muda depois de salva.",
    areaKind: "Tipo",
    geometry: "Posição e tamanho (unidades da tela)",
    x: "X",
    y: "Y",
    width: "Largura",
    height: "Altura",
    stack: "Ordem de sobreposição (maior fica na frente)",
    background: "Cor de fundo",
    fit: "Encaixe da mídia",
    fits: { contain: "Mostrar inteira", cover: "Preencher (corta as bordas)" },
    muted: "Sem som",
    volume: "Volume (0 a 100)",
    pageControlled: "Controlada pelas páginas do layout",
    removeArea: "Remover área",
    viewTitle: "Visão do catálogo",
    catalog: "Catálogo",
    chooseCatalog: "Escolha um catálogo",
    catalogsUnavailable:
      "Para escolher catálogos, você precisa poder ver catálogos nesta empresa.",
    viewFields: "Campos mostrados",
    viewFieldsHint:
      "Um título é obrigatório; subtítulo, preço, imagem e grupo aparecem no máximo uma vez. Até 8 campos.",
    field: "Campo",
    roleOf: (position: number) => `Papel do campo ${position}`,
    roles: {
      title: "Título",
      subtitle: "Subtítulo",
      price: "Preço",
      image: "Imagem",
      detail: "Detalhe",
      group: "Grupo",
    },
    addField: "Adicionar campo",
    fieldPosition: (position: number) => `Campo ${position}`,
    presentation: "Apresentação",
    presentations: {
      list: "Lista",
      table: "Tabela",
      menu: "Cardápio (título e preço alinhados)",
      agenda: "Agenda (por dia da semana)",
    },
    textSize: "Tamanho do texto (24 a 200)",
    unavailable: "Itens indisponíveis",
    unavailableChoices: {
      hide: "Esconder",
      show: "Mostrar como indisponíveis",
    },
    pageSeconds: "Trocar de página a cada (segundos, 5 a 120)",
    audioTitle: "Áudio",
    audioMix: "Confirmo que estas áreas tocam som ao mesmo tempo.",
    audioAreas: (names: string) => `Áreas com som: ${names}.`,
    pagesTitle: "Páginas",
    pagesLead:
      "As páginas coordenam as áreas controladas: todas trocam juntas. Um layout tem nenhuma ou de 2 a 20 páginas.",
    pagesEmpty: "Sem páginas: cada área segue a sua própria programação.",
    addPage: "Adicionar página",
    removePage: "Remover página",
    pageTitle: (number: number) => `Página ${number}`,
    pageDuration: "Duração (segundos, 1 a 600)",
    suggested: (seconds: number) =>
      `Na versão salva, ${seconds} s cobrem o vídeo mais longo da página.`,
    noControlledAreas:
      "Marque “Controlada pelas páginas do layout” em uma área para escolher o que ela mostra em cada página.",
    content: (area: string) => `${area}: conteúdo`,
    noMedia: "Nenhuma mídia escolhida",
    chooseMedia: "Escolher mídia",
    closePicker: "Fechar",
    useMedia: (name: string) => `Usar ${name}`,
    contentModes: { page: "Página da visão", group: "Grupo" },
    viewPage: (area: string) => `${area}: página da visão`,
    group: (area: string) => `${area}: grupo`,
    chooseGroup: "Escolha um grupo",
    weekdays: [
      "Segunda-feira",
      "Terça-feira",
      "Quarta-feira",
      "Quinta-feira",
      "Sexta-feira",
      "Sábado",
      "Domingo",
    ],
    nameTitle: "Nome do layout",
    saveLayout: "Salvar layout",
    layoutSaved: "Layout salvo.",
    export: "Exportar JSON",
    exporting: "Exportando…",
    exported: "Arquivo do layout exportado.",
    fitTitle: "Encaixe dos catálogos",
    fitLead:
      "Calculado na versão salva, com a medida de texto que as telas respeitam. Itens nunca são cortados: o que não cabe aparece abaixo.",
    fitEmpty: "Este layout não tem áreas de catálogo.",
    fitSummary: (records: number, pages: number, rows: number) =>
      `${records === 1 ? "1 item" : `${records} itens`} em ${
        pages === 1 ? "1 página" : `${pages} páginas`
      }, até ${rows} por página`,
    overflowRecord: "Um item",
    overflow: {
      TITLE_OVERFLOW: "o título não cabe em 2 linhas",
      PRICE_OVERFLOW: "o preço não cabe na coluna de preço",
      DETAIL_OVERFLOW: "o subtítulo ou um detalhe não cabe em 3 linhas",
      ROW_TOO_TALL: "o item não cabe na altura da área",
    } as Record<string, string>,
    readOnlyAreas: "Áreas do layout",
    viewOf: (catalog: string) => `Mostra o catálogo ${catalog}`,
    deleteTitle: "Excluir layout",
    deleteLead: "A exclusão é definitiva.",
    deleteConfirm: (name: string) =>
      `Confirmo que quero excluir o layout “${name}”.`,
    delete: "Excluir layout",
    audioLabel: "Áudio",
    programsLoseOutput: (programs: number) =>
      `${programs === 1 ? "1 programação perde" : `${programs} programações perdem`} os horários e a playlist padrão desta área.`,
    programsLoseDefault: (programs: number) =>
      `${programs === 1 ? "1 programação perde" : `${programs} programações perdem`} a playlist padrão desta área, que passa a mostrar a visão do catálogo.`,
    confirmRemoval:
      "Confirmo que quero remover esses horários e padrões das programações.",
    issues: {
      AREA_COUNT: "Um layout tem de 1 a 12 áreas.",
      KEY_INVALID:
        "A chave usa letras minúsculas, números e hífens, começa com letra e tem até 16 caracteres.",
      KEY_DUPLICATE: "Outra área já usa esta chave.",
      NAME_INVALID: "O nome tem de 1 a 40 caracteres.",
      GEOMETRY_INVALID:
        "Posição e tamanho são números inteiros; a área tem pelo menos 40 de largura e de altura e cabe na tela.",
      OUTSIDE_CANVAS: "A área passa da borda da tela.",
      STACK_INVALID: "A ordem de sobreposição vai de 0 a 99.",
      STACK_DUPLICATE: "Outra área já usa esta ordem de sobreposição.",
      COLOR_INVALID: "Use uma cor no formato #RRGGBB.",
      VOLUME_INVALID: "O volume vai de 0 a 100.",
      NO_PAGES:
        "Uma área controlada pelas páginas precisa que o layout tenha páginas.",
      VIEW_NOT_APPLICABLE: "Uma área de mídia não mostra catálogo.",
      VIEW_REQUIRED: "Escolha o catálogo e os campos que a área mostra.",
      VIEW_COUNT: "Um layout tem no máximo 6 áreas de catálogo.",
      FIELD_COUNT: "Uma visão mostra de 1 a 8 campos.",
      FIELD_DUPLICATE: "Um campo aparece duas vezes.",
      TITLE_REQUIRED: "A visão precisa de exatamente um campo como título.",
      ROLE_REPEATED:
        "Subtítulo, preço, imagem e grupo aparecem no máximo uma vez.",
      PRICE_REQUIRED: "Um cardápio precisa de um campo de preço.",
      GROUP_REQUIRED:
        "Uma agenda precisa de um campo de dias da semana como grupo.",
      TEXT_SIZE_INVALID: "O tamanho do texto vai de 24 a 200.",
      PAGE_SECONDS_INVALID: "A troca de página vai de 5 a 120 segundos.",
      AUDIO_MIX_UNCONFIRMED:
        "Mais de uma área tem som: confirme a mistura de áudio.",
      PAGE_COUNT: "Um layout com páginas tem de 2 a 20 páginas.",
      DURATION_INVALID: "Uma página dura de 1 a 600 segundos.",
      AREA_NOT_PAGE_CONTROLLED:
        "A página nomeia uma área que não é controlada pelas páginas.",
      AREA_DUPLICATE: "A página nomeia a mesma área duas vezes.",
      CONTENT_INVALID:
        "Escolha uma mídia para áreas de mídia, e uma página da visão ou um grupo para áreas de catálogo.",
      CONTENT_MISSING: "A página não diz o que cada área controlada mostra.",
      CATALOG_UNAVAILABLE:
        "O catálogo não existe, foi arquivado ou você não pode usá-lo.",
      CATALOG_SCOPE: "O catálogo é de uma filial que o layout não cobre.",
      FIELD_UNAVAILABLE: "O campo não existe mais ou foi arquivado.",
      ROLE_TYPE_MISMATCH:
        "O tipo do campo não serve para o papel: preço é dinheiro, imagem é mídia e grupo é seleção (ou dias da semana, na agenda).",
      MEDIA_UNAVAILABLE:
        "A mídia não está pronta, foi arquivada ou você não pode usá-la.",
      MEDIA_SCOPE: "A mídia é de uma filial que o layout não cobre.",
      PAGE_SHORTER_THAN_VIDEO:
        "A página dura menos que um vídeo que ela mostra.",
      GROUP_UNKNOWN: "O grupo escolhido não existe no campo de grupo.",
      FORMAT_UNSUPPORTED:
        "O arquivo não é um layout do Teluni (teluni.layout, versão 1).",
    } as Record<string, string>,
  },
  errors: {
    PROGRAMMING_LIMIT_REACHED:
      "A empresa chegou a um limite de programação: 1.000 playlists, 500 layouts, 100 grupos, 2.000 programações, 500 itens por playlist ou 200 horários.",
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
    LAYOUT_INVALID:
      "O layout não pode ser salvo assim. Veja abaixo o que corrigir.",
    LAYOUT_IN_USE:
      "Programações usam este layout. Escolha outro layout para elas antes de excluí-lo.",
    LAYOUT_SCOPE_MISMATCH:
      "Este layout é de uma filial que a programação não cobre. Use um layout da empresa ou dessa única filial.",
    LAYOUT_CHANGE_CONFIRMATION_REQUIRED:
      "Esta mudança remove horários ou playlists padrão de áreas. Confirme para continuar.",
    PUBLICATION_INVALID:
      "Esta programação não pode ser publicada como está. Revise de novo para ver o que corrigir.",
    PUBLICATION_NOT_RESTORABLE:
      "Esta geração não é mais guardada e não pode ser restaurada.",
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
  lead: "Playlists, layouts, screen groups and schedules. Everything here is a draft until it is published.",
  backToCompany: "Back to the company",
  backToProgramming: "Back to programming",
  viewsLabel: "Programming sections",
  views: { playlists: "Playlists", layouts: "Layouts", groups: "Groups" },
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
  schedulesFor: (output: string) => `Schedules: ${output}`,
  layoutTitle: "Screen layout",
  layoutLead:
    "Without a layout, the programming has a single full-screen output. With a layout, each area has its own schedules.",
  layoutLabel: "Layout",
  noLayout: "No layout (full screen)",
  useLayout: "Use this layout",
  layoutChosen: "Layout chosen.",
  openLayout: (name: string) => `Open layout ${name}`,
  layoutConfirmLead: "These outputs lose schedules or their default playlist:",
  outputRemoved: (output: string, rules: number) =>
    `${output}: no longer exists${
      rules > 0 ? ` (${rules === 1 ? "1 schedule" : `${rules} schedules`})` : ""
    }.`,
  defaultRemoved: (output: string) =>
    `${output}: loses its default playlist and shows its catalog view instead.`,
  layoutConfirm:
    "I confirm that I want to remove these schedules and defaults.",
  outputLabel: "Area",
  timelineOutputLabel: "Area in the preview",
  wholeScreen: "Whole screen",
  areaOutput: (name: string, kind: string) => `${name} (${kind})`,
  outputKinds: { media: "media", catalog: "catalog" },
  viewDefault:
    "This area's default is its catalog view; schedules can replace it with playlists.",
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
  segmentView: "Catalog view",
  hiddenPlaylist: "A playlist outside your access",
  hiddenPlaylists:
    "This programming uses playlists outside your access, such as those of the screen's previous branch. Replace them to save.",
  segmentDefault: (name: string) => `${name} (default)`,
  noteGap: (local: string, resolved: string) =>
    `${local} does not exist that day because of a clock change; it applies from ${resolved}.`,
  noteRepeated: (local: string, resolved: string) =>
    `${local} happens twice because of a clock change; ${resolved} applies.`,
  sourceLabel: "Programming source",
  sources: { group: "Group", individual: "Own programming" },
  hiddenGroup: "A group with branches outside your access",
  hiddenGroupSchedules:
    "This screen follows a group with branches outside your access. Its schedules are edited by someone with access to all of those branches.",
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
  publishedDestination: (generation: number) =>
    `The chosen destination has generation ${generation} published; the screen shows it at its next synchronization.`,
  publication: {
    title: "Publication",
    lead: "Publishing makes the current draft a new generation, which connected screens receive within 30 seconds.",
    never:
      "Nothing is published yet: screens of this programming show a neutral screen.",
    current: (generation: number, when: string, byYou: boolean) =>
      `Generation ${generation}, published on ${when} ${byYou ? "by you" : "by another member"}.`,
    stepUp: "Publishing requires two-step verification.",
    review: "Review to publish",
    reviewing: "Reviewing…",
    reviewTitle: "Publication review",
    unchanged:
      "The draft equals the published generation. There is nothing new to publish.",
    summary: (
      rules: number,
      playlists: number,
      items: number,
      media: number,
      size: string,
    ) =>
      `${rules === 1 ? "1 schedule" : `${rules} schedules`} · ${
        playlists === 1 ? "1 playlist" : `${playlists} playlists`
      } · ${items === 1 ? "1 item" : `${items} items`} · ${
        media === 1 ? "1 media item" : `${media} media items`
      } (${size})`,
    followers: (count: number) =>
      count === 0
        ? "No screen follows this programming now."
        : count === 1
          ? "1 screen follows this programming and will receive it."
          : `${count} screens follow this programming and will receive it.`,
    problemsTitle: "Fix before publishing",
    problems: {
      NOTHING_TO_PUBLISH: "This programming has no schedules or default yet.",
      LAYOUT_NOT_PUBLISHABLE:
        "Programming with a layout publishes through the screens' protocol 2, which is not available yet.",
      SCHEDULE_INVALID:
        "The saved schedules no longer pass validation. Review and save them again.",
      PLAYLIST_OUT_OF_SCOPE:
        "A playlist belongs to a branch this programming does not cover, such as the screen's previous branch.",
      MEDIA_UNAVAILABLE: "A media item of a playlist is no longer available.",
      TRANSITION_UNSUPPORTED:
        "A playlist uses the Fade transition, which screens are not qualified for yet. Use Cut to publish.",
      TOO_LARGE: "The publication exceeds 2,000 items or 1,000 media items.",
    },
    publish: "Publish now",
    publishing: "Publishing…",
    cancel: "Cancel",
    published: (generation: number) =>
      `Generation ${generation} published. Connected screens receive it within 30 seconds.`,
    alreadyPublished: (generation: number) =>
      `The content already was generation ${generation}; nothing changed.`,
    changedSinceReview:
      "The programming changed after the review. Review again before publishing.",
    historyTitle: "Published generations",
    historyEmpty: "No generation yet.",
    generation: (generation: number) => `Generation ${generation}`,
    restoredFrom: (generation: number) => `restores generation ${generation}`,
    byYou: "by you",
    byOther: "by another member",
    states: {
      current: "current",
      retained: "can be restored",
      pruned: "no longer kept",
    },
    restore: "Restore",
    restoreConfirm: (generation: number) =>
      `Publish the content of generation ${generation} again? Drafts do not change.`,
    restoreYes: "Restore as a new generation",
    restoring: "Restoring…",
    restored: (generation: number) =>
      `Content restored as generation ${generation}.`,
    more: "Earlier generations",
    membersSync: "Screen synchronization",
  },
  layouts: {
    listEmpty: "No layouts yet.",
    createTitle: "New layout",
    orientationLabel: "Screen orientation",
    orientations: {
      landscape: "Landscape (1920 × 1080)",
      portrait: "Portrait (1080 × 1920)",
    },
    firstAreaName: "Main",
    summary: (areas: number, pages: number) =>
      `${areas === 1 ? "1 area" : `${areas} areas`}${
        pages > 0 ? ` · ${pages} pages` : ""
      }`,
    importTitle: "Import layout",
    importLead:
      "Choose a .json file exported from Teluni. Catalogs, fields and media you cannot use are reported as issues to replace.",
    importFile: "Layout file",
    importing: "Importing…",
    import: "Import",
    importUnreadable:
      "The file could not be read. Use a .json file exported from Teluni, up to 512 KB.",
    canvasLabel: (name: string) => `Canvas of layout ${name}`,
    canvasHint:
      "Drag an area to move it and its corner to resize it. With an area selected, arrow keys move it 10 units and Shift + arrow keys change its size.",
    areaButton: (name: string, kind: string) => `${name} (${kind})`,
    kinds: { media: "Media", catalog: "Catalog" },
    areasTitle: "Areas",
    addMediaArea: "Add media area",
    addCatalogArea: "Add catalog area",
    newAreaName: (number: number) => `Area ${number}`,
    selectedTitle: (name: string) => `Area “${name}”`,
    noSelection: "Select an area on the canvas or in the list.",
    areaName: "Area name",
    areaKey: "Key",
    areaKeyHint:
      "Programming uses the key to know what the area shows; it does not change once saved.",
    areaKind: "Kind",
    geometry: "Position and size (canvas units)",
    x: "X",
    y: "Y",
    width: "Width",
    height: "Height",
    stack: "Stacking order (higher draws in front)",
    background: "Background color",
    fit: "Media fit",
    fits: { contain: "Show whole", cover: "Fill (crops the edges)" },
    muted: "Muted",
    volume: "Volume (0 to 100)",
    pageControlled: "Controlled by the layout's pages",
    removeArea: "Remove area",
    viewTitle: "Catalog view",
    catalog: "Catalog",
    chooseCatalog: "Choose a catalog",
    catalogsUnavailable:
      "To choose catalogs, you need to be allowed to view catalogs in this company.",
    viewFields: "Fields shown",
    viewFieldsHint:
      "A title is required; subtitle, price, image and group appear at most once. Up to 8 fields.",
    field: "Field",
    roleOf: (position: number) => `Role of field ${position}`,
    roles: {
      title: "Title",
      subtitle: "Subtitle",
      price: "Price",
      image: "Image",
      detail: "Detail",
      group: "Group",
    },
    addField: "Add field",
    fieldPosition: (position: number) => `Field ${position}`,
    presentation: "Presentation",
    presentations: {
      list: "List",
      table: "Table",
      menu: "Menu (title and price aligned)",
      agenda: "Agenda (by weekday)",
    },
    textSize: "Text size (24 to 200)",
    unavailable: "Unavailable items",
    unavailableChoices: { hide: "Hide", show: "Show as unavailable" },
    pageSeconds: "Change page every (seconds, 5 to 120)",
    audioTitle: "Audio",
    audioMix: "I confirm that these areas play sound at the same time.",
    audioAreas: (names: string) => `Areas with sound: ${names}.`,
    pagesTitle: "Pages",
    pagesLead:
      "Pages coordinate the controlled areas: they all change together. A layout has no pages or 2 to 20 pages.",
    pagesEmpty: "No pages: each area follows its own programming.",
    addPage: "Add page",
    removePage: "Remove page",
    pageTitle: (number: number) => `Page ${number}`,
    pageDuration: "Duration (seconds, 1 to 600)",
    suggested: (seconds: number) =>
      `On the saved version, ${seconds} s cover the page's longest video.`,
    noControlledAreas:
      "Check “Controlled by the layout's pages” on an area to choose what it shows on each page.",
    content: (area: string) => `${area}: content`,
    noMedia: "No media chosen",
    chooseMedia: "Choose media",
    closePicker: "Close",
    useMedia: (name: string) => `Use ${name}`,
    contentModes: { page: "View page", group: "Group" },
    viewPage: (area: string) => `${area}: view page`,
    group: (area: string) => `${area}: group`,
    chooseGroup: "Choose a group",
    weekdays: [
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
      "Sunday",
    ],
    nameTitle: "Layout name",
    saveLayout: "Save layout",
    layoutSaved: "Layout saved.",
    export: "Export JSON",
    exporting: "Exporting…",
    exported: "Layout file exported.",
    fitTitle: "Catalog fit",
    fitLead:
      "Computed on the saved version with the text measure screens honor. Items are never clipped: what does not fit is listed below.",
    fitEmpty: "This layout has no catalog areas.",
    fitSummary: (records: number, pages: number, rows: number) =>
      `${records === 1 ? "1 item" : `${records} items`} on ${
        pages === 1 ? "1 page" : `${pages} pages`
      }, up to ${rows} per page`,
    overflowRecord: "An item",
    overflow: {
      TITLE_OVERFLOW: "the title does not fit in 2 lines",
      PRICE_OVERFLOW: "the price does not fit the price column",
      DETAIL_OVERFLOW: "the subtitle or a detail does not fit in 3 lines",
      ROW_TOO_TALL: "the item does not fit the area's height",
    },
    readOnlyAreas: "Layout areas",
    viewOf: (catalog: string) => `Shows catalog ${catalog}`,
    deleteTitle: "Delete layout",
    deleteLead: "Deletion is permanent.",
    deleteConfirm: (name: string) =>
      `I confirm that I want to delete layout “${name}”.`,
    delete: "Delete layout",
    audioLabel: "Audio",
    programsLoseOutput: (programs: number) =>
      `${programs === 1 ? "1 program loses" : `${programs} programs lose`} this area's schedules and default playlist.`,
    programsLoseDefault: (programs: number) =>
      `${programs === 1 ? "1 program loses" : `${programs} programs lose`} this area's default playlist, and the area shows its catalog view instead.`,
    confirmRemoval:
      "I confirm that I want to remove these schedules and defaults from the programs.",
    issues: {
      AREA_COUNT: "A layout has 1 to 12 areas.",
      KEY_INVALID:
        "The key uses lowercase letters, digits and hyphens, starts with a letter and has up to 16 characters.",
      KEY_DUPLICATE: "Another area already uses this key.",
      NAME_INVALID: "The name has 1 to 40 characters.",
      GEOMETRY_INVALID:
        "Position and size are whole numbers; an area is at least 40 wide and high and fits the canvas.",
      OUTSIDE_CANVAS: "The area goes past the edge of the canvas.",
      STACK_INVALID: "The stacking order goes from 0 to 99.",
      STACK_DUPLICATE: "Another area already uses this stacking order.",
      COLOR_INVALID: "Use a color in #RRGGBB format.",
      VOLUME_INVALID: "Volume goes from 0 to 100.",
      NO_PAGES: "A page-controlled area needs the layout to have pages.",
      VIEW_NOT_APPLICABLE: "A media area does not show a catalog.",
      VIEW_REQUIRED: "Choose the catalog and fields the area shows.",
      VIEW_COUNT: "A layout has at most 6 catalog areas.",
      FIELD_COUNT: "A view shows 1 to 8 fields.",
      FIELD_DUPLICATE: "A field appears twice.",
      TITLE_REQUIRED: "The view needs exactly one field as its title.",
      ROLE_REPEATED: "Subtitle, price, image and group appear at most once.",
      PRICE_REQUIRED: "A menu needs a price field.",
      GROUP_REQUIRED: "An agenda needs a weekdays field as its group.",
      TEXT_SIZE_INVALID: "Text size goes from 24 to 200.",
      PAGE_SECONDS_INVALID: "Paging goes from 5 to 120 seconds.",
      AUDIO_MIX_UNCONFIRMED:
        "More than one area has sound: confirm the audio mix.",
      PAGE_COUNT: "A layout with pages has 2 to 20 pages.",
      DURATION_INVALID: "A page lasts 1 to 600 seconds.",
      AREA_NOT_PAGE_CONTROLLED:
        "The page names an area that is not controlled by the pages.",
      AREA_DUPLICATE: "The page names the same area twice.",
      CONTENT_INVALID:
        "Choose a media item for media areas, and a view page or a group for catalog areas.",
      CONTENT_MISSING:
        "The page does not say what every controlled area shows.",
      CATALOG_UNAVAILABLE:
        "The catalog does not exist, was archived, or you cannot use it.",
      CATALOG_SCOPE:
        "The catalog belongs to a branch this layout does not cover.",
      FIELD_UNAVAILABLE: "The field no longer exists or was archived.",
      ROLE_TYPE_MISMATCH:
        "The field's type does not suit the role: price is money, image is media and group is selection (or weekdays, in an agenda).",
      MEDIA_UNAVAILABLE:
        "The media item is not ready, was archived, or you cannot use it.",
      MEDIA_SCOPE:
        "The media item belongs to a branch this layout does not cover.",
      PAGE_SHORTER_THAN_VIDEO: "The page is shorter than a video it shows.",
      GROUP_UNKNOWN: "The chosen group does not exist in the group field.",
      FORMAT_UNSUPPORTED:
        "The file is not a Teluni layout (teluni.layout, schema 1).",
    },
  },
  errors: {
    PROGRAMMING_LIMIT_REACHED:
      "The company reached a programming limit: 1,000 playlists, 500 layouts, 100 groups, 2,000 programs, 500 items per playlist or 200 schedules.",
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
    LAYOUT_INVALID:
      "The layout cannot be saved this way. See below what to fix.",
    LAYOUT_IN_USE:
      "Programs use this layout. Choose another layout for them before deleting it.",
    LAYOUT_SCOPE_MISMATCH:
      "This layout belongs to a branch the programming does not cover. Use a company layout or one of that single branch.",
    LAYOUT_CHANGE_CONFIRMATION_REQUIRED:
      "This change removes schedules or default playlists of areas. Confirm to continue.",
    PUBLICATION_INVALID:
      "This programming cannot be published as it is. Review it again to see what to fix.",
    PUBLICATION_NOT_RESTORABLE:
      "This generation is no longer kept and cannot be restored.",
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
