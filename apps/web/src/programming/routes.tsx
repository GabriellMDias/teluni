import { createRoute } from "@tanstack/react-router";
import { rootRoute } from "../shell.js";
import {
  GroupPage,
  PlaylistPage,
  ProgrammingPage,
  ScreenProgrammingPage,
  type ProgrammingFilter,
} from "./pages.js";
import type { ProgrammingDetailFilter } from "./workspace.js";
import { PublishedQr } from "./widget-qr.js";
import { LayoutPage } from "./layouts.js";
import "./programming.css";

const overviewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/companies/$companyId/programming",
  validateSearch: (search: Record<string, unknown>): ProgrammingFilter => ({
    ...(search.mode === "grid" || search.mode === "form"
      ? { mode: search.mode }
      : {}),
    ...(typeof search.record === "string" &&
    (search.record === "new" ||
      (search.view === "layouts" && search.record === "import") ||
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        search.record,
      ))
      ? { record: search.record }
      : {}),
    ...(search.view === "groups" || search.view === "layouts"
      ? { view: search.view }
      : {}),
    ...(typeof search.cursor === "string" &&
    search.cursor.length > 0 &&
    search.cursor.length <= 1024
      ? { cursor: search.cursor }
      : {}),
    ...(typeof search.text === "string" &&
    search.text.trim().length > 0 &&
    search.text.length <= 120
      ? { text: search.text.trim() }
      : {}),
  }),
  component: function ProgrammingRoute() {
    const { companyId } = overviewRoute.useParams();
    const filter = overviewRoute.useSearch();
    return (
      <ProgrammingPage key={companyId} companyId={companyId} filter={filter} />
    );
  },
});

const detailSearch = (
  search: Record<string, unknown>,
): ProgrammingDetailFilter =>
  search.section === "preview" ||
  search.section === "screens" ||
  search.section === "publication" ||
  search.section === "settings"
    ? { section: search.section }
    : {};

const playlistRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/companies/$companyId/programming/playlists/$playlistId",
  validateSearch: (search: Record<string, unknown>): ProgrammingDetailFilter =>
    search.section === "settings" ? { section: "settings" } : {},
  component: function PlaylistRoute() {
    const { companyId, playlistId } = playlistRoute.useParams();
    return (
      <PlaylistPage
        key={`${companyId}/${playlistId}`}
        companyId={companyId}
        playlistId={playlistId}
        section={playlistRoute.useSearch().section}
      />
    );
  },
});

const layoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/companies/$companyId/programming/layouts/$layoutId",
  component: function LayoutRoute() {
    const { companyId, layoutId } = layoutRoute.useParams();
    return (
      <LayoutPage
        key={`${companyId}/${layoutId}`}
        companyId={companyId}
        layoutId={layoutId}
      />
    );
  },
});

const groupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/companies/$companyId/programming/groups/$groupId",
  validateSearch: detailSearch,
  component: function GroupRoute() {
    const { companyId, groupId } = groupRoute.useParams();
    return (
      <GroupPage
        key={`${companyId}/${groupId}`}
        companyId={companyId}
        groupId={groupId}
        section={groupRoute.useSearch().section}
      />
    );
  },
});

const screenRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/companies/$companyId/programming/screens/$deviceId",
  validateSearch: (search: Record<string, unknown>): ProgrammingDetailFilter =>
    search.section === "screens" ? {} : detailSearch(search),
  component: function ScreenProgrammingRoute() {
    const { companyId, deviceId } = screenRoute.useParams();
    return (
      <ScreenProgrammingPage
        key={`${companyId}/${deviceId}`}
        companyId={companyId}
        deviceId={deviceId}
        section={screenRoute.useSearch().section}
      />
    );
  },
});

const qrRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/q/$linkId",
  component: function QrRoute() {
    return <PublishedQr linkId={qrRoute.useParams().linkId} />;
  },
});

export const programmingRoutes = [
  qrRoute,
  overviewRoute,
  playlistRoute,
  layoutRoute,
  groupRoute,
  screenRoute,
] as const;
