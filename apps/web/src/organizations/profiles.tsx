import { useMemo, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { ApiFailure } from "../api-client.js";
import { Button, Checkbox, DataSet, TextField } from "../components.js";
import type { DataSetColumn } from "../dataset.js";
import type { Locale } from "../locale.js";
import { NavigationIcon } from "../navigation-icon.js";
import { UiIcon } from "../ui-icon.js";
import {
  archiveAccessProfile,
  createAccessProfile,
  describe,
  getAccessProfile,
  invalidateCompany,
  listAccessProfiles,
  profilesKey,
  updateAccessProfile,
  type AccessProfile,
  type AccessProfileDetail,
  type DelegableCapability,
} from "./api.js";
import { formatInstant, WriteFailure } from "./members.js";
import type { OrganizationMessages } from "./messages.js";

const capabilityGroups = [
  {
    id: "organization",
    icon: "branches",
    capabilities: ["branches.view", "invitations.manage", "audit.view"],
  },
  {
    id: "screens",
    icon: "sessions",
    capabilities: ["devices.view", "devices.manage"],
  },
  {
    id: "media",
    icon: "media",
    capabilities: ["media.view", "media.upload", "media.archive"],
  },
  {
    id: "programming",
    icon: "programming",
    capabilities: [
      "programming.view",
      "programming.edit",
      "programming.assign",
      "publications.publish",
    ],
  },
  {
    id: "catalogs",
    icon: "catalogs",
    capabilities: [
      "catalogs.view",
      "catalogs.edit",
      "catalogs.manage",
      "prices.edit",
    ],
  },
] as const;

/** Capabilities an access profile may carry, in display order. */
export const delegableCapabilities: readonly DelegableCapability[] =
  capabilityGroups.flatMap((group) => [...group.capabilities]);

const prerequisites: Partial<Record<DelegableCapability, DelegableCapability>> =
  {
    "devices.manage": "devices.view",
    "media.upload": "media.view",
    "media.archive": "media.view",
    "programming.edit": "programming.view",
    "programming.assign": "programming.view",
    "publications.publish": "programming.view",
    "catalogs.edit": "catalogs.view",
    "catalogs.manage": "catalogs.view",
    "prices.edit": "catalogs.view",
  };

/** Grouped permission fields for a profile draft; submission belongs to its form. */
export function ProfileCapabilities({
  value,
  onChange,
  disabled,
  t,
}: {
  value: readonly DelegableCapability[];
  onChange: (value: DelegableCapability[]) => void;
  disabled?: boolean;
  t: OrganizationMessages;
}) {
  const toggle = (capability: DelegableCapability, checked: boolean) => {
    const next = new Set(value);
    if (checked) {
      next.add(capability);
      const prerequisite = prerequisites[capability];
      if (prerequisite) next.add(prerequisite);
    } else {
      next.delete(capability);
      for (const dependent of delegableCapabilities)
        if (prerequisites[dependent] === capability) next.delete(dependent);
    }
    onChange(delegableCapabilities.filter((item) => next.has(item)));
  };
  return (
    <div className="profile-permissions">
      <div className="profiles-section-heading">
        <h3>{t.profileCapabilities}</h3>
        <span role="status">
          {t.profileWorkspace.permissionCount(value.length)}
        </span>
      </div>
      <p className="hint">{t.profileCapabilitiesHint}</p>
      <div className="profile-capability-grid">
        {capabilityGroups.map((group) => (
          <fieldset
            key={group.id}
            disabled={disabled}
            className="profile-capability-card"
          >
            <legend>
              <NavigationIcon name={group.icon} />{" "}
              {t.profileWorkspace.groups[group.id].title}
            </legend>
            <p className="hint">
              {t.profileWorkspace.groups[group.id].description}
            </p>
            {group.capabilities.map((capability) => (
              <Checkbox
                key={capability}
                label={t.capabilities[capability]}
                checked={value.includes(capability)}
                onChange={(event) => toggle(capability, event.target.checked)}
              />
            ))}
          </fieldset>
        ))}
      </div>
    </div>
  );
}

function CapabilitySummary({
  profile,
  t,
}: {
  profile: AccessProfile;
  t: OrganizationMessages;
}) {
  return (
    <div className="profile-capability-grid">
      {capabilityGroups
        .filter((group) =>
          group.capabilities.some((capability) =>
            profile.capabilities.includes(capability),
          ),
        )
        .map((group) => (
          <section key={group.id} className="profile-capability-card">
            <h4>
              <NavigationIcon name={group.icon} />{" "}
              {t.profileWorkspace.groups[group.id].title}
            </h4>
            <ul>
              {group.capabilities
                .filter((capability) =>
                  profile.capabilities.includes(capability),
                )
                .map((capability) => (
                  <li key={capability}>
                    <UiIcon name="check" /> {t.capabilities[capability]}
                  </li>
                ))}
            </ul>
          </section>
        ))}
    </div>
  );
}

function needsReload(error: unknown): boolean {
  return Boolean(
    error &&
    (!(error instanceof ApiFailure) ||
      error.status >= 500 ||
      error.code === "RESOURCE_VERSION_CONFLICT"),
  );
}

function ProfileForm({
  companyId,
  initial,
  returnTo,
  t,
  blocked,
  onSaved,
  onCancel,
  onReload,
}: {
  companyId: string;
  initial?: AccessProfile;
  returnTo: string;
  t: OrganizationMessages;
  blocked?: boolean;
  onSaved: (profile: AccessProfile) => void;
  onCancel: () => void;
  onReload: () => Promise<void>;
}) {
  const [base] = useState(initial);
  const [name, setName] = useState(initial?.name ?? "");
  const [capabilities, setCapabilities] = useState<DelegableCapability[]>([
    ...(initial?.capabilities ?? []),
  ]);
  const [confirming, setConfirming] = useState(false);
  const [reloading, setReloading] = useState(false);
  const changedCapabilities = Boolean(
    base &&
    (base.capabilities.length !== capabilities.length ||
      capabilities.some((item) => !base.capabilities.includes(item))),
  );
  const changedName = name.trim() !== base?.name;
  const save = useMutation({
    mutationFn: () =>
      base
        ? updateAccessProfile(companyId, base, {
            ...(changedName ? { name: name.trim() } : {}),
            ...(changedCapabilities ? { capabilities } : {}),
          })
        : createAccessProfile(companyId, { name: name.trim(), capabilities }),
    onSuccess: onSaved,
  });
  const mustReload = needsReload(save.error);
  const complete =
    name.trim().length > 0 &&
    capabilities.length > 0 &&
    (!base || changedCapabilities || changedName);
  const frozen = save.isPending || mustReload || reloading || blocked;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (frozen || !complete) return;
    if (
      base &&
      changedCapabilities &&
      (initial?.grantCount ?? 0) > 0 &&
      !confirming
    ) {
      setConfirming(true);
      return;
    }
    save.mutate();
  };
  return (
    <form
      className="profile-form"
      aria-label={
        base ? `${t.profileEdit}: ${base.name}` : t.profileCreateTitle
      }
      onSubmit={submit}
    >
      <div className="profile-name-card">
        <TextField
          label={t.profileName}
          hint={t.profileWorkspace.nameHint}
          value={name}
          maxLength={120}
          required
          disabled={frozen || confirming}
          onChange={(event) => setName(event.target.value)}
        />
      </div>
      <ProfileCapabilities
        value={capabilities}
        onChange={setCapabilities}
        disabled={frozen || confirming}
        t={t}
      />
      <p className="notice profile-scope-note">
        {t.profileWorkspace.scopeHint}
      </p>
      {confirming && (
        <div className="notice profile-impact" role="status">
          <strong>{t.profileWorkspace.reviewTitle}</strong>
          <p>{t.profileChangeConfirmation(initial?.memberCount ?? 0)}</p>
        </div>
      )}
      {save.error && (
        <WriteFailure
          error={save.error}
          returnTo={returnTo}
          t={t}
          busy={save.isPending || reloading}
          onReload={
            mustReload
              ? () => {
                  setReloading(true);
                  void onReload().finally(() => setReloading(false));
                }
              : undefined
          }
        />
      )}
      {mustReload && (
        <p className="hint">{t.profileWorkspace.reviewRequired}</p>
      )}
      <div className="action-group profile-form-actions">
        <Button
          type="submit"
          variant="primary"
          pending={save.isPending}
          disabled={frozen || !complete}
        >
          {save.isPending
            ? t.saving
            : confirming
              ? t.profileChangeConfirm
              : base
                ? t.save
                : t.profileCreate}
        </Button>
        {confirming && (
          <Button disabled={frozen} onClick={() => setConfirming(false)}>
            {t.profileWorkspace.reviewSelection}
          </Button>
        )}
        <Button disabled={save.isPending || reloading} onClick={onCancel}>
          {t.cancel}
        </Button>
      </div>
    </form>
  );
}

function ProfileHolders({
  detail,
  locale,
  t,
}: {
  detail: AccessProfileDetail;
  locale: Locale;
  t: OrganizationMessages;
}) {
  return (
    <section
      className="profile-holders"
      aria-labelledby="profile-holders-title"
    >
      <div className="profiles-section-heading">
        <h3 id="profile-holders-title">{t.profileHolders}</h3>
        <span>
          {t.profileUsage(
            detail.profile.memberCount,
            detail.profile.grantCount,
          )}
        </span>
      </div>
      {detail.holders.length === 0 ? (
        <p className="empty-state">{t.profileNoHolders}</p>
      ) : (
        <ul className="profile-holder-list">
          {detail.holders.map((holder) => (
            <li key={holder.grantId}>
              <div>
                <strong>
                  {holder.displayName ?? holder.email ?? t.memberUnknown}
                </strong>
                {holder.displayName && holder.email && (
                  <small>{holder.email}</small>
                )}
                <span
                  className="member-status"
                  data-state={holder.membershipStatus}
                >
                  {t.memberStatuses[holder.membershipStatus]}
                </span>
              </div>
              <div>
                <span className="profile-holder-label">
                  {t.profileWorkspace.scope}
                </span>
                <span>
                  {holder.scope === "COMPANY"
                    ? t.grantCompanyWide
                    : `${t.grantBranches}: ${holder.branches.map((branch) => branch.name).join(", ")}`}
                </span>
              </div>
              <div>
                <span className="profile-holder-label">
                  {t.profileWorkspace.expiry}
                </span>
                <span>
                  {holder.expiresAt
                    ? formatInstant(locale, holder.expiresAt)
                    : t.profileWorkspace.noExpiry}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
      {detail.holdersTruncated && (
        <p className="hint">{t.profileHoldersTruncated}</p>
      )}
    </section>
  );
}

function ProfileDetail({
  companyId,
  profileId,
  returnTo,
  locale,
  t,
}: {
  companyId: string;
  profileId: string;
  returnTo: string;
  locale: Locale;
  t: OrganizationMessages;
}) {
  const client = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [revision, setRevision] = useState(0);
  const [archiveBase, setArchiveBase] = useState<AccessProfile>();
  const [confirmed, setConfirmed] = useState(false);
  const detail = useQuery({
    queryKey: [...profilesKey(companyId), "detail", profileId],
    queryFn: () => getAccessProfile(companyId, profileId),
  });
  const archive = useMutation({
    mutationFn: () => {
      if (!archiveBase) throw new Error("No profile selected for archive");
      return archiveAccessProfile(companyId, archiveBase);
    },
    onSuccess: () => {
      setArchiveBase(undefined);
      setConfirmed(false);
      void invalidateCompany(client, companyId);
    },
  });
  const reload = async () => {
    const result = await detail.refetch();
    if (!result.isSuccess) return;
    setRevision((value) => value + 1);
    setArchiveBase(undefined);
    setConfirmed(false);
    archive.reset();
    void client.invalidateQueries({
      queryKey: [...profilesKey(companyId), "all"],
    });
  };
  if (detail.isPending) return <p>{t.loading}</p>;
  const profile = detail.data?.profile;
  return (
    <>
      {detail.isError && (
        <div role="alert" className="notice notice-error">
          {describe(detail.error, t, "read")}
          <Button onClick={() => void reload()}>{t.reload}</Button>
        </div>
      )}
      {profile && detail.data && (
        <>
          <header className="profile-detail-heading">
            <div>
              <p className="eyebrow">
                {profile.status === "ACTIVE"
                  ? t.profileWorkspace.active
                  : t.profileWorkspace.archived}
              </p>
              <h3>{profile.name}</h3>
              <p className="hint">
                {t.profileWorkspace.updated}{" "}
                {formatInstant(locale, profile.updatedAt)}
              </p>
            </div>
            {profile.status === "ACTIVE" && !editing && (
              <Button
                variant="primary"
                disabled={detail.isError || Boolean(archiveBase)}
                onClick={() => setEditing(true)}
              >
                {t.profileEdit}
              </Button>
            )}
          </header>
          {editing ? (
            <ProfileForm
              key={revision}
              companyId={companyId}
              initial={profile}
              returnTo={returnTo}
              t={t}
              blocked={detail.isError || profile.status !== "ACTIVE"}
              onSaved={() => {
                setEditing(false);
                void invalidateCompany(client, companyId);
              }}
              onCancel={() => setEditing(false)}
              onReload={reload}
            />
          ) : (
            <section aria-labelledby="profile-permissions-title">
              <div className="profiles-section-heading">
                <h3 id="profile-permissions-title">{t.profileCapabilities}</h3>
                <span>
                  {t.profileWorkspace.permissionCount(
                    profile.capabilities.length,
                  )}
                </span>
              </div>
              <CapabilitySummary profile={profile} t={t} />
            </section>
          )}
          <ProfileHolders detail={detail.data} locale={locale} t={t} />
          {!editing && (
            <section
              className="profile-archive-card"
              aria-labelledby="profile-archive-title"
            >
              <h3 id="profile-archive-title">
                {t.profileWorkspace.archiveTitle}
              </h3>
              <p className="hint">
                {profile.status === "ARCHIVED"
                  ? t.profileWorkspace.archivedHint
                  : profile.grantCount > 0
                    ? t.profileArchiveInUse
                    : t.profileWorkspace.archiveHint}
              </p>
              {profile.status === "ACTIVE" &&
                (!archiveBase ? (
                  <Button
                    aria-label={`${t.archive}: ${profile.name}`}
                    disabled={profile.grantCount > 0 || detail.isError}
                    onClick={() => {
                      archive.reset();
                      setArchiveBase(profile);
                    }}
                  >
                    {t.archive}
                  </Button>
                ) : (
                  <div className="profile-archive-confirmation">
                    <Checkbox
                      label={t.profileWorkspace.archiveConfirm(profile.name)}
                      checked={confirmed}
                      disabled={
                        archive.isPending ||
                        needsReload(archive.error) ||
                        detail.isError
                      }
                      onChange={(event) => setConfirmed(event.target.checked)}
                    />
                    <div className="action-group">
                      <Button
                        disabled={
                          !confirmed ||
                          needsReload(archive.error) ||
                          detail.isError
                        }
                        pending={archive.isPending}
                        onClick={() => archive.mutate()}
                      >
                        {t.profileWorkspace.confirmArchive}
                      </Button>
                      <Button
                        disabled={archive.isPending}
                        onClick={() => setArchiveBase(undefined)}
                      >
                        {t.cancel}
                      </Button>
                    </div>
                  </div>
                ))}
              {archive.error && (
                <WriteFailure
                  error={archive.error}
                  returnTo={returnTo}
                  t={t}
                  busy={archive.isPending || detail.isFetching}
                  onReload={() => void reload()}
                />
              )}
            </section>
          )}
        </>
      )}
    </>
  );
}

/** Company access profiles, with a DataSet list and URL-owned detail. */
export function CompanyProfiles({
  companyId,
  profileId,
  returnTo,
  locale,
  t,
}: {
  companyId: string;
  profileId?: string;
  returnTo: string;
  locale: Locale;
  t: OrganizationMessages;
}) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const copy = t.profileWorkspace;
  const [text, setText] = useState("");
  const [status, setStatus] = useState<AccessProfile["status"] | "all">("all");
  const [selectedId, setSelectedId] = useState<string>();
  const selection = useRef<string | undefined>(undefined);
  const profiles = useQuery({
    queryKey: [...profilesKey(companyId), "all"],
    queryFn: () => listAccessProfiles(companyId, true),
  });
  const openProfile = (id?: string) => {
    void navigate({
      to: "/companies/$companyId",
      params: { companyId },
      search: { view: "profiles", ...(id ? { profile: id } : {}) },
    });
  };
  const normalize = (value: string) =>
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase(locale)
      .trim();
  const items = profiles.data ?? [];
  const term = normalize(text);
  const rows = items.filter(
    (profile) =>
      (status === "all" || profile.status === status) &&
      (!term || normalize(profile.name).includes(term)),
  );
  const columns = useMemo<readonly DataSetColumn<AccessProfile>[]>(
    () => [
      {
        key: "name",
        header: t.profileName,
        width: 260,
        value: (row) => row.name,
        render: (row) => (
          <Link
            className="profiles-name"
            to="/companies/$companyId"
            params={{ companyId }}
            search={{ view: "profiles", profile: row.id }}
          >
            <NavigationIcon name="profiles" />
            <strong>{row.name}</strong>
          </Link>
        ),
      },
      {
        key: "permissions",
        header: t.profileCapabilities,
        width: 320,
        value: (row) =>
          capabilityGroups
            .filter((group) =>
              group.capabilities.some((item) =>
                row.capabilities.includes(item),
              ),
            )
            .map((group) => copy.groups[group.id].title)
            .join(", "),
        render: (row) => (
          <div className="profiles-areas">
            <strong>{copy.permissionCount(row.capabilities.length)}</strong>
            <small>
              {capabilityGroups
                .filter((group) =>
                  group.capabilities.some((item) =>
                    row.capabilities.includes(item),
                  ),
                )
                .map((group) => copy.groups[group.id].title)
                .join(" · ")}
            </small>
          </div>
        ),
      },
      {
        key: "usage",
        header: copy.usage,
        width: 240,
        value: (row) => t.profileUsage(row.memberCount, row.grantCount),
      },
      {
        key: "status",
        header: copy.status,
        width: 140,
        value: (row) => (row.status === "ACTIVE" ? copy.active : copy.archived),
        render: (row) => (
          <span
            className={`profile-status profile-status-${row.status.toLowerCase()}`}
          >
            {row.status === "ACTIVE" ? copy.active : copy.archived}
          </span>
        ),
      },
    ],
    [t, copy, companyId],
  );
  return (
    <section
      className="profiles-workspace"
      aria-labelledby="company-profiles-title"
    >
      <header className="profiles-header">
        <div>
          <h2 id="company-profiles-title">{t.profilesTitle}</h2>
          <p className="hint">{t.profilesLead}</p>
        </div>
        {!profileId && (
          <Button variant="primary" onClick={() => openProfile("new")}>
            <UiIcon name="add" />
            {t.profileCreate}
          </Button>
        )}
      </header>
      {profileId ? (
        <>
          <Link
            className="profiles-back"
            to="/companies/$companyId"
            params={{ companyId }}
            search={{ view: "profiles" }}
          >
            <UiIcon name="previous" />
            {copy.back}
          </Link>
          {profileId === "new" ? (
            <>
              <h3>{t.profileCreateTitle}</h3>
              <ProfileForm
                companyId={companyId}
                returnTo={returnTo}
                t={t}
                onCancel={() => openProfile()}
                onSaved={(profile) => {
                  void invalidateCompany(client, companyId);
                  openProfile(profile.id);
                }}
                onReload={async () => {
                  const result = await profiles.refetch();
                  if (result.isSuccess) openProfile();
                }}
              />
            </>
          ) : (
            <ProfileDetail
              key={profileId}
              {...{ companyId, profileId, returnTo, locale, t }}
            />
          )}
        </>
      ) : profiles.isPending ? (
        <p>{t.loading}</p>
      ) : profiles.isError ? (
        <div role="alert" className="notice notice-error">
          {describe(profiles.error, t, "read")}
          <Button onClick={() => void profiles.refetch()}>{t.reload}</Button>
        </div>
      ) : (
        <>
          <div className="profiles-controls">
            <TextField
              label={copy.search}
              placeholder={copy.searchPlaceholder}
              type="search"
              value={text}
              maxLength={120}
              onChange={(event) => setText(event.target.value)}
            />
            <div className="ui-field">
              <label htmlFor="profiles-status">{copy.status}</label>
              <select
                id="profiles-status"
                className="ui-field-control"
                value={status}
                onChange={(event) =>
                  setStatus(event.target.value as typeof status)
                }
              >
                <option value="all">{copy.allStatuses}</option>
                <option value="ACTIVE">{copy.active}</option>
                <option value="ARCHIVED">{copy.archived}</option>
              </select>
            </div>
            {(text || status !== "all") && (
              <Button
                onClick={() => {
                  setText("");
                  setStatus("all");
                }}
              >
                {copy.clear}
              </Button>
            )}
          </div>
          <p className="hint profiles-results" role="status">
            {copy.results(rows.length, items.length)}
          </p>
          <DataSet
            label={copy.listLabel}
            locale={locale}
            mode="grid"
            rows={rows}
            columns={columns}
            rowId={(row) => row.id}
            selectedId={
              rows.some((row) => row.id === selectedId) ? selectedId : undefined
            }
            onSelect={(id) => {
              selection.current = id;
              setSelectedId(id);
            }}
            onModeChange={
              rows.length
                ? () =>
                    openProfile(
                      rows.find((row) => row.id === selection.current)?.id ??
                        rows[0].id,
                    )
                : undefined
            }
            onRefresh={() => void profiles.refetch()}
            refreshing={profiles.isFetching}
            empty={
              <p className="empty-state">
                {items.length ? copy.noResults : t.profilesEmpty}
              </p>
            }
          />
          <p className="hint profile-scope-note">{copy.scopeHint}</p>
        </>
      )}
    </section>
  );
}
