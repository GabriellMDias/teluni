import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiFailure } from "../api-client.js";
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
  type DelegableCapability,
} from "./api.js";
import { WriteFailure } from "./members.js";
import type { OrganizationMessages } from "./messages.js";

/** Capabilities an access profile may carry, in display order. */
export const delegableCapabilities: readonly DelegableCapability[] = [
  "branches.view",
  "invitations.manage",
  "audit.view",
  "devices.view",
  "devices.manage",
];

function CapabilityFields({
  idPrefix,
  value,
  onChange,
  t,
}: {
  idPrefix: string;
  value: readonly DelegableCapability[];
  onChange: (value: DelegableCapability[]) => void;
  t: OrganizationMessages;
}) {
  return (
    <fieldset>
      <legend>{t.profileCapabilities}</legend>
      {delegableCapabilities.map((capability) => (
        <label key={capability} className="choice">
          <input
            type="checkbox"
            name={`${idPrefix}-capabilities`}
            checked={value.includes(capability)}
            onChange={(event) =>
              onChange(
                event.target.checked
                  ? delegableCapabilities.filter(
                      (choice) =>
                        choice === capability || value.includes(choice),
                    )
                  : value.filter((choice) => choice !== capability),
              )
            }
          />
          {t.capabilities[capability]}
        </label>
      ))}
      <p className="hint">{t.profileCapabilitiesHint}</p>
    </fieldset>
  );
}

function CreateProfileForm({
  companyId,
  returnTo,
  t,
}: {
  companyId: string;
  returnTo: string;
  t: OrganizationMessages;
}) {
  const client = useQueryClient();
  const [name, setName] = useState("");
  const [capabilities, setCapabilities] = useState<DelegableCapability[]>([]);
  const create = useMutation({
    mutationFn: () =>
      createAccessProfile(companyId, { name: name.trim(), capabilities }),
    onSuccess: async () => {
      setName("");
      setCapabilities([]);
      await invalidateCompany(client, companyId);
    },
  });
  function submit(event: FormEvent) {
    event.preventDefault();
    create.mutate();
  }
  return (
    <form
      className="form-stack"
      aria-labelledby="profile-create-title"
      onSubmit={submit}
    >
      <h3 id="profile-create-title">{t.profileCreateTitle}</h3>
      <label htmlFor="profile-create-name">{t.profileName}</label>
      <input
        id="profile-create-name"
        required
        maxLength={120}
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <CapabilityFields
        idPrefix="profile-create"
        value={capabilities}
        onChange={setCapabilities}
        t={t}
      />
      {create.error && (
        <WriteFailure error={create.error} returnTo={returnTo} t={t} />
      )}
      <button
        type="submit"
        className="button-primary"
        disabled={create.isPending || !name.trim() || capabilities.length === 0}
      >
        {create.isPending ? t.saving : t.profileCreate}
      </button>
    </form>
  );
}

/**
 * Edits a profile against the version read when editing began; changing
 * capabilities that members hold asks for confirmation naming them.
 */
function EditProfileForm({
  companyId,
  profile,
  returnTo,
  t,
  onClose,
}: {
  companyId: string;
  profile: AccessProfile;
  returnTo: string;
  t: OrganizationMessages;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const [base] = useState(profile);
  const [name, setName] = useState(profile.name);
  const [capabilities, setCapabilities] = useState<DelegableCapability[]>([
    ...profile.capabilities,
  ]);
  const [confirming, setConfirming] = useState(false);
  const detail = useQuery({
    queryKey: [...profilesKey(companyId), "detail", profile.id],
    queryFn: () => getAccessProfile(companyId, profile.id),
  });
  const capabilitiesChanged =
    capabilities.length !== base.capabilities.length ||
    capabilities.some((capability) => !base.capabilities.includes(capability));
  const nameChanged = name.trim() !== base.name;
  const save = useMutation({
    mutationFn: () =>
      updateAccessProfile(companyId, base, {
        ...(nameChanged ? { name: name.trim() } : {}),
        ...(capabilitiesChanged ? { capabilities } : {}),
      }),
    onSuccess: async () => {
      onClose();
      await invalidateCompany(client, companyId);
    },
  });
  // A stale or unconfirmed edit is reviewed against current data, never
  // retried blindly.
  const mustReload =
    Boolean(save.error) &&
    (!(save.error instanceof ApiFailure) ||
      save.error.status >= 500 ||
      save.error.code === "RESOURCE_VERSION_CONFLICT");
  async function reload() {
    onClose();
    await invalidateCompany(client, companyId);
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (mustReload) return;
    if (capabilitiesChanged && base.grantCount > 0 && !confirming) {
      setConfirming(true);
      return;
    }
    save.mutate();
  }
  const holders = detail.data?.holders ?? [];
  return (
    <form
      className="form-stack"
      aria-label={`${t.profileEdit}: ${base.name}`}
      onSubmit={submit}
    >
      <label htmlFor={`profile-name-${base.id}`}>{t.profileName}</label>
      <input
        id={`profile-name-${base.id}`}
        required
        maxLength={120}
        value={name}
        disabled={confirming}
        onChange={(event) => setName(event.target.value)}
      />
      <CapabilityFields
        idPrefix={`profile-${base.id}`}
        value={capabilities}
        onChange={(value) => {
          setConfirming(false);
          setCapabilities(value);
        }}
        t={t}
      />
      <section aria-label={`${t.profileHolders}: ${base.name}`}>
        <h4>{t.profileHolders}</h4>
        {detail.isPending ? (
          <p>{t.loading}</p>
        ) : detail.isError ? (
          <div role="alert" className="notice notice-error">
            {describe(detail.error, t, "read")}
            <button type="button" onClick={() => void detail.refetch()}>
              {t.reload}
            </button>
          </div>
        ) : holders.length === 0 ? (
          <p className="hint">{t.profileNoHolders}</p>
        ) : (
          <ul className="grant-list">
            {holders.map((holder) => (
              <li key={holder.grantId}>
                {holder.displayName ?? holder.email ?? t.memberUnknown}
                {" · "}
                {holder.scope === "COMPANY"
                  ? t.grantCompanyWide
                  : `${t.grantBranches}: ${holder.branches.map((branch) => branch.name).join(", ")}`}
              </li>
            ))}
          </ul>
        )}
        {detail.data?.holdersTruncated && (
          <p className="hint">{t.profileHoldersTruncated}</p>
        )}
      </section>
      {confirming && (
        <p role="status">{t.profileChangeConfirmation(base.memberCount)}</p>
      )}
      {save.error && (
        <WriteFailure
          error={save.error}
          returnTo={returnTo}
          t={t}
          busy={save.isPending}
          onReload={mustReload ? () => void reload() : undefined}
        />
      )}
      <div className="action-group">
        <button
          type="submit"
          className="button-primary"
          disabled={
            save.isPending ||
            mustReload ||
            !name.trim() ||
            capabilities.length === 0 ||
            (!nameChanged && !capabilitiesChanged)
          }
        >
          {save.isPending
            ? t.saving
            : confirming
              ? t.profileChangeConfirm
              : t.save}
        </button>
        <button type="button" disabled={save.isPending} onClick={onClose}>
          {t.cancel}
        </button>
      </div>
    </form>
  );
}

function ProfileRow({
  companyId,
  profile,
  returnTo,
  t,
}: {
  companyId: string;
  profile: AccessProfile;
  returnTo: string;
  t: OrganizationMessages;
}) {
  const client = useQueryClient();
  const [editing, setEditing] = useState(false);
  const archive = useMutation({
    mutationFn: () => archiveAccessProfile(companyId, profile),
    onSuccess: () => invalidateCompany(client, companyId),
  });
  const active = profile.status === "ACTIVE";
  return (
    <li className="branch-item">
      <div>
        <strong>{profile.name}</strong>{" "}
        <span className="hint">
          {active ? t.statusActive : t.statusArchived}
        </span>
      </div>
      <span>
        {profile.capabilities
          .map((capability) => t.capabilities[capability])
          .join(", ")}
      </span>
      <span className="hint">
        {t.profileUsage(profile.memberCount, profile.grantCount)}
      </span>
      {editing ? (
        <EditProfileForm
          companyId={companyId}
          profile={profile}
          returnTo={returnTo}
          t={t}
          onClose={() => setEditing(false)}
        />
      ) : (
        active && (
          <div className="action-group">
            <button
              type="button"
              aria-label={`${t.profileEdit}: ${profile.name}`}
              onClick={() => {
                archive.reset();
                setEditing(true);
              }}
            >
              {t.profileEdit}
            </button>
            <button
              type="button"
              aria-label={`${t.archive}: ${profile.name}`}
              disabled={archive.isPending || profile.grantCount > 0}
              onClick={() => archive.mutate()}
            >
              {t.archive}
            </button>
          </div>
        )
      )}
      {active && !editing && profile.grantCount > 0 && (
        <p className="hint">{t.profileArchiveInUse}</p>
      )}
      {archive.error && (
        <WriteFailure
          error={archive.error}
          returnTo={returnTo}
          t={t}
          busy={archive.isPending}
          onReload={() => {
            archive.reset();
            void invalidateCompany(client, companyId);
          }}
        />
      )}
    </li>
  );
}

/** Customized access profiles of a company, for its administrators. */
export function CompanyProfiles({
  companyId,
  returnTo,
  t,
}: {
  companyId: string;
  returnTo: string;
  t: OrganizationMessages;
}) {
  const profiles = useQuery({
    queryKey: [...profilesKey(companyId), "all"],
    queryFn: () => listAccessProfiles(companyId, true),
  });
  return (
    <section aria-labelledby="company-profiles-title">
      <h2 id="company-profiles-title">{t.profilesTitle}</h2>
      <p>{t.profilesLead}</p>
      {profiles.isPending ? (
        <p>{t.loading}</p>
      ) : profiles.isError ? (
        <div role="alert" className="notice notice-error">
          {describe(profiles.error, t, "read")}
          <button type="button" onClick={() => void profiles.refetch()}>
            {t.reload}
          </button>
        </div>
      ) : profiles.data.length === 0 ? (
        <p className="empty-state">{t.profilesEmpty}</p>
      ) : (
        <ul className="branch-list">
          {profiles.data.map((profile) => (
            <ProfileRow
              key={`${profile.id}-${profile.version}`}
              companyId={companyId}
              profile={profile}
              returnTo={returnTo}
              t={t}
            />
          ))}
        </ul>
      )}
      <CreateProfileForm companyId={companyId} returnTo={returnTo} t={t} />
    </section>
  );
}
