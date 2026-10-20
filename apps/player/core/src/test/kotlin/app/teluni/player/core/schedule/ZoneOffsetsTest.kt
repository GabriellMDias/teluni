package app.teluni.player.core.schedule

import app.teluni.player.core.Fixtures
import app.teluni.player.core.string
import app.teluni.player.core.zoneOffsetsOf
import java.time.Instant
import java.time.LocalDateTime
import java.time.ZoneOffset
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject

class ZoneOffsetsTest {
    private fun localSeconds(value: String) =
        LocalDateTime.parse(value).toEpochSecond(ZoneOffset.UTC)

    @Test
    fun `resolves local times exactly as the API does`() {
        val zones = Fixtures.conformance.getValue("zones").jsonArray
        assertEquals(4, zones.size)
        for (element in zones) {
            val zone = element.jsonObject
            val offsets = zoneOffsetsOf(zone.getValue("offsets"))
            for (item in zone.getValue("resolutions").jsonArray) {
                val case = item.jsonObject
                val boundary = Boundary.valueOf(case.getValue("boundary").string.uppercase())
                val resolved = offsets.resolve(localSeconds(case.getValue("local").string), boundary)
                val label = "${zone.getValue("timeZone").string} ${case.getValue("local").string} $boundary"
                assertEquals(Instant.parse(case.getValue("instant").string), resolved?.instant, label)
                assertEquals(
                    case.getValue("resolution").takeUnless { it is JsonNull }?.string,
                    resolved?.resolution?.name?.lowercase(),
                    label,
                )
            }
        }
    }

    @Test
    fun `gives offsets only inside the covered range`() {
        val offsets = ZoneOffsets(
            listOf(
                ZoneOffsets.Period(Instant.parse("2027-03-12T00:00:00Z"), -18_000),
                ZoneOffsets.Period(Instant.parse("2027-03-14T07:00:00Z"), -14_400),
            ),
            Instant.parse("2027-04-16T00:00:00Z"),
        )
        assertNull(offsets.offsetAt(Instant.parse("2027-03-11T23:59:59Z")))
        assertEquals(-18_000, offsets.offsetAt(Instant.parse("2027-03-14T06:59:59Z")))
        assertEquals(-14_400, offsets.offsetAt(Instant.parse("2027-03-14T07:00:00Z")))
        assertNull(offsets.offsetAt(Instant.parse("2027-04-16T00:00:00Z")))
        // A local time whose candidates fall outside the range has no answer.
        assertNull(offsets.resolve(localSeconds("2027-03-11T18:00"), Boundary.START))
    }

    @Test
    fun `refuses malformed offsets`() {
        val start = Instant.parse("2027-01-01T00:00:00Z")
        assertFailsWith<IllegalArgumentException> { ZoneOffsets(emptyList(), start) }
        assertFailsWith<IllegalArgumentException> {
            ZoneOffsets(listOf(ZoneOffsets.Period(start, 0), ZoneOffsets.Period(start, 3600)), start.plusSeconds(60))
        }
        assertFailsWith<IllegalArgumentException> { ZoneOffsets(listOf(ZoneOffsets.Period(start, 0)), start) }
        assertFailsWith<IllegalArgumentException> {
            ZoneOffsets(listOf(ZoneOffsets.Period(start, 90_000)), start.plusSeconds(60))
        }
    }
}
