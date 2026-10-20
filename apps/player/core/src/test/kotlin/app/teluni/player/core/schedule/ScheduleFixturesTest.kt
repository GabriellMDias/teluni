package app.teluni.player.core.schedule

import app.teluni.player.core.Fixtures
import app.teluni.player.core.string
import app.teluni.player.core.zoneOffsetsOf
import java.time.Instant
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.jupiter.api.DynamicTest
import org.junit.jupiter.api.TestFactory

/**
 * The canonical schedule fixtures the API's evaluator also runs, evaluated
 * with the zone offsets the API computes for each case (conformance file),
 * exactly as a screen would receive them.
 */
class ScheduleFixturesTest {
    private fun rule(element: JsonElement): ScheduleRule {
        val value = element.jsonObject
        val text = { key: String -> value[key]?.takeUnless { it is JsonNull }?.string }
        return ScheduleRule(
            id = value.getValue("id").string,
            playlistId = value.getValue("playlistId").string,
            weekdays = value.getValue("weekdays").jsonArray.map { it.jsonPrimitive.int },
            allDay = value.getValue("allDay").jsonPrimitive.boolean,
            startMinute = text("startTime")?.let(::parseTime),
            endMinute = text("endTime")?.let(::parseTime),
            startsOn = value.getValue("startsOn").string,
            endsOn = text("endsOn"),
        )
    }

    private fun sourceName(source: SegmentSource) = when (source) {
        is SegmentSource.Rule -> "rule:${source.ruleId}"
        is SegmentSource.Default -> "default"
        SegmentSource.None -> "none"
    }

    @TestFactory
    fun timelines(): List<DynamicTest> {
        val offsets = Fixtures.conformance.getValue("scheduleOffsets").jsonObject
        val timelines = Fixtures.schedule.getValue("timelines").jsonArray
        assertEquals(timelines.map { it.jsonObject.getValue("id").string }.toSet(), offsets.keys)
        return timelines.map { element ->
            val case = element.jsonObject
            val id = case.getValue("id").string
            DynamicTest.dynamicTest(id) {
                val timeline = ScheduleEvaluator.evaluate(
                    case.getValue("rules").jsonArray.map(::rule),
                    case["defaultPlaylistId"]?.takeUnless { it is JsonNull }?.string,
                    zoneOffsetsOf(offsets.getValue(id)),
                    Instant.parse(case.getValue("from").string),
                    Instant.parse(case.getValue("to").string),
                    2000,
                )
                assertNotNull(timeline, "the offsets must cover $id")
                val expect = case.getValue("expect").jsonObject
                assertEquals(
                    expect.getValue("segments").jsonArray.map {
                        val segment = it.jsonObject
                        Triple(segment.getValue("start").string, segment.getValue("end").string, segment.getValue("source").string)
                    },
                    timeline.segments.map { Triple(it.start.toString(), it.end.toString(), sourceName(it.source)) },
                )
                assertEquals(
                    expect.getValue("notes").jsonArray.map {
                        val note = it.jsonObject
                        listOf("ruleId", "boundary", "resolution", "local", "instant").map { key -> note.getValue(key).string }
                    },
                    timeline.notes.map {
                        listOf(
                            it.ruleId,
                            it.boundary.name.lowercase(),
                            it.resolution.name.lowercase(),
                            it.local,
                            it.instant.toString(),
                        )
                    },
                )
            }
        }
    }

    @TestFactory
    fun validation(): List<DynamicTest> =
        Fixtures.schedule.getValue("validation").jsonArray.map { element ->
            val case = element.jsonObject
            DynamicTest.dynamicTest(case.getValue("id").string) {
                val rules = case.getValue("rules").jsonArray.map(::rule)
                assertEquals(
                    case.getValue("issues").jsonArray.map {
                        it.jsonObject.getValue("ruleId").string to it.jsonObject.getValue("issue").string
                    },
                    rules.mapNotNull { rule -> ruleIssue(rule)?.let { rule.id to it.name.lowercase() } },
                )
            }
        }

    @Test
    fun `parses dates, weekdays and times strictly`() {
        assertNull(epochDay("1970-01-02"))
        assertNull(epochDay("2027-02-29"))
        assertNull(epochDay("2027-1-04"))
        assertEquals(1, isoWeekday(epochDay("2027-01-04")!!))
        assertEquals(7, isoWeekday(epochDay("2027-01-10")!!))
        assertEquals(1439, parseTime("23:59"))
        assertNull(parseTime("24:00"))
        assertNull(parseTime("7:00"))
    }

    @Test
    fun `answers nothing when the offsets do not cover the range`() {
        val zone = ZoneOffsets(
            listOf(ZoneOffsets.Period(Instant.parse("2027-01-04T00:00:00Z"), -10_800)),
            Instant.parse("2027-01-07T00:00:00Z"),
        )
        val rules = listOf(ScheduleRule("r1", "p", listOf(1, 2, 3, 4, 5, 6, 7), true, null, null, "2027-01-01", null))
        // The evaluator reads the day before the range, which these offsets miss.
        assertNull(
            ScheduleEvaluator.evaluate(
                rules,
                null,
                zone,
                Instant.parse("2027-01-04T12:00:00Z"),
                Instant.parse("2027-01-05T00:00:00Z"),
                10,
            ),
        )
        val inside = ScheduleEvaluator.evaluate(
            rules,
            null,
            zone,
            Instant.parse("2027-01-05T12:00:00Z"),
            Instant.parse("2027-01-05T18:00:00Z"),
            10,
        )
        assertNotNull(inside)
        assertTrue(inside.segments.single().source is SegmentSource.Rule)
    }
}
