import type { paths } from "@teluni/sdk";
import { unwrap } from "../api-client.js";
import { sessionApiClient } from "../identity/api.js";
import { mediaErrorCodes } from "../media/api.js";

export const programmingErrorCodes: ReadonlySet<string> = new Set([
  ...mediaErrorCodes,
  "DEVICE_UNLINKED",
  "PROGRAMMING_LIMIT_REACHED",
  "PLAYLIST_IN_USE",
  "PLAYLIST_SCOPE_MISMATCH",
  "GROUP_NAME_IN_USE",
  "GROUP_HAS_MEMBERS",
  "GROUP_SPAN_EXCLUDES_DEVICE",
  "SCHEDULE_TIMES_EQUAL",
  "SCHEDULE_CONFLICT",
  "ASSIGNMENT_CONFIRMATION_REQUIRED",
  "TIMELINE_TOO_LARGE",
]);

type Json<T> = T extends {
  responses: { 200: { content: { "application/json": infer Body } } };
}
  ? Body
  : never;

export type Playlist = Json<
  paths["/companies/{companyId}/programming/playlists/{playlistId}"]["get"]
>;
export type PlaylistItem = Playlist["items"][number];
export type Transition = Playlist["transition"];
export type Group = Json<
  paths["/companies/{companyId}/programming/groups/{groupId}"]["get"]
>;
export type Program = Json<
  paths["/companies/{companyId}/programming/groups/{groupId}/program"]["get"]
>;
export type Rule = Program["outputs"][number]["rules"][number];
export type RuleInput = NonNullable<
  paths["/companies/{companyId}/programming/rule-checks"]["post"]["requestBody"]
>["content"]["application/json"]["rules"][number];
export type RuleCheck = Json<
  paths["/companies/{companyId}/programming/rule-checks"]["post"]
>;
export type DeviceProgramming = Json<
  paths["/companies/{companyId}/programming/devices/{deviceId}"]["get"]
>;
export type Timeline = Json<
  paths["/companies/{companyId}/programming/devices/{deviceId}/timeline"]["get"]
>;
export type SelectableMedia = Json<
  paths["/companies/{companyId}/media"]["get"]
>["items"][number];

/** A program belongs to a group or to one screen. */
export type ProgramSource =
  | Readonly<{ kind: "group"; groupId: string }>
  | Readonly<{ kind: "device"; deviceId: string }>;

export const playlistsKey = (companyId: string) =>
  ["programming", "playlists", companyId] as const;
export const playlistKey = (companyId: string, playlistId: string) =>
  ["programming", "playlist", companyId, playlistId] as const;
export const groupsKey = (companyId: string) =>
  ["programming", "groups", companyId] as const;
export const groupKey = (companyId: string, groupId: string) =>
  ["programming", "group", companyId, groupId] as const;
export const programKey = (companyId: string, source: ProgramSource) =>
  [
    "programming",
    "program",
    companyId,
    source.kind === "group" ? source.groupId : source.deviceId,
  ] as const;
export const deviceProgrammingKey = (companyId: string, deviceId: string) =>
  ["programming", "device", companyId, deviceId] as const;
export const timelineKey = (companyId: string, id: string) =>
  ["programming", "timeline", companyId, id] as const;

const client = sessionApiClient;

export async function listPlaylists(
  companyId: string,
  filter: { cursor?: string; text?: string },
) {
  return unwrap(
    await client().GET("/companies/{companyId}/programming/playlists", {
      params: { path: { companyId }, query: { limit: 50, ...filter } },
    }),
    programmingErrorCodes,
  );
}

/**
 * Every playlist the caller can see, page by page, for the schedule
 * selectors. A company holds at most 1,000 playlists, so this stays bounded.
 */
export async function listPlaylistChoices(companyId: string) {
  type Page = Awaited<ReturnType<typeof listPlaylists>>;
  const items: Page["items"] = [];
  let cursor: string | null = null;
  do {
    const page: Page = unwrap(
      await client().GET("/companies/{companyId}/programming/playlists", {
        params: {
          path: { companyId },
          query: { limit: 100, ...(cursor ? { cursor } : {}) },
        },
      }),
      programmingErrorCodes,
    );
    items.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return items;
}

export async function getPlaylist(companyId: string, playlistId: string) {
  return unwrap(
    await client().GET(
      "/companies/{companyId}/programming/playlists/{playlistId}",
      { params: { path: { companyId, playlistId } } },
    ),
    programmingErrorCodes,
  );
}

export async function createPlaylist(
  companyId: string,
  input: { name: string; branchId: string | null },
) {
  return unwrap(
    await client().POST("/companies/{companyId}/programming/playlists", {
      params: { path: { companyId } },
      body: input,
    }),
    programmingErrorCodes,
  );
}

export async function updatePlaylist(
  companyId: string,
  playlist: Playlist,
  input: { name?: string; transition?: Transition; fadeMs?: number | null },
) {
  return unwrap(
    await client().PATCH(
      "/companies/{companyId}/programming/playlists/{playlistId}",
      {
        params: { path: { companyId, playlistId: playlist.id } },
        body: { expectedVersion: playlist.version, ...input },
      },
    ),
    programmingErrorCodes,
  );
}

export async function replacePlaylistItems(
  companyId: string,
  playlist: Playlist,
  items: { mediaAssetId: string; durationSeconds: number | null }[],
) {
  return unwrap(
    await client().PUT(
      "/companies/{companyId}/programming/playlists/{playlistId}/items",
      {
        params: { path: { companyId, playlistId: playlist.id } },
        body: { expectedVersion: playlist.version, items },
      },
    ),
    programmingErrorCodes,
  );
}

export async function deletePlaylist(companyId: string, playlist: Playlist) {
  const { error, response } = await client().DELETE(
    "/companies/{companyId}/programming/playlists/{playlistId}",
    {
      params: { path: { companyId, playlistId: playlist.id } },
      body: { expectedVersion: playlist.version },
    },
  );
  if (response.status === 204) return;
  unwrap({ error, response }, programmingErrorCodes);
}

/** Ready media the caller may add, newest first. */
export async function listSelectableMedia(
  companyId: string,
  text: string | undefined,
) {
  return unwrap(
    await client().GET("/companies/{companyId}/media", {
      params: {
        path: { companyId },
        query: { limit: 48, view: "selectable", ...(text ? { text } : {}) },
      },
    }),
    programmingErrorCodes,
  );
}

export async function listGroups(companyId: string) {
  return unwrap(
    await client().GET("/companies/{companyId}/programming/groups", {
      params: { path: { companyId } },
    }),
    programmingErrorCodes,
  );
}

export async function getGroup(companyId: string, groupId: string) {
  return unwrap(
    await client().GET("/companies/{companyId}/programming/groups/{groupId}", {
      params: { path: { companyId, groupId } },
    }),
    programmingErrorCodes,
  );
}

export async function createGroup(
  companyId: string,
  input: { name: string; allBranches: boolean; branchIds: string[] },
) {
  return unwrap(
    await client().POST("/companies/{companyId}/programming/groups", {
      params: { path: { companyId } },
      body: input,
    }),
    programmingErrorCodes,
  );
}

export async function updateGroup(
  companyId: string,
  group: Group,
  input: { name?: string; allBranches?: boolean; branchIds?: string[] },
) {
  return unwrap(
    await client().PATCH(
      "/companies/{companyId}/programming/groups/{groupId}",
      {
        params: { path: { companyId, groupId: group.id } },
        body: { expectedVersion: group.version, ...input },
      },
    ),
    programmingErrorCodes,
  );
}

export async function deleteGroup(companyId: string, group: Group) {
  const { error, response } = await client().DELETE(
    "/companies/{companyId}/programming/groups/{groupId}",
    {
      params: { path: { companyId, groupId: group.id } },
      body: { expectedVersion: group.version },
    },
  );
  if (response.status === 204) return;
  unwrap({ error, response }, programmingErrorCodes);
}

export async function getProgram(
  companyId: string,
  source: ProgramSource,
): Promise<Program> {
  const api = client();
  return unwrap(
    source.kind === "group"
      ? await api.GET(
          "/companies/{companyId}/programming/groups/{groupId}/program",
          { params: { path: { companyId, groupId: source.groupId } } },
        )
      : await api.GET(
          "/companies/{companyId}/programming/devices/{deviceId}/program",
          { params: { path: { companyId, deviceId: source.deviceId } } },
        ),
    programmingErrorCodes,
  );
}

export async function replaceScreenOutput(
  companyId: string,
  source: ProgramSource,
  expectedVersion: number,
  input: { defaultPlaylistId: string | null; rules: RuleInput[] },
): Promise<Program> {
  const api = client();
  const body = { expectedVersion, ...input };
  return unwrap(
    source.kind === "group"
      ? await api.PUT(
          "/companies/{companyId}/programming/groups/{groupId}/program/outputs/{outputKey}",
          {
            params: {
              path: { companyId, groupId: source.groupId, outputKey: "screen" },
            },
            body,
          },
        )
      : await api.PUT(
          "/companies/{companyId}/programming/devices/{deviceId}/program/outputs/{outputKey}",
          {
            params: {
              path: {
                companyId,
                deviceId: source.deviceId,
                outputKey: "screen",
              },
            },
            body,
          },
        ),
    programmingErrorCodes,
  );
}

export async function checkRules(companyId: string, rules: RuleInput[]) {
  return unwrap(
    await client().POST("/companies/{companyId}/programming/rule-checks", {
      params: { path: { companyId } },
      body: { rules },
    }),
    programmingErrorCodes,
  );
}

export async function getDeviceProgramming(
  companyId: string,
  deviceId: string,
) {
  return unwrap(
    await client().GET(
      "/companies/{companyId}/programming/devices/{deviceId}",
      { params: { path: { companyId, deviceId } } },
    ),
    programmingErrorCodes,
  );
}

export async function assignDevice(
  companyId: string,
  current: DeviceProgramming,
  input: {
    groupId: string | null;
    individual: boolean;
    confirmUnpublished: boolean;
  },
) {
  return unwrap(
    await client().PUT(
      "/companies/{companyId}/programming/devices/{deviceId}/assignment",
      {
        params: { path: { companyId, deviceId: current.device.id } },
        body: { expectedVersion: current.version, ...input },
      },
    ),
    programmingErrorCodes,
  );
}

/** The next seven days from the start of the current hour. */
export function previewRange(now = new Date()): { from: string; to: string } {
  const from = new Date(now);
  from.setUTCMinutes(0, 0, 0);
  const to = new Date(from.getTime() + 7 * 86_400_000);
  return { from: from.toISOString(), to: to.toISOString() };
}

export async function getTimeline(
  companyId: string,
  source: ProgramSource,
  range: { from: string; to: string },
  timeZone: string,
): Promise<Timeline> {
  const api = client();
  return unwrap(
    source.kind === "group"
      ? await api.GET(
          "/companies/{companyId}/programming/groups/{groupId}/timeline",
          {
            params: {
              path: { companyId, groupId: source.groupId },
              query: { ...range, timeZone },
            },
          },
        )
      : await api.GET(
          "/companies/{companyId}/programming/devices/{deviceId}/timeline",
          {
            params: {
              path: { companyId, deviceId: source.deviceId },
              query: range,
            },
          },
        ),
    programmingErrorCodes,
  );
}

// Publications of a program (PJ-11): history, check, publish and restore.

export const publicationErrorCodes: ReadonlySet<string> = new Set([
  ...programmingErrorCodes,
  "PUBLICATION_INVALID",
  "PUBLICATION_NOT_RESTORABLE",
]);

export type PublicationPage = Json<
  paths["/companies/{companyId}/programming/groups/{groupId}/publications"]["get"]
>;
export type Publication = PublicationPage["items"][number];
export type PublicationCheck = Json<
  paths["/companies/{companyId}/programming/groups/{groupId}/publications/check"]["post"]
>;
export type PublicationProblem = PublicationCheck["problems"][number];

export const publicationsKey = (companyId: string, source: ProgramSource) =>
  [
    "programming",
    "publications",
    companyId,
    source.kind === "group" ? source.groupId : source.deviceId,
  ] as const;

export async function listPublications(
  companyId: string,
  source: ProgramSource,
  options: { limit?: number; cursor?: string } = {},
): Promise<PublicationPage> {
  const api = client();
  const query = {
    limit: options.limit ?? 10,
    ...(options.cursor ? { cursor: options.cursor } : {}),
  };
  return unwrap(
    source.kind === "group"
      ? await api.GET(
          "/companies/{companyId}/programming/groups/{groupId}/publications",
          { params: { path: { companyId, groupId: source.groupId }, query } },
        )
      : await api.GET(
          "/companies/{companyId}/programming/devices/{deviceId}/publications",
          { params: { path: { companyId, deviceId: source.deviceId }, query } },
        ),
    publicationErrorCodes,
  );
}

export async function checkPublication(
  companyId: string,
  source: ProgramSource,
): Promise<PublicationCheck> {
  const api = client();
  return unwrap(
    source.kind === "group"
      ? await api.POST(
          "/companies/{companyId}/programming/groups/{groupId}/publications/check",
          { params: { path: { companyId, groupId: source.groupId } } },
        )
      : await api.POST(
          "/companies/{companyId}/programming/devices/{deviceId}/publications/check",
          { params: { path: { companyId, deviceId: source.deviceId } } },
        ),
    publicationErrorCodes,
  );
}

/** Publishes exactly the reviewed content; a changed draft is a conflict. */
export async function publishProgram(
  companyId: string,
  source: ProgramSource,
  contentDigest: string,
): Promise<{ publication: Publication; created: boolean }> {
  const api = client();
  return unwrap(
    source.kind === "group"
      ? await api.POST(
          "/companies/{companyId}/programming/groups/{groupId}/publications",
          {
            params: { path: { companyId, groupId: source.groupId } },
            body: { contentDigest },
          },
        )
      : await api.POST(
          "/companies/{companyId}/programming/devices/{deviceId}/publications",
          {
            params: { path: { companyId, deviceId: source.deviceId } },
            body: { contentDigest },
          },
        ),
    publicationErrorCodes,
  );
}

export async function restorePublication(
  companyId: string,
  source: ProgramSource,
  publicationId: string,
): Promise<{ publication: Publication; created: boolean }> {
  const api = client();
  return unwrap(
    source.kind === "group"
      ? await api.POST(
          "/companies/{companyId}/programming/groups/{groupId}/publications/{publicationId}/restore",
          {
            params: {
              path: { companyId, groupId: source.groupId, publicationId },
            },
          },
        )
      : await api.POST(
          "/companies/{companyId}/programming/devices/{deviceId}/publications/{publicationId}/restore",
          {
            params: {
              path: { companyId, deviceId: source.deviceId, publicationId },
            },
          },
        ),
    publicationErrorCodes,
  );
}

// Layouts (D-11 increment 2): areas on a canvas, catalog views and pages.

export const layoutErrorCodes: ReadonlySet<string> = new Set([
  ...programmingErrorCodes,
  "LAYOUT_INVALID",
]);

export type LayoutList = Json<
  paths["/companies/{companyId}/programming/layouts"]["get"]
>;
export type LayoutSummary = LayoutList["items"][number];
export type Layout = Json<
  paths["/companies/{companyId}/programming/layouts/{layoutId}"]["get"]
>;
export type LayoutDocument = Json<
  paths["/companies/{companyId}/programming/layouts/{layoutId}/export"]["get"]
>;
export type LayoutDefinition = NonNullable<
  paths["/companies/{companyId}/programming/layouts"]["post"]["requestBody"]
>["content"]["application/json"]["definition"];
export type AreaInput = LayoutDefinition["areas"][number];
export type ViewInput = NonNullable<AreaInput["view"]>;
export type PageInput = NonNullable<LayoutDefinition["pages"]>[number];
export type ImportedDocument = NonNullable<
  paths["/companies/{companyId}/programming/layouts/import"]["post"]["requestBody"]
>["content"]["application/json"]["document"];

export const layoutsKey = (companyId: string) =>
  ["programming", "layouts", companyId] as const;
export const layoutKey = (companyId: string, layoutId: string) =>
  ["programming", "layout", companyId, layoutId] as const;

export async function listLayouts(
  companyId: string,
  filter: { cursor?: string; text?: string },
) {
  return unwrap(
    await client().GET("/companies/{companyId}/programming/layouts", {
      params: { path: { companyId }, query: { limit: 50, ...filter } },
    }),
    layoutErrorCodes,
  );
}

export async function getLayout(companyId: string, layoutId: string) {
  return unwrap(
    await client().GET(
      "/companies/{companyId}/programming/layouts/{layoutId}",
      { params: { path: { companyId, layoutId } } },
    ),
    layoutErrorCodes,
  );
}

export async function createLayout(
  companyId: string,
  input: {
    name: string;
    branchId: string | null;
    definition: LayoutDefinition;
  },
) {
  return unwrap(
    await client().POST("/companies/{companyId}/programming/layouts", {
      params: { path: { companyId } },
      body: input,
    }),
    layoutErrorCodes,
  );
}

export async function importLayout(
  companyId: string,
  input: { branchId: string | null; document: ImportedDocument },
) {
  return unwrap(
    await client().POST("/companies/{companyId}/programming/layouts/import", {
      params: { path: { companyId } },
      body: input,
    }),
    layoutErrorCodes,
  );
}

export async function updateLayout(
  companyId: string,
  layout: Layout,
  input: { name?: string; definition?: LayoutDefinition },
) {
  return unwrap(
    await client().PATCH(
      "/companies/{companyId}/programming/layouts/{layoutId}",
      {
        params: { path: { companyId, layoutId: layout.id } },
        body: { expectedVersion: layout.version, ...input },
      },
    ),
    layoutErrorCodes,
  );
}

export async function deleteLayout(companyId: string, layout: Layout) {
  const { error, response } = await client().DELETE(
    "/companies/{companyId}/programming/layouts/{layoutId}",
    {
      params: { path: { companyId, layoutId: layout.id } },
      body: { expectedVersion: layout.version },
    },
  );
  if (response.status === 204) return;
  unwrap({ error, response }, layoutErrorCodes);
}

export async function exportLayout(companyId: string, layoutId: string) {
  return unwrap(
    await client().GET(
      "/companies/{companyId}/programming/layouts/{layoutId}/export",
      { params: { path: { companyId, layoutId } } },
    ),
    layoutErrorCodes,
  );
}
