import type { Locale } from "./locale.js";

const ptBR = {
  navigation: "Navegação principal",
  menu: "Menu",
  skip: "Ir para o conteúdo",
  darkTheme: "Tema escuro",
  tagline: "Todas as suas telas. Um só lugar.",
  collapseSidebar: "Recolher menu",
  expandSidebar: "Expandir menu",
};

export const shellMessages: Readonly<Record<Locale, typeof ptBR>> = {
  "pt-BR": ptBR,
  "en-US": {
    navigation: "Main navigation",
    menu: "Menu",
    skip: "Skip to content",
    darkTheme: "Dark theme",
    tagline: "Every screen. One place.",
    collapseSidebar: "Collapse menu",
    expandSidebar: "Expand menu",
  },
};
