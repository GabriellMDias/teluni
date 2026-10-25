import { createRoute } from "@tanstack/react-router";
import { rootRoute } from "../shell.js";
import type { DeviceFilter, DeviceHistoryFilter } from "./api.js";
import { ScreenPage, ScreensPage } from "./pages.js";
import "./devices.css";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const screensRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/companies/$companyId/screens",
  validateSearch: (search: Record<string, unknown>): DeviceFilter => ({
    ...(typeof search.cursor === "string" &&
    search.cursor.length > 0 &&
    search.cursor.length <= 1024
      ? { cursor: search.cursor }
      : {}),
    ...(typeof search.branchId === "string" && uuidPattern.test(search.branchId)
      ? { branchId: search.branchId }
      : {}),
    ...(search.status === "ACTIVE" || search.status === "REVOKED"
      ? { status: search.status }
      : {}),
  }),
  component: function ScreensRoute() {
    const { companyId } = screensRoute.useParams();
    const filter = screensRoute.useSearch();
    return (
      <ScreensPage key={companyId} companyId={companyId} filter={filter} />
    );
  },
});

const screenRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/companies/$companyId/screens/$deviceId",
  validateSearch: (search: Record<string, unknown>): DeviceHistoryFilter => ({
    ...(search.view === "history" ? { view: "history" } : {}),
    ...(search.view === "history" &&
    typeof search.cursor === "string" &&
    search.cursor.length > 0 &&
    search.cursor.length <= 1024
      ? { cursor: search.cursor }
      : {}),
  }),
  component: function ScreenRoute() {
    const { companyId, deviceId } = screenRoute.useParams();
    const filter = screenRoute.useSearch();
    return (
      <ScreenPage
        key={`${companyId}/${deviceId}`}
        companyId={companyId}
        deviceId={deviceId}
        filter={filter}
      />
    );
  },
});

export const deviceRoutes = [screensRoute, screenRoute] as const;
