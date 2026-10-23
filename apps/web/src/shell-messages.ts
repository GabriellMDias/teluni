import type { Locale } from "./locale.js";

const ptBR = {
  navigation: "Navegação principal",
  workspace: "Seu espaço de trabalho",
  menu: "Menu",
  skip: "Ir para o conteúdo",
  theme: "Tema",
  system: "Sistema",
  light: "Claro",
  dark: "Escuro",
  tagline: "Todas as suas telas. Um só lugar.",
};

export const shellMessages: Readonly<Record<Locale, typeof ptBR>> = {
  "pt-BR": ptBR,
  "en-US": {
    navigation: "Main navigation",
    workspace: "Your workspace",
    menu: "Menu",
    skip: "Skip to content",
    theme: "Theme",
    system: "System",
    light: "Light",
    dark: "Dark",
    tagline: "Every screen. One place.",
  },
};
