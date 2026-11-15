import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "../components.js";
import { ScreenCard, ScreenStatus } from "./components.js";
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
  compact = false,
}: {
  companyId: string;
  deviceId: string;
  compact?: boolean;
}) {
  const locale = useMemo(browserLocale, []);
  const t = deviceMessages[locale];
  const state = useQuery({
    queryKey: syncStateKey(companyId, deviceId),
    queryFn: () => getSyncState(companyId, deviceId),
    refetchInterval: syncRefreshMs,
  });
  return (
    <section aria-label={t.sync.title} className="screen-sync-section">
      {state.isPending ? (
        <p>{t.loading}</p>
      ) : state.isError ? (
        <div role="alert" className="notice notice-error">
          {describe(state.error, t, "read")}
          <Button onClick={() => void state.refetch()}>{t.reload}</Button>
        </div>
      ) : compact ? (
        <SyncSummary state={state.data} t={t} />
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
      <div className="screen-card-grid" data-testid="screen-sync">
        <ScreenCard title={t.sync.connectionLabel}>
          <ScreenStatus
            tone={state.connection === "online" ? "positive" : "neutral"}
          >
            {t.sync.connection[state.connection]}
          </ScreenStatus>
          <dl className="screen-facts">
            <div>
              <dt>{t.sync.lastContact}</dt>
              <dd>
                {state.lastContactAt
                  ? formatInstant(locale, state.lastContactAt)
                  : t.neverSeen}
              </dd>
            </div>
          </dl>
        </ScreenCard>
        <ScreenCard title={t.publicationTitle}>
          <ScreenStatus tone={publicationTone(state)}>
            {t.sync.publication[state.publication]}
          </ScreenStatus>
          <dl className="screen-facts">
            <div>
              <dt>{t.sync.desiredLabel}</dt>
              <dd>
                {state.desired
                  ? t.sync.desired(
                      state.desired.generation,
                      state.source === "group",
                    )
                  : t.sync.noDesired}
              </dd>
            </div>
            {reported && (
              <>
                <div>
                  <dt>{t.sync.activeLabel}</dt>
                  <dd>
                    {reported.active
                      ? t.sync.active(reported.active.generation)
                      : t.sync.noActive}
                  </dd>
                </div>
                {reported.staging && (
                  <div>
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
                  </div>
                )}
                <div>
                  <dt>{t.sync.playbackLabel}</dt>
                  <dd>
                    {t.sync.playback[reported.playback] ?? reported.playback}
                  </dd>
                </div>
              </>
            )}
          </dl>
        </ScreenCard>
        <ScreenCard title={t.diagnosticsTitle}>
          {reported ? (
            <dl className="screen-facts">
              <div>
                <dt>{t.sync.storageLabel}</dt>
                <dd>
                  {reported.storage
                    ? `${bytes(locale, reported.storage.freeBytes)} / ${bytes(locale, reported.storage.totalBytes)}`
                    : t.sync.unknownDiagnostic}
                </dd>
              </div>
              <div>
                <dt>{t.sync.clockLabel}</dt>
                <dd>
                  {reported.diagnostics
                    ? t.sync.clock[reported.diagnostics.clock]
                    : t.sync.unknownDiagnostic}
                </dd>
              </div>
              <div>
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
              </div>
              <div>
                <dt>{t.sync.crashLabel}</dt>
                <dd>
                  {reported.diagnostics?.crashCount == null
                    ? t.sync.unknownDiagnostic
                    : `${reported.diagnostics.crashCount === 2_147_483_647 ? "≥ " : ""}${new Intl.NumberFormat(locale).format(reported.diagnostics.crashCount)}`}
                </dd>
              </div>
              <div>
                <dt>{t.sync.appLabel}</dt>
                <dd>{reported.appVersion}</dd>
              </div>
            </dl>
          ) : (
            <p className="hint">{t.sync.unknownDiagnostic}</p>
          )}
        </ScreenCard>
      </div>
      {reported?.diagnostics?.systemSkewMillis != null &&
        Math.abs(reported.diagnostics.systemSkewMillis) > 60_000 && (
          <p role="status" className="notice">
            {t.sync.skewWarning}
          </p>
        )}
      <p className="hint screen-sync-note">{t.sync.note}</p>
    </>
  );
}

function publicationTone(state: ScreenState) {
  return state.publication === "up_to_date"
    ? "positive"
    : state.publication === "failed"
      ? "danger"
      : "neutral";
}

function SyncSummary({ state, t }: { state: ScreenState; t: Messages }) {
  return (
    <>
      <div className="screen-health-summary" data-testid="screen-sync-summary">
        <div>
          <span className="screen-metric-label">{t.sync.connectionLabel}</span>
          <ScreenStatus
            tone={state.connection === "online" ? "positive" : "neutral"}
          >
            {t.sync.connection[state.connection]}
          </ScreenStatus>
        </div>
        <div>
          <span className="screen-metric-label">{t.sync.publicationLabel}</span>
          <ScreenStatus tone={publicationTone(state)}>
            {t.sync.publication[state.publication]}
          </ScreenStatus>
        </div>
        <div>
          <span className="screen-metric-label">{t.sync.playbackLabel}</span>
          <strong>
            {state.reported
              ? (t.sync.playback[state.reported.playback] ??
                state.reported.playback)
              : t.sync.unknownDiagnostic}
          </strong>
        </div>
      </div>
      <p className="hint screen-sync-note">{t.sync.note}</p>
    </>
  );
}
