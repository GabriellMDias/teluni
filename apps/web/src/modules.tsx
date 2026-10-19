import type { ComponentType } from "react";
import { deviceRoutes } from "./devices/routes.js";
import { identityRoutes, IdentityNavigation } from "./identity/routes.js";
import {
  organizationRoutes,
  OrganizationsNavigation,
} from "./organizations/routes.js";
import { rootRoute } from "./shell.js";
import { workspaceRoutes, WorkspaceNavigation } from "./workspace/routes.js";

// Composition owned by this repository. Mount each web module's route tree
// here and contribute its header and home-page links to moduleNavigation.
//
// The Living Documentation portal is a development aid, not part of the
// product (owner direction, 2026-10-19). Only the Vite development server
// mounts it; production builds drop this branch, so neither the portal's
// code nor its generated pages are emitted.
const developerPortal = import.meta.env.DEV
  ? await import("./documentation-routes.js")
  : undefined;

export const routeTree = rootRoute.addChildren([
  ...workspaceRoutes,
  ...identityRoutes,
  ...organizationRoutes,
  ...deviceRoutes,
  ...(developerPortal?.documentationRoutes ?? []),
]);

export const moduleNavigation: readonly ComponentType[] = [
  WorkspaceNavigation,
  OrganizationsNavigation,
  ...(developerPortal ? [developerPortal.DocumentationNavigation] : []),
  IdentityNavigation,
];
