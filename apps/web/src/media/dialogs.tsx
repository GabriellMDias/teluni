import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "../components.js";
import { browserLocale } from "../locale.js";
import { UiIcon } from "../ui-icon.js";
import {
  getMediaFolder,
  listMediaFolders,
  mediaFolderKey,
  mediaFoldersKey,
  type MediaFolder,
} from "./api.js";
import { mediaMessages } from "./messages.js";
import { Failure, mustReload } from "./feedback.js";

/** Native modal focus handling for this feature's file-management tasks. */
export function MediaDialog({
  title,
  children,
  onClose,
  busy = false,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  busy?: boolean;
  wide?: boolean;
}) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const t = mediaMessages[useMemo(browserLocale, [])];
  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    const opener =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    node.showModal();
    (node.querySelector<HTMLElement>("[data-autofocus]") ?? node).focus();
    return () => {
      if (node.open) node.close();
      if (opener?.isConnected) opener.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className={`media-dialog${wide ? " media-dialog-wide" : ""}`}
      aria-labelledby={id}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) {
          const rect = event.currentTarget.getBoundingClientRect();
          if (
            event.clientX < rect.left ||
            event.clientX > rect.right ||
            event.clientY < rect.top ||
            event.clientY > rect.bottom
          )
            onClose();
        }
      }}
    >
      <header className="media-dialog-heading">
        <h2 id={id}>{title}</h2>
        <Button
          aria-label={t.manager.close}
          title={t.manager.close}
          disabled={busy}
          onClick={onClose}
        >
          <UiIcon name="close" />
        </Button>
      </header>
      {children}
    </dialog>
  );
}

/** Browse destinations on demand without fetching a whole tenant's folder tree. */
export function MediaFolderPicker({
  companyId,
  initialId,
  action,
  sourceFolderIds,
  sourceScopes,
  onChoose,
  pending,
  error,
  onReload,
}: {
  companyId: string;
  initialId: string | null;
  action: "MOVE" | "COPY";
  sourceFolderIds: readonly string[];
  sourceScopes: readonly (string | null)[];
  onChoose: (folderId: string | null) => void;
  pending: boolean;
  error: unknown;
  onReload: () => void;
}) {
  const t = mediaMessages[useMemo(browserLocale, [])],
    m = t.manager;
  const [parentId, setParentId] = useState(initialId);
  const [cursor, setCursor] = useState<string>();
  const detail = useQuery({
    queryKey: mediaFolderKey(companyId, parentId ?? "root"),
    queryFn: () => getMediaFolder(companyId, parentId!),
    enabled: Boolean(parentId),
  });
  const folders = useQuery({
    queryKey: [...mediaFoldersKey(companyId), "picker", parentId, cursor],
    queryFn: () =>
      listMediaFolders(companyId, {
        parentId: parentId ?? "root",
        ...(cursor ? { cursor } : {}),
      }),
  });
  const path =
    parentId && detail.isSuccess
      ? [...detail.data.ancestors, detail.data.folder]
      : [];
  const incompatible = (folder: MediaFolder) =>
    action === "MOVE" &&
    sourceScopes.some((scope) => scope !== (folder.branch?.id ?? null));
  const insideSource = path.some((folder) =>
    sourceFolderIds.includes(folder.id),
  );
  const ready = !parentId || detail.isSuccess;
  const disabled =
    !ready ||
    insideSource ||
    (parentId && detail.data ? incompatible(detail.data.folder) : false);
  const go = (id: string | null) => {
    setParentId(id);
    setCursor(undefined);
  };
  return (
    <div className="media-folder-picker">
      <p className="hint">{m.destinationHint}</p>
      <nav className="media-breadcrumbs" aria-label={m.chooseFolder}>
        <button type="button" onClick={() => go(null)}>
          <UiIcon name="folder" />
          {m.root}
        </button>
        {path.map((folder) => (
          <button
            type="button"
            key={folder.id}
            onClick={() => go(folder.id)}
            aria-current={folder.id === parentId ? "location" : undefined}
          >
            {folder.name}
          </button>
        ))}
      </nav>
      {parentId && detail.isError ? (
        <Failure
          operation="read"
          error={detail.error}
          onReload={() => void detail.refetch()}
        />
      ) : folders.isPending || (parentId && detail.isPending) ? (
        <p>{m.loading}</p>
      ) : folders.isError ? (
        <Failure
          operation="read"
          error={folders.error}
          onReload={() => void folders.refetch()}
        />
      ) : (
        <>
          <ul className="media-picker-folders" aria-label={m.folders}>
            {folders.data.items.map((folder) => (
              <li key={folder.id}>
                <button
                  type="button"
                  disabled={
                    pending ||
                    incompatible(folder) ||
                    sourceFolderIds.includes(folder.id)
                  }
                  onClick={() => go(folder.id)}
                >
                  <UiIcon name="folder" />
                  <span>
                    <strong>{folder.name}</strong>
                    <small>{folder.branch?.name ?? t.companyScope}</small>
                  </span>
                  <span aria-hidden="true">›</span>
                </button>
              </li>
            ))}
          </ul>
          {folders.data.items.length === 0 && (
            <p className="empty-state">{m.emptyFolder}</p>
          )}
          <div className="media-picker-pagination">
            {cursor && (
              <Button onClick={() => setCursor(undefined)}>
                {t.firstPage}
              </Button>
            )}
            {folders.data.nextCursor && (
              <Button onClick={() => setCursor(folders.data.nextCursor!)}>
                {m.moreFolders}
              </Button>
            )}
          </div>
        </>
      )}
      {!parentId && <p className="hint">{m.rootScopeHint}</p>}
      {disabled && ready && (
        <p className="notice">
          {insideSource ? t.errors.MEDIA_INVALID_DESTINATION : m.incompatible}
        </p>
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
          variant="primary"
          pending={pending}
          disabled={
            mustReload(error) ||
            Boolean(disabled) ||
            folders.isError ||
            Boolean(parentId && detail.isError)
          }
          onClick={() => onChoose(parentId)}
        >
          {m.useFolder}
        </Button>
      </div>
    </div>
  );
}
