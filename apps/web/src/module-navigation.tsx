import { createContext, useContext, type ComponentType } from "react";

/**
 * Application and home-page links contributed by composed modules. Each entry is a
 * component so modules render type-checked router links to their own routes.
 */
export const ModuleNavigation = createContext<readonly ComponentType[]>([]);

export function useModuleNavigation() {
  return useContext(ModuleNavigation);
}
