package app.teluni.player.core.schedule

import java.time.DateTimeException
import java.time.LocalDate

// Local calendar values and rule validation, ported from the API's
// schedule evaluator (apps/api/src/features/programming/schedule.ts) and
// checked against the same shared fixtures. Nothing here reads a clock or a
// time zone: local values are plain numbers.

internal const val MINUTES_PER_DAY = 1440
internal const val SECONDS_PER_DAY = 86_400L

private val datePattern = Regex("""(\d{4})-(\d{2})-(\d{2})""")
private val timePattern = Regex("""([01]\d|2[0-3]):([0-5]\d)""")

/** Days since 1970-01-01 of an ISO date between 2000 and 2200, or null. */
public fun epochDay(value: String): Long? {
    val match = datePattern.matchEntire(value) ?: return null
    val (year, month, day) = match.destructured
    if (year.toInt() !in 2000..2200) return null
    return try {
        LocalDate.of(year.toInt(), month.toInt(), day.toInt()).toEpochDay()
    } catch (_: DateTimeException) {
        null
    }
}

/** ISO weekday of a day number, Monday 1 to Sunday 7; 1970-01-01 was a Thursday. */
public fun isoWeekday(day: Long): Int = (Math.floorMod(day + 3, 7L) + 1).toInt()

/** Minute of the day of `HH:MM`, or null. */
public fun parseTime(value: String): Int? {
    val match = timePattern.matchEntire(value) ?: return null
    val (hours, minutes) = match.destructured
    return hours.toInt() * 60 + minutes.toInt()
}

/** A schedule rule in local values; dates are ISO `YYYY-MM-DD`. */
public data class ScheduleRule(
    val id: String,
    val playlistId: String,
    /** ISO weekdays on which a window starts, Monday 1 to Sunday 7. */
    val weekdays: List<Int>,
    val allDay: Boolean,
    /** Minute of the local day; null when the rule is all-day. */
    val startMinute: Int?,
    /** Minute of the local day; earlier than the start ends on the next day. */
    val endMinute: Int?,
    val startsOn: String,
    val endsOn: String?,
)

public enum class RuleIssue { INVALID, TIMES_EQUAL }

/** What is wrong with a rule's own fields, if anything. */
public fun ruleIssue(rule: ScheduleRule): RuleIssue? {
    val weekdays = rule.weekdays.toSet()
    if (weekdays.isEmpty() || weekdays.size != rule.weekdays.size || weekdays.any { it !in 1..7 }) {
        return RuleIssue.INVALID
    }
    val startsOn = epochDay(rule.startsOn) ?: return RuleIssue.INVALID
    val endsOn = rule.endsOn?.let { epochDay(it) ?: return RuleIssue.INVALID }
    if (endsOn != null && endsOn < startsOn) return RuleIssue.INVALID
    if (rule.allDay) {
        return if (rule.startMinute == null && rule.endMinute == null) null else RuleIssue.INVALID
    }
    val start = rule.startMinute
    val end = rule.endMinute
    if (start == null || end == null || start !in 0 until MINUTES_PER_DAY || end !in 0 until MINUTES_PER_DAY) {
        return RuleIssue.INVALID
    }
    return if (start == end) RuleIssue.TIMES_EQUAL else null
}

/** A window in local minutes since 1970-01-01, end exclusive. */
internal data class LocalWindow(val start: Long, val end: Long)

/** The window a valid rule starts on a local day, with the final-date clip. */
internal fun windowOn(rule: ScheduleRule, day: Long): LocalWindow? {
    val startsOn = requireNotNull(epochDay(rule.startsOn))
    val endsOn = rule.endsOn?.let { requireNotNull(epochDay(it)) }
    if (day < startsOn || (endsOn != null && day > endsOn)) return null
    if (isoWeekday(day) !in rule.weekdays) return null
    val base = day * MINUTES_PER_DAY
    val start: Long
    var end: Long
    if (rule.allDay) {
        start = base
        end = base + MINUTES_PER_DAY
    } else {
        val startMinute = requireNotNull(rule.startMinute)
        val endMinute = requireNotNull(rule.endMinute)
        start = base + startMinute
        end = if (endMinute > startMinute) base + endMinute else base + MINUTES_PER_DAY + endMinute
    }
    if (endsOn != null) end = minOf(end, (endsOn + 1) * MINUTES_PER_DAY)
    return LocalWindow(start, end)
}
