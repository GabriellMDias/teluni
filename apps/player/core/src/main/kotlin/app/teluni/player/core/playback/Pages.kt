package app.teluni.player.core.playback

/** The page a cycle shows, with the local seconds of the day it started and ends. */
public data class PagePosition(val page: Int, val startsAt: Int, val endsAt: Int)

/**
 * The coordinated page cycle of the catalog and composition design, ported
 * from the API (`pageAt` in apps/api/src/features/programming/layouts.ts)
 * and checked against the conformance file's page cycles.
 */
public object PageCycle {
    public const val DAY_SECONDS: Int = 86_400

    /**
     * The page a cycle of durations (seconds) shows at a local time of day
     * (seconds since local midnight, by the wall clock). The cycle restarts
     * at every local midnight, so every screen of a group shows the same
     * page at the same local time; the day's last cycle may end early.
     * Null without pages.
     */
    public fun pageAt(durations: List<Int>, secondOfDay: Int): PagePosition? {
        val total = durations.sumOf { it.toLong() }
        if (durations.isEmpty() || total <= 0) return null
        val second = secondOfDay.coerceIn(0, DAY_SECONDS - 1).toLong()
        var start = second / total * total
        durations.forEachIndexed { page, seconds ->
            val end = start + seconds
            if (second < end) return PagePosition(page, start.toInt(), minOf(end, DAY_SECONDS.toLong()).toInt())
            start = end
        }
        error("A page cycle position was not found")
    }
}
