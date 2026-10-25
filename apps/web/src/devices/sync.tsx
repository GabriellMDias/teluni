import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { describe } from "../organizations/api.js";
import { formatInstant } from "../organizations/members.js";
import { browserLocale, type Locale } from "../locale.js";
import {
  getSyncState,
  syncRefreshMs,
  syncStateKey,
  type ScreenState,
} from "./api.js";
import { deviceMessages } from "./messages.js";

type Messages = (typeof deviceMessages)["pt-BR"];

/** A short line for lists: connection and publication state. */
export function syncSummary(state: ScreenState, t: Messages): string {
  return `${t.sync.connection[state.connection]} · ${
    t.sync.publication[state.publication]
  }`;
}

function bytes(locale: Locale, value: number): string {
  return new Intl.NumberFormat(locale, {
    style: "unit",
    unit: value >= 1e9 ? "gigabyte" : "megabyte",
    maximumFractionDigits: 1,
  }).format(value / (value >= 1e9 ? 1e9 : 1e6));
}

/**
 * A screen's synchronization, refreshed every five seconds while shown so an
 * acknowledgement appears within AT-14's ten seconds. Every reported value
 * is labeled as the screen's own statement.
 */
export function ScreenSync({
  companyId,
  deviceId,
}: {
  companyId: string;
  deviceId: string;
}) {
  const locale = useMemo(browserLocale, []);
  const t = deviceMessages[locale];
  const state = useQuery({
    queryKey: syncStateKey(companyId, deviceId),
    queryFn: () => getSyncState(companyId, deviceId),
    refetchInterval: syncRefreshMs,
  });
  return (
    <section aria-labelledby="sync-title">
      <h2 id="sync-title">{t.sync.title}</h2>
      {state.isPending ? (
        <p>{t.loading}</p>
      ) : state.isError ? (
        <div role="alert" className="notice notice-error">
          {describe(state.error, t, "read")}
        </div>
      ) : (
        <SyncDetails state={state.data} locale={locale} t={t} />
      )}
    </section>
  );
}

function SyncDetails({
  state,
  locale,
  t,
}: {
  state: ScreenState;
  locale: Locale;
  t: Messages;
}) {
  const reported = state.reported;
  return (
    <>
      <dl className="company-settings" data-testid="screen-sync">
        <dt>{t.sync.connectionLabel}</dt>
        <dd>
          {t.sync.connection[state.connection]}
          {state.lastContactAt &&
            ` · ${t.sync.lastContact}: ${formatInstant(locale, state.lastContactAt)}`}
        </dd>
        <dt>{t.sync.publicationLabel}</dt>
        <dd>{t.sync.publication[state.publication]}</dd>
        <dt>{t.sync.desiredLabel}</dt>
        <dd>
          {state.desired
            ? t.sync.desired(state.desired.generation, state.source === "group")
            : t.sync.noDesired}
        </dd>
        {reported && (
          <>
            <dt>{t.sync.activeLabel}</dt>
            <dd>
              {reported.active
                ? t.sync.active(reported.active.generation)
                : t.sync.noActive}
            </dd>
            {reported.staging && (
              <>
                <dt>{t.sync.stagingLabel}</dt>
                <dd>
                  {reported.staging.state === "FAILED"
                    ? (t.sync.failure[reported.staging.failure ?? ""] ??
                      t.sync.publication.failed)
                    : t.sync.staging(
                        reported.staging.generation,
                        reported.staging.bytesTotal > 0
                          ? Math.floor(
                              (reported.staging.bytesDone * 100) /
                                reported.staging.bytesTotal,
                            )
                          : 0,
                      )}
                </dd>
              </>
            )}
            <dt>{t.sync.playbackLabel}</dt>
            <dd>{t.sync.playback[reported.playback] ?? reported.playback}</dd>
            {reported.storage && (
              <>
                <dt>{t.sync.storageLabel}</dt>
                <dd>
                  {bytes(locale, reported.storage.freeBytes)} /{" "}
                  {bytes(locale, reported.storage.totalBytes)}
                </dd>
              </>
            )}
            <dt>{t.sync.clockLabel}</dt>
            <dd>
              {reported.diagnostics
                ? t.sync.clock[reported.diagnostics.clock]
                : t.sync.unknownDiagnostic}
            </dd>
            <dt>{t.sync.skewLabel}</dt>
            <dd>
              {reported.diagnostics?.systemSkewMillis == null
                ? t.sync.skewUnavailable
                : new Intl.NumberFormat(locale, {
                    style: "unit",
                    unit: "second",
                    signDisplay: "always",
                    maximumFractionDigits: 3,
                  }).format(reported.diagnostics.systemSkewMillis / 1000)}
            </dd>
            <dt>{t.sync.crashLabel}</dt>
            <dd>
              {reported.diagnostics?.crashCount == null
                ? t.sync.unknownDiagnostic
                : `${reported.diagnostics.crashCount === 2_147_483_647 ? "≥ " : ""}${new Intl.NumberFormat(locale).format(reported.diagnostics.crashCount)}`}
            </dd>
            <dt>{t.sync.appLabel}</dt>
            <dd>{reported.appVersion}</dd>
          </>
        )}
      </dl>
      {reported?.diagnostics?.systemSkewMillis != null &&
        Math.abs(reported.diagnostics.systemSkewMillis) > 60_000 && (
          <p role="status" className="notice">
            {t.sync.skewWarning}
          </p>
        )}
      <p className="hint">{t.sync.note}</p>
    </>
  );
}
