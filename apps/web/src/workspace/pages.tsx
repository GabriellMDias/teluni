import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, Navigate } from "@tanstack/react-router";
import { Button } from "../components.js";
import { sessionQuery, twoStepHref, twoStepQuery } from "../identity/api.js";
import { browserLocale } from "../locale.js";
import { NavigationIcon } from "../navigation-icon.js";
import { listCompanies } from "../organizations/api.js";
import { CompanyCard } from "./company-card.js";
import { workspaceMessages } from "./messages.js";

export function useWorkspaceMessages() {
  const locale = useMemo(browserLocale, []);
  return { locale, t: workspaceMessages[locale] };
}

/** The entry requires a currently available human session. */
export function EntryPage() {
  const { locale, t } = useWorkspaceMessages();
  const session = useQuery(sessionQuery);
  if (session.isPending)
    return (
      <p className="workspace-loading" lang={locale} role="status">
        {t.loading}
      </p>
    );
  if (session.isError && session.data)
    return (
      <div className="workspace-loading" lang={locale} role="alert">
        <p>{t.sessionFailed}</p>
        <Button onClick={() => void session.refetch()}>{t.reload}</Button>
      </div>
    );
  if (!session.data) return <Navigate to="/sign-in" replace />;
  return <HomePage />;
}

const homeCompanyCount = 6;

function HomePage() {
  const { locale, t } = useWorkspaceMessages();
  const companies = useQuery({
    queryKey: ["organizations", "companies", "home"],
    queryFn: () => listCompanies(),
  });
  const items = companies.isSuccess ? companies.data.items : [];
  const hasMore =
    items.length > homeCompanyCount || Boolean(companies.data?.nextCursor);
  return (
    <div className="workspace-home" lang={locale}>
      <header className="workspace-heading">
        <div>
          <p className="eyebrow">{t.homeEyebrow}</p>
          <h1>{t.homeTitle}</h1>
          <p className="workspace-lead">{t.homeLead}</p>
        </div>
        <Link
          to="/companies"
          search={{ mode: "form", record: "new" }}
          className="button-link button-primary workspace-create"
        >
          <span aria-hidden="true">+</span>
          {t.createAnother}
        </Link>
      </header>
      <div className="workspace-grid">
        <section
          className="workspace-company-section"
          aria-labelledby="home-companies-title"
        >
          <div className="workspace-section-heading">
            <div>
              <h2 id="home-companies-title">{t.companiesTitle}</h2>
              <p>{t.companiesLead}</p>
            </div>
            {companies.isSuccess && items.length > 0 && (
              <Link to="/companies">
                {t.allCompanies}
                <span aria-hidden="true"> →</span>
              </Link>
            )}
          </div>
          {companies.isPending ? (
            <div className="workspace-placeholder" role="status">
              <NavigationIcon name="companies" />
              <p>{t.loading}</p>
            </div>
          ) : companies.isError ? (
            <div role="alert" className="workspace-placeholder workspace-error">
              <p>{t.companiesFailed}</p>
              <Button onClick={() => void companies.refetch()}>
                {t.reload}
              </Button>
            </div>
          ) : items.length === 0 ? (
            <div className="workspace-empty">
              <span className="workspace-empty-icon" aria-hidden="true">
                <NavigationIcon name="companies" />
              </span>
              <h3>{t.emptyTitle}</h3>
              <p>{t.companiesEmpty}</p>
              <Link
                to="/companies"
                search={{ mode: "form", record: "new" }}
                className="button-link button-primary"
              >
                {t.createFirst}
                <span aria-hidden="true"> →</span>
              </Link>
            </div>
          ) : (
            <>
              <ul className="workspace-companies">
                {items.slice(0, homeCompanyCount).map((company) => (
                  <CompanyCard
                    key={company.id}
                    company={company}
                    locale={locale}
                    t={t}
                  />
                ))}
              </ul>
              {hasMore && (
                <p className="workspace-more">
                  {t.companiesPartial(Math.min(items.length, homeCompanyCount))}{" "}
                  <Link to="/companies">{t.allCompanies}</Link>
                </p>
              )}
            </>
          )}
        </section>
        <aside className="workspace-aside" aria-label={t.helpAndAccount}>
          <section
            className="workspace-guide"
            aria-labelledby="home-guide-title"
          >
            <p className="eyebrow">{t.guideEyebrow}</p>
            <h2 id="home-guide-title">{t.guideTitle}</h2>
            <p className="workspace-guide-lead">{t.guideLead}</p>
            <ol>
              {[
                {
                  title: t.guideMedia,
                  description: t.guideMediaLead,
                  icon: "media",
                },
                {
                  title: t.guideProgramming,
                  description: t.guideProgrammingLead,
                  icon: "programming",
                },
                {
                  title: t.guideScreens,
                  description: t.guideScreensLead,
                  icon: "sessions",
                },
              ].map((step, index) => (
                <li key={step.icon}>
                  <span className="workspace-guide-number" aria-hidden="true">
                    {index + 1}
                  </span>
                  <div>
                    <h3>{step.title}</h3>
                    <p>{step.description}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>
          <AccountSummary />
        </aside>
      </div>
    </div>
  );
}

function AccountSummary() {
  const { t } = useWorkspaceMessages();
  const twoStep = useQuery(twoStepQuery);
  return (
    <section className="workspace-account" aria-labelledby="home-account-title">
      <div className="workspace-account-heading">
        <NavigationIcon name="profiles" />
        <h2 id="home-account-title">{t.accountTitle}</h2>
      </div>
      {twoStep.isPending ? (
        <p role="status">{t.accountLoading}</p>
      ) : twoStep.isError ? (
        <div role="alert">
          <p>{t.accountFailed}</p>
          <Button onClick={() => void twoStep.refetch()}>{t.reload}</Button>
        </div>
      ) : twoStep.data.enabled ? (
        <p className="workspace-security-enabled">{t.twoStepEnabled}</p>
      ) : (
        <>
          <p>{t.twoStepDisabled}</p>
          <a
            className="workspace-security-link"
            href={twoStepHref("enable", "/")}
          >
            {t.twoStepButton}
            <span aria-hidden="true"> →</span>
          </a>
        </>
      )}
      <Link className="workspace-session-link" to="/account/sessions">
        <NavigationIcon name="sessions" />
        {t.accountSessions}
        <span aria-hidden="true">→</span>
      </Link>
    </section>
  );
}
