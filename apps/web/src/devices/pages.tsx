import { useMemo, useState, type FormEvent } from "react";
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
  configureDevice,
  deviceKey,
  devicesKey,
  getDevice,
  latestAuthorization,
  listDevices,
  listScreenStates,
  moveDevice,
  pairDevice,
  recordDeviceReset,
  rotations,
  screenStatesKey,
  syncRefreshMs,
  unlinkDevice,
  type Device,
  type DeviceFilter,
  type Rotation,
} from "./api.js";
import { deviceMessages } from "./messages.js";
import { ScreenSync, syncSummary } from "./sync.js";

export function useDeviceMessages() {
  const locale = useMemo(browserLocale, []);
  return { locale, t: deviceMessages[locale] };
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
  const { t } = useDeviceMessages();
  return (
    <div role="alert" className="notice notice-error">
      {describe(error, t, operation)}
      {onReload && (
        <button type="button" onClick={onReload}>
          {t.reload}
        </button>
      )}
    </div>
  );
}

function StepUpPrompt({ returnTo }: { returnTo: string }) {
  const { t } = useDeviceMessages();
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
 * Loads the session and the company access every screens page needs, and
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
  const { locale, t } = useDeviceMessages();
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
    !company.data.access.capabilities.includes("devices.view")
  )
    body = (
      <p role="alert" className="notice notice-error">
        {t.errors.PERMISSION_DENIED}
      </p>
    );
  else if (company.data) body = children(company.data);
  return (
    <section
      className="panel organization-panel devices-panel"
      aria-labelledby="devices-title"
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

function deviceState(
  device: Device,
  t: ReturnType<typeof useDeviceMessages>["t"],
) {
  const status = device.status === "ACTIVE" ? t.statusActive : t.statusRevoked;
  const erasure = t.erasure[device.erasure];
  return erasure ? `${status} · ${erasure}` : status;
}

function PairForm({
  companyId,
  branches,
}: {
  companyId: string;
  branches: { id: string; name: string }[];
}) {
  const { t } = useDeviceMessages();
  const queryClient = useQueryClient();
  const [userCode, setUserCode] = useState("");
  const [name, setName] = useState("");
  const [branchId, setBranchId] = useState(branches[0]?.id ?? "");
  const [rotation, setRotation] = useState<Rotation>(0);
  const pair = useMutation({
    mutationFn: () =>
      pairDevice(companyId, { userCode, name, branchId, rotation }),
    onSuccess: async () => {
      setUserCode("");
      setName("");
      await queryClient.invalidateQueries({ queryKey: devicesKey(companyId) });
    },
  });
  function submit(event: FormEvent) {
    event.preventDefault();
    pair.mutate();
  }
  const paired = pair.data;
  return (
    <form
      className="form-stack devices-pair"
      onSubmit={submit}
      aria-labelledby="pair-title"
    >
      <h2 id="pair-title">{t.pairTitle}</h2>
      <p>{t.pairLead}</p>
      <label htmlFor="pair-code">{t.fieldCode}</label>
      <input
        id="pair-code"
        className="pairing-code"
        required
        autoComplete="off"
        spellCheck={false}
        maxLength={12}
        placeholder="XXXX-XXXX"
        value={userCode}
        onChange={(event) => setUserCode(event.target.value.toUpperCase())}
      />
      <label htmlFor="pair-name">{t.fieldName}</label>
      <input
        id="pair-name"
        required
        maxLength={80}
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <label htmlFor="pair-branch">{t.fieldBranch}</label>
      <select
        id="pair-branch"
        required
        value={branchId}
        onChange={(event) => setBranchId(event.target.value)}
      >
        {branches.map((branch) => (
          <option key={branch.id} value={branch.id}>
            {branch.name}
          </option>
        ))}
      </select>
      <label htmlFor="pair-rotation">{t.rotationLabel}</label>
      <select
        id="pair-rotation"
        value={rotation}
        onChange={(event) =>
          setRotation(Number(event.target.value) as Rotation)
        }
      >
        {rotations.map((value) => (
          <option key={value} value={value}>
            {t.rotations[value]}
          </option>
        ))}
      </select>
      {pair.error && (
        <Failure
          error={pair.error}
          operation="write"
          onReload={
            mustReload(pair.error)
              ? () => {
                  pair.reset();
                  void queryClient.invalidateQueries({
                    queryKey: devicesKey(companyId),
                  });
                }
              : undefined
          }
        />
      )}
      {paired && (
        <p role="status">
          {t.paired}{" "}
          <Link
            to="/companies/$companyId/screens/$deviceId"
            params={{ companyId, deviceId: paired.id }}
          >
            {paired.name}
          </Link>{" "}
          <span className="hint">
            {paired.report.manufacturer} {paired.report.model} ·{" "}
            {paired.report.display.width}×{paired.report.display.height}
          </span>
        </p>
      )}
      <button
        type="submit"
        className="button-primary"
        disabled={pair.isPending || !branchId}
      >
        {pair.isPending ? t.pairing : t.pair}
      </button>
    </form>
  );
}

function ScreenList({
  companyId,
  filter,
  branches,
}: {
  companyId: string;
  filter: DeviceFilter;
  branches: { id: string; name: string }[];
}) {
  const { locale, t } = useDeviceMessages();
  const navigate = useNavigate();
  const devices = useQuery({
    queryKey: [...devicesKey(companyId), filter],
    queryFn: () => listDevices(companyId, filter),
  });
  const active = (devices.data?.items ?? [])
    .filter((device) => device.status === "ACTIVE")
    .map((device) => device.id);
  const states = useQuery({
    queryKey: screenStatesKey(companyId, active),
    queryFn: () => listScreenStates(companyId, active),
    enabled: active.length > 0,
    refetchInterval: syncRefreshMs,
  });
  const setFilter = (next: DeviceFilter) =>
    void navigate({
      to: "/companies/$companyId/screens",
      params: { companyId },
      search: {
        ...(next.branchId ? { branchId: next.branchId } : {}),
        ...(next.status ? { status: next.status } : {}),
      },
    });
  return (
    <div className="devices-list-section">
      <div className="devices-filters">
        <label htmlFor="filter-branch">{t.filterBranch}</label>
        <select
          id="filter-branch"
          value={filter.branchId ?? ""}
          onChange={(event) =>
            setFilter({ ...filter, branchId: event.target.value || undefined })
          }
        >
          <option value="">{t.filterAll}</option>
          {branches.map((branch) => (
            <option key={branch.id} value={branch.id}>
              {branch.name}
            </option>
          ))}
        </select>
        <label htmlFor="filter-status">{t.filterStatus}</label>
        <select
          id="filter-status"
          value={filter.status ?? ""}
          onChange={(event) =>
            setFilter({
              ...filter,
              status:
                event.target.value === "ACTIVE" ||
                event.target.value === "REVOKED"
                  ? event.target.value
                  : undefined,
            })
          }
        >
          <option value="">{t.filterAll}</option>
          <option value="ACTIVE">{t.statusActive}</option>
          <option value="REVOKED">{t.statusRevoked}</option>
        </select>
      </div>
      {devices.isPending ? (
        <p>{t.loading}</p>
      ) : devices.isError ? (
        <Failure
          error={devices.error}
          operation="read"
          onReload={() => void devices.refetch()}
        />
      ) : devices.data.items.length === 0 ? (
        <p className="empty-state">{filter.cursor ? t.pageEmpty : t.empty}</p>
      ) : (
        <ul className="organization-list devices-list">
          {devices.data.items.map((device) => (
            <li key={device.id}>
              <Link
                to="/companies/$companyId/screens/$deviceId"
                params={{ companyId, deviceId: device.id }}
              >
                {device.name}
              </Link>
              <span className="hint">
                {device.branch.name} · {deviceState(device, t)} ·{" "}
                {device.lastSeenAt
                  ? `${t.lastSeen}: ${formatInstant(locale, device.lastSeenAt)}`
                  : t.neverSeen}
              </span>
              {states.data?.get(device.id) && (
                <span className="hint">
                  {syncSummary(states.data.get(device.id)!, t)}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      <nav className="pagination" aria-label={t.title}>
        {filter.cursor && (
          <Link
            to="/companies/$companyId/screens"
            params={{ companyId }}
            search={{ ...filter, cursor: undefined }}
          >
            {t.firstPage}
          </Link>
        )}
        {devices.data?.nextCursor && (
          <Link
            to="/companies/$companyId/screens"
            params={{ companyId }}
            search={{ ...filter, cursor: devices.data.nextCursor }}
          >
            {t.nextPage}
          </Link>
        )}
      </nav>
    </div>
  );
}

function useBranchChoices(companyId: string) {
  return useQuery({
    queryKey: ["devices", "branches", companyId],
    queryFn: () => listBranchChoices(companyId),
  });
}

function ScreensContent({
  companyId,
  filter,
  company,
  returnTo,
}: {
  companyId: string;
  filter: DeviceFilter;
  company: CompanyWithAccess;
  returnTo: string;
}) {
  const { t } = useDeviceMessages();
  const branches = useBranchChoices(companyId);
  const manage = company.access.capabilities.includes("devices.manage");
  const stepUp =
    company.access.capabilitiesAfterStrongAuthentication.includes(
      "devices.manage",
    );
  const choices = branches.data?.items ?? [];
  return (
    <>
      <h1 id="devices-title">{t.title}</h1>
      <p>{t.lead}</p>
      {stepUp && <StepUpPrompt returnTo={returnTo} />}
      <ScreenList companyId={companyId} filter={filter} branches={choices} />
      {manage &&
        (branches.isPending ? (
          <p>{t.loading}</p>
        ) : branches.isError ? (
          <Failure
            error={branches.error}
            operation="read"
            onReload={() => void branches.refetch()}
          />
        ) : choices.length === 0 ? (
          <p className="empty-state">{t.noBranches}</p>
        ) : (
          <>
            {branches.data.truncated && (
              <p className="hint">{t.branchesTruncated}</p>
            )}
            <PairForm companyId={companyId} branches={choices} />
          </>
        ))}
    </>
  );
}

export function ScreensPage({
  companyId,
  filter,
}: {
  companyId: string;
  filter: DeviceFilter;
}) {
  const search = new URLSearchParams(
    Object.entries(filter).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  const returnTo = `/companies/${companyId}/screens${search.size ? `?${search}` : ""}`;
  return (
    <CompanyGate companyId={companyId} returnTo={returnTo}>
      {(company) => (
        <ScreensContent
          companyId={companyId}
          filter={filter}
          company={company}
          returnTo={returnTo}
        />
      )}
    </CompanyGate>
  );
}

function ConfigureForm({
  companyId,
  device,
  onChanged,
}: {
  companyId: string;
  device: Device;
  onChanged: (device: Device, notice?: string) => Promise<void>;
}) {
  const { t } = useDeviceMessages();
  const [name, setName] = useState(device.name);
  const [rotation, setRotation] = useState<Rotation>(device.rotation);
  const [zone, setZone] = useState(device.timeZone ?? "");
  const timeZone = zone.trim() || null;
  const save = useMutation({
    mutationFn: () =>
      configureDevice(companyId, device, {
        ...(name.trim() !== device.name ? { name } : {}),
        ...(rotation !== device.rotation ? { rotation } : {}),
        ...(timeZone !== device.timeZone ? { timeZone } : {}),
      }),
    onSuccess: async (changed) => {
      await onChanged(changed, t.saved);
    },
  });
  const unchanged =
    name.trim() === device.name &&
    rotation === device.rotation &&
    timeZone === device.timeZone;
  return (
    <form
      className="form-stack"
      aria-labelledby="configure-title"
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate();
      }}
    >
      <h2 id="configure-title">{t.editTitle}</h2>
      <label htmlFor="device-name">{t.fieldName}</label>
      <input
        id="device-name"
        required
        maxLength={80}
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <label htmlFor="device-rotation">{t.rotationLabel}</label>
      <select
        id="device-rotation"
        value={rotation}
        onChange={(event) =>
          setRotation(Number(event.target.value) as Rotation)
        }
      >
        {device.report.rotations.map((value) => (
          <option key={value} value={value}>
            {t.rotations[value]}
          </option>
        ))}
      </select>
      <label htmlFor="device-time-zone">{t.timeZoneLabel}</label>
      <input
        id="device-time-zone"
        maxLength={64}
        value={zone}
        placeholder={device.branch.timeZone}
        aria-describedby="device-time-zone-hint"
        onChange={(event) => setZone(event.target.value)}
      />
      <p id="device-time-zone-hint" className="hint">
        {t.timeZoneHint(device.branch.timeZone)}
      </p>
      {save.error && (
        <Failure
          error={save.error}
          operation="write"
          onReload={() => {
            save.reset();
            void onChanged(device);
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

function MoveForm({
  companyId,
  device,
  onChanged,
}: {
  companyId: string;
  device: Device;
  onChanged: (device: Device, notice?: string) => Promise<void>;
}) {
  const { t } = useDeviceMessages();
  const branches = useBranchChoices(companyId);
  const destinations = (branches.data?.items ?? []).filter(
    (branch) => branch.id !== device.branch.id,
  );
  const [branchId, setBranchId] = useState("");
  const target = branchId || destinations[0]?.id || "";
  const move = useMutation({
    mutationFn: () => moveDevice(companyId, device, target),
    onSuccess: (changed) => onChanged(changed, t.moved),
  });
  if (branches.isPending || destinations.length === 0) return null;
  return (
    <form
      className="form-stack"
      aria-labelledby="move-title"
      onSubmit={(event) => {
        event.preventDefault();
        move.mutate();
      }}
    >
      <h2 id="move-title">{t.moveTitle}</h2>
      <label htmlFor="move-branch">{t.moveTo}</label>
      <select
        id="move-branch"
        value={target}
        onChange={(event) => setBranchId(event.target.value)}
      >
        {destinations.map((branch) => (
          <option key={branch.id} value={branch.id}>
            {branch.name}
          </option>
        ))}
      </select>
      {move.error && (
        <Failure
          error={move.error}
          operation="write"
          onReload={() => {
            move.reset();
            void onChanged(device);
          }}
        />
      )}
      <button type="submit" disabled={move.isPending || mustReload(move.error)}>
        {t.move}
      </button>
    </form>
  );
}

function UnlinkForm({
  companyId,
  device,
  onChanged,
}: {
  companyId: string;
  device: Device;
  onChanged: (device: Device, notice?: string) => Promise<void>;
}) {
  const { t } = useDeviceMessages();
  const [confirmed, setConfirmed] = useState(false);
  const unlink = useMutation({
    mutationFn: () => unlinkDevice(companyId, device),
    onSuccess: (changed) => onChanged(changed),
  });
  return (
    <form
      className="form-stack devices-danger"
      aria-labelledby="unlink-title"
      onSubmit={(event) => {
        event.preventDefault();
        if (confirmed) unlink.mutate();
      }}
    >
      <h2 id="unlink-title">{t.unlinkTitle}</h2>
      <p>{t.unlinkLead}</p>
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(event) => setConfirmed(event.target.checked)}
        />
        {t.unlinkConfirm(device.name)}
      </label>
      {unlink.error && (
        <Failure
          error={unlink.error}
          operation="write"
          onReload={() => {
            unlink.reset();
            void onChanged(device);
          }}
        />
      )}
      <button
        type="submit"
        className="button-danger"
        disabled={!confirmed || unlink.isPending || mustReload(unlink.error)}
      >
        {t.unlink}
      </button>
    </form>
  );
}

function ResetForm({
  companyId,
  device,
  onChanged,
}: {
  companyId: string;
  device: Device;
  onChanged: (device: Device, notice?: string) => Promise<void>;
}) {
  const { t } = useDeviceMessages();
  const reset = useMutation({
    mutationFn: () => recordDeviceReset(companyId, device),
    onSuccess: (changed) => onChanged(changed, t.resetRecorded),
  });
  return (
    <section aria-labelledby="reset-title" className="form-stack">
      <h2 id="reset-title">{t.resetTitle}</h2>
      <p>{t.resetLead}</p>
      {reset.error && (
        <Failure
          error={reset.error}
          operation="write"
          onReload={() => {
            reset.reset();
            void onChanged(device);
          }}
        />
      )}
      <button
        type="button"
        disabled={reset.isPending || mustReload(reset.error)}
        onClick={() => reset.mutate()}
      >
        {t.reset}
      </button>
    </section>
  );
}

function ScreenDetail({
  companyId,
  deviceId,
  company,
}: {
  companyId: string;
  deviceId: string;
  company: CompanyWithAccess;
}) {
  const { locale, t } = useDeviceMessages();
  const queryClient = useQueryClient();
  const device = useQuery({
    queryKey: deviceKey(companyId, deviceId),
    queryFn: () => getDevice(companyId, deviceId),
  });
  const manage = company.access.capabilities.includes("devices.manage");
  // Every change refetches the screen and the list so versions stay current.
  const [notice, setNotice] = useState<string | null>(null);
  const onChanged = async (changed: Device, done?: string) => {
    setNotice(done ?? null);
    queryClient.setQueryData(deviceKey(companyId, deviceId), changed);
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: deviceKey(companyId, deviceId),
      }),
      queryClient.invalidateQueries({ queryKey: devicesKey(companyId) }),
    ]);
  };
  if (device.isPending) return <p>{t.loading}</p>;
  if (device.isError)
    return (
      <>
        <Failure
          error={device.error}
          operation="read"
          onReload={() => void device.refetch()}
        />
        <Link to="/companies/$companyId/screens" params={{ companyId }}>
          {t.backToScreens}
        </Link>
      </>
    );
  const screen = device.data;
  const deadline = latestAuthorization(screen);
  return (
    <>
      <p className="hint">
        <Link to="/companies/$companyId/screens" params={{ companyId }}>
          {t.backToScreens}
        </Link>
      </p>
      <h1 id="devices-title">{screen.name}</h1>
      <p className="hint">
        {screen.branch.name} · {deviceState(screen, t)}
      </p>
      {notice && <p role="status">{notice}</p>}
      <section aria-labelledby="details-title">
        <h2 id="details-title">{t.detailsTitle}</h2>
        <dl className="company-settings">
          <dt>{t.rotationLabel}</dt>
          <dd>{t.rotations[screen.rotation]}</dd>
          <dt>{t.timeZoneLabel}</dt>
          <dd>{screen.timeZone ?? t.branchTimeZone(screen.branch.timeZone)}</dd>
          <dt>{t.lastSeen}</dt>
          <dd>
            {screen.lastSeenAt
              ? formatInstant(locale, screen.lastSeenAt)
              : t.neverSeen}
          </dd>
          {deadline && (
            <>
              <dt>{t.authorizedUntil}</dt>
              <dd>{formatInstant(locale, deadline.toISOString())}</dd>
            </>
          )}
          <dt>{t.reportedModel}</dt>
          <dd>
            {screen.report.manufacturer} {screen.report.model} (Android{" "}
            {screen.report.osVersion})
          </dd>
          <dt>{t.reportedDisplay}</dt>
          <dd>
            {screen.report.display.width}×{screen.report.display.height}
          </dd>
          <dt>{t.reportedApp}</dt>
          <dd>{screen.report.appVersion}</dd>
          <dt>{t.pairedAt}</dt>
          <dd>{formatInstant(locale, screen.pairedAt)}</dd>
          {screen.revokedAt && (
            <>
              <dt>{t.revokedAt}</dt>
              <dd>{formatInstant(locale, screen.revokedAt)}</dd>
            </>
          )}
        </dl>
        <p className="hint">{t.reportNote}</p>
        {screen.status === "ACTIVE" &&
          company.access.capabilities.includes("programming.view") && (
            <p>
              <Link
                to="/companies/$companyId/programming/screens/$deviceId"
                params={{ companyId, deviceId }}
              >
                {t.programmingLink}
              </Link>
            </p>
          )}
      </section>
      {screen.status === "ACTIVE" && (
        <ScreenSync companyId={companyId} deviceId={deviceId} />
      )}
      {manage && screen.status === "ACTIVE" && (
        <>
          <ConfigureForm
            key={`configure-${screen.version}`}
            companyId={companyId}
            device={screen}
            onChanged={onChanged}
          />
          <MoveForm
            key={`move-${screen.version}`}
            companyId={companyId}
            device={screen}
            onChanged={onChanged}
          />
          <UnlinkForm
            key={`unlink-${screen.version}`}
            companyId={companyId}
            device={screen}
            onChanged={onChanged}
          />
        </>
      )}
      {manage &&
        screen.status === "REVOKED" &&
        screen.erasure === "PENDING" && (
          <ResetForm
            key={`reset-${screen.version}`}
            companyId={companyId}
            device={screen}
            onChanged={onChanged}
          />
        )}
      {screen.status === "REVOKED" && (
        <p role="status" className="hint">
          {screen.erasure === "PENDING"
            ? t.unlinked
            : t.erasure[screen.erasure]}
        </p>
      )}
    </>
  );
}

export function ScreenPage({
  companyId,
  deviceId,
}: {
  companyId: string;
  deviceId: string;
}) {
  return (
    <CompanyGate
      companyId={companyId}
      returnTo={`/companies/${companyId}/screens/${deviceId}`}
    >
      {(company) => (
        <ScreenDetail
          companyId={companyId}
          deviceId={deviceId}
          company={company}
        />
      )}
    </CompanyGate>
  );
}
