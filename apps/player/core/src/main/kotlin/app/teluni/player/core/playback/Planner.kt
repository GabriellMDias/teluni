package app.teluni.player.core.playback

import app.teluni.player.core.protocol.Manifest
import app.teluni.player.core.protocol.Publication
import app.teluni.player.core.protocol.Statement
import app.teluni.player.core.schedule.ScheduleEvaluator
import app.teluni.player.core.schedule.SegmentSource
import app.teluni.player.core.schedule.TimelineTooLarge
import app.teluni.player.core.schedule.ZoneOffsets
import app.teluni.player.core.time.TrustedTime
import app.teluni.player.core.time.instantOrNull
import java.time.Duration
import java.time.Instant

/** The playback condition the sync report carries. */
public enum class PlaybackCondition { PLAYING, NEUTRAL, AUTHORIZATION_EXPIRED, CLOCK_UNTRUSTED, DEGRADED, SETUP }

/** What the screen shows now and until when. */
public sealed interface Plan {
    /** The instant at which the plan must be made again, by trusted time; null when nothing scheduled changes it. */
    public val until: Instant?

    /** Plays a playlist; the renderer restarts it only when the playlist changes. */
    public data class Play(
        val publication: Publication,
        val playlist: Manifest.Playlist,
        override val until: Instant?,
    ) : Plan

    public data class Neutral(val condition: PlaybackCondition, override val until: Instant?) : Plan
}

/**
 * Decides protected output (player design, "Authorization" and "Playback"):
 * only an active generation that the latest verified statement lists, before
 * the statement's expiry by trusted time, evaluated against the zone offsets
 * the server sent. Everything else is neutral output with its reason.
 */
public object PlaybackPlanner {
    /** How far ahead a plan looks for its next boundary. */
    public val lookahead: Duration = Duration.ofDays(1)
    private const val MAX_SEGMENTS = 10_000

    public fun plan(
        active: Publication?,
        statement: Statement?,
        time: TrustedTime,
        zone: ZoneOffsets?,
    ): Plan {
        val now = time.instantOrNull ?: return Plan.Neutral(PlaybackCondition.CLOCK_UNTRUSTED, null)
        if (statement == null || now >= statement.expiresAt) {
            return Plan.Neutral(PlaybackCondition.AUTHORIZATION_EXPIRED, null)
        }
        if (active == null || !statement.authorizes(active.manifest.publicationId, active.sha256)) {
            return Plan.Neutral(PlaybackCondition.NEUTRAL, null)
        }
        if (zone == null || !zone.covers(now)) return Plan.Neutral(PlaybackCondition.CLOCK_UNTRUSTED, null)
        val horizon = minOf(now.plus(lookahead), statement.expiresAt, zone.until.minusMillis(1))
        if (horizon <= now) return Plan.Neutral(PlaybackCondition.CLOCK_UNTRUSTED, null)
        val timeline = try {
            ScheduleEvaluator.evaluate(active.rules, active.defaultPlaylistId, zone, now, horizon, MAX_SEGMENTS)
        } catch (_: TimelineTooLarge) {
            null
        } ?: return Plan.Neutral(PlaybackCondition.CLOCK_UNTRUSTED, null)
        // A plan lasts until its segment ends, or until the horizon to look again.
        val segment = timeline.segments.first()
        val until = segment.end
        val playlistId = when (val source = segment.source) {
            is SegmentSource.Rule -> source.playlistId
            is SegmentSource.Default -> source.playlistId
            SegmentSource.None -> null
        }
        val playlist = playlistId?.let { active.playlists[it] }
        if (playlist == null || playlist.items.isEmpty()) return Plan.Neutral(PlaybackCondition.NEUTRAL, until)
        return Plan.Play(active, playlist, until)
    }
}
