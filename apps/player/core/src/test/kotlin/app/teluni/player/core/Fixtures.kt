package app.teluni.player.core

import app.teluni.player.core.schedule.ZoneOffsets
import java.io.File
import java.time.Instant
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/** The repository's shared fixtures, located by the Gradle test task. */
object Fixtures {
    val schedule: JsonObject by lazy { read("teluni.scheduleFixtures") }
    val conformance: JsonObject by lazy { read("teluni.conformance") }
    val openApi: JsonObject by lazy { read("teluni.openapi") }

    private fun read(property: String): JsonObject {
        val path = requireNotNull(System.getProperty(property)) { "Run the tests through Gradle" }
        return Json.parseToJsonElement(File(path).readText()).jsonObject
    }
}

val JsonElement.string: String get() = jsonPrimitive.content

fun zoneOffsetsOf(element: JsonElement): ZoneOffsets {
    val value = element.jsonObject
    return ZoneOffsets(
        value.getValue("periods").jsonArray.map {
            ZoneOffsets.Period(
                Instant.parse(it.jsonObject.getValue("from").string),
                it.jsonObject.getValue("offsetSeconds").jsonPrimitive.int,
            )
        },
        Instant.parse(value.getValue("until").string),
    )
}
