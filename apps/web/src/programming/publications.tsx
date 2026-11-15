import { useMemo, useState } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { ApiFailure } from "../api-client.js";
import { browserLocale, type Locale } from "../locale.js";
import { describe, type CompanyWithAccess } from "../organizations/api.js";
import { formatInstant } from "../organizations/members.js";
import {
  checkPublication,
  listPublications,
  publicationsKey,
  publishProgram,
  restorePublication,
  type ProgramSource,
  type Publication,
  type PublicationCheck,
} from "./api.js";
import { programmingMessages } from "./messages.js";

type Messages = (typeof programmingMessages)["pt-BR"];

function size(locale: Locale, bytes: number): string {
  const mega = bytes >= 1e9 ? "gigabyte" : "megabyte";
  return new Intl.NumberFormat(locale, {
    style: "unit",
    unit: mega,
    maximumFractionDigits: 1,
  }).format(bytes / (bytes >= 1e9 ? 1e9 : 1e6));
}

const isConflict = (error: unknown) =>
  error instanceof ApiFailure && error.code === "RESOURCE_VERSION_CONFLICT";

/**
 * A program's publication: the current generation, a review that shows
 * exactly what will be published and what blocks it, and the generations
 * published so far with restore. Publishing sends the reviewed content
 * digest, so a draft changed after the review is refused, not published.
 */
export function PublicationPanel({
  companyId,
  source,
  company,
}: {
  companyId: string;
  source: ProgramSource;
  company: CompanyWithAccess;
}) {
  const locale = useMemo(browserLocale, []);
  const t = programmingMessages[locale];
  const p = t.publication;
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<string | null>(null);
  const canPublish = company.access.capabilities.includes(
    "publications.publish",
  );
  const history = useInfiniteQuery({
    queryKey: publicationsKey(companyId, source),
    queryFn: ({ pageParam }) =>
      listPublications(companyId, source, {
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  const published = async (done: string) => {
    setNotice(done);
    await queryClient.invalidateQueries({
      queryKey: publicationsKey(companyId, source),
    });
  };
  const items = history.data?.pages.flatMap((page) => page.items) ?? [];
  const latest = items[0] ?? null;
  return (
    <section aria-labelledby="publication-title">
      <h2 id="publication-title">{p.title}</h2>
      <p className="hint">{p.lead}</p>
      {notice && <p role="status">{notice}</p>}
      {history.isPending ? (
        <p>{t.loading}</p>
      ) : history.isError ? (
        <div role="alert" className="notice notice-error">
          {describe(history.error, t, "read")}
          <button type="button" onClick={() => void history.refetch()}>
            {t.reload}
          </button>
        </div>
      ) : (
        <p>
          {latest
            ? p.current(
                latest.generation,
                formatInstant(locale, latest.publishedAt),
                latest.publishedBy.isCaller,
              )
            : p.never}
        </p>
      )}
      {canPublish && (
        <PublishReview
          companyId={companyId}
          source={source}
          locale={locale}
          t={t}
          onPublished={published}
        />
      )}
      {items.length > 0 && (
        <>
          <h3>{p.historyTitle}</h3>
          <ul className="programming-list" aria-label={p.historyTitle}>
            {items.map((item) => (
              <HistoryEntry
                key={item.id}
                companyId={companyId}
                source={source}
                item={item}
                canRestore={canPublish && item.state === "retained"}
                locale={locale}
                t={t}
                onRestored={published}
              />
            ))}
          </ul>
          {history.hasNextPage && (
            <button
              type="button"
              disabled={history.isFetchingNextPage}
              onClick={() => void history.fetchNextPage()}
            >
              {p.more}
            </button>
          )}
        </>
      )}
    </section>
  );
}

function PublishReview({
  companyId,
  source,
  locale,
  t,
  onPublished,
}: {
  companyId: string;
  source: ProgramSource;
  locale: Locale;
  t: Messages;
  onPublished: (notice: string) => Promise<void>;
}) {
  const p = t.publication;
  const [review, setReview] = useState<PublicationCheck | null>(null);
  const check = useMutation({
    mutationFn: () => checkPublication(companyId, source),
    onSuccess: (result) => setReview(result),
  });
  const publish = useMutation({
    mutationFn: (digest: string) => publishProgram(companyId, source, digest),
    onSuccess: async (result) => {
      setReview(null);
      await onPublished(
        result.created
          ? p.published(result.publication.generation)
          : p.alreadyPublished(result.publication.generation),
      );
    },
  });
  if (!review)
    return (
      <div className="form-stack">
        {check.error && (
          <div role="alert" className="notice notice-error">
            {describe(check.error, t, "read")}
          </div>
        )}
        <button
          type="button"
          className="button-primary"
          disabled={check.isPending}
          onClick={() => {
            publish.reset();
            check.mutate();
          }}
        >
          {check.isPending ? p.reviewing : p.review}
        </button>
      </div>
    );
  // One line per problem kind, and per layout area for catalog problems.
  const problems = [
    ...new Map(
      review.problems.map((problem) => {
        const text = p.problems[problem.code] ?? t.generic;
        return [
          `${problem.code}:${problem.areaKey ?? ""}`,
          problem.areaKey ? p.areaProblem(problem.areaKey, text) : text,
        ];
      }),
    ),
  ];
  return (
    <div
      className="form-stack"
      role="region"
      aria-labelledby="publication-review-title"
    >
      <h3 id="publication-review-title">{p.reviewTitle}</h3>
      {review.unchanged && <p>{p.unchanged}</p>}
      <p>
        {p.summary(
          review.counts.rules,
          review.counts.playlists,
          review.counts.items,
          review.counts.media,
          size(locale, review.counts.mediaBytes),
        )}
      </p>
      <p>{p.followers(review.followers)}</p>
      {problems.length > 0 && (
        <div role="alert" className="notice notice-error">
          <strong>{p.problemsTitle}</strong>
          <ul>
            {problems.map(([key, text]) => (
              <li key={key}>{text}</li>
            ))}
          </ul>
        </div>
      )}
      {publish.error && (
        <div role="alert" className="notice notice-error">
          {isConflict(publish.error)
            ? p.changedSinceReview
            : describe(publish.error, t, "write")}
        </div>
      )}
      <div className="programming-item-actions">
        <button
          type="button"
          className="button-primary"
          disabled={
            !review.publishable ||
            review.unchanged ||
            publish.isPending ||
            Boolean(publish.error)
          }
          onClick={() => publish.mutate(review.contentDigest)}
        >
          {publish.isPending ? p.publishing : p.publish}
        </button>
        <button
          type="button"
          onClick={() => {
            setReview(null);
            publish.reset();
          }}
        >
          {p.cancel}
        </button>
      </div>
    </div>
  );
}

function HistoryEntry({
  companyId,
  source,
  item,
  canRestore,
  locale,
  t,
  onRestored,
}: {
  companyId: string;
  source: ProgramSource;
  item: Publication;
  canRestore: boolean;
  locale: Locale;
  t: Messages;
  onRestored: (notice: string) => Promise<void>;
}) {
  const p = t.publication;
  const [confirming, setConfirming] = useState(false);
  const restore = useMutation({
    mutationFn: () => restorePublication(companyId, source, item.id),
    onSuccess: async (result) => {
      setConfirming(false);
      await onRestored(
        result.created
          ? p.restored(result.publication.generation)
          : p.alreadyPublished(result.publication.generation),
      );
    },
  });
  return (
    <li>
      <strong>{p.generation(item.generation)}</strong>
      <span className="hint">
        {formatInstant(locale, item.publishedAt)} ·{" "}
        {item.publishedBy.isCaller ? p.byYou : p.byOther}
        {item.restoredFromGeneration !== null &&
          ` · ${p.restoredFrom(item.restoredFromGeneration)}`}
        {item.origin === "price" && ` · ${p.priceOrigin}`} ·{" "}
        {p.states[item.state]}
      </span>
      {canRestore && !confirming && (
        <button type="button" onClick={() => setConfirming(true)}>
          {p.restore}
        </button>
      )}
      {canRestore && confirming && (
        <div className="form-stack">
          <p>{p.restoreConfirm(item.generation)}</p>
          {restore.error && (
            <div role="alert" className="notice notice-error">
              {describe(restore.error, t, "write")}
            </div>
          )}
          <div className="programming-item-actions">
            <button
              type="button"
              className="button-primary"
              disabled={restore.isPending || Boolean(restore.error)}
              onClick={() => restore.mutate()}
            >
              {restore.isPending ? p.restoring : p.restoreYes}
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirming(false);
                restore.reset();
              }}
            >
              {p.cancel}
            </button>
          </div>
        </div>
      )}
    </li>
  );
}
