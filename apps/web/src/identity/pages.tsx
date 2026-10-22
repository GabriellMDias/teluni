import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Navigate, useNavigate } from "@tanstack/react-router";
import brandMark from "../assets/brand-mark.svg";
import {
  listSessions,
  loginHref,
  sessionQuery,
  signUpHref,
  sessionsKey,
  terminateAllSessions,
  terminateSession,
  type SessionItem,
} from "./api.js";
import { describeFailure } from "./failures.js";
import {
  browserLocale,
  identityMessages,
  type LoginErrorReason,
} from "./messages.js";

export function useIdentityMessages() {
  const locale = useMemo(browserLocale, []);
  return { locale, t: identityMessages[locale] };
}

export function SignInPage({
  error,
  returnTo,
}: {
  error?: LoginErrorReason;
  returnTo?: string;
}) {
  const { locale, t } = useIdentityMessages();
  const session = useQuery(sessionQuery);
  // A signed-in person has nothing to do here; send them on.
  if (session.data) return <Navigate to={returnTo ?? "/"} replace />;
  return (
    <div className="sign-in-layout" lang={locale}>
      <section className="panel sign-in-panel" aria-labelledby="sign-in-title">
        <img src={brandMark} alt="" width="56" height="56" />
        <p className="eyebrow">{t.signInEyebrow}</p>
        <h1 id="sign-in-title">{t.signInTitle}</h1>
        <p>{t.signInLead}</p>
        {error && (
          <div role="alert" className="notice notice-error">
            {t.loginErrors[error]}
          </div>
        )}
        {session.isPending ? (
          <p className="hint">{t.loading}</p>
        ) : (
          <>
            <a
              className="button-link button-primary sign-in-button"
              href={loginHref(returnTo ?? "/")}
            >
              {t.signInButton}
            </a>
            <p className="hint">{t.signInHint}</p>
            <p className="sign-up">
              {t.signUpPrompt}{" "}
              <a href={signUpHref(returnTo ?? "/")}>{t.signUpLink}</a>
            </p>
            <p className="hint">{t.signUpHint}</p>
          </>
        )}
      </section>
      <aside className="sign-in-aside" aria-label={t.productTitle}>
        <h2>{t.productTitle}</h2>
        <ul>
          {t.productPoints.map((point) => (
            <li key={point}>{point}</li>
          ))}
        </ul>
      </aside>
    </div>
  );
}

function SessionRow({
  item,
  format,
  onEnd,
  ending,
}: {
  item: SessionItem;
  format: Intl.DateTimeFormat;
  onEnd: () => void;
  ending: boolean;
}) {
  const { t } = useIdentityMessages();
  const label = item.current ? t.sessionCurrent : t.sessionOther;
  return (
    <li className="session-item">
      <div>
        <strong>{label}</strong>
        <dl className="session-times">
          <dt>{t.sessionCreated}</dt>
          <dd>{format.format(new Date(item.createdAt))}</dd>
          <dt>{t.sessionLastActivity}</dt>
          <dd>{format.format(new Date(item.lastActivityAt))}</dd>
          <dt>{t.sessionExpires}</dt>
          <dd>{format.format(new Date(item.expiresAt))}</dd>
        </dl>
      </div>
      <button
        type="button"
        onClick={onEnd}
        disabled={ending}
        aria-label={`${t.endSession}: ${label}, ${format.format(new Date(item.createdAt))}`}
      >
        {t.endSession}
      </button>
    </li>
  );
}

export function SessionsPage() {
  const { locale, t } = useIdentityMessages();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const session = useQuery(sessionQuery);
  const sessions = useQuery({
    queryKey: sessionsKey,
    queryFn: listSessions,
    enabled: Boolean(session.data),
  });
  const format = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        dateStyle: "short",
        timeStyle: "short",
      }),
    [locale],
  );
  const end = useMutation({
    mutationFn: async (item: SessionItem) => {
      await terminateSession(item.id);
      return item;
    },
    onSuccess: async (item) => {
      if (item.current) {
        queryClient.clear();
        await navigate({ to: "/sign-in" });
        return;
      }
      await queryClient.invalidateQueries({ queryKey: sessionsKey });
      await queryClient.invalidateQueries({ queryKey: sessionQuery.queryKey });
    },
  });
  const endAll = useMutation({
    mutationFn: terminateAllSessions,
    onSuccess: async () => {
      queryClient.clear();
      await navigate({ to: "/sign-in" });
    },
  });

  if (session.isPending) return <p>{t.loading}</p>;
  if (session.isError)
    return (
      <div role="alert" className="notice notice-error" lang={locale}>
        {describeFailure(session.error, t, "read")}
        <button type="button" onClick={() => void session.refetch()}>
          {t.reload}
        </button>
      </div>
    );
  if (!session.data)
    return (
      <section className="panel identity-panel" lang={locale}>
        <h1>{t.sessionsTitle}</h1>
        <p>{t.sessionsRequireSignIn}</p>
        <a
          className="button-link button-primary"
          href={loginHref("/account/sessions")}
        >
          {t.navSignIn}
        </a>
      </section>
    );
  const mutationError = end.error ?? endAll.error;
  return (
    <section
      className="panel identity-panel"
      aria-labelledby="sessions-title"
      lang={locale}
    >
      <p className="eyebrow">{t.sessionsEyebrow}</p>
      <h1 id="sessions-title">{t.sessionsTitle}</h1>
      <p>{t.sessionsLead}</p>
      <section className="two-step" aria-labelledby="two-step-title">
        <h2 id="two-step-title">{t.twoStepTitle}</h2>
        {session.data.strongAuthenticatedAt ? (
          <p>
            {t.twoStepDone}{" "}
            {format.format(new Date(session.data.strongAuthenticatedAt))}.
          </p>
        ) : (
          <>
            <p>{t.twoStepMissing}</p>
            <a
              className="button-link button-primary"
              href={loginHref("/account/sessions", "strong")}
            >
              {t.twoStepButton}
            </a>
            <p className="hint">{t.twoStepHint}</p>
          </>
        )}
      </section>
      {session.data.state === "PENDING_LIMIT" && (
        <div role="status" className="notice notice-error">
          {t.sessionsPending}
        </div>
      )}
      {mutationError && (
        <div role="alert" className="notice notice-error">
          {describeFailure(mutationError, t, "write")}
          <button type="button" onClick={() => void sessions.refetch()}>
            {t.reload}
          </button>
        </div>
      )}
      {sessions.isPending ? (
        <p>{t.loading}</p>
      ) : sessions.isError ? (
        <div role="alert" className="notice notice-error">
          {describeFailure(sessions.error, t, "read")}
          <button type="button" onClick={() => void sessions.refetch()}>
            {t.reload}
          </button>
        </div>
      ) : (
        <ul className="session-list">
          {sessions.data.map((item) => (
            <SessionRow
              key={item.id}
              item={item}
              format={format}
              ending={end.isPending || endAll.isPending}
              onEnd={() => end.mutate(item)}
            />
          ))}
        </ul>
      )}
      <div className="action-group">
        <button
          type="button"
          onClick={() => endAll.mutate()}
          disabled={endAll.isPending}
        >
          {t.endAllSessions}
        </button>
      </div>
      <p className="hint">{t.endAllHint}</p>
    </section>
  );
}
