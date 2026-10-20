import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  listScreenStates,
  screenStatesKey,
  syncRefreshMs,
} from "../devices/api.js";
import { deviceMessages } from "../devices/messages.js";
import { syncSummary } from "../devices/sync.js";
import { contentUrl } from "../media/api.js";
import { type CompanyWithAccess } from "../organizations/api.js";
import {
  assignDevice,
  checkRules,
  createGroup,
  createPlaylist,
  deleteGroup,
  deletePlaylist,
  deviceProgrammingKey,
  getDeviceProgramming,
  getGroup,
  getPlaylist,
  getProgram,
  getTimeline,
  groupKey,
  groupsKey,
  listGroups,
  listPlaylistChoices,
  listPlaylists,
  listPublications,
  listSelectableMedia,
  playlistKey,
  playlistsKey,
  previewRange,
  programKey,
  publicationsKey,
  replacePlaylistItems,
  replaceScreenOutput,
  timelineKey,
  updateGroup,
  updatePlaylist,
  type Group,
  type Playlist,
  type Program,
  type ProgramSource,
  type RuleInput,
  type Transition,
} from "./api.js";
import {
  BackLink,
  can,
  CompanyGate,
  ConfirmedDelete,
  Failure,
  StepUpPrompt,
  mustReload,
  scopeName,
  useBranchChoices,
  useProgrammingMessages,
  type Messages,
} from "./common.js";
import { LayoutsView } from "./layouts.js";
import { PublicationPanel } from "./publications.js";

export type ProgrammingFilter = Readonly<{
  view?: "groups" | "layouts";
  cursor?: string;
  text?: string;
}>;

/** `1:05` or `1:02:05` for a duration in milliseconds. */
export function formatDuration(ms: number): string {
  const total = Math.round(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, "0");
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}`
    : `${minutes}:${seconds}`;
}

function summary(playlist: Playlist, t: Messages) {
  return t.playlistSummary(
    playlist.items.length,
    formatDuration(playlist.durationMs),
    playlist.videoCount,
  );
}

// Overview

function CreatePlaylistForm({
  companyId,
  branches,
}: {
  companyId: string;
  branches: { id: string; name: string }[];
}) {
  const { t } = useProgrammingMessages();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [scope, setScope] = useState("company");
  const create = useMutation({
    mutationFn: () =>
      createPlaylist(companyId, {
        name,
        branchId: scope === "company" ? null : scope,
      }),
    onSuccess: (created) =>
      navigate({
        to: "/companies/$companyId/programming/playlists/$playlistId",
        params: { companyId, playlistId: created.id },
      }),
  });
  return (
    <form
      className="form-stack"
      aria-labelledby="create-playlist-title"
      onSubmit={(event) => {
        event.preventDefault();
        create.mutate();
      }}
    >
      <h2 id="create-playlist-title">{t.createPlaylistTitle}</h2>
      <label htmlFor="playlist-name">{t.fieldName}</label>
      <input
        id="playlist-name"
        required
        maxLength={120}
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <label htmlFor="playlist-scope">{t.fieldScope}</label>
      <select
        id="playlist-scope"
        value={scope}
        onChange={(event) => setScope(event.target.value)}
      >
        <option value="company">{t.companyScope}</option>
        {branches.map((branch) => (
          <option key={branch.id} value={branch.id}>
            {branch.name}
          </option>
        ))}
      </select>
      {create.error && <Failure error={create.error} operation="write" />}
      <button
        type="submit"
        className="button-primary"
        disabled={create.isPending || !name.trim()}
      >
        {create.isPending ? t.creating : t.create}
      </button>
    </form>
  );
}

function PlaylistList({
  companyId,
  filter,
}: {
  companyId: string;
  filter: ProgrammingFilter;
}) {
  const { t } = useProgrammingMessages();
  const navigate = useNavigate();
  const [text, setText] = useState(filter.text ?? "");
  const playlists = useQuery({
    queryKey: [...playlistsKey(companyId), filter],
    queryFn: () =>
      listPlaylists(companyId, {
        ...(filter.cursor ? { cursor: filter.cursor } : {}),
        ...(filter.text ? { text: filter.text } : {}),
      }),
  });
  return (
    <section aria-labelledby="playlists-title">
      <h2 id="playlists-title">{t.views.playlists}</h2>
      <form
        role="search"
        className="programming-filters"
        onSubmit={(event) => {
          event.preventDefault();
          void navigate({
            to: "/companies/$companyId/programming",
            params: { companyId },
            search: text.trim() ? { text: text.trim() } : {},
          });
        }}
      >
        <label htmlFor="playlist-text">{t.filterText}</label>{" "}
        <input
          id="playlist-text"
          type="search"
          maxLength={120}
          value={text}
          onChange={(event) => setText(event.target.value)}
        />{" "}
        <button type="submit">{t.search}</button>
      </form>
      {playlists.isPending ? (
        <p>{t.loading}</p>
      ) : playlists.isError ? (
        <Failure
          error={playlists.error}
          operation="read"
          onReload={() => void playlists.refetch()}
        />
      ) : playlists.data.items.length === 0 ? (
        <p className="empty-state">
          {filter.cursor ? t.pageEmpty : t.playlistsEmpty}
        </p>
      ) : (
        <ul className="programming-list">
          {playlists.data.items.map((playlist) => (
            <li key={playlist.id}>
              <Link
                to="/companies/$companyId/programming/playlists/$playlistId"
                params={{ companyId, playlistId: playlist.id }}
              >
                {playlist.name}
              </Link>
              <span className="hint">
                {scopeName(playlist.branch, t)} · {summary(playlist, t)}
              </span>
            </li>
          ))}
        </ul>
      )}
      <nav className="pagination" aria-label={t.views.playlists}>
        {filter.cursor && (
          <Link
            to="/companies/$companyId/programming"
            params={{ companyId }}
            search={filter.text ? { text: filter.text } : {}}
          >
            {t.firstPage}
          </Link>
        )}
        {playlists.data?.nextCursor && (
          <Link
            to="/companies/$companyId/programming"
            params={{ companyId }}
            search={{ ...filter, cursor: playlists.data.nextCursor }}
          >
            {t.nextPage}
          </Link>
        )}
      </nav>
    </section>
  );
}

function SpanFields({
  idPrefix,
  branches,
  allBranches,
  selected,
  onAll,
  onSelected,
}: {
  idPrefix: string;
  branches: { id: string; name: string }[];
  allBranches: boolean;
  selected: string[];
  onAll: (value: boolean) => void;
  onSelected: (value: string[]) => void;
}) {
  const { t } = useProgrammingMessages();
  return (
    <fieldset className="programming-choices">
      <legend>{t.spanLabel}</legend>
      <p className="hint">{t.spanHint}</p>
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={allBranches}
          onChange={(event) => onAll(event.target.checked)}
        />
        {t.allBranches}
      </label>
      {!allBranches &&
        branches.map((branch) => (
          <label key={branch.id} className="checkbox-row">
            <input
              type="checkbox"
              id={`${idPrefix}-${branch.id}`}
              checked={selected.includes(branch.id)}
              onChange={(event) =>
                onSelected(
                  event.target.checked
                    ? [...selected, branch.id]
                    : selected.filter((id) => id !== branch.id),
                )
              }
            />
            {branch.name}
          </label>
        ))}
    </fieldset>
  );
}

function CreateGroupForm({
  companyId,
  branches,
}: {
  companyId: string;
  branches: { id: string; name: string }[];
}) {
  const { t } = useProgrammingMessages();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [allBranches, setAllBranches] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const create = useMutation({
    mutationFn: () =>
      createGroup(companyId, {
        name,
        allBranches,
        branchIds: allBranches ? [] : selected,
      }),
    onSuccess: (created) =>
      navigate({
        to: "/companies/$companyId/programming/groups/$groupId",
        params: { companyId, groupId: created.id },
      }),
  });
  return (
    <form
      className="form-stack"
      aria-labelledby="create-group-title"
      onSubmit={(event) => {
        event.preventDefault();
        create.mutate();
      }}
    >
      <h2 id="create-group-title">{t.createGroupTitle}</h2>
      <label htmlFor="group-name">{t.fieldName}</label>
      <input
        id="group-name"
        required
        maxLength={80}
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <SpanFields
        idPrefix="create-span"
        branches={branches}
        allBranches={allBranches}
        selected={selected}
        onAll={setAllBranches}
        onSelected={setSelected}
      />
      {create.error && <Failure error={create.error} operation="write" />}
      <button
        type="submit"
        className="button-primary"
        disabled={
          create.isPending ||
          !name.trim() ||
          (!allBranches && selected.length === 0)
        }
      >
        {create.isPending ? t.creating : t.create}
      </button>
    </form>
  );
}

const spanText = (group: Group, t: Messages) =>
  group.allBranches
    ? t.spanAll
    : group.branches.map((branch) => branch.name).join(", ");

function GroupList({ companyId }: { companyId: string }) {
  const { t } = useProgrammingMessages();
  const groups = useQuery({
    queryKey: groupsKey(companyId),
    queryFn: () => listGroups(companyId),
  });
  return (
    <section aria-labelledby="groups-title">
      <h2 id="groups-title">{t.views.groups}</h2>
      {groups.isPending ? (
        <p>{t.loading}</p>
      ) : groups.isError ? (
        <Failure
          error={groups.error}
          operation="read"
          onReload={() => void groups.refetch()}
        />
      ) : groups.data.items.length === 0 ? (
        <p className="empty-state">{t.groupsEmpty}</p>
      ) : (
        <ul className="programming-list">
          {groups.data.items.map((group) => (
            <li key={group.id}>
              <Link
                to="/companies/$companyId/programming/groups/$groupId"
                params={{ companyId, groupId: group.id }}
              >
                {group.name}
              </Link>
              <span className="hint">
                {spanText(group, t)} · {t.memberCount(group.members.length)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function ProgrammingPage({
  companyId,
  filter,
}: {
  companyId: string;
  filter: ProgrammingFilter;
}) {
  const { t } = useProgrammingMessages();
  const branches = useBranchChoices(companyId);
  const view = filter.view ?? "playlists";
  const search = new URLSearchParams(
    Object.entries(filter).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  const returnTo = `/companies/${companyId}/programming${search.size ? `?${search}` : ""}`;
  const choices = branches.data?.items ?? [];
  return (
    <CompanyGate companyId={companyId} returnTo={returnTo}>
      {(company) => (
        <>
          <h1 id="programming-title">{t.title}</h1>
          <p>{t.lead}</p>
          <nav className="company-navigation" aria-label={t.viewsLabel}>
            <Link
              to="/companies/$companyId/programming"
              params={{ companyId }}
              search={{}}
              aria-current={view === "playlists" ? "page" : undefined}
            >
              {t.views.playlists}
            </Link>
            <Link
              to="/companies/$companyId/programming"
              params={{ companyId }}
              search={{ view: "layouts" }}
              aria-current={view === "layouts" ? "page" : undefined}
            >
              {t.views.layouts}
            </Link>
            <Link
              to="/companies/$companyId/programming"
              params={{ companyId }}
              search={{ view: "groups" }}
              aria-current={view === "groups" ? "page" : undefined}
            >
              {t.views.groups}
            </Link>
          </nav>
          {view === "layouts" ? (
            <LayoutsView
              companyId={companyId}
              company={company}
              branches={choices}
              filter={filter}
            />
          ) : view === "playlists" ? (
            <>
              {can(company, "programming.edit") && (
                <CreatePlaylistForm companyId={companyId} branches={choices} />
              )}
              <PlaylistList companyId={companyId} filter={filter} />
            </>
          ) : (
            <>
              {can(company, "programming.edit") && (
                <CreateGroupForm companyId={companyId} branches={choices} />
              )}
              <GroupList companyId={companyId} />
            </>
          )}
        </>
      )}
    </CompanyGate>
  );
}

// Playlists

function PlaylistSettings({
  companyId,
  playlist,
  onChanged,
}: {
  companyId: string;
  playlist: Playlist;
  onChanged: (changed: Playlist | null, notice?: string) => Promise<void>;
}) {
  const { t } = useProgrammingMessages();
  const [name, setName] = useState(playlist.name);
  const [transition, setTransition] = useState<Transition>(playlist.transition);
  const [fade, setFade] = useState(String(playlist.fadeMs ?? 500));
  const fadeMs = transition === "FADE" ? Number(fade) : null;
  const transitionChanged =
    transition !== playlist.transition || fadeMs !== playlist.fadeMs;
  const save = useMutation({
    mutationFn: () =>
      updatePlaylist(companyId, playlist, {
        ...(name.trim() !== playlist.name ? { name } : {}),
        ...(transitionChanged ? { transition, fadeMs } : {}),
      }),
    onSuccess: (changed) => onChanged(changed, t.saved),
  });
  return (
    <form
      className="form-stack"
      aria-labelledby="playlist-settings-title"
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate();
      }}
    >
      <h2 id="playlist-settings-title">{t.settingsTitle}</h2>
      <label htmlFor="playlist-rename">{t.fieldName}</label>
      <input
        id="playlist-rename"
        required
        maxLength={120}
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <label htmlFor="playlist-transition">{t.transitionLabel}</label>
      <select
        id="playlist-transition"
        value={transition}
        onChange={(event) => setTransition(event.target.value as Transition)}
      >
        <option value="CUT">{t.transitions.CUT}</option>
        <option value="FADE">{t.transitions.FADE}</option>
      </select>
      {transition === "FADE" && (
        <>
          <label htmlFor="playlist-fade">{t.fadeLabel}</label>
          <input
            id="playlist-fade"
            type="number"
            min={250}
            max={2000}
            step={50}
            required
            value={fade}
            onChange={(event) => setFade(event.target.value)}
          />
          <p className="hint">{t.fadeHint}</p>
        </>
      )}
      {save.error && (
        <Failure
          error={save.error}
          operation="write"
          onReload={() => {
            save.reset();
            void onChanged(playlist);
          }}
        />
      )}
      <button
        type="submit"
        className="button-primary"
        disabled={
          save.isPending ||
          mustReload(save.error) ||
          (name.trim() === playlist.name && !transitionChanged)
        }
      >
        {save.isPending ? t.saving : t.save}
      </button>
    </form>
  );
}

type DraftItem = {
  key: string;
  mediaAssetId: string;
  name: string;
  kind: "IMAGE" | "VIDEO";
  mediaStatus: string;
  seconds: string;
};

let draftKeys = 0;
const nextKey = () => `item-${++draftKeys}`;

function toDraft(playlist: Playlist): DraftItem[] {
  return playlist.items.map((item) => ({
    key: nextKey(),
    mediaAssetId: item.mediaAssetId,
    name: item.name,
    kind: item.kind,
    mediaStatus: item.mediaStatus,
    seconds:
      item.kind === "IMAGE"
        ? String(Math.round((item.durationMs ?? 10_000) / 1000))
        : "",
  }));
}

function MediaPicker({
  companyId,
  playlist,
  onAdd,
}: {
  companyId: string;
  playlist: Playlist;
  onAdd: (item: DraftItem) => void;
}) {
  const { t } = useProgrammingMessages();
  const [text, setText] = useState("");
  const [query, setQuery] = useState<string | undefined>(undefined);
  const media = useQuery({
    queryKey: ["programming", "picker", companyId, query],
    queryFn: () => listSelectableMedia(companyId, query),
  });
  // The server checks scope again; this only hides what cannot be added.
  const fits = (item: { branch: { id: string } | null }) =>
    item.branch === null ||
    (playlist.branch !== null && item.branch.id === playlist.branch.id);
  const items = media.data?.items.filter(fits) ?? [];
  return (
    <section aria-labelledby="picker-title" className="programming-picker">
      <h3 id="picker-title">{t.pickerTitle}</h3>
      <p className="hint">{t.pickerLead}</p>
      <form
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          setQuery(text.trim() || undefined);
        }}
      >
        <label htmlFor="picker-text">{t.filterText}</label>{" "}
        <input
          id="picker-text"
          type="search"
          maxLength={120}
          value={text}
          onChange={(event) => setText(event.target.value)}
        />{" "}
        <button type="submit">{t.search}</button>
      </form>
      {media.isPending ? (
        <p>{t.loading}</p>
      ) : media.isError ? (
        <Failure
          error={media.error}
          operation="read"
          onReload={() => void media.refetch()}
        />
      ) : items.length === 0 ? (
        <p className="empty-state">{t.pickerEmpty}</p>
      ) : (
        <ul className="programming-picker-grid">
          {items.map((item) => (
            <li key={item.id}>
              <img
                src={contentUrl(companyId, item, "thumbnail")}
                alt=""
                loading="lazy"
              />
              <span>{item.name}</span>
              <button
                type="button"
                onClick={() =>
                  onAdd({
                    key: nextKey(),
                    mediaAssetId: item.id,
                    name: item.name,
                    kind: item.kind,
                    mediaStatus: item.status,
                    seconds: item.kind === "IMAGE" ? "10" : "",
                  })
                }
              >
                {t.add(item.name)}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ItemsEditor({
  companyId,
  playlist,
  onChanged,
}: {
  companyId: string;
  playlist: Playlist;
  onChanged: (changed: Playlist | null, notice?: string) => Promise<void>;
}) {
  const { t } = useProgrammingMessages();
  const [items, setItems] = useState<DraftItem[]>(() => toDraft(playlist));
  const [dirty, setDirty] = useState(false);
  const change = (next: DraftItem[]) => {
    setItems(next);
    setDirty(true);
  };
  const move = (index: number, offset: number) => {
    const next = [...items];
    const [moved] = next.splice(index, 1);
    next.splice(index + offset, 0, moved);
    change(next);
  };
  const valid = items.every(
    (item) =>
      item.kind === "VIDEO" ||
      (/^\d+$/.test(item.seconds) &&
        Number(item.seconds) >= 1 &&
        Number(item.seconds) <= 3600),
  );
  const save = useMutation({
    mutationFn: () =>
      replacePlaylistItems(
        companyId,
        playlist,
        items.map((item) => ({
          mediaAssetId: item.mediaAssetId,
          durationSeconds: item.kind === "IMAGE" ? Number(item.seconds) : null,
        })),
      ),
    onSuccess: (changed) => onChanged(changed, t.itemsSaved),
  });
  return (
    <section aria-labelledby="items-title" className="form-stack">
      <h2 id="items-title">{t.itemsTitle}</h2>
      <p className="hint">{t.itemsLead}</p>
      {items.length === 0 ? (
        <p className="empty-state">{t.itemsEmpty}</p>
      ) : (
        <ol className="programming-items">
          {items.map((item, index) => (
            <li key={item.key}>
              <span className="programming-item-name">
                {t.itemPosition(index + 1, item.name)}
                {item.mediaStatus === "ARCHIVED" && (
                  <span className="hint"> · {t.archivedItem}</span>
                )}
                {item.mediaStatus !== "READY" &&
                  item.mediaStatus !== "ARCHIVED" && (
                    <span className="hint"> · {t.unavailableItem}</span>
                  )}
              </span>
              {item.kind === "IMAGE" ? (
                <input
                  type="number"
                  min={1}
                  max={3600}
                  required
                  aria-label={t.itemSeconds(item.name)}
                  value={item.seconds}
                  onChange={(event) =>
                    change(
                      items.map((entry) =>
                        entry.key === item.key
                          ? { ...entry, seconds: event.target.value }
                          : entry,
                      ),
                    )
                  }
                />
              ) : (
                <span className="hint">{t.videoFull}</span>
              )}
              <span className="programming-item-actions">
                <button
                  type="button"
                  disabled={index === 0}
                  aria-label={`${t.moveUp}: ${t.itemPosition(index + 1, item.name)}`}
                  onClick={() => move(index, -1)}
                >
                  {t.moveUp}
                </button>
                <button
                  type="button"
                  disabled={index === items.length - 1}
                  aria-label={`${t.moveDown}: ${t.itemPosition(index + 1, item.name)}`}
                  onClick={() => move(index, 1)}
                >
                  {t.moveDown}
                </button>
                <button
                  type="button"
                  aria-label={`${t.remove}: ${t.itemPosition(index + 1, item.name)}`}
                  onClick={() =>
                    change(items.filter((entry) => entry.key !== item.key))
                  }
                >
                  {t.remove}
                </button>
              </span>
            </li>
          ))}
        </ol>
      )}
      {dirty && <p className="hint">{t.unsaved}</p>}
      {save.error && (
        <Failure
          error={save.error}
          operation="write"
          onReload={() => {
            save.reset();
            void onChanged(playlist);
          }}
        />
      )}
      <button
        type="button"
        className="button-primary"
        disabled={
          !dirty ||
          !valid ||
          items.length > 500 ||
          save.isPending ||
          mustReload(save.error)
        }
        onClick={() => save.mutate()}
      >
        {save.isPending ? t.saving : t.saveItems}
      </button>
      <MediaPicker
        companyId={companyId}
        playlist={playlist}
        onAdd={(item) => change([...items, item])}
      />
    </section>
  );
}

function PlaylistDetail({
  companyId,
  playlistId,
  company,
}: {
  companyId: string;
  playlistId: string;
  company: CompanyWithAccess;
}) {
  const { t } = useProgrammingMessages();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [notice, setNotice] = useState<string | null>(null);
  const playlist = useQuery({
    queryKey: playlistKey(companyId, playlistId),
    queryFn: () => getPlaylist(companyId, playlistId),
  });
  const onChanged = async (changed: Playlist | null, done?: string) => {
    setNotice(done ?? null);
    if (changed)
      queryClient.setQueryData(playlistKey(companyId, playlistId), changed);
    await queryClient.invalidateQueries({ queryKey: playlistsKey(companyId) });
    if (changed)
      await queryClient.invalidateQueries({
        queryKey: playlistKey(companyId, playlistId),
      });
  };
  if (playlist.isPending) return <p>{t.loading}</p>;
  if (playlist.isError)
    return (
      <>
        <Failure
          error={playlist.error}
          operation="read"
          onReload={() => void playlist.refetch()}
        />
        <BackLink companyId={companyId} />
      </>
    );
  const item = playlist.data;
  // Company playlists need company-wide authority, which the server decides.
  const edit = can(company, "programming.edit");
  return (
    <>
      <BackLink companyId={companyId} />
      <h1 id="programming-title">{item.name}</h1>
      <p className="hint">
        {scopeName(item.branch, t)} · {summary(item, t)} ·{" "}
        {item.transition === "FADE"
          ? `${t.transitions.FADE} ${item.fadeMs ?? 0} ms`
          : t.transitions.CUT}
      </p>
      {notice && <p role="status">{notice}</p>}
      {edit ? (
        <>
          <PlaylistSettings
            key={`settings-${item.version}`}
            companyId={companyId}
            playlist={item}
            onChanged={onChanged}
          />
          <ItemsEditor
            key={`items-${item.version}`}
            companyId={companyId}
            playlist={item}
            onChanged={onChanged}
          />
          <ConfirmedDelete
            key={`delete-${item.version}`}
            title={t.deletePlaylistTitle}
            lead={t.deletePlaylistLead}
            confirm={t.deletePlaylistConfirm(item.name)}
            label={t.deletePlaylist}
            run={() => deletePlaylist(companyId, item)}
            onDone={() => {
              void queryClient.invalidateQueries({
                queryKey: playlistsKey(companyId),
              });
              void navigate({
                to: "/companies/$companyId/programming",
                params: { companyId },
              });
            }}
          />
        </>
      ) : (
        <ol className="programming-items">
          {item.items.map((entry, index) => (
            <li key={`${entry.mediaAssetId}-${index}`}>
              {t.itemPosition(index + 1, entry.name)}
              <span className="hint">
                {" "}
                ·{" "}
                {entry.kind === "VIDEO" || entry.durationMs === null
                  ? t.videoFull
                  : formatDuration(entry.durationMs)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}

export function PlaylistPage({
  companyId,
  playlistId,
}: {
  companyId: string;
  playlistId: string;
}) {
  return (
    <CompanyGate
      companyId={companyId}
      returnTo={`/companies/${companyId}/programming/playlists/${playlistId}`}
    >
      {(company) => (
        <PlaylistDetail
          companyId={companyId}
          playlistId={playlistId}
          company={company}
        />
      )}
    </CompanyGate>
  );
}

// Schedules

type DraftRule = {
  key: string;
  playlistId: string;
  weekdays: number[];
  allDay: boolean;
  startTime: string;
  endTime: string;
  startsOn: string;
  endsOn: string;
};

const today = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};

function toDraftRules(program: Program): DraftRule[] {
  return (program.outputs[0]?.rules ?? []).map((rule) => ({
    key: nextKey(),
    playlistId: rule.playlistId,
    weekdays: [...rule.weekdays],
    allDay: rule.allDay,
    startTime: rule.startTime ?? "",
    endTime: rule.endTime ?? "",
    startsOn: rule.startsOn,
    endsOn: rule.endsOn ?? "",
  }));
}

const complete = (rule: DraftRule) =>
  rule.playlistId !== "" &&
  rule.weekdays.length > 0 &&
  rule.startsOn !== "" &&
  (rule.allDay || (rule.startTime !== "" && rule.endTime !== ""));

const ruleInput = (rule: DraftRule): RuleInput => ({
  playlistId: rule.playlistId,
  weekdays: [...rule.weekdays].sort((a, b) => a - b),
  allDay: rule.allDay,
  ...(rule.allDay ? {} : { startTime: rule.startTime, endTime: rule.endTime }),
  startsOn: rule.startsOn,
  endsOn: rule.endsOn || null,
});

/** Branches a program can reach, to offer only playlists that fit it. */
type Reach = "all" | ReadonlySet<string>;

function ScheduleEditor({
  companyId,
  source,
  reach,
  editable,
}: {
  companyId: string;
  source: ProgramSource;
  reach: Reach;
  editable: boolean;
}) {
  const { locale, t } = useProgrammingMessages();
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<string | null>(null);
  const program = useQuery({
    queryKey: programKey(companyId, source),
    queryFn: () => getProgram(companyId, source),
  });
  const playlists = useQuery({
    queryKey: [...playlistsKey(companyId), "choices"],
    queryFn: () => listPlaylistChoices(companyId),
  });
  if (program.isPending) return <p>{t.loading}</p>;
  if (program.isError)
    return (
      <Failure
        error={program.error}
        operation="read"
        onReload={() => void program.refetch()}
      />
    );
  const fits = (playlist: { branch: { id: string } | null }) =>
    playlist.branch === null ||
    (reach !== "all" && reach.size === 1 && reach.has(playlist.branch.id));
  // References keep their place even when the caller cannot see the playlist,
  // such as one of a moved screen's previous branch.
  const choices = new Map<string, string>();
  const refer = (id: string | null, summary: { name: string } | null) => {
    if (id) choices.set(id, summary?.name ?? t.hiddenPlaylist);
  };
  for (const output of program.data.outputs) {
    refer(output.defaultPlaylistId, output.defaultPlaylist);
    for (const rule of output.rules) refer(rule.playlistId, rule.playlist);
  }
  for (const playlist of playlists.data ?? [])
    if (fits(playlist)) choices.set(playlist.id, playlist.name);
  return (
    <ScheduleForm
      key={`program-${program.data.version}`}
      companyId={companyId}
      source={source}
      program={program.data}
      choices={[...choices].map(([id, name]) => ({ id, name }))}
      editable={editable}
      locale={locale}
      notice={notice}
      onEdit={() => setNotice(null)}
      onSaved={async (saved) => {
        setNotice(t.schedulesSaved);
        queryClient.setQueryData(programKey(companyId, source), saved);
        await queryClient.invalidateQueries({
          queryKey: ["programming", "timeline", companyId],
        });
      }}
    />
  );
}

function ScheduleForm({
  companyId,
  source,
  program,
  choices,
  editable,
  locale,
  notice,
  onEdit,
  onSaved,
}: {
  companyId: string;
  source: ProgramSource;
  program: Program;
  choices: { id: string; name: string }[];
  editable: boolean;
  locale: string;
  notice: string | null;
  onEdit: () => void;
  onSaved: (program: Program) => Promise<void>;
}) {
  const { t } = useProgrammingMessages();
  const [rules, setRules] = useState<DraftRule[]>(() => toDraftRules(program));
  const [fallback, setFallback] = useState(
    program.outputs[0]?.defaultPlaylistId ?? "",
  );
  const hidden = program.outputs.some(
    (output) =>
      (output.defaultPlaylistId !== null && !output.defaultPlaylist) ||
      output.rules.some((rule) => !rule.playlist),
  );
  const [problems, setProblems] = useState<Map<number, string[]>>(new Map());
  const formatDate = (date: string) =>
    new Intl.DateTimeFormat(locale, {
      dateStyle: "short",
      timeZone: "UTC",
    }).format(new Date(`${date}T00:00:00Z`));
  const update = (key: string, change: Partial<DraftRule>) =>
    setRules((current) =>
      current.map((rule) => (rule.key === key ? { ...rule, ...change } : rule)),
    );
  const save = useMutation({
    mutationFn: async () => {
      onEdit();
      const found = new Map<number, string[]>();
      const note = (index: number, text: string) =>
        found.set(index, [...(found.get(index) ?? []), text]);
      rules.forEach((rule, index) => {
        if (!complete(rule)) note(index, t.ruleIncomplete);
      });
      if (found.size === 0) {
        const check = await checkRules(companyId, rules.map(ruleInput));
        for (const issue of check.issues) note(issue.index, t.ruleTimesEqual);
        for (const conflict of check.conflicts) {
          const date = formatDate(conflict.date);
          note(conflict.first, t.ruleConflict(conflict.second + 1, date));
          note(conflict.second, t.ruleConflict(conflict.first + 1, date));
        }
      }
      setProblems(found);
      if (found.size > 0) return null;
      return replaceScreenOutput(companyId, source, program.version, {
        defaultPlaylistId: fallback || null,
        rules: rules.map(ruleInput),
      });
    },
    onSuccess: async (saved) => {
      if (saved) await onSaved(saved);
    },
  });
  return (
    <section aria-labelledby="schedules-title" className="form-stack">
      <h2 id="schedules-title">{t.schedulesTitle}</h2>
      <p className="hint">{t.schedulesLead}</p>
      {notice && <p role="status">{notice}</p>}
      {choices.length === 0 && <p className="hint">{t.noPlaylists}</p>}
      {hidden && <p className="hint">{t.hiddenPlaylists}</p>}
      <fieldset disabled={!editable} className="programming-rules">
        <legend className="visually-hidden">{t.schedulesTitle}</legend>
        {rules.map((rule, index) => {
          const position = index + 1;
          const id = (field: string) => `${rule.key}-${field}`;
          const messages = problems.get(index) ?? [];
          return (
            <fieldset
              key={rule.key}
              className="programming-rule"
              aria-describedby={messages.length ? id("problems") : undefined}
            >
              <legend>{t.ruleLabel(position)}</legend>
              <label htmlFor={id("playlist")}>{t.rulePlaylist}</label>
              <select
                id={id("playlist")}
                value={rule.playlistId}
                onChange={(event) =>
                  update(rule.key, { playlistId: event.target.value })
                }
              >
                <option value="">{t.choosePlaylist}</option>
                {choices.map((choice) => (
                  <option key={choice.id} value={choice.id}>
                    {choice.name}
                  </option>
                ))}
              </select>
              <fieldset className="programming-weekdays">
                <legend>{t.weekdaysLabel}</legend>
                {[1, 2, 3, 4, 5, 6, 7].map((day) => (
                  <label key={day} className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={rule.weekdays.includes(day)}
                      onChange={(event) =>
                        update(rule.key, {
                          weekdays: event.target.checked
                            ? [...rule.weekdays, day]
                            : rule.weekdays.filter((value) => value !== day),
                        })
                      }
                    />
                    {t.weekdays[day]}
                  </label>
                ))}
              </fieldset>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={rule.allDay}
                  onChange={(event) =>
                    update(rule.key, { allDay: event.target.checked })
                  }
                />
                {t.allDay}
              </label>
              {!rule.allDay && (
                <span className="programming-times">
                  <label htmlFor={id("start")}>{t.startTime}</label>
                  <input
                    id={id("start")}
                    type="time"
                    step={60}
                    value={rule.startTime}
                    onChange={(event) =>
                      update(rule.key, { startTime: event.target.value })
                    }
                  />
                  <label htmlFor={id("end")}>{t.endTime}</label>
                  <input
                    id={id("end")}
                    type="time"
                    step={60}
                    value={rule.endTime}
                    onChange={(event) =>
                      update(rule.key, { endTime: event.target.value })
                    }
                  />
                </span>
              )}
              <span className="programming-times">
                <label htmlFor={id("from")}>{t.startsOn}</label>
                <input
                  id={id("from")}
                  type="date"
                  required
                  value={rule.startsOn}
                  onChange={(event) =>
                    update(rule.key, { startsOn: event.target.value })
                  }
                />
                <label htmlFor={id("until")}>{t.endsOn}</label>
                <input
                  id={id("until")}
                  type="date"
                  value={rule.endsOn}
                  onChange={(event) =>
                    update(rule.key, { endsOn: event.target.value })
                  }
                />
              </span>
              {messages.length > 0 && (
                <ul
                  id={id("problems")}
                  role="alert"
                  className="notice notice-error"
                >
                  {messages.map((message) => (
                    <li key={message}>{message}</li>
                  ))}
                </ul>
              )}
              {editable && (
                <button
                  type="button"
                  onClick={() =>
                    setRules((current) =>
                      current.filter((entry) => entry.key !== rule.key),
                    )
                  }
                >
                  {t.removeRule(position)}
                </button>
              )}
            </fieldset>
          );
        })}
        {editable && (
          <button
            type="button"
            disabled={rules.length >= 200}
            onClick={() =>
              setRules((current) => [
                ...current,
                {
                  key: nextKey(),
                  playlistId: "",
                  weekdays: [1, 2, 3, 4, 5, 6, 7],
                  allDay: false,
                  startTime: "08:00",
                  endTime: "18:00",
                  startsOn: today(),
                  endsOn: "",
                },
              ])
            }
          >
            {t.addRule}
          </button>
        )}
        <label htmlFor="default-playlist">{t.defaultPlaylist}</label>
        <select
          id="default-playlist"
          value={fallback}
          onChange={(event) => setFallback(event.target.value)}
        >
          <option value="">{t.noDefault}</option>
          {choices.map((choice) => (
            <option key={choice.id} value={choice.id}>
              {choice.name}
            </option>
          ))}
        </select>
      </fieldset>
      {save.error && <Failure error={save.error} operation="write" />}
      {editable && (
        <button
          type="button"
          className="button-primary"
          disabled={save.isPending || mustReload(save.error)}
          onClick={() => save.mutate()}
        >
          {save.isPending ? t.saving : t.saveSchedules}
        </button>
      )}
    </section>
  );
}

function TimelinePreview({
  companyId,
  source,
  zones,
}: {
  companyId: string;
  source: ProgramSource;
  /** Zones to choose from for a group; a screen uses its own. */
  zones?: readonly string[];
}) {
  const { locale, t } = useProgrammingMessages();
  const [range] = useState(previewRange);
  const [zone, setZone] = useState(zones?.[0] ?? "UTC");
  const id = source.kind === "group" ? source.groupId : source.deviceId;
  const timeline = useQuery({
    queryKey: [...timelineKey(companyId, id), zone, range],
    queryFn: () => getTimeline(companyId, source, range, zone),
  });
  const shown = timeline.data?.timeZone ?? zone;
  const format = (instant: string) =>
    new Intl.DateTimeFormat(locale, {
      timeZone: shown,
      weekday: "short",
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(instant));
  const formatLocal = (local: string) =>
    new Intl.DateTimeFormat(locale, {
      timeZone: "UTC",
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(`${local}:00Z`));
  return (
    <section aria-labelledby="timeline-title">
      <h2 id="timeline-title">{t.timelineTitle}</h2>
      {zones && zones.length > 1 && (
        <p>
          <label htmlFor="timeline-zone">{t.timelineZoneLabel}</label>{" "}
          <select
            id="timeline-zone"
            value={zone}
            onChange={(event) => setZone(event.target.value)}
          >
            {zones.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </p>
      )}
      {timeline.isPending ? (
        <p>{t.loading}</p>
      ) : timeline.isError ? (
        <Failure
          error={timeline.error}
          operation="read"
          onReload={() => void timeline.refetch()}
        />
      ) : (
        <>
          <p className="hint">{t.timelineZone(timeline.data.timeZone)}</p>
          <table className="programming-timeline">
            <thead>
              <tr>
                <th scope="col">{t.timelineStart}</th>
                <th scope="col">{t.timelineEnd}</th>
                <th scope="col">{t.timelinePlays}</th>
              </tr>
            </thead>
            <tbody>
              {timeline.data.segments.map((segment) => (
                <tr key={segment.start}>
                  <td>{format(segment.start)}</td>
                  <td>{format(segment.end)}</td>
                  <td>
                    {segment.source === "none"
                      ? t.segmentNone
                      : !segment.playlist
                        ? t.hiddenPlaylist
                        : segment.source === "default"
                          ? t.segmentDefault(segment.playlist.name)
                          : segment.playlist.name}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {timeline.data.notes.length > 0 && (
            <ul className="hint">
              {timeline.data.notes.map((note) => (
                <li key={`${note.ruleId}-${note.boundary}-${note.local}`}>
                  {note.resolution === "gap"
                    ? t.noteGap(formatLocal(note.local), format(note.instant))
                    : t.noteRepeated(
                        formatLocal(note.local),
                        format(note.instant),
                      )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

// Groups

function GroupSettings({
  companyId,
  group,
  branches,
  onChanged,
}: {
  companyId: string;
  group: Group;
  branches: { id: string; name: string }[];
  onChanged: (changed: Group) => Promise<void>;
}) {
  const { t } = useProgrammingMessages();
  const [name, setName] = useState(group.name);
  const [allBranches, setAllBranches] = useState(group.allBranches);
  const [selected, setSelected] = useState(
    group.branches.map((branch) => branch.id),
  );
  const original = group.branches
    .map((branch) => branch.id)
    .sort()
    .join();
  const spanChanged =
    allBranches !== group.allBranches ||
    (!allBranches && [...selected].sort().join() !== original);
  // Archived branches stay in a span and must remain choosable.
  const choices = [
    ...branches,
    ...group.branches.filter(
      (branch) => !branches.some((choice) => choice.id === branch.id),
    ),
  ];
  const save = useMutation({
    mutationFn: () =>
      updateGroup(companyId, group, {
        ...(name.trim() !== group.name ? { name } : {}),
        ...(spanChanged
          ? { allBranches, branchIds: allBranches ? [] : selected }
          : {}),
      }),
    onSuccess: onChanged,
  });
  return (
    <form
      className="form-stack"
      aria-labelledby="group-settings-title"
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate();
      }}
    >
      <h2 id="group-settings-title">{t.groupSettingsTitle}</h2>
      <label htmlFor="group-rename">{t.fieldName}</label>
      <input
        id="group-rename"
        required
        maxLength={80}
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <SpanFields
        idPrefix="edit-span"
        branches={choices}
        allBranches={allBranches}
        selected={selected}
        onAll={setAllBranches}
        onSelected={setSelected}
      />
      {save.error && (
        <Failure
          error={save.error}
          operation="write"
          onReload={() => {
            save.reset();
            void onChanged(group);
          }}
        />
      )}
      <button
        type="submit"
        className="button-primary"
        disabled={
          save.isPending ||
          mustReload(save.error) ||
          (!allBranches && selected.length === 0) ||
          (name.trim() === group.name && !spanChanged)
        }
      >
        {save.isPending ? t.saving : t.save}
      </button>
    </form>
  );
}

function GroupDetail({
  companyId,
  groupId,
  company,
}: {
  companyId: string;
  groupId: string;
  company: CompanyWithAccess;
}) {
  const { locale, t } = useProgrammingMessages();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const branches = useBranchChoices(companyId);
  const [notice, setNotice] = useState<string | null>(null);
  const group = useQuery({
    queryKey: groupKey(companyId, groupId),
    queryFn: () => getGroup(companyId, groupId),
  });
  const memberIds = (group.data?.members ?? []).map((member) => member.id);
  const states = useQuery({
    queryKey: screenStatesKey(companyId, memberIds),
    queryFn: () => listScreenStates(companyId, memberIds),
    enabled: memberIds.length > 0 && can(company, "devices.view"),
    refetchInterval: syncRefreshMs,
  });
  const screenText = deviceMessages[locale];
  if (group.isPending) return <p>{t.loading}</p>;
  if (group.isError)
    return (
      <>
        <Failure
          error={group.error}
          operation="read"
          onReload={() => void group.refetch()}
        />
        <BackLink companyId={companyId} view="groups" />
      </>
    );
  const item = group.data;
  const edit = can(company, "programming.edit");
  const zones = [
    ...new Set(
      item.allBranches
        ? [
            company.company.timeZone,
            ...(branches.data?.items ?? []).map((branch) => branch.timeZone),
          ]
        : item.branches.map((branch) => branch.timeZone),
    ),
  ];
  const reach: Reach = item.allBranches
    ? "all"
    : new Set(item.branches.map((branch) => branch.id));
  return (
    <>
      <BackLink companyId={companyId} view="groups" />
      <h1 id="programming-title">{item.name}</h1>
      <p className="hint">{spanText(item, t)}</p>
      {notice && <p role="status">{notice}</p>}
      <section aria-labelledby="members-title">
        <h2 id="members-title">{t.membersTitle}</h2>
        {item.members.length === 0 ? (
          <p className="empty-state">{t.membersEmpty}</p>
        ) : (
          <ul className="programming-list">
            {item.members.map((member) => (
              <li key={member.id}>
                <Link
                  to="/companies/$companyId/programming/screens/$deviceId"
                  params={{ companyId, deviceId: member.id }}
                >
                  {member.name}
                </Link>
                <span className="hint">{member.branch.name}</span>
                {states.data?.get(member.id) && (
                  <span className="hint">
                    {syncSummary(states.data.get(member.id)!, screenText)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      <ScheduleEditor
        companyId={companyId}
        source={{ kind: "group", groupId }}
        reach={reach}
        editable={edit}
      />
      <TimelinePreview
        key={zones.join()}
        companyId={companyId}
        source={{ kind: "group", groupId }}
        zones={zones}
      />
      <PublicationPanel
        companyId={companyId}
        source={{ kind: "group", groupId }}
        company={company}
        returnTo={`/companies/${companyId}/programming/groups/${groupId}`}
      />
      {edit && (
        <>
          <GroupSettings
            key={`settings-${item.version}`}
            companyId={companyId}
            group={item}
            branches={branches.data?.items ?? []}
            onChanged={async (changed) => {
              setNotice(t.saved);
              queryClient.setQueryData(groupKey(companyId, groupId), changed);
              await queryClient.invalidateQueries({
                queryKey: groupsKey(companyId),
              });
            }}
          />
          <ConfirmedDelete
            key={`delete-${item.version}`}
            title={t.deleteGroupTitle}
            lead={t.deleteGroupLead}
            confirm={t.deleteGroupConfirm(item.name)}
            label={t.deleteGroup}
            run={() => deleteGroup(companyId, item)}
            onDone={() => {
              void queryClient.invalidateQueries({
                queryKey: groupsKey(companyId),
              });
              void navigate({
                to: "/companies/$companyId/programming",
                params: { companyId },
                search: { view: "groups" },
              });
            }}
          />
        </>
      )}
    </>
  );
}

export function GroupPage({
  companyId,
  groupId,
}: {
  companyId: string;
  groupId: string;
}) {
  return (
    <CompanyGate
      companyId={companyId}
      returnTo={`/companies/${companyId}/programming/groups/${groupId}`}
    >
      {(company) => (
        <GroupDetail
          companyId={companyId}
          groupId={groupId}
          company={company}
        />
      )}
    </CompanyGate>
  );
}

// Screens

/** Select value for a group the caller cannot fully see; it cannot be sent. */
const HIDDEN_GROUP = "hidden";

function AssignmentForm({
  companyId,
  current,
  groups,
  onChanged,
}: {
  companyId: string;
  current: Parameters<typeof assignDevice>[1];
  groups: Group[];
  onChanged: (notice: string) => Promise<void>;
}) {
  const { t } = useProgrammingMessages();
  // Individual programming exists only inside a group, so a screen with it
  // and no visible group belongs to a hidden one.
  const hidden =
    current.group === null &&
    (current.source === "group" || current.individual);
  const [groupId, setGroupId] = useState(
    current.group?.id ?? (hidden ? HIDDEN_GROUP : ""),
  );
  const [individual, setIndividual] = useState(current.individual);
  const [confirmed, setConfirmed] = useState(false);
  const branchId = current.device.branch.id;
  const choices = groups.filter(
    (group) =>
      group.allBranches ||
      group.branches.some((branch) => branch.id === branchId),
  );
  if (current.group && !choices.some((group) => group.id === current.group?.id))
    choices.push({
      ...current.group,
      allBranches: false,
      branches: [],
      members: [],
      createdAt: "",
      updatedAt: "",
      version: 1,
    });
  // The destination's latest publication decides whether the person must
  // confirm a neutral screen; until it is known, confirmation is asked.
  const destination: ProgramSource | null =
    groupId === HIDDEN_GROUP
      ? null
      : groupId && !individual
        ? { kind: "group", groupId }
        : { kind: "device", deviceId: current.device.id };
  const published = useQuery({
    queryKey: destination
      ? [...publicationsKey(companyId, destination), "latest"]
      : ["programming", "publications", companyId, "none"],
    queryFn: () => listPublications(companyId, destination!, { limit: 1 }),
    enabled: destination !== null,
  });
  const latest = published.data?.items[0] ?? null;
  const assign = useMutation({
    mutationFn: () =>
      assignDevice(companyId, current, {
        groupId: groupId || null,
        individual: groupId ? individual : false,
        confirmUnpublished: latest ? false : confirmed,
      }),
    onSuccess: () => onChanged(t.assigned),
  });
  // Leaving a hidden group is always a change; keeping it sends nothing.
  const unchanged = hidden
    ? groupId === HIDDEN_GROUP
    : (groupId || null) === (current.group?.id ?? null) &&
      (groupId ? individual : false) === current.individual;
  return (
    <form
      className="form-stack"
      aria-labelledby="assignment-title"
      onSubmit={(event) => {
        event.preventDefault();
        assign.mutate();
      }}
    >
      <h2 id="assignment-title">{t.assignmentTitle}</h2>
      <label htmlFor="assignment-group">{t.groupLabel}</label>
      <select
        id="assignment-group"
        value={groupId}
        onChange={(event) => setGroupId(event.target.value)}
      >
        <option value="">{t.noGroup}</option>
        {hidden && <option value={HIDDEN_GROUP}>{t.hiddenGroup}</option>}
        {choices.map((group) => (
          <option key={group.id} value={group.id}>
            {group.name}
          </option>
        ))}
      </select>
      {groupId && groupId !== HIDDEN_GROUP && (
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={individual}
            onChange={(event) => setIndividual(event.target.checked)}
          />
          {t.individualLabel}
        </label>
      )}
      {latest ? (
        <p className="hint">{t.publishedDestination(latest.generation)}</p>
      ) : (
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
          />
          {t.confirmUnpublished}
        </label>
      )}
      {assign.error && (
        <Failure
          error={assign.error}
          operation="write"
          onReload={() => {
            assign.reset();
            void onChanged("");
          }}
        />
      )}
      <button
        type="submit"
        className="button-primary"
        disabled={
          unchanged ||
          (!latest && !confirmed) ||
          assign.isPending ||
          mustReload(assign.error)
        }
      >
        {assign.isPending ? t.saving : t.assign}
      </button>
    </form>
  );
}

function ScreenProgrammingDetail({
  companyId,
  deviceId,
  company,
  returnTo,
}: {
  companyId: string;
  deviceId: string;
  company: CompanyWithAccess;
  returnTo: string;
}) {
  const { t } = useProgrammingMessages();
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<string | null>(null);
  const programming = useQuery({
    queryKey: deviceProgrammingKey(companyId, deviceId),
    queryFn: () => getDeviceProgramming(companyId, deviceId),
  });
  const assign = can(company, "programming.assign");
  const groups = useQuery({
    queryKey: groupsKey(companyId),
    queryFn: () => listGroups(companyId),
    enabled: assign,
  });
  if (programming.isPending) return <p>{t.loading}</p>;
  if (programming.isError)
    return (
      <Failure
        error={programming.error}
        operation="read"
        onReload={() => void programming.refetch()}
      />
    );
  const current = programming.data;
  const zone = current.device.timeZone ?? current.device.branch.timeZone;
  const stepUp =
    !assign &&
    company.access.capabilitiesAfterStrongAuthentication.includes(
      "programming.assign",
    );
  return (
    <>
      <p className="hint">
        <Link
          to="/companies/$companyId/screens/$deviceId"
          params={{ companyId, deviceId }}
        >
          {t.screenLink}
        </Link>
      </p>
      <h1 id="programming-title">{current.device.name}</h1>
      {notice && <p role="status">{notice}</p>}
      <dl className="company-settings">
        <dt>{t.branchLabel}</dt>
        <dd>{current.device.branch.name}</dd>
        <dt>{t.zoneLabel}</dt>
        <dd>
          {current.device.timeZone ??
            t.branchZone(current.device.branch.timeZone)}
        </dd>
        <dt>{t.sourceLabel}</dt>
        <dd>
          {current.source === "individual"
            ? t.sources.individual
            : current.group
              ? `${t.sources.group}: ${current.group.name}`
              : t.hiddenGroup}
        </dd>
      </dl>
      {stepUp && <StepUpPrompt returnTo={returnTo} />}
      {assign && groups.isPending && <p>{t.loading}</p>}
      {assign && groups.isError && (
        <Failure
          error={groups.error}
          operation="read"
          onReload={() => void groups.refetch()}
        />
      )}
      {assign && groups.data && (
        <AssignmentForm
          key={`assignment-${current.version}`}
          companyId={companyId}
          current={current}
          groups={groups.data.items}
          onChanged={async (done) => {
            setNotice(done || null);
            await Promise.all([
              queryClient.invalidateQueries({
                queryKey: deviceProgrammingKey(companyId, deviceId),
              }),
              queryClient.invalidateQueries({ queryKey: groupsKey(companyId) }),
              queryClient.invalidateQueries({
                queryKey: timelineKey(companyId, deviceId),
              }),
            ]);
          }}
        />
      )}
      {current.source === "group" && current.group ? (
        <p>
          <Link
            to="/companies/$companyId/programming/groups/$groupId"
            params={{ companyId, groupId: current.group.id }}
          >
            {t.groupSchedules}
          </Link>
        </p>
      ) : current.source === "group" ? (
        <p className="hint">{t.hiddenGroupSchedules}</p>
      ) : (
        <ScheduleEditor
          companyId={companyId}
          source={{ kind: "device", deviceId }}
          reach={new Set([current.device.branch.id])}
          editable={can(company, "programming.edit")}
        />
      )}
      <TimelinePreview
        key={`${current.version}-${zone}`}
        companyId={companyId}
        source={{ kind: "device", deviceId }}
      />
      {current.source === "individual" && (
        <PublicationPanel
          companyId={companyId}
          source={{ kind: "device", deviceId }}
          company={company}
          returnTo={returnTo}
        />
      )}
    </>
  );
}

export function ScreenProgrammingPage({
  companyId,
  deviceId,
}: {
  companyId: string;
  deviceId: string;
}) {
  const returnTo = `/companies/${companyId}/programming/screens/${deviceId}`;
  return (
    <CompanyGate companyId={companyId} returnTo={returnTo}>
      {(company) => (
        <ScreenProgrammingDetail
          companyId={companyId}
          deviceId={deviceId}
          company={company}
          returnTo={returnTo}
        />
      )}
    </CompanyGate>
  );
}
