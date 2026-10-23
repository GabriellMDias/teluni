import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, Navigate } from "@tanstack/react-router";
import brandMark from "../assets/brand-mark.svg";
import { loginHref, sessionQuery } from "../identity/api.js";
import { browserLocale } from "../locale.js";
import { listCompanies } from "../organizations/api.js";
import { organizationMessages } from "../organizations/messages.js";
import { workspaceMessages } from "./messages.js";

export function useWorkspaceMessages() {
  const locale = useMemo(browserLocale, []);
  return { locale, t: workspaceMessages[locale] };
}

/**
 * The application entry: a visitor goes to sign-in, a signed-in person sees
 * the home page. An unavailable session service also leads to sign-in,
 * which explains provider failures when the person tries to enter.
 */
export function EntryPage() {
  const { locale, t } = useWorkspaceMessages();
  const session = useQuery(sessionQuery);
  if (session.isPending)
    return (
      <p className="workspace-loading" lang={locale}>
        {t.loading}
      </p>
    );
  if (!session.data) return <Navigate to="/sign-in" replace />;
  return <HomePage strong={session.data.strongAuthenticatedAt !== null} />;
}

const homeCompanyCount = 6;

function HomePage({ strong }: { strong: boolean }) {
  const { locale, t } = useWorkspaceMessages();
  const roles = organizationMessages[locale].roles;
  const companies = useQuery({
    queryKey: ["organizations", "companies", "home"],
    queryFn: () => listCompanies(),
  });
  const items = companies.data?.items ?? [];
  return (
    <div className="workspace-home" lang={locale}>
      <header className="workspace-hero">
        <div>
          <p className="eyebrow">{t.homeEyebrow}</p>
          <h1>{t.homeTitle}</h1>
          <p>{t.homeLead}</p>
        </div>
        <img
          className="workspace-hero-mark"
          src={brandMark}
          alt=""
          width="180"
          height="180"
        />
      </header>
      <div className="workspace-grid">
        <section className="panel" aria-labelledby="home-companies-title">
          <div className="section-heading">
            <h2 id="home-companies-title">{t.companiesTitle}</h2>
            {items.length > 0 && <Link to="/companies">{t.allCompanies}</Link>}
          </div>
          {companies.isPending ? (
            <p>{t.loading}</p>
          ) : companies.isError ? (
            <div role="alert" className="notice notice-error">
              {t.companiesFailed}
              <button type="button" onClick={() => void companies.refetch()}>
                {t.reload}
              </button>
            </div>
          ) : items.length === 0 ? (
            <div className="workspace-empty">
              <p>{t.companiesEmpty}</p>
              <Link to="/companies" className="button-link button-primary">
                {t.createFirst}
              </Link>
            </div>
          ) : (
            <>
              <ul className="workspace-companies">
                {items.slice(0, homeCompanyCount).map((company) => (
                  <li key={company.id}>
                    <Link
                      to="/companies/$companyId"
                      params={{ companyId: company.id }}
                    >
                      {company.displayName}
                    </Link>
                    <span className="hint">
                      {company.roles.map((role) => roles[role]).join(", ")}
                    </span>
                  </li>
                ))}
              </ul>
              <Link to="/companies">{t.createAnother}</Link>
            </>
          )}
        </section>
        <section className="panel" aria-labelledby="home-account-title">
          <h2 id="home-account-title">{t.accountTitle}</h2>
          <p className={strong ? "hint" : "notice notice-info"}>
            {strong ? t.twoStepDone : t.twoStepMissing}
          </p>
          {!strong && (
            <a
              className="button-link button-primary"
              href={loginHref("/", "strong")}
            >
              {t.twoStepButton}
            </a>
          )}
          <p>
            <Link to="/account/sessions">{t.accountSessions}</Link>
          </p>
        </section>
      </div>
    </div>
  );
}
