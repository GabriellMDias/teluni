package app.teluni.player.core.schedule

import java.time.Instant
import java.time.LocalDateTime
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter

public sealed interface SegmentSource {
    public data class Rule(val ruleId: String, val playlistId: String) : SegmentSource

    public data class Default(val playlistId: String) : SegmentSource

    public data object None : SegmentSource
}

public data class Segment(val start: Instant, val end: Instant, val source: SegmentSource)

public data class ResolutionNote(
    val ruleId: String,
    val boundary: Boundary,
    val resolution: Resolution,
    /** The rule's local wall-clock boundary, `YYYY-MM-DDTHH:MM`. */
    val local: String,
    val instant: Instant,
)

public data class Timeline(val segments: List<Segment>, val notes: List<ResolutionNote>)

public class TimelineTooLarge : RuntimeException("The timeline has more segments than allowed")

/**
 * The evaluator of the programming design, ported from the API: the ordered,
 * non-overlapping segments covering [from, to) for one output, with rule
 * windows, then the default playlist or neutral output in between. A
 * window's end never passes the next window's start (the handoff clip).
 */
public object ScheduleEvaluator {
    private val localFormat = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm")

    private class Window(
        val rule: ScheduleRule,
        val order: Int,
        val start: Instant,
        var end: Instant,
        val notes: List<ResolutionNote>,
    )

    /**
     * Evaluates valid rules (see [ruleIssue]). Returns null when the zone
     * offsets do not cover every instant the evaluation needs; the caller
     * then has no business time.
     */
    public fun evaluate(
        rules: List<ScheduleRule>,
        defaultPlaylistId: String?,
        zone: ZoneOffsets,
        from: Instant,
        to: Instant,
        maxSegments: Int,
    ): Timeline? {
        if (from >= to) return Timeline(emptyList(), emptyList())
        val firstDay = localDay(zone, from)?.minus(1) ?: return null
        val lastDay = localDay(zone, to) ?: return null
        val windows = mutableListOf<Window>()
        rules.forEachIndexed { order, rule ->
            for (day in firstDay..lastDay) {
                val local = windowOn(rule, day) ?: continue
                val notes = mutableListOf<ResolutionNote>()
                val start = resolve(zone, rule, local.start, Boundary.START, notes) ?: return null
                val end = resolve(zone, rule, local.end, Boundary.END, notes) ?: return null
                if (start < end) windows += Window(rule, order, start, end, notes)
            }
        }
        windows.sortWith(compareBy<Window> { it.start }.thenBy { it.order })
        for (i in 0 until windows.size - 1) {
            if (windows[i].end > windows[i + 1].start) windows[i].end = windows[i + 1].start
        }

        val segments = mutableListOf<Segment>()
        val notes = mutableListOf<ResolutionNote>()
        fun push(start: Instant, end: Instant, source: SegmentSource) {
            if (start >= end) return
            if (segments.size >= maxSegments) throw TimelineTooLarge()
            segments += Segment(start, end, source)
        }
        val fill: SegmentSource =
            defaultPlaylistId?.let { SegmentSource.Default(it) } ?: SegmentSource.None
        var cursor = from
        for (window in windows) {
            if (window.end <= window.start) continue
            if (window.end <= from) continue
            if (window.start >= to) break
            val start = if (window.start > cursor) window.start else cursor
            val end = if (window.end < to) window.end else to
            push(cursor, start, fill)
            push(start, end, SegmentSource.Rule(window.rule.id, window.rule.playlistId))
            notes += window.notes
            cursor = end
        }
        push(cursor, to, fill)
        return Timeline(segments, notes)
    }

    private fun localDay(zone: ZoneOffsets, instant: Instant): Long? {
        val offset = zone.offsetAt(instant) ?: return null
        return Math.floorDiv(instant.epochSecond + offset, SECONDS_PER_DAY)
    }

    private fun resolve(
        zone: ZoneOffsets,
        rule: ScheduleRule,
        localMinute: Long,
        boundary: Boundary,
        notes: MutableList<ResolutionNote>,
    ): Instant? {
        val resolved = zone.resolve(localMinute * 60, boundary) ?: return null
        val resolution = resolved.resolution
        if (resolution != null) {
            val local = LocalDateTime.ofEpochSecond(localMinute * 60, 0, ZoneOffset.UTC)
            notes += ResolutionNote(rule.id, boundary, resolution, localFormat.format(local), resolved.instant)
        }
        return resolved.instant
    }
}
