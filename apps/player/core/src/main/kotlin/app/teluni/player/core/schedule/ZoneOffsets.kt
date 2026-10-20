package app.teluni.player.core.schedule

import java.time.Instant

public enum class Boundary { START, END }

public enum class Resolution { GAP, REPEATED }

/** A local boundary resolved to an instant; `resolution` is null when it was unique. */
public data class Resolved(val instant: Instant, val resolution: Resolution?)

/**
 * The UTC offsets of a screen's zone as the sync response gives them (player
 * design, "Trusted time and zone offsets"): the offset from the first
 * period's start, then one period per transition, up to `until`. The player
 * resolves local times only against these, never against the device's own
 * time zone data, so it agrees with the server's preview.
 */
public class ZoneOffsets(periods: List<Period>, public val until: Instant) {
    public data class Period(val from: Instant, val offsetSeconds: Int)

    public val periods: List<Period> = periods.toList()

    init {
        require(this.periods.isNotEmpty()) { "Zone offsets need at least one period" }
        require(this.periods.zipWithNext().all { (a, b) -> a.from < b.from }) { "Periods must be in order" }
        require(this.periods.last().from < until) { "The last period must start before the end" }
        require(this.periods.all { it.offsetSeconds in -MAX_OFFSET..MAX_OFFSET }) { "Offset out of range" }
    }

    /** Whether the offsets describe an instant. */
    public fun covers(instant: Instant): Boolean = instant >= periods.first().from && instant < until

    /** The offset in force at an instant, or null outside the covered range. */
    public fun offsetAt(instant: Instant): Int? {
        if (!covers(instant)) return null
        return periods.last { it.from <= instant }.offsetSeconds
    }

    /**
     * Resolves a local time, given in seconds since 1970-01-01T00:00 local:
     * a gap gives the transition instant, a repeated time the earlier
     * occurrence for a start and the later for an end. Null when the answer
     * depends on instants these offsets do not cover.
     */
    public fun resolve(localSeconds: Long, boundary: Boundary): Resolved? {
        val matches = mutableListOf<Instant>()
        for (offset in periods.map { it.offsetSeconds }.distinct()) {
            val instant = Instant.ofEpochSecond(localSeconds - offset)
            val actual = offsetAt(instant) ?: return null
            if (actual == offset) matches += instant
        }
        val distinct = matches.distinct().sorted()
        return when {
            distinct.size == 1 -> Resolved(distinct.single(), null)
            distinct.size > 1 -> Resolved(
                if (boundary == Boundary.START) distinct.first() else distinct.last(),
                Resolution.REPEATED,
            )
            else -> gap(localSeconds)
        }
    }

    private fun gap(localSeconds: Long): Resolved? {
        for ((before, after) in periods.zipWithNext()) {
            val transition = after.from.epochSecond
            if (after.offsetSeconds > before.offsetSeconds &&
                localSeconds >= transition + before.offsetSeconds &&
                localSeconds < transition + after.offsetSeconds
            ) {
                return Resolved(after.from, Resolution.GAP)
            }
        }
        return null
    }

    private companion object {
        const val MAX_OFFSET = 86_400
    }
}
