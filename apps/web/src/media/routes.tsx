import { createRoute } from "@tanstack/react-router";
import { rootRoute } from "../shell.js";
import type { MediaFilter } from "./api.js";
import { MediaItemPage, MediaLibraryPage } from "./pages.js";
import "./media.css";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const libraryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/companies/$companyId/media",
  validateSearch: (search: Record<string, unknown>): MediaFilter => ({
    ...(typeof search.cursor === "string" &&
    search.cursor.length > 0 &&
    search.cursor.length <= 1024
      ? { cursor: search.cursor }
      : {}),
    ...(search.view === "archived" || search.view === "trash"
      ? { view: search.view }
      : {}),
    ...(search.kind === "IMAGE" || search.kind === "VIDEO"
      ? { kind: search.kind }
      : {}),
    ...(typeof search.scope === "string" &&
    (search.scope === "company" || uuidPattern.test(search.scope))
      ? { scope: search.scope }
      : {}),
    ...(typeof search.text === "string" &&
    search.text.trim().length > 0 &&
    search.text.length <= 120
      ? { text: search.text.trim() }
      : {}),
  }),
  component: function MediaLibraryRoute() {
    const { companyId } = libraryRoute.useParams();
    const filter = libraryRoute.useSearch();
    return (
      <MediaLibraryPage key={companyId} companyId={companyId} filter={filter} />
    );
  },
});

const itemRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/companies/$companyId/media/$assetId",
  component: function MediaItemRoute() {
    const { companyId, assetId } = itemRoute.useParams();
    return (
      <MediaItemPage
        key={`${companyId}/${assetId}`}
        companyId={companyId}
        assetId={assetId}
      />
    );
  },
});

export const mediaRoutes = [libraryRoute, itemRoute] as const;
