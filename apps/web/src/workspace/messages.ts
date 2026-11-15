import type { Locale } from "../locale.js";

// Localized copy for the application's entry and home page.
const ptBR = {
  navHome: "Início",
  sessionFailed:
    "Não foi possível confirmar sua sessão. Tente novamente para continuar.",
  loading: "Carregando seu espaço de trabalho…",
  homeEyebrow: "Visão geral",
  homeTitle: "Seu espaço de trabalho",
  homeLead: "Suas empresas, conteúdos e telas. Escolha por onde continuar.",
  companiesTitle: "Suas empresas",
  companiesLead: "Acesse uma empresa ou vá direto ao que precisa.",
  emptyTitle: "Comece pela sua empresa",
  companiesEmpty:
    "Crie um espaço para reunir suas telas e conteúdos. Se alguém já convidou você, aceite o convite recebido por e-mail.",
  createFirst: "Criar minha primeira empresa",
  allCompanies: "Ver todas",
  createAnother: "Nova empresa",
  companiesPartial: (count: number) =>
    `Exibindo as primeiras ${count} empresas.`,
  companiesFailed:
    "Não foi possível carregar suas empresas. Tente novamente para continuar.",
  companySuspended:
    "Empresa suspensa. Acesse a empresa para consultar sua situação.",
  companyShortcuts: (name: string) => `Atalhos de ${name}`,
  accessLoading: "Carregando seus acessos…",
  accessFailed:
    "Seus acessos não puderam ser confirmados. Abra a empresa ou tente novamente.",
  noShortcuts: "Abra a empresa para consultar seus acessos.",
  screens: "Telas",
  media: "Mídia",
  programming: "Programação",
  catalogs: "Catálogos",
  screensLoading: "Consultando telas…",
  screensFailed: "O resumo de telas está indisponível.",
  noScreens: "Nenhuma tela pareada por aqui ainda.",
  screenCount: (count: number, partial: boolean) =>
    `${partial ? "Pelo menos " : ""}${count} ${count === 1 ? "tela" : "telas"}`,
  connectedCount: (count: number) =>
    `${count} ${count === 1 ? "conectada" : "conectadas"}`,
  contactHint: "Conexão pelo último contato com o servidor.",
  connectionLoading: "Consultando conexão…",
  connectionUnavailable: "Não foi possível confirmar a conexão das telas.",
  screensPartial: "Conexão apenas das telas desta prévia. Veja todas em Telas.",
  helpAndAccount: "Guia rápido e conta",
  guideEyebrow: "Do conteúdo à tela",
  guideTitle: "Tudo se conecta",
  guideLead: "Dentro de cada empresa, seu conteúdo segue este caminho.",
  guideMedia: "Prepare o conteúdo",
  guideMediaLead: "Envie imagens e vídeos para a biblioteca de mídia.",
  guideProgramming: "Monte a programação",
  guideProgrammingLead:
    "Organize playlists e escolha quando exibir cada conteúdo.",
  guideScreens: "Leve para suas telas",
  guideScreensLead: "Pareie o player, atribua a programação e publique.",
  accountTitle: "Sua conta",
  accountLoading: "Consultando proteção da conta…",
  accountFailed: "Não foi possível consultar a proteção da conta.",
  accountSessions: "Gerenciar sessões",
  twoStepEnabled: "Verificação em duas etapas ativada.",
  twoStepDisabled:
    "Adicione uma camada de proteção à sua conta com a verificação em duas etapas.",
  twoStepButton: "Ativar duas etapas",
  reload: "Tentar novamente",
};

export type WorkspaceMessages = typeof ptBR;

const enUS: WorkspaceMessages = {
  navHome: "Home",
  sessionFailed: "Your session could not be confirmed. Try again to continue.",
  loading: "Loading your workspace…",
  homeEyebrow: "Overview",
  homeTitle: "Your workspace",
  homeLead: "Your companies, content and screens. Choose where to pick up.",
  companiesTitle: "Your companies",
  companiesLead: "Open a company or go straight to what you need.",
  emptyTitle: "Start with your company",
  companiesEmpty:
    "Create a space for your screens and content. If someone already invited you, accept the invitation you received by email.",
  createFirst: "Create my first company",
  allCompanies: "See all",
  createAnother: "New company",
  companiesPartial: (count: number) => `Showing the first ${count} companies.`,
  companiesFailed: "Your companies could not be loaded. Try again to continue.",
  companySuspended: "Company suspended. Open the company to check its status.",
  companyShortcuts: (name: string) => `Shortcuts for ${name}`,
  accessLoading: "Loading your access…",
  accessFailed:
    "Your access could not be confirmed. Open the company or try again.",
  noShortcuts: "Open the company to check your access.",
  screens: "Screens",
  media: "Media",
  programming: "Programming",
  catalogs: "Catalogs",
  screensLoading: "Checking screens…",
  screensFailed: "The screen summary is unavailable.",
  noScreens: "No screens paired here yet.",
  screenCount: (count: number, partial: boolean) =>
    `${partial ? "At least " : ""}${count} ${count === 1 ? "screen" : "screens"}`,
  connectedCount: (count: number) => `${count} connected`,
  contactHint: "Connection based on last contact with the server.",
  connectionLoading: "Checking connection…",
  connectionUnavailable: "The screens' connection could not be confirmed.",
  screensPartial:
    "Connection covers only screens in this preview. See all in Screens.",
  helpAndAccount: "Quick guide and account",
  guideEyebrow: "From content to screen",
  guideTitle: "It all connects",
  guideLead: "Within each company, your content follows this path.",
  guideMedia: "Prepare your content",
  guideMediaLead: "Upload images and videos to your media library.",
  guideProgramming: "Plan your programming",
  guideProgrammingLead: "Organize playlists and choose when each item plays.",
  guideScreens: "Bring it to your screens",
  guideScreensLead: "Pair the player, assign its programming and publish.",
  accountTitle: "Your account",
  accountLoading: "Checking account protection…",
  accountFailed: "Account protection could not be checked.",
  accountSessions: "Manage sessions",
  twoStepEnabled: "Two-step verification is on.",
  twoStepDisabled:
    "Add another layer of protection to your account with two-step verification.",
  twoStepButton: "Turn on two-step verification",
  reload: "Try again",
};

export const workspaceMessages: Readonly<Record<Locale, WorkspaceMessages>> = {
  "pt-BR": ptBR,
  "en-US": enUS,
};
