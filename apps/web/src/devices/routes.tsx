import { createRoute } from "@tanstack/react-router";
import { rootRoute } from "../shell.js";
import type { DeviceHistoryFilter } from "./api.js";
import { ScreenPage, ScreensPage, type ScreensSearch } from "./pages.js";
import "./devices.css";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const screensRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/companies/$companyId/screens",
  validateSearch: (search: Record<string, unknown>): ScreensSearch => ({
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
    ...(search.mode === "grid" || search.mode === "form"
      ? { mode: search.mode }
      : {}),
    ...(search.record === "new" ||
    (typeof search.record === "string" && uuidPattern.test(search.record))
      ? { record: search.record }
      : {}),
  }),
  component: function ScreensRoute() {
    const { companyId } = screensRoute.useParams();
    const search = screensRoute.useSearch();
    return (
      <ScreensPage key={companyId} companyId={companyId} search={search} />
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
