package app.teluni.player.core.playback

import app.teluni.player.core.catalog.EffectivePrice
import app.teluni.player.core.catalog.Prices
import app.teluni.player.core.protocol.Area
import app.teluni.player.core.protocol.AreaKind
import app.teluni.player.core.protocol.Layout
import app.teluni.player.core.protocol.LayoutManifest
import app.teluni.player.core.protocol.Manifest
import app.teluni.player.core.protocol.ManifestParser
import app.teluni.player.core.protocol.OutputDefault
import app.teluni.player.core.protocol.PageContent
import app.teluni.player.core.protocol.Publication
import app.teluni.player.core.protocol.Statement
import app.teluni.player.core.protocol.View
import app.teluni.player.core.schedule.Boundary
import app.teluni.player.core.schedule.ScheduleEvaluator
import app.teluni.player.core.schedule.Segment
import app.teluni.player.core.schedule.SegmentSource
import app.teluni.player.core.schedule.TimelineTooLarge
import app.teluni.player.core.schedule.ZoneOffsets
import app.teluni.player.core.time.TrustedTime
import app.teluni.player.core.time.instantOrNull
import java.time.Duration
import java.time.Instant
import java.time.LocalDateTime
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter

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

    /** Composes a protocol 2 layout: what each area shows, in stacking order from the back. */
    public data class Compose(
        val publication: Publication,
        val areas: List<AreaPlan>,
        override val until: Instant?,
    ) : Plan

    public data class Neutral(val condition: PlaybackCondition, override val until: Instant?) : Plan
}

/** What one layout area shows. */
public sealed interface AreaPlan {
    public val area: Area

    /** A playlist from a rule or the area's default; the renderer restarts it only when it changes. */
    public data class Play(override val area: Area, val playlist: Manifest.Playlist) : AreaPlan

    /** A page's media item; a video shorter than the page holds its last frame. */
    public data class Still(override val area: Area, val media: Manifest.Media) : AreaPlan

    /** A page of a catalog view, with the prices in effect for the screen's branch. */
    public data class Catalog(override val area: Area, val view: View, val records: List<ShownRecord>) : AreaPlan

    public data class Empty(override val area: Area) : AreaPlan
}

/** A record on a view page: its values, availability and effective prices by money field. */
public data class ShownRecord(
    val record: LayoutManifest.Record,
    val group: String?,
    val prices: Map<String, EffectivePrice>,
)

/**
 * Decides protected output (player design, "Authorization" and "Playback"):
 * only an active generation that the latest verified statement lists, before
 * the statement's expiry by trusted time, evaluated against the zone offsets
 * the server sent. Everything else is neutral output with its reason.
 * Protocol 2 layouts follow the catalog and composition design: each area
 * evaluates its own output, page-controlled areas follow the page cycle
 * while no rule applies, and catalog views page and price themselves.
 */
public object PlaybackPlanner {
    /** How far ahead a plan looks for its next boundary. */
    public val lookahead: Duration = Duration.ofDays(1)
    private const val MAX_SEGMENTS = 10_000
    private val localMinute = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm")

    /** `branchId` is the screen's branch from the sync answer; protocol 2 branch prices need it. */
    public fun plan(
        active: Publication?,
        statement: Statement?,
        time: TrustedTime,
        zone: ZoneOffsets?,
        branchId: String? = null,
    ): Plan {
        val now = time.instantOrNull ?: return Plan.Neutral(PlaybackCondition.CLOCK_UNTRUSTED, null)
        if (statement == null || now >= statement.expiresAt) {
            return Plan.Neutral(PlaybackCondition.AUTHORIZATION_EXPIRED, null)
        }
        if (active == null || !statement.authorizes(active.header.publicationId, active.sha256)) {
            return Plan.Neutral(PlaybackCondition.NEUTRAL, null)
        }
        if (zone == null || !zone.covers(now)) return Plan.Neutral(PlaybackCondition.CLOCK_UNTRUSTED, null)
        val horizon = minOf(now.plus(lookahead), statement.expiresAt, zone.until.minusMillis(1))
        if (horizon <= now) return Plan.Neutral(PlaybackCondition.CLOCK_UNTRUSTED, null)
        val layout = active.layout
            ?: return single(active, zone, now, horizon)
        return compose(active, layout, zone, now, horizon, branchId)
            ?: Plan.Neutral(PlaybackCondition.CLOCK_UNTRUSTED, null)
    }

    private fun single(active: Publication, zone: ZoneOffsets, now: Instant, horizon: Instant): Plan {
        // A plan lasts until its segment ends, or until the horizon to look again.
        val segment = segment(active, ManifestParser.OUTPUT, zone, now, horizon)
            ?: return Plan.Neutral(PlaybackCondition.CLOCK_UNTRUSTED, null)
        val playlist = playlistOf(active, segment)
        if (playlist == null || playlist.items.isEmpty()) return Plan.Neutral(PlaybackCondition.NEUTRAL, segment.end)
        return Plan.Play(active, playlist, segment.end)
    }

    private fun segment(active: Publication, key: String, zone: ZoneOffsets, now: Instant, horizon: Instant): Segment? {
        val output = active.outputs[key] ?: return null
        val timeline = try {
            ScheduleEvaluator.evaluate(output.rules, output.defaultPlaylistId, zone, now, horizon, MAX_SEGMENTS)
        } catch (_: TimelineTooLarge) {
            null
        }
        return timeline?.segments?.first()
    }

    private fun playlistOf(active: Publication, segment: Segment): Manifest.Playlist? {
        val playlistId = when (val source = segment.source) {
            is SegmentSource.Rule -> source.playlistId
            is SegmentSource.Default -> source.playlistId
            SegmentSource.None -> null
        }
        return playlistId?.let { active.playlists[it] }
    }

    /** Null when an area's schedule cannot be evaluated with the offsets at hand. */
    private fun compose(
        active: Publication,
        layout: Layout,
        zone: ZoneOffsets,
        now: Instant,
        horizon: Instant,
        branchId: String?,
    ): Plan? {
        val local = now.epochSecond + (zone.offsetAt(now) ?: return null)
        val secondOfDay = Math.floorMod(local, PageCycle.DAY_SECONDS.toLong()).toInt()
        val minute = localMinute.format(LocalDateTime.ofEpochSecond(local, 0, ZoneOffset.UTC))
        val changes = mutableListOf(horizon)
        fun changeAt(localSecondOfDay: Int) {
            changes += instantOf(zone, now, local, local - secondOfDay + localSecondOfDay)
        }
        val position = PageCycle.pageAt(layout.pages.map { it.durationSeconds }, secondOfDay)
        if (position != null) changeAt(position.endsAt)

        fun shown(area: Area, view: View, entries: List<Pair<String, String?>>): AreaPlan {
            val catalog = layout.catalogs.getValue(view.catalogId)
            val money = view.fields.map { it.fieldId }.filter { catalog.fields[it]?.type == "money" }.distinct()
            val records = entries.map { (recordId, group) ->
                val facts = catalog.prices[recordId].orEmpty()
                ShownRecord(
                    catalog.records.getValue(recordId),
                    group,
                    money.mapNotNull { fieldId ->
                        facts[fieldId]?.let { fact ->
                            Prices.nextChange(fact, minute)?.let { next ->
                                localSeconds(next)?.let { changes += instantOf(zone, now, local, it) }
                            }
                            fieldId to Prices.effective(fact, branchId, minute)
                        }
                    }.toMap(),
                )
            }
            return AreaPlan.Catalog(area, view, records)
        }

        val areas = layout.areas.map { area ->
            val segment = segment(active, area.key, zone, now, horizon) ?: return null
            changes += segment.end
            val content = position?.let { layout.pages[it.page].contents[area.key] }
            val view = area.view
            when {
                // A regional schedule overrides the area only while it lasts.
                segment.source is SegmentSource.Rule ->
                    playlistOf(active, segment)?.takeIf { it.items.isNotEmpty() }
                        ?.let { AreaPlan.Play(area, it) } ?: AreaPlan.Empty(area)
                content is PageContent.Media -> AreaPlan.Still(area, active.media.getValue(content.mediaId))
                content is PageContent.ViewPage && view != null ->
                    shown(area, view, view.pages[content.index].map { it.recordId to it.group })
                content is PageContent.Group && view != null ->
                    shown(area, view, view.groups.getValue(content.group).map { it to content.group })
                area.kind == AreaKind.CATALOG && view != null && active.outputs[area.key]?.default == OutputDefault.View -> {
                    val page = PageCycle.pageAt(List(view.pages.size) { view.pageSeconds }, secondOfDay)
                    if (page == null) {
                        shown(area, view, emptyList())
                    } else {
                        changeAt(page.endsAt)
                        shown(area, view, view.pages[page.page].map { it.recordId to it.group })
                    }
                }
                else ->
                    playlistOf(active, segment)?.takeIf { it.items.isNotEmpty() }
                        ?.let { AreaPlan.Play(area, it) } ?: AreaPlan.Empty(area)
            }
        }
        return Plan.Compose(active, areas, changes.min())
    }

    /** Local epoch seconds of a local minute `YYYY-MM-DDTHH:MM`. */
    private fun localSeconds(value: String): Long? = try {
        LocalDateTime.parse(value, localMinute).toEpochSecond(ZoneOffset.UTC)
    } catch (_: java.time.format.DateTimeParseException) {
        null
    }

    /**
     * The instant of a later local wall-clock second. Without an offset
     * change in between it is plain arithmetic; across one, the zone
     * resolves it as the start of a rule would be resolved.
     */
    private fun instantOf(zone: ZoneOffsets, now: Instant, local: Long, target: Long): Instant {
        val plain = Instant.ofEpochSecond(now.epochSecond + (target - local))
        if (zone.offsetAt(plain) == zone.offsetAt(now)) return plain
        val resolved = zone.resolve(target, Boundary.START)?.instant
        return if (resolved != null && resolved > now) resolved else plain
    }
}
