import type { ComponentType } from "react";
import { identityRoutes, IdentityNavigation } from "./identity/routes.js";
import { coreRoutes, rootRoute } from "./shell.js";

// Composition owned by this repository. Mount each web module's route tree
// here and contribute its header and home-page links to moduleNavigation.
export const routeTree = rootRoute.addChildren([
  ...coreRoutes,
  ...identityRoutes,
]);

export const moduleNavigation: readonly ComponentType[] = [IdentityNavigation];
