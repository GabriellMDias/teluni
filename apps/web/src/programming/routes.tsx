import { createRoute } from "@tanstack/react-router";
import { rootRoute } from "../shell.js";
import {
  GroupPage,
  PlaylistPage,
  ProgrammingPage,
  ScreenProgrammingPage,
  type ProgrammingFilter,
} from "./pages.js";
import { LayoutPage } from "./layouts.js";
import "./programming.css";

const overviewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/companies/$companyId/programming",
  validateSearch: (search: Record<string, unknown>): ProgrammingFilter => ({
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

const playlistRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/companies/$companyId/programming/playlists/$playlistId",
  component: function PlaylistRoute() {
    const { companyId, playlistId } = playlistRoute.useParams();
    return (
      <PlaylistPage
        key={`${companyId}/${playlistId}`}
        companyId={companyId}
        playlistId={playlistId}
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
  component: function GroupRoute() {
    const { companyId, groupId } = groupRoute.useParams();
    return (
      <GroupPage
        key={`${companyId}/${groupId}`}
        companyId={companyId}
        groupId={groupId}
      />
    );
  },
});

const screenRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/companies/$companyId/programming/screens/$deviceId",
  component: function ScreenProgrammingRoute() {
    const { companyId, deviceId } = screenRoute.useParams();
    return (
      <ScreenProgrammingPage
        key={`${companyId}/${deviceId}`}
        companyId={companyId}
        deviceId={deviceId}
      />
    );
  },
});

export const programmingRoutes = [
  overviewRoute,
  playlistRoute,
  layoutRoute,
  groupRoute,
  screenRoute,
] as const;
