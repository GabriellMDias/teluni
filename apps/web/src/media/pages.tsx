import { useMemo, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { ApiFailure } from "../api-client.js";
import { loginHref, sessionQuery } from "../identity/api.js";
import { browserLocale } from "../locale.js";
import {
  companyKey,
  describe,
  getCompany,
  listBranchChoices,
  type CompanyWithAccess,
} from "../organizations/api.js";
import { formatInstant } from "../organizations/members.js";
import {
  acceptedTypes,
  changeMedia,
  contentUrl,
  createMedia,
  discardMedia,
  getMedia,
  isAccepted,
  isPending,
  listMedia,
  maxBytes,
  mediaKey,
  mediaListKey,
  nameFromFile,
  updateMedia,
  uploadMediaContent,
  type Media,
  type MediaFilter,
  type MediaKind,
  type MediaView,
} from "./api.js";
import { mediaMessages } from "./messages.js";

/** How often pages refresh while an item is uploading or being prepared. */
const pollMs = 3000;

export function useMediaMessages() {
  const locale = useMemo(browserLocale, []);
  return { locale, t: mediaMessages[locale] };
}

type Messages = ReturnType<typeof useMediaMessages>["t"];

/**
 * Like the shared description, except that a full media volume is a known
 * refusal: nothing was written, so it is explained rather than reported as
 * an unknown outcome.
 */
function explain(error: unknown, t: Messages, operation: "read" | "write") {
  if (error instanceof ApiFailure && error.code === "MEDIA_STORAGE_FULL")
    return t.errors.MEDIA_STORAGE_FULL;
  return describe(error, t, operation);
}

function Failure({
  error,
  operation,
  onReload,
}: {
  error: unknown;
  operation: "read" | "write";
  onReload?: () => void;
}) {
  const { t } = useMediaMessages();
  return (
    <div role="alert" className="notice notice-error">
      {explain(error, t, operation)}
      {onReload && (
        <button type="button" onClick={onReload}>
          {t.reload}
        </button>
      )}
    </div>
  );
}

function StepUpPrompt({ returnTo }: { returnTo: string }) {
  const { t } = useMediaMessages();
  return (
    <div role="status" className="notice notice-error">
      {t.stepUpNotice}
      <a
        className="button-link button-primary"
        href={loginHref(returnTo, "strong")}
      >
        {t.stepUpButton}
      </a>
    </div>
  );
}

/** A write whose outcome is unknown or stale needs a reload, not a retry. */
function mustReload(error: unknown): boolean {
  return (
    Boolean(error) &&
    (!(error instanceof ApiFailure) ||
      error.status >= 500 ||
      error.code === "RESOURCE_VERSION_CONFLICT")
  );
}

/**
 * Loads the session and the company access every media page needs, and
 * renders sign-in, step-up and denial states before the page itself.
 */
function CompanyGate({
  companyId,
  returnTo,
  children,
}: {
  companyId: string;
  returnTo: string;
  children: (company: CompanyWithAccess) => React.ReactNode;
}) {
  const { locale, t } = useMediaMessages();
  const session = useQuery(sessionQuery);
  const company = useQuery({
    queryKey: companyKey(companyId),
    queryFn: () => getCompany(companyId),
    enabled: Boolean(session.data),
  });
  let body: React.ReactNode;
  if (session.isPending || (session.data && company.isPending))
    body = <p>{t.loading}</p>;
  else if (session.isError)
    body = (
      <Failure
        error={session.error}
        operation="read"
        onReload={() => void session.refetch()}
      />
    );
  else if (!session.data)
    body = (
      <a className="button-link button-primary" href={loginHref(returnTo)}>
        {t.errors.AUTHENTICATION_REQUIRED}
      </a>
    );
  else if (company.isError)
    body =
      company.error instanceof ApiFailure &&
      company.error.code === "STRONG_AUTHENTICATION_REQUIRED" ? (
        <StepUpPrompt returnTo={returnTo} />
      ) : (
        <Failure
          error={company.error}
          operation="read"
          onReload={() => void company.refetch()}
        />
      );
  else if (
    company.data &&
    !company.data.access.capabilities.includes("media.view")
  )
    body = (
      <p role="alert" className="notice notice-error">
        {t.errors.PERMISSION_DENIED}
      </p>
    );
  else if (company.data) body = children(company.data);
  return (
    <section
      className="panel organization-panel media-panel"
      aria-labelledby="media-title"
      lang={locale}
    >
      <p className="eyebrow">
        <Link to="/companies/$companyId" params={{ companyId }}>
          {company.data?.company.displayName ?? t.backToCompany}
        </Link>
      </p>
      {body}
    </section>
  );
}

function useBranchChoices(companyId: string) {
  return useQuery({
    queryKey: ["media", "branches", companyId],
    queryFn: () => listBranchChoices(companyId),
  });
}

function scopeName(item: Media, t: Messages) {
  return item.branch ? item.branch.name : t.companyScope;
}

/** One line about where an item is in its life, for lists and details. */
function stateLine(item: Media, t: Messages) {
  const status = t.statuses[item.status];
  if (item.status === "PROCESSING" && item.processing) {
    const stage = t.stages[item.processing.stage] ?? "";
    return item.processing.progress === null
      ? `${status} · ${stage}`
      : `${status} · ${stage} ${t.progress(item.processing.progress)}`;
  }
  if (item.status === "REJECTED" && item.rejectionReason)
    return `${status} · ${t.rejections[item.rejectionReason]}`;
  return status;
}

function facts(item: Media, t: Messages) {
  const parts: string[] = [t.kinds[item.kind]];
  if (item.width && item.height)
    parts.push(t.dimensions(item.width, item.height));
  if (item.durationMs !== null)
    parts.push(t.duration(Math.round(item.durationMs / 1000)));
  return parts.join(" · ");
}

const hasRenditions = (item: Media) =>
  item.status === "READY" ||
  item.status === "ARCHIVED" ||
  item.status === "DELETED";

type UploadRow = {
  key: string;
  name: string;
  progress: number;
  state: "waiting" | "sending" | "done" | "failed";
  error?: unknown;
  local?: string;
};

function UploadForm({
  companyId,
  branches,
}: {
  companyId: string;
  branches: { id: string; name: string }[];
}) {
  const { t } = useMediaMessages();
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [scope, setScope] = useState("company");
  const [files, setFiles] = useState<File[]>([]);
  const [rows, setRows] = useState<UploadRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const update = (key: string, change: Partial<UploadRow>) =>
    setRows((current) =>
      current.map((row) => (row.key === key ? { ...row, ...change } : row)),
    );

  async function send(event: FormEvent) {
    event.preventDefault();
    if (files.length === 0 || busy) return;
    const batch = files.map((file, index) => ({
      file,
      key: `${Date.now()}-${index}`,
    }));
    setRows(
      batch.map(({ file, key }) => ({
        key,
        name: file.name,
        progress: 0,
        state: "waiting",
      })),
    );
    setBusy(true);
    // One at a time keeps within the open-upload limit and the bandwidth.
    for (const { file, key } of batch) {
      const type = file.type;
      if (!isAccepted(type)) {
        update(key, { state: "failed", local: t.uploadUnsupported });
        continue;
      }
      const kind: MediaKind = acceptedTypes[type];
      if (file.size < 1 || file.size > maxBytes[kind]) {
        update(key, { state: "failed", local: t.uploadTooLarge });
        continue;
      }
      update(key, { state: "sending" });
      try {
        const created = await createMedia(companyId, {
          name: nameFromFile(file.name),
          branchId: scope === "company" ? null : scope,
          contentType: type,
          size: file.size,
        });
        await uploadMediaContent(companyId, created.id, file, (fraction) =>
          update(key, { progress: Math.floor(fraction * 100) }),
        );
        update(key, { state: "done", progress: 100 });
      } catch (error) {
        update(key, { state: "failed", error });
      }
      await queryClient.invalidateQueries({
        queryKey: mediaListKey(companyId),
      });
    }
    setBusy(false);
    setFiles([]);
    if (input.current) input.current.value = "";
  }

  return (
    <form
      className={`form-stack media-upload${dragging ? " media-upload-active" : ""}`}
      aria-labelledby="upload-title"
      onSubmit={(event) => void send(event)}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        if (!busy) setFiles([...event.dataTransfer.files]);
      }}
    >
      <h2 id="upload-title">{t.uploadTitle}</h2>
      <p>{t.uploadLead}</p>
      <label htmlFor="upload-files">{t.uploadFiles}</label>
      <input
        ref={input}
        id="upload-files"
        type="file"
        multiple
        accept={Object.keys(acceptedTypes).join(",")}
        disabled={busy}
        onChange={(event) => setFiles([...(event.target.files ?? [])])}
      />
      <p className="hint">{t.dropHint}</p>
      {files.length > 0 && !busy && (
        <ul className="hint">
          {files.map((file, index) => (
            <li key={index}>{file.name}</li>
          ))}
        </ul>
      )}
      <label htmlFor="upload-scope">{t.uploadScope}</label>
      <select
        id="upload-scope"
        value={scope}
        disabled={busy}
        onChange={(event) => setScope(event.target.value)}
      >
        <option value="company">{t.companyScope}</option>
        {branches.map((branch) => (
          <option key={branch.id} value={branch.id}>
            {branch.name}
          </option>
        ))}
      </select>
      {rows.length > 0 && (
        <ul className="media-upload-rows" aria-live="polite">
          {rows.map((row) => (
            <li key={row.key}>
              <span>{row.name}</span>{" "}
              {row.state === "sending" && (
                <progress
                  max={100}
                  value={row.progress}
                  aria-label={row.name}
                />
              )}{" "}
              <span className="hint">
                {row.state === "sending"
                  ? t.progress(row.progress)
                  : row.state === "done"
                    ? t.uploadDone
                    : row.state === "failed"
                      ? (row.local ?? explain(row.error, t, "write"))
                      : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
      <button
        type="submit"
        className="button-primary"
        disabled={busy || files.length === 0}
      >
        {busy ? t.uploading : t.upload}
      </button>
    </form>
  );
}

function MediaGrid({
  companyId,
  filter,
  branches,
  canSeeTrash,
}: {
  companyId: string;
  filter: MediaFilter;
  branches: { id: string; name: string }[];
  canSeeTrash: boolean;
}) {
  const { t } = useMediaMessages();
  const navigate = useNavigate();
  const [text, setText] = useState(filter.text ?? "");
  const media = useQuery({
    queryKey: [...mediaListKey(companyId), filter],
    queryFn: () => listMedia(companyId, filter),
    refetchInterval: (query) =>
      query.state.data?.items.some(isPending) ? pollMs : false,
  });
  const setFilter = (next: MediaFilter) =>
    void navigate({
      to: "/companies/$companyId/media",
      params: { companyId },
      search: {
        ...(next.view && next.view !== "library" ? { view: next.view } : {}),
        ...(next.kind ? { kind: next.kind } : {}),
        ...(next.scope ? { scope: next.scope } : {}),
        ...(next.text ? { text: next.text } : {}),
      },
    });
  const views: MediaView[] = canSeeTrash
    ? ["library", "archived", "trash"]
    : ["library", "archived"];
  const current = filter.view ?? "library";
  return (
    <div className="media-list-section">
      <nav className="company-navigation" aria-label={t.viewsLabel}>
        {views.map((view) => (
          <Link
            key={view}
            to="/companies/$companyId/media"
            params={{ companyId }}
            search={view === "library" ? {} : { view }}
            aria-current={view === current ? "page" : undefined}
          >
            {t.views[view]}
          </Link>
        ))}
      </nav>
      <div className="media-filters">
        <label htmlFor="filter-kind">{t.filterKind}</label>
        <select
          id="filter-kind"
          value={filter.kind ?? ""}
          onChange={(event) =>
            setFilter({
              ...filter,
              kind:
                event.target.value === "IMAGE" || event.target.value === "VIDEO"
                  ? event.target.value
                  : undefined,
            })
          }
        >
          <option value="">{t.filterAll}</option>
          <option value="IMAGE">{t.kinds.IMAGE}</option>
          <option value="VIDEO">{t.kinds.VIDEO}</option>
        </select>
        <label htmlFor="filter-scope">{t.filterScope}</label>
        <select
          id="filter-scope"
          value={filter.scope ?? ""}
          onChange={(event) =>
            setFilter({ ...filter, scope: event.target.value || undefined })
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
        <form
          role="search"
          onSubmit={(event) => {
            event.preventDefault();
            setFilter({ ...filter, text: text.trim() || undefined });
          }}
        >
          <label htmlFor="filter-text">{t.filterText}</label>{" "}
          <input
            id="filter-text"
            type="search"
            maxLength={120}
            value={text}
            onChange={(event) => setText(event.target.value)}
          />{" "}
          <button type="submit">{t.search}</button>
        </form>
      </div>
      {media.isPending ? (
        <p>{t.loading}</p>
      ) : media.isError ? (
        <Failure
          error={media.error}
          operation="read"
          onReload={() => void media.refetch()}
        />
      ) : media.data.items.length === 0 ? (
        <p className="empty-state">{filter.cursor ? t.pageEmpty : t.empty}</p>
      ) : (
        <ul className="media-grid">
          {media.data.items.map((item) => (
            <li key={item.id}>
              <Link
                to="/companies/$companyId/media/$assetId"
                params={{ companyId, assetId: item.id }}
              >
                <span className="media-thumb">
                  {hasRenditions(item) ? (
                    <img
                      src={contentUrl(companyId, item, "thumbnail")}
                      alt=""
                      loading="lazy"
                    />
                  ) : (
                    <span className="media-thumb-placeholder">
                      {t.kinds[item.kind]}
                    </span>
                  )}
                </span>
                <span className="media-name">{item.name}</span>
              </Link>
              <span className="hint">
                {facts(item, t)} · {scopeName(item, t)}
              </span>
              <span className="hint">{stateLine(item, t)}</span>
            </li>
          ))}
        </ul>
      )}
      <nav className="pagination" aria-label={t.title}>
        {filter.cursor && (
          <Link
            to="/companies/$companyId/media"
            params={{ companyId }}
            search={{ ...filter, cursor: undefined }}
          >
            {t.firstPage}
          </Link>
        )}
        {media.data?.nextCursor && (
          <Link
            to="/companies/$companyId/media"
            params={{ companyId }}
            search={{ ...filter, cursor: media.data.nextCursor }}
          >
            {t.nextPage}
          </Link>
        )}
      </nav>
    </div>
  );
}

function LibraryContent({
  companyId,
  filter,
  company,
  returnTo,
}: {
  companyId: string;
  filter: MediaFilter;
  company: CompanyWithAccess;
  returnTo: string;
}) {
  const { t } = useMediaMessages();
  const branches = useBranchChoices(companyId);
  const { capabilities, capabilitiesAfterStrongAuthentication } =
    company.access;
  const upload = capabilities.includes("media.upload");
  const stepUp = capabilitiesAfterStrongAuthentication.some(
    (capability) =>
      capability.startsWith("media.") && !capabilities.includes(capability),
  );
  const choices = branches.data?.items ?? [];
  return (
    <>
      <h1 id="media-title">{t.title}</h1>
      <p>{t.lead}</p>
      {stepUp && <StepUpPrompt returnTo={returnTo} />}
      {upload && (filter.view ?? "library") === "library" && (
        <UploadForm companyId={companyId} branches={choices} />
      )}
      <MediaGrid
        companyId={companyId}
        filter={filter}
        branches={choices}
        canSeeTrash={capabilities.includes("media.delete")}
      />
    </>
  );
}

export function MediaLibraryPage({
  companyId,
  filter,
}: {
  companyId: string;
  filter: MediaFilter;
}) {
  const search = new URLSearchParams(
    Object.entries(filter).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  const returnTo = `/companies/${companyId}/media${search.size ? `?${search}` : ""}`;
  return (
    <CompanyGate companyId={companyId} returnTo={returnTo}>
      {(company) => (
        <LibraryContent
          companyId={companyId}
          filter={filter}
          company={company}
          returnTo={returnTo}
        />
      )}
    </CompanyGate>
  );
}

type Changed = (item: Media | null, notice?: string) => Promise<void>;

function EditForm({
  companyId,
  item,
  onChanged,
}: {
  companyId: string;
  item: Media;
  onChanged: Changed;
}) {
  const { t } = useMediaMessages();
  const [name, setName] = useState(item.name);
  const [tags, setTags] = useState(item.tags.join(", "));
  const parsed = tags
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
  const sameTags =
    parsed.length === item.tags.length &&
    parsed.every((tag, index) => tag.toLowerCase() === item.tags[index]);
  const save = useMutation({
    mutationFn: () =>
      updateMedia(companyId, item, {
        ...(name.trim() !== item.name ? { name } : {}),
        ...(!sameTags ? { tags: parsed } : {}),
      }),
    onSuccess: (changed) => onChanged(changed, t.saved),
  });
  const unchanged = name.trim() === item.name && sameTags;
  return (
    <form
      className="form-stack"
      aria-labelledby="edit-title"
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate();
      }}
    >
      <h2 id="edit-title">{t.editTitle}</h2>
      <label htmlFor="media-name">{t.fieldName}</label>
      <input
        id="media-name"
        required
        maxLength={120}
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <label htmlFor="media-tags">{t.fieldTags}</label>
      <input
        id="media-tags"
        value={tags}
        onChange={(event) => setTags(event.target.value)}
      />
      {save.error && (
        <Failure
          error={save.error}
          operation="write"
          onReload={() => {
            save.reset();
            void onChanged(item);
          }}
        />
      )}
      <button
        type="submit"
        className="button-primary"
        disabled={save.isPending || unchanged || mustReload(save.error)}
      >
        {save.isPending ? t.saving : t.save}
      </button>
    </form>
  );
}

function TransitionButton({
  companyId,
  item,
  transition,
  label,
  done,
  onChanged,
  disabled = false,
  className,
}: {
  companyId: string;
  item: Media;
  transition: Parameters<typeof changeMedia>[2];
  label: string;
  done: string;
  onChanged: Changed;
  disabled?: boolean;
  className?: string;
}) {
  const change = useMutation({
    mutationFn: () => changeMedia(companyId, item, transition),
    onSuccess: (changed) => onChanged(changed, done),
  });
  return (
    <>
      {change.error && (
        <Failure
          error={change.error}
          operation="write"
          onReload={() => {
            change.reset();
            void onChanged(item);
          }}
        />
      )}
      <button
        type="submit"
        className={className}
        disabled={disabled || change.isPending || mustReload(change.error)}
        onClick={(event) => {
          event.preventDefault();
          change.mutate();
        }}
      >
        {label}
      </button>
    </>
  );
}

function DeleteForm({
  companyId,
  item,
  onChanged,
}: {
  companyId: string;
  item: Media;
  onChanged: Changed;
}) {
  const { t } = useMediaMessages();
  const [confirmed, setConfirmed] = useState(false);
  return (
    <form className="form-stack media-danger" aria-labelledby="delete-title">
      <h2 id="delete-title">{t.deleteTitle}</h2>
      <p>{t.deleteLead}</p>
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(event) => setConfirmed(event.target.checked)}
        />
        {t.deleteConfirm(item.name)}
      </label>
      <TransitionButton
        companyId={companyId}
        item={item}
        transition="delete"
        label={t.delete}
        done={t.deleted}
        onChanged={onChanged}
        disabled={!confirmed}
        className="button-danger"
      />
    </form>
  );
}

function DiscardForm({
  companyId,
  item,
  onChanged,
}: {
  companyId: string;
  item: Media;
  onChanged: Changed;
}) {
  const { t } = useMediaMessages();
  const discard = useMutation({
    mutationFn: () => discardMedia(companyId, item),
    onSuccess: () => onChanged(null, t.discarded),
  });
  return (
    <section aria-labelledby="discard-title" className="form-stack">
      <h2 id="discard-title">{t.discardTitle}</h2>
      <p>{t.discardLead}</p>
      {discard.error && (
        <Failure
          error={discard.error}
          operation="write"
          onReload={() => {
            discard.reset();
            void onChanged(item);
          }}
        />
      )}
      <button
        type="button"
        disabled={discard.isPending || mustReload(discard.error)}
        onClick={() => discard.mutate()}
      >
        {t.discard}
      </button>
    </section>
  );
}

function Preview({ companyId, item }: { companyId: string; item: Media }) {
  const { t } = useMediaMessages();
  if (!hasRenditions(item))
    return <p className="hint">{t.previewUnavailable}</p>;
  const source = contentUrl(companyId, item, "display");
  return (
    <figure className="media-preview">
      {item.kind === "IMAGE" ? (
        <img src={source} alt={item.name} />
      ) : (
        <video
          src={source}
          controls
          preload="metadata"
          poster={contentUrl(companyId, item, "thumbnail")}
          aria-label={item.name}
        />
      )}
    </figure>
  );
}

function MediaDetail({
  companyId,
  assetId,
  company,
}: {
  companyId: string;
  assetId: string;
  company: CompanyWithAccess;
}) {
  const { locale, t } = useMediaMessages();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const media = useQuery({
    queryKey: mediaKey(companyId, assetId),
    queryFn: () => getMedia(companyId, assetId),
    refetchInterval: (query) =>
      query.state.data && isPending(query.state.data) ? pollMs : false,
  });
  const can = (capability: string) =>
    company.access.capabilities.some((granted) => granted === capability);
  const [notice, setNotice] = useState<string | null>(null);
  // Every change refetches the item and the list so versions stay current.
  const onChanged: Changed = async (changed, done) => {
    setNotice(done ?? null);
    if (changed)
      queryClient.setQueryData(mediaKey(companyId, assetId), changed);
    await queryClient.invalidateQueries({ queryKey: mediaListKey(companyId) });
    if (!changed) {
      void navigate({
        to: "/companies/$companyId/media",
        params: { companyId },
      });
      return;
    }
    await queryClient.invalidateQueries({
      queryKey: mediaKey(companyId, assetId),
    });
  };
  if (media.isPending) return <p>{t.loading}</p>;
  if (media.isError)
    return (
      <>
        <Failure
          error={media.error}
          operation="read"
          onReload={() => void media.refetch()}
        />
        <Link to="/companies/$companyId/media" params={{ companyId }}>
          {t.backToMedia}
        </Link>
      </>
    );
  const item = media.data;
  const status = item.status;
  return (
    <>
      <p className="hint">
        <Link to="/companies/$companyId/media" params={{ companyId }}>
          {t.backToMedia}
        </Link>
      </p>
      <h1 id="media-title">{item.name}</h1>
      <p className="hint">
        {scopeName(item, t)} · {stateLine(item, t)}
      </p>
      {notice && <p role="status">{notice}</p>}
      {status === "FAILED" && <p className="hint">{t.failedHint}</p>}
      <Preview companyId={companyId} item={item} />
      <section aria-labelledby="details-title">
        <h2 id="details-title">{t.detailsTitle}</h2>
        <dl className="company-settings">
          <dt>{t.fieldKind}</dt>
          <dd>{t.kinds[item.kind]}</dd>
          <dt>{t.fieldScope}</dt>
          <dd>{scopeName(item, t)}</dd>
          <dt>{t.fieldStatus}</dt>
          <dd>{stateLine(item, t)}</dd>
          {item.width && item.height && (
            <>
              <dt>{t.fieldDimensions}</dt>
              <dd>{t.dimensions(item.width, item.height)}</dd>
            </>
          )}
          {item.durationMs !== null && (
            <>
              <dt>{t.fieldDuration}</dt>
              <dd>{t.duration(Math.round(item.durationMs / 1000))}</dd>
            </>
          )}
          {item.kind === "VIDEO" && item.hasAudio !== null && (
            <>
              <dt>{t.fieldAudio}</dt>
              <dd>{item.hasAudio ? t.yes : t.no}</dd>
            </>
          )}
          <dt>{t.fieldSize}</dt>
          <dd>
            {new Intl.NumberFormat(locale, {
              style: "unit",
              unit: "megabyte",
              maximumFractionDigits: 1,
            }).format(item.declaredSize / 1_000_000)}
          </dd>
          <dt>{t.fieldCreated}</dt>
          <dd>{formatInstant(locale, item.createdAt)}</dd>
          {item.tags.length > 0 && (
            <>
              <dt>{t.tags}</dt>
              <dd>{item.tags.join(", ")}</dd>
            </>
          )}
          {item.purgeAfter && (
            <>
              <dt>{t.fieldPurge}</dt>
              <dd>{formatInstant(locale, item.purgeAfter)}</dd>
            </>
          )}
        </dl>
        {can("media.upload") && hasRenditions(item) && (
          <p>
            <a href={contentUrl(companyId, item, "original")} download>
              {t.downloadOriginal}
            </a>
          </p>
        )}
      </section>
      {can("media.upload") && status !== "DELETED" && (
        <EditForm
          key={`edit-${item.version}`}
          companyId={companyId}
          item={item}
          onChanged={onChanged}
        />
      )}
      {can("media.archive") && status === "READY" && (
        <form className="form-stack" aria-labelledby="archive-title">
          <h2 id="archive-title">{t.archiveTitle}</h2>
          <p>{t.archiveLead}</p>
          <TransitionButton
            key={`archive-${item.version}`}
            companyId={companyId}
            item={item}
            transition="archive"
            label={t.archive}
            done={t.archived}
            onChanged={onChanged}
          />
        </form>
      )}
      {can("media.archive") && status === "ARCHIVED" && (
        <form className="form-stack" aria-label={t.restore}>
          <TransitionButton
            key={`restore-${item.version}`}
            companyId={companyId}
            item={item}
            transition="restore"
            label={t.restore}
            done={t.restored}
            onChanged={onChanged}
          />
        </form>
      )}
      {can("media.delete") && status === "ARCHIVED" && (
        <DeleteForm
          key={`delete-${item.version}`}
          companyId={companyId}
          item={item}
          onChanged={onChanged}
        />
      )}
      {can("media.delete") && status === "DELETED" && (
        <form className="form-stack" aria-label={t.restoreDeleted}>
          <TransitionButton
            key={`restore-deleted-${item.version}`}
            companyId={companyId}
            item={item}
            transition="restore-deleted"
            label={t.restoreDeleted}
            done={t.restored}
            onChanged={onChanged}
          />
        </form>
      )}
      {can("media.upload") &&
        (status === "UPLOADING" ||
          status === "REJECTED" ||
          status === "FAILED") && (
          <DiscardForm
            key={`discard-${item.version}`}
            companyId={companyId}
            item={item}
            onChanged={onChanged}
          />
        )}
    </>
  );
}

export function MediaItemPage({
  companyId,
  assetId,
}: {
  companyId: string;
  assetId: string;
}) {
  return (
    <CompanyGate
      companyId={companyId}
      returnTo={`/companies/${companyId}/media/${assetId}`}
    >
      {(company) => (
        <MediaDetail
          companyId={companyId}
          assetId={assetId}
          company={company}
        />
      )}
    </CompanyGate>
  );
}
