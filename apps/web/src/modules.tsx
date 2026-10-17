import type { ComponentType } from "react";
import { coreRoutes, rootRoute } from "./shell.js";

// Composition owned by this repository. Mount each web module's route tree
// here and contribute its header and home-page links to moduleNavigation.
export const routeTree = rootRoute.addChildren([...coreRoutes]);

export const moduleNavigation: readonly ComponentType[] = [];
