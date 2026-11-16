import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Button, Checkbox, DataGrid, Menu, TextField } from "../components.js";
import type { MenuItem } from "../popover.js";
import { companyKey, type CompanyWithAccess } from "../organizations/api.js";
import { ApiFailure } from "../api-client.js";
import { formatInstant } from "../organizations/members.js";
import { UiIcon } from "../ui-icon.js";
import {
  changeMedia,
  contentUrl,
  createMediaFolder,
  getMedia,
  getMediaFolder,
  isPending,
  listMedia,
  listMediaFolders,
  mediaFolderKey,
  mediaFoldersKey,
  mediaKey,
  mediaListKey,
  organizeMedia,
  removeMediaFolder,
  renameMediaFolder,
  updateMedia,
  type Media,
  type MediaFilter,
  type MediaFolder,
  type MediaOrganizationCommand,
} from "./api.js";
import { MediaDialog, MediaFolderPicker } from "./dialogs.js";
import { Failure, mustReload, useMediaMessages } from "./feedback.js";

export type MediaBrowserRow =
  { kind: "asset"; item: Media } | { kind: "folder"; item: MediaFolder };
const rowKey = (row: MediaBrowserRow) => `${row.kind}:${row.item.id}`;
const sameScope = (row: MediaBrowserRow) => row.item.branch?.id ?? null;
const ready = (item: Media) =>
  ["READY", "ARCHIVED", "DELETED"].includes(item.status);
type Clipboard = { action: "MOVE" | "COPY"; rows: MediaBrowserRow[] };
type Modal =
  | { kind: "create" }
  | { kind: "rename" | "remove"; row: MediaBrowserRow }
  | { kind: "upload"; folder: MediaFolder | null; files: File[] }
  | { kind: "destination"; action: "MOVE" | "COPY"; rows: MediaBrowserRow[] }
  | { kind: "preview"; item: Media }
  | { kind: "trash"; item: Media };

/** URL-owned folders and filters; selection/clipboard remain in this library's React state. */
export function MediaBrowser({
  companyId,
  company,
  filter,
  branches,
  renderUpload,
  renderPreview,
}: {
  companyId: string;
  company: CompanyWithAccess;
  filter: MediaFilter;
  branches: { id: string; name: string }[];
  renderUpload: (options: {
    folder: MediaFolder | null;
    files: File[];
    onBusyChange: (busy: boolean) => void;
  }) => ReactNode;
  renderPreview: (item: Media) => ReactNode;
}) {
  const { locale, t } = useMediaMessages(),
    m = t.manager;
  const navigate = useNavigate(),
    client = useQueryClient();
  const view = filter.view ?? "library",
    layout = filter.layout ?? "grid";
  const folderId =
    view === "library" && filter.folderId && filter.folderId !== "root"
      ? filter.folderId
      : null;
  const upload = company.access.capabilities.includes("media.upload"),
    archive = company.access.capabilities.includes("media.archive"),
    deletion = company.access.capabilities.includes("media.delete");
  const [selected, setSelected] = useState<string[]>([]),
    [clipboard, setClipboard] = useState<Clipboard | null>(null);
  const [modal, setModal] = useState<Modal | null>(null),
    [notice, setNotice] = useState<string | null>(null),
    [uploadBusy, setUploadBusy] = useState(false);
  const [text, setText] = useState(filter.text ?? ""),
    [sort, setSort] = useState("name");
  const anchor = useRef<string | null>(null),
    menus = useRef(new Map<string, HTMLButtonElement>()),
    drag = useRef<MediaBrowserRow[] | null>(null);
  const location = useQuery({
    queryKey: mediaFolderKey(companyId, folderId ?? "root"),
    queryFn: () => getMediaFolder(companyId, folderId!),
    enabled: Boolean(folderId),
  });
  const folder = folderId && location.isSuccess ? location.data.folder : null;
  const fileFilter: MediaFilter = {
    ...(filter.cursor ? { cursor: filter.cursor } : {}),
    ...(filter.view ? { view: filter.view } : {}),
    ...(filter.kind ? { kind: filter.kind } : {}),
    ...(filter.scope ? { scope: filter.scope } : {}),
    ...(filter.text ? { text: filter.text } : {}),
    ...(view === "library" && !filter.text
      ? { folderId: folderId ?? "root" }
      : {}),
  };
  const files = useQuery({
    queryKey: [...mediaListKey(companyId), fileFilter],
    queryFn: () => listMedia(companyId, fileFilter),
    refetchInterval: (query) =>
      query.state.data?.items.some(isPending) ? 3000 : false,
  });
  const folders = useQuery({
    queryKey: [
      ...mediaFoldersKey(companyId),
      "list",
      folderId,
      filter.text,
      filter.scope,
      filter.folderCursor,
    ],
    queryFn: () =>
      listMediaFolders(companyId, {
        parentId: folderId ?? "root",
        ...(filter.text ? { text: filter.text } : {}),
        ...(filter.scope ? { scope: filter.scope } : {}),
        ...(filter.folderCursor ? { cursor: filter.folderCursor } : {}),
      }),
    enabled: view === "library",
  });
  const rows = useMemo(() => {
    const list: MediaBrowserRow[] = [
      ...(view === "library" && folders.isSuccess
        ? folders.data.items.map((item) => ({ kind: "folder" as const, item }))
        : []),
      ...(files.isSuccess
        ? files.data.items.map((item) => ({ kind: "asset" as const, item }))
        : []),
    ];
    const collator = new Intl.Collator(locale, {
      numeric: true,
      sensitivity: "base",
    });
    return list.sort((a, b) =>
      a.kind !== b.kind
        ? a.kind === "folder"
          ? -1
          : 1
        : sort === "recent"
          ? b.item.createdAt.localeCompare(a.item.createdAt)
          : sort === "size" && a.kind === "asset" && b.kind === "asset"
            ? b.item.declaredSize - a.item.declaredSize
            : collator.compare(a.item.name, b.item.name),
    );
  }, [
    files.data,
    files.isSuccess,
    folders.data,
    folders.isSuccess,
    view,
    sort,
    locale,
  ]);
  const chosen = rows.filter((row) => selected.includes(rowKey(row)));
  const path =
    folderId && location.isSuccess
      ? [...location.data.ancestors, location.data.folder]
      : [];
  const locationReady = !folderId || location.isSuccess;
  const go = (next: MediaFilter, replace = false) =>
    void navigate({
      to: "/companies/$companyId/media",
      params: { companyId },
      search: next,
      replace,
    });
  const goFolder = (id: string | null) =>
    go({
      ...(filter.layout ? { layout: filter.layout } : {}),
      ...(filter.kind ? { kind: filter.kind } : {}),
      ...(id ? { folderId: id } : {}),
    });
  useEffect(() => {
    setSelected([]);
    anchor.current = null;
  }, [
    folderId,
    view,
    filter.text,
    filter.scope,
    filter.kind,
    filter.cursor,
    filter.folderCursor,
  ]);
  useEffect(() => setText(filter.text ?? ""), [filter.text]);

  const refresh = async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: companyKey(companyId) }),
      client.invalidateQueries({ queryKey: mediaListKey(companyId) }),
      client.invalidateQueries({ queryKey: mediaFoldersKey(companyId) }),
      client.invalidateQueries({ queryKey: ["media", "item", companyId] }),
    ]);
  };
  const organization = useMutation({
    mutationFn: (command: MediaOrganizationCommand) =>
      organizeMedia(companyId, command),
    onSuccess: async (result, command) => {
      await refresh();
      setModal(null);
      setSelected(
        command.destinationFolderId === folderId
          ? result.items.map((item) => `${item.kind}:${item.id}`)
          : [],
      );
      setNotice(m.done);
      if (command.action === "MOVE") setClipboard(null);
    },
  });
  const simple = useMutation({
    mutationFn: async (
      action:
        | { kind: "rename"; row: MediaBrowserRow; name: string }
        | {
            kind: "create";
            name: string;
            branchId: string | null;
            operationId: string;
          }
        | { kind: "remove"; row: MediaBrowserRow }
        | {
            kind: "transition";
            item: Media;
            transition: "archive" | "restore" | "delete" | "restore-deleted";
          },
    ) => {
      if (action.kind === "create")
        return createMediaFolder(companyId, {
          operationId: action.operationId,
          name: action.name,
          parentId: folderId,
          branchId: action.branchId,
        });
      if (action.kind === "rename")
        return action.row.kind === "folder"
          ? renameMediaFolder(companyId, action.row.item, action.name)
          : updateMedia(companyId, action.row.item, { name: action.name });
      if (action.kind === "remove" && action.row.kind === "folder")
        return removeMediaFolder(companyId, action.row.item);
      if (action.kind === "transition")
        return changeMedia(companyId, action.item, action.transition);
    },
    onSuccess: async (_result, action) => {
      await refresh();
      setModal(null);
      setSelected([]);
      setNotice(
        action.kind === "create"
          ? m.folderCreated
          : action.kind === "rename"
            ? m.renamed
            : action.kind === "remove"
              ? m.folderRemoved
              : m.done,
      );
    },
  });
  const pending = organization.isPending || simple.isPending,
    blocked = mustReload(organization.error) || mustReload(simple.error);
  const reset = async () => {
    await refresh();
    organization.reset();
    simple.reset();
    setClipboard(null);
    setSelected([]);
    setModal(null);
  };
  const unknown = (error: unknown) =>
    Boolean(error) && (!(error instanceof ApiFailure) || error.status >= 500);
  const recoverOrganization = async () => {
    const intent = organization.variables;
    await refresh();
    if (intent && unknown(organization.error)) organization.mutate(intent);
    else await reset();
  };
  const recoverSimple = async () => {
    const intent = simple.variables;
    await refresh();
    if (intent?.kind === "create" && unknown(simple.error))
      simple.mutate(intent);
    else await reset();
  };
  const openModal = (value: Modal) => {
    if (blocked && value.kind !== "preview") return;
    if (!blocked) {
      simple.reset();
      organization.reset();
    }
    setModal(value);
  };
  const activate = (row: MediaBrowserRow) =>
    row.kind === "folder"
      ? goFolder(row.item.id)
      : openModal({ kind: "preview", item: row.item });
  const select = (row: MediaBrowserRow, event: MouseEvent) => {
    const key = rowKey(row);
    if (event.shiftKey && anchor.current) {
      const start = rows.findIndex((item) => rowKey(item) === anchor.current),
        end = rows.findIndex((item) => rowKey(item) === key);
      if (start >= 0) {
        const range = rows
          .slice(Math.min(start, end), Math.max(start, end) + 1)
          .map(rowKey);
        setSelected(
          event.ctrlKey || event.metaKey
            ? [...new Set([...selected, ...range])]
            : range,
        );
        return;
      }
    }
    setSelected(
      event.ctrlKey || event.metaKey
        ? selected.includes(key)
          ? selected.filter((id) => id !== key)
          : [...selected, key]
        : [key],
    );
    anchor.current = key;
  };
  const canCopy = (items: readonly MediaBrowserRow[]) =>
    upload &&
    items.length > 0 &&
    items.length <= 100 &&
    items.every(
      (row) =>
        row.kind === "folder" ||
        ["READY", "ARCHIVED"].includes(row.item.status),
    );
  const canMove = (items: readonly MediaBrowserRow[]) =>
    upload &&
    items.length > 0 &&
    items.length <= 100 &&
    items.every(
      (row) => row.kind === "folder" || row.item.status !== "DELETED",
    );
  const hold = (action: "MOVE" | "COPY", items = chosen) => {
    if (
      pending ||
      blocked ||
      !(action === "COPY" ? canCopy(items) : canMove(items))
    )
      return;
    setClipboard({
      action,
      rows: items.map(
        (row) => ({ ...row, item: { ...row.item } }) as MediaBrowserRow,
      ),
    });
    setNotice(
      action === "COPY" ? m.copied(items.length) : m.cutNotice(items.length),
    );
  };
  const command = (
    action: "MOVE" | "COPY",
    items: MediaBrowserRow[],
    destinationFolderId: string | null,
  ) => {
    if (pending || blocked) return;
    organization.mutate({
      operationId: crypto.randomUUID(),
      action,
      destinationFolderId,
      items: items.map((row) => ({
        kind: row.kind,
        id: row.item.id,
        expectedVersion: row.item.version,
        ...(action === "COPY"
          ? {
              name: [...m.copyName(row.item.name)].reduce(
                (value, point) =>
                  value.length + point.length <= 120 ? value + point : value,
                "",
              ),
            }
          : {}),
      })),
    });
  };
  const paste = () => {
    if (clipboard && upload && view === "library" && locationReady)
      command(clipboard.action, clipboard.rows, folderId);
  };
  const keyDown = (event: KeyboardEvent) => {
    if (
      event.defaultPrevented ||
      modal ||
      pending ||
      (event.target instanceof HTMLElement &&
        event.target.closest(
          'input, textarea, select, [contenteditable="true"]',
        ))
    )
      return;
    if (event.ctrlKey || event.metaKey) {
      const key = event.key.toLowerCase();
      if (key === "a") {
        event.preventDefault();
        setSelected(rows.map(rowKey));
      } else if (key === "c" && canCopy(chosen)) {
        event.preventDefault();
        hold("COPY");
      } else if (key === "x" && canMove(chosen)) {
        event.preventDefault();
        hold("MOVE");
      } else if (key === "v" && clipboard && view === "library") {
        event.preventDefault();
        paste();
      }
    } else if (event.key === "F2" && chosen.length === 1 && upload) {
      event.preventDefault();
      openModal({ kind: "rename", row: chosen[0] });
    }
  };
  const actions = (targets: MediaBrowserRow[]): MenuItem[] => {
    const one = targets.length === 1 ? targets[0] : undefined;
    return [
      {
        key: "open",
        label: m.open,
        icon: "folder",
        disabled: !one,
        onSelect: () => one && activate(one),
      },
      {
        key: "rename",
        label: m.rename,
        icon: "form",
        disabled: blocked || !upload || !one,
        onSelect: () => one && openModal({ kind: "rename", row: one }),
      },
      {
        key: "copy",
        label: m.copy,
        icon: "copy",
        disabled: !canCopy(targets) || blocked,
        onSelect: () => hold("COPY", targets),
      },
      {
        key: "cut",
        label: m.cut,
        icon: "cut",
        disabled: !canMove(targets) || blocked,
        onSelect: () => hold("MOVE", targets),
      },
      {
        key: "move",
        label: m.move,
        icon: "move",
        disabled: !canMove(targets) || blocked,
        onSelect: () =>
          openModal({ kind: "destination", action: "MOVE", rows: targets }),
      },
      {
        key: "archive",
        label: m.archive,
        disabled:
          blocked ||
          !archive ||
          one?.kind !== "asset" ||
          one.item.status !== "READY",
        onSelect: () =>
          one?.kind === "asset" &&
          simple.mutate({
            kind: "transition",
            item: one.item,
            transition: "archive",
          }),
      },
      {
        key: "restore",
        label: m.restore,
        disabled:
          blocked ||
          one?.kind !== "asset" ||
          (one.item.status === "DELETED"
            ? !deletion
            : !archive || one.item.status !== "ARCHIVED"),
        onSelect: () =>
          one?.kind === "asset" &&
          simple.mutate({
            kind: "transition",
            item: one.item,
            transition:
              one.item.status === "DELETED" ? "restore-deleted" : "restore",
          }),
      },
      {
        key: "trash",
        label: m.trash,
        icon: "delete",
        disabled:
          blocked ||
          !deletion ||
          one?.kind !== "asset" ||
          one.item.status !== "ARCHIVED",
        onSelect: () =>
          one?.kind === "asset" && openModal({ kind: "trash", item: one.item }),
      },
      {
        key: "remove",
        label: m.removeFolder,
        icon: "delete",
        disabled: blocked || !upload || one?.kind !== "folder",
        onSelect: () => one && openModal({ kind: "remove", row: one }),
      },
    ];
  };
  const menu = (row: MediaBrowserRow) => (
    <Menu
      label={m.more(row.item.name)}
      align="end"
      className="media-item-menu"
      disabled={pending}
      ref={(node) => {
        if (node) menus.current.set(rowKey(row), node);
        else menus.current.delete(rowKey(row));
      }}
      onClick={() => {
        if (!selected.includes(rowKey(row))) setSelected([rowKey(row)]);
      }}
      items={actions(selected.includes(rowKey(row)) ? chosen : [row])}
    >
      <UiIcon name="more" />
    </Menu>
  );
  const drop = (event: React.DragEvent, destination: MediaFolder | null) => {
    event.preventDefault();
    event.stopPropagation();
    if (pending || !upload) return;
    if (drag.current) {
      const current = drag.current;
      drag.current = null;
      command(
        event.ctrlKey || event.metaKey ? "COPY" : "MOVE",
        current,
        destination?.id ?? null,
      );
    } else if (event.dataTransfer.files.length)
      openModal({
        kind: "upload",
        folder: destination,
        files: [...event.dataTransfer.files],
      });
  };
  const tile = (row: MediaBrowserRow) => {
    const key = rowKey(row),
      checked = selected.includes(key),
      cut =
        clipboard?.action === "MOVE" &&
        clipboard.rows.some((item) => rowKey(item) === key);
    return (
      <li
        key={key}
        className={`media-tile ${row.kind === "folder" ? "media-folder-tile" : "media-file-tile"}${checked ? " media-tile-selected" : ""}${cut ? " media-tile-cut" : ""}`}
        draggable={upload && view === "library"}
        onDragStart={(event) => {
          drag.current = checked ? chosen : [row];
          event.dataTransfer.setData("application/x-teluni-media", "selection");
          event.dataTransfer.effectAllowed = "copyMove";
        }}
        onDragEnd={() => {
          drag.current = null;
        }}
        onDragOver={(event) => {
          if (row.kind === "folder" && upload) {
            event.preventDefault();
            event.dataTransfer.dropEffect = event.ctrlKey ? "copy" : "move";
          }
        }}
        onDrop={(event) => {
          if (row.kind === "folder") drop(event, row.item);
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          menus.current.get(key)?.click();
        }}
      >
        <div className="media-tile-actions">
          <Checkbox
            label={
              <span className="media-sr-only">{m.select(row.item.name)}</span>
            }
            checked={checked}
            onChange={() => {
              setSelected(
                checked
                  ? selected.filter((id) => id !== key)
                  : [...selected, key],
              );
              anchor.current = key;
            }}
          />
          {menu(row)}
        </div>
        <button
          type="button"
          className="media-tile-open"
          aria-label={row.item.name}
          aria-pressed={checked}
          onClick={(event) => select(row, event)}
          onDoubleClick={() => activate(row)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              activate(row);
            }
          }}
        >
          {row.kind === "folder" ? (
            <span className="media-folder-glyph">
              <UiIcon name="folder" />
            </span>
          ) : (
            <MediaThumbnail companyId={companyId} item={row.item} />
          )}
          <span className="media-tile-name" title={row.item.name}>
            {row.item.name}
          </span>
          <span className="media-tile-scope">
            {row.item.branch?.name ?? t.companyScope}
          </span>
        </button>
        {row.kind === "asset" && (
          <div className="media-tile-meta">
            <span>
              {t.kinds[row.item.kind]} ·{" "}
              {formatBytes(locale, row.item.declaredSize)}
            </span>
            <span
              className={`media-item-status media-item-status-${row.item.status.toLowerCase()}`}
            >
              {row.item.processing
                ? t.stages[row.item.processing.stage]
                : t.statuses[row.item.status]}
              {row.item.processing?.progress != null
                ? ` ${row.item.processing.progress}%`
                : ""}
            </span>
            {row.item.rejectionReason && (
              <span className="media-tile-rejection">
                {t.rejections[row.item.rejectionReason]}
              </span>
            )}
          </div>
        )}
      </li>
    );
  };
  const loading =
    files.isPending ||
    (view === "library" && folders.isPending) ||
    (folderId && location.isPending);
  const readError =
    files.error ||
    (view === "library" ? folders.error : null) ||
    (folderId ? location.error : null);
  return (
    <div className="media-browser" onKeyDown={keyDown}>
      <header className="media-browser-heading">
        <div>
          <p className="eyebrow">{t.title}</p>
          <h1 id="media-title">
            {view === "library" ? (folder?.name ?? m.root) : t.views[view]}
          </h1>
          <p className="hint">{m.lead}</p>
        </div>
        {upload && view === "library" && (
          <div className="media-primary-actions">
            <Button
              disabled={!locationReady || pending || blocked}
              onClick={() => openModal({ kind: "create" })}
            >
              <UiIcon name="add" />
              {m.newFolder}
            </Button>
            <Button
              variant="primary"
              disabled={!locationReady || pending || blocked}
              onClick={() => openModal({ kind: "upload", folder, files: [] })}
            >
              <UiIcon name="upload" />
              {t.uploadTitle}
            </Button>
          </div>
        )}
      </header>
      <nav className="media-view-tabs" aria-label={t.viewsLabel}>
        {(["library", "archived", ...(deletion ? ["trash"] : [])] as const).map(
          (next) => (
            <Link
              key={next}
              to="/companies/$companyId/media"
              params={{ companyId }}
              search={{
                ...(next !== "library"
                  ? { view: next as "archived" | "trash" }
                  : {}),
                ...(filter.layout ? { layout: filter.layout } : {}),
              }}
              aria-current={view === next ? "page" : undefined}
            >
              {t.views[next as "library" | "archived" | "trash"]}
            </Link>
          ),
        )}
      </nav>
      <div className="media-browser-controls">
        <form
          role="search"
          onSubmit={(event) => {
            event.preventDefault();
            go({
              ...filter,
              text: text.trim() || undefined,
              cursor: undefined,
              folderCursor: undefined,
            });
          }}
        >
          <TextField
            id="media-search"
            label={t.filterText}
            type="search"
            maxLength={120}
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder={m.searchHint}
          />
          <Button type="submit">{t.search}</Button>
        </form>
        <div>
          <label htmlFor="filter-kind">{t.filterKind}</label>
          <select
            id="filter-kind"
            value={filter.kind ?? ""}
            onChange={(event) =>
              go({
                ...filter,
                kind:
                  event.target.value === "IMAGE" ||
                  event.target.value === "VIDEO"
                    ? event.target.value
                    : undefined,
                cursor: undefined,
              })
            }
          >
            <option value="">{t.filterAll}</option>
            <option value="IMAGE">{t.kinds.IMAGE}</option>
            <option value="VIDEO">{t.kinds.VIDEO}</option>
          </select>
        </div>
        <div>
          <label htmlFor="filter-scope">{t.filterScope}</label>
          <select
            id="filter-scope"
            disabled={Boolean(folderId)}
            value={
              folderId
                ? (folder?.branch?.id ?? "company")
                : (filter.scope ?? "")
            }
            onChange={(event) =>
              go({
                ...filter,
                scope: event.target.value || undefined,
                cursor: undefined,
                folderCursor: undefined,
              })
            }
          >
            <option value="">{t.filterAll}</option>
            <option value="company">{t.companyScope}</option>
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="media-location-bar">
        <nav className="media-breadcrumbs" aria-label={m.breadcrumbs}>
          <Link
            to="/companies/$companyId/media"
            params={{ companyId }}
            search={filter.layout ? { layout: filter.layout } : {}}
          >
            <UiIcon name="folder" />
            {m.root}
          </Link>
          {view !== "library" ? (
            <span>{t.views[view]}</span>
          ) : filter.text ? (
            <span>{m.results}</span>
          ) : (
            path.map((item) => (
              <Link
                key={item.id}
                to="/companies/$companyId/media"
                params={{ companyId }}
                search={{
                  folderId: item.id,
                  ...(filter.layout ? { layout: filter.layout } : {}),
                }}
                aria-current={item.id === folderId ? "location" : undefined}
              >
                {item.name}
              </Link>
            ))
          )}
        </nav>
        <div className="media-layout-actions">
          <Button
            aria-label={m.refresh}
            title={m.refresh}
            disabled={pending || blocked}
            pending={
              files.isFetching || (view === "library" && folders.isFetching)
            }
            onClick={() => void reset()}
          >
            <UiIcon name="refresh" />
          </Button>
          <Button
            aria-label={m.gridView}
            title={m.gridView}
            aria-pressed={layout === "grid"}
            onClick={() => go({ ...filter, layout: "grid" })}
          >
            <UiIcon name="tiles" />
          </Button>
          <Button
            aria-label={m.listView}
            title={m.listView}
            aria-pressed={layout === "list"}
            onClick={() => go({ ...filter, layout: "list" })}
          >
            <UiIcon name="grid" />
          </Button>
        </div>
      </div>
      <div className="media-action-bar" aria-label={m.actions} role="group">
        <Checkbox
          label={m.selectAll}
          aria-label={m.selectAll}
          indeterminate={chosen.length > 0 && chosen.length < rows.length}
          checked={rows.length > 0 && chosen.length === rows.length}
          disabled={!rows.length}
          onChange={() =>
            setSelected(chosen.length === rows.length ? [] : rows.map(rowKey))
          }
        />
        <span className="media-selection-count">
          {chosen.length ? m.selected(chosen.length) : m.count(rows.length)}
        </span>
        {upload && (
          <>
            <Button
              disabled={!canCopy(chosen) || pending || blocked}
              onClick={() => hold("COPY")}
            >
              <UiIcon name="copy" />
              {m.copy}
            </Button>
            <Button
              disabled={!canMove(chosen) || pending || blocked}
              onClick={() => hold("MOVE")}
            >
              <UiIcon name="cut" />
              {m.cut}
            </Button>
            <Button
              disabled={
                !clipboard ||
                pending ||
                blocked ||
                view !== "library" ||
                !locationReady
              }
              aria-label={m.paste}
              onClick={paste}
            >
              <UiIcon name="paste" />
              {m.paste}
              {clipboard ? ` (${clipboard.rows.length})` : ""}
            </Button>
            <Button
              disabled={!canMove(chosen) || pending || blocked}
              onClick={() =>
                openModal({ kind: "destination", action: "MOVE", rows: chosen })
              }
            >
              <UiIcon name="move" />
              {m.move}
            </Button>
          </>
        )}
        <Button
          className={chosen.length ? "" : "media-clear-selection-inactive"}
          disabled={!chosen.length}
          aria-label={m.clearSelection}
          title={m.clearSelection}
          onClick={() => setSelected([])}
        >
          <UiIcon name="close" />
        </Button>
        <label className="media-sort">
          {m.sort}
          <select
            value={sort}
            onChange={(event) => setSort(event.target.value)}
          >
            <option value="name">{m.sortName}</option>
            <option value="recent">{m.sortRecent}</option>
            <option value="size">{m.sortSize}</option>
          </select>
        </label>
      </div>
      {clipboard && (
        <div className="media-clipboard">
          <UiIcon name={clipboard.action === "COPY" ? "copy" : "cut"} />
          <span>
            {m.clipboard}: {clipboard.rows.length} · {m.clipboardHint}
          </span>
          <Button
            aria-label={m.clearClipboard}
            onClick={() => {
              setClipboard(null);
              setNotice(null);
            }}
          >
            <UiIcon name="close" />
          </Button>
        </div>
      )}
      {notice && (
        <p role="status" className="media-notice">
          {notice}
        </p>
      )}
      {!modal && (organization.error || simple.error) && (
        <Failure
          operation="write"
          error={organization.error ?? simple.error}
          reloadLabel={m.reconcile}
          onReload={() =>
            void (organization.error ? recoverOrganization() : recoverSimple())
          }
        />
      )}
      {readError ? (
        <Failure
          operation="read"
          error={readError}
          onReload={() => void refresh()}
        />
      ) : loading ? (
        <p role="status">{m.loading}</p>
      ) : (
        <div
          role="group"
          tabIndex={0}
          className={`media-browser-content media-browser-content-${layout}`}
          aria-label={t.title}
          onDragOver={(event) => {
            if (upload && view === "library") event.preventDefault();
          }}
          onDrop={(event) => {
            if (view === "library") drop(event, folder);
          }}
        >
          {rows.length === 0 ? (
            <div className="media-browser-empty">
              <UiIcon name="folder" />
              <h2>
                {filter.text || filter.kind || filter.scope
                  ? t.empty
                  : m.emptyFolder}
              </h2>
              <p>{m.emptyLead}</p>
              {(filter.text || filter.kind || filter.scope) && (
                <Button
                  onClick={() =>
                    go({
                      ...(folderId ? { folderId } : {}),
                      ...(view !== "library" ? { view } : {}),
                      layout,
                    })
                  }
                >
                  {m.clearFilters}
                </Button>
              )}
            </div>
          ) : layout === "list" ? (
            <DataGrid
              key={sort}
              label={t.title}
              locale={locale}
              rows={rows}
              rowId={rowKey}
              multiple
              selectedIds={selected}
              onSelectedIdsChange={setSelected}
              onRowActivate={(key) => {
                const row = rows.find((item) => rowKey(item) === key);
                if (row) activate(row);
              }}
              columns={[
                {
                  key: "name",
                  header: t.fieldName,
                  value: (row) => row.item.name,
                  width: 330,
                  render: (row) => (
                    <button
                      type="button"
                      className="media-row-open"
                      onClick={() => activate(row)}
                    >
                      <UiIcon
                        name={
                          row.kind === "folder"
                            ? "folder"
                            : row.item.kind === "VIDEO"
                              ? "video"
                              : "image"
                        }
                      />
                      {row.item.name}
                    </button>
                  ),
                },
                {
                  key: "kind",
                  header: t.filterKind,
                  value: (row) =>
                    row.kind === "folder" ? m.folder : t.kinds[row.item.kind],
                  width: 120,
                },
                {
                  key: "scope",
                  header: t.fieldScope,
                  value: (row) => row.item.branch?.name ?? t.companyScope,
                  width: 210,
                },
                {
                  key: "size",
                  header: m.size,
                  value: (row) =>
                    row.kind === "asset" ? row.item.declaredSize : 0,
                  format: (value) =>
                    value ? formatBytes(locale, Number(value)) : "—",
                  width: 130,
                },
                {
                  key: "status",
                  header: t.fieldStatus,
                  value: (row) =>
                    row.kind === "asset" ? t.statuses[row.item.status] : "—",
                  width: 150,
                },
                {
                  key: "created",
                  header: m.modified,
                  value: (row) => row.item.createdAt,
                  format: (value) => formatInstant(locale, String(value)),
                  width: 190,
                },
                {
                  key: "actions",
                  header: m.actions,
                  width: 70,
                  sortable: false,
                  filterable: false,
                  resizable: false,
                  render: menu,
                },
              ]}
            />
          ) : (
            <>
              {rows.some((row) => row.kind === "folder") && (
                <div className="media-folder-group">
                  <h2 className="media-group-heading">{m.folders}</h2>
                  <ul className="media-folder-grid">
                    {rows.filter((row) => row.kind === "folder").map(tile)}
                  </ul>
                </div>
              )}
              {rows.some((row) => row.kind === "asset") && (
                <div className="media-file-group">
                  <h2 className="media-group-heading">{m.files}</h2>
                  <ul className="media-file-grid">
                    {rows.filter((row) => row.kind === "asset").map(tile)}
                  </ul>
                </div>
              )}
            </>
          )}
          {upload && view === "library" && (
            <p className="media-drop-hint">{m.drop}</p>
          )}
        </div>
      )}
      <nav className="media-browser-pagination" aria-label={t.title}>
        {(filter.cursor || filter.folderCursor) && (
          <Button
            onClick={() =>
              go({ ...filter, cursor: undefined, folderCursor: undefined })
            }
          >
            {t.firstPage}
          </Button>
        )}
        {view === "library" && folders.data?.nextCursor && (
          <Button
            onClick={() =>
              go({ ...filter, folderCursor: folders.data.nextCursor! })
            }
          >
            {m.moreFolders}
          </Button>
        )}
        {files.data?.nextCursor && (
          <Button
            onClick={() => go({ ...filter, cursor: files.data.nextCursor! })}
          >
            {m.moreFiles}
          </Button>
        )}
      </nav>
      {modal?.kind === "upload" && (
        <MediaDialog
          title={t.uploadTitle}
          busy={uploadBusy}
          onClose={() => setModal(null)}
        >
          {renderUpload({
            folder: modal.folder,
            files: modal.files,
            onBusyChange: setUploadBusy,
          })}
        </MediaDialog>
      )}
      {modal?.kind === "create" && (
        <MediaDialog
          title={m.newFolder}
          busy={simple.isPending}
          onClose={() => setModal(null)}
        >
          <NameForm
            key="new"
            initial=""
            folder={folder}
            branches={branches}
            busy={simple.isPending}
            blocked={mustReload(simple.error)}
            error={simple.error}
            onReload={() => void recoverSimple()}
            onSubmit={(name, branchId, operationId) =>
              simple.mutate({ kind: "create", name, branchId, operationId })
            }
          />
        </MediaDialog>
      )}
      {modal?.kind === "rename" && (
        <MediaDialog
          title={m.rename}
          busy={simple.isPending}
          onClose={() => setModal(null)}
        >
          <NameForm
            key={rowKey(modal.row)}
            initial={modal.row.item.name}
            busy={simple.isPending}
            blocked={mustReload(simple.error)}
            error={simple.error}
            onReload={() => void reset()}
            onSubmit={(name) =>
              simple.mutate({ kind: "rename", row: modal.row, name })
            }
          />
        </MediaDialog>
      )}
      {modal?.kind === "remove" && (
        <MediaDialog
          title={m.removeFolder}
          busy={simple.isPending}
          onClose={() => setModal(null)}
        >
          <p>
            <strong>{modal.row.item.name}</strong>
          </p>
          <p>{m.removeHint}</p>
          {simple.error && (
            <Failure
              operation="write"
              error={simple.error}
              onReload={() => void reset()}
            />
          )}
          <div className="media-dialog-footer">
            <Button
              disabled={blocked}
              pending={simple.isPending}
              onClick={() => simple.mutate({ kind: "remove", row: modal.row })}
            >
              {m.confirmRemove}
            </Button>
          </div>
        </MediaDialog>
      )}
      {modal?.kind === "destination" && (
        <MediaDialog
          title={modal.action === "MOVE" ? m.moveTitle : m.copyTitle}
          busy={organization.isPending}
          onClose={() => setModal(null)}
        >
          <MediaFolderPicker
            companyId={companyId}
            initialId={folderId}
            action={modal.action}
            sourceFolderIds={modal.rows
              .filter((row) => row.kind === "folder")
              .map((row) => row.item.id)}
            sourceScopes={modal.rows.map(sameScope)}
            pending={organization.isPending}
            error={organization.error}
            onReload={() => void recoverOrganization()}
            onChoose={(id) => command(modal.action, modal.rows, id)}
          />
        </MediaDialog>
      )}
      {modal?.kind === "preview" && (
        <PreviewDialog
          companyId={companyId}
          initial={modal.item}
          renderPreview={renderPreview}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.kind === "trash" && (
        <MediaDialog
          title={m.trash}
          busy={simple.isPending}
          onClose={() => setModal(null)}
        >
          <p>
            <strong>{modal.item.name}</strong>
          </p>
          <p>{m.trashHint}</p>
          {simple.error && (
            <Failure
              error={simple.error}
              operation="write"
              onReload={() => void reset()}
            />
          )}
          <div className="media-dialog-footer">
            <Button
              disabled={blocked}
              pending={simple.isPending}
              onClick={() =>
                simple.mutate({
                  kind: "transition",
                  item: modal.item,
                  transition: "delete",
                })
              }
            >
              {m.confirmTrash}
            </Button>
          </div>
        </MediaDialog>
      )}
    </div>
  );
}

function formatBytes(locale: string, value: number) {
  const unit = value >= 1e9 ? "GB" : value >= 1e6 ? "MB" : "KB",
    divisor = value >= 1e9 ? 1e9 : value >= 1e6 ? 1e6 : 1000;
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value / divisor)} ${unit}`;
}
function MediaThumbnail({
  companyId,
  item,
}: {
  companyId: string;
  item: Media;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <span className="media-file-preview">
      {ready(item) && !failed ? (
        <img
          src={contentUrl(companyId, item, "thumbnail")}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
        />
      ) : (
        <UiIcon name={item.kind === "VIDEO" ? "video" : "image"} />
      )}
      {item.kind === "VIDEO" && (
        <span className="media-duration">
          {item.durationMs != null
            ? `${Math.floor(item.durationMs / 60000)}:${String(Math.floor(item.durationMs / 1000) % 60).padStart(2, "0")}`
            : "—"}
        </span>
      )}
    </span>
  );
}
function NameForm({
  initial,
  folder,
  branches,
  busy,
  blocked,
  error,
  onReload,
  onSubmit,
}: {
  initial: string;
  folder?: MediaFolder | null;
  branches?: { id: string; name: string }[];
  busy: boolean;
  blocked: boolean;
  error: unknown;
  onReload: () => void;
  onSubmit: (
    name: string,
    branchId: string | null,
    operationId: string,
  ) => void;
}) {
  const { t } = useMediaMessages(),
    m = t.manager;
  const [name, setName] = useState(initial),
    [scope, setScope] = useState(folder?.branch?.id ?? "company"),
    [operationId] = useState(() => crypto.randomUUID());
  return (
    <form
      className="form-stack"
      aria-label={initial ? m.rename : m.newFolder}
      onSubmit={(event) => {
        event.preventDefault();
        if (!busy && !blocked && name.trim())
          onSubmit(name, scope === "company" ? null : scope, operationId);
      }}
    >
      <TextField
        id="media-entry-name"
        label={initial ? t.fieldName : m.folderName}
        required
        disabled={busy || blocked}
        maxLength={120}
        value={name}
        onChange={(event) => setName(event.target.value)}
        data-autofocus
      />
      {branches && (
        <>
          <label htmlFor="folder-scope">{t.uploadScope}</label>
          <select
            id="folder-scope"
            value={scope}
            disabled={Boolean(folder) || busy || blocked}
            onChange={(event) => setScope(event.target.value)}
          >
            <option value="company">{t.companyScope}</option>
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name}
              </option>
            ))}
          </select>
        </>
      )}
      {Boolean(error) && (
        <Failure
          error={error}
          operation="write"
          reloadLabel={m.reconcile}
          onReload={onReload}
        />
      )}
      <div className="media-dialog-footer">
        <Button
          type="submit"
          variant="primary"
          pending={busy}
          disabled={
            blocked ||
            !name.trim() ||
            (Boolean(initial) && name.trim() === initial)
          }
        >
          {initial ? t.save : m.createFolder}
        </Button>
      </div>
    </form>
  );
}
function PreviewDialog({
  companyId,
  initial,
  renderPreview,
  onClose,
}: {
  companyId: string;
  initial: Media;
  renderPreview: (item: Media) => ReactNode;
  onClose: () => void;
}) {
  const { locale, t } = useMediaMessages(),
    m = t.manager;
  const query = useQuery({
    queryKey: mediaKey(companyId, initial.id),
    queryFn: () => getMedia(companyId, initial.id),
    refetchInterval: (q) =>
      q.state.data && isPending(q.state.data) ? 3000 : false,
  });
  return (
    <MediaDialog
      title={query.isError ? m.preview : (query.data?.name ?? initial.name)}
      wide
      onClose={onClose}
    >
      {query.isPending ? (
        <p>{t.loading}</p>
      ) : query.isError ? (
        <Failure
          operation="read"
          error={query.error}
          onReload={() => void query.refetch()}
        />
      ) : (
        <>
          <div className="media-browser-preview">
            {renderPreview(query.data)}
          </div>
          <dl className="media-preview-facts">
            <div>
              <dt>{t.fieldKind}</dt>
              <dd>{t.kinds[query.data.kind]}</dd>
            </div>
            <div>
              <dt>{m.size}</dt>
              <dd>{formatBytes(locale, query.data.declaredSize)}</dd>
            </div>
            <div>
              <dt>{t.fieldScope}</dt>
              <dd>{query.data.branch?.name ?? t.companyScope}</dd>
            </div>
            <div>
              <dt>{t.fieldStatus}</dt>
              <dd>{t.statuses[query.data.status]}</dd>
            </div>
          </dl>
          <div className="media-dialog-footer">
            {ready(query.data) && (
              <a
                className="button-link"
                href={contentUrl(companyId, query.data, "original")}
                download
              >
                {m.download}
              </a>
            )}
            <Link
              className="button-link button-primary"
              to="/companies/$companyId/media/$assetId"
              params={{ companyId, assetId: initial.id }}
            >
              {m.showDetails}
            </Link>
          </div>
        </>
      )}
    </MediaDialog>
  );
}
