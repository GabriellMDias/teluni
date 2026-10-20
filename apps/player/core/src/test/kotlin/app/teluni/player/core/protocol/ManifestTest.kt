package app.teluni.player.core.protocol

import app.teluni.player.core.Fixtures
import app.teluni.player.core.string
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject

class ManifestTest {
    private val fixture = Fixtures.conformance.getValue("manifest").jsonObject
    private val bytes = fixture.getValue("bytes").string.encodeToByteArray()
    private val sha256 = fixture.getValue("sha256").string

    @Test
    fun `parses the API's protocol 1 manifest`() {
        assertEquals(sha256, sha256Hex(bytes))
        val publication = ManifestParser.parse(bytes, sha256)
        assertEquals(1, publication.header.protocol)
        assertEquals(3, publication.header.generation)
        val output = publication.outputs.getValue(ManifestParser.OUTPUT)
        assertEquals(listOf("r1", "r2", "r3"), output.rules.map { it.id })
        assertEquals(480, output.rules[0].startMinute)
        assertEquals(120, output.rules[1].endMinute)
        assertEquals(null, output.rules[2].startMinute)
        assertEquals(2, publication.playlists.size)
        assertEquals(setOf("IMAGE", "VIDEO"), publication.media.values.map { it.kind }.toSet())
        assertEquals(publication.playlists.keys.max(), output.defaultPlaylistId)
        assertEquals(null, publication.layout)
    }

    @Test
    fun `refuses bytes that do not match the expected SHA-256`() {
        assertFailure(StagingFailureCode.INTEGRITY_FAILED) { ManifestParser.parse(bytes, "0".repeat(64)) }
    }

    private fun parsed(): JsonObject = Json.parseToJsonElement(bytes.decodeToString()).jsonObject

    private fun edit(change: (MutableMap<String, JsonElement>) -> Unit): ByteArray {
        val value = parsed().toMutableMap()
        change(value)
        return JsonObject(value).toString().encodeToByteArray()
    }

    private fun parseEdited(change: (MutableMap<String, JsonElement>) -> Unit) {
        val edited = edit(change)
        ManifestParser.parse(edited, sha256Hex(edited))
    }

    private fun assertFailure(code: StagingFailureCode, block: () -> Unit) {
        assertEquals(code, assertFailsWith<StagingFailure> { block() }.code)
    }

    private fun MutableMap<String, JsonElement>.editArray(key: String, index: Int, change: (MutableMap<String, JsonElement>) -> Unit) {
        val items = getValue(key).jsonArray.toMutableList()
        val item = items[index].jsonObject.toMutableMap()
        change(item)
        items[index] = JsonObject(item)
        this[key] = JsonArray(items)
    }

    @Test
    fun `refuses unknown fields, protocols and formats`() {
        assertFailure(StagingFailureCode.INVALID_MANIFEST) { parseEdited { it["extra"] = JsonPrimitive(1) } }
        assertFailure(StagingFailureCode.INCOMPATIBLE) { parseEdited { it["protocol"] = JsonPrimitive(3) } }
        // A protocol 1 body that claims protocol 2 does not match protocol 2.
        assertFailure(StagingFailureCode.INVALID_MANIFEST) { parseEdited { it["protocol"] = JsonPrimitive(2) } }
        assertFailure(StagingFailureCode.INVALID_MANIFEST) { parseEdited { it["format"] = JsonPrimitive("other") } }
        assertFailure(StagingFailureCode.INVALID_MANIFEST) { parseEdited { it.remove("media") } }
        assertFailure(StagingFailureCode.INVALID_MANIFEST) {
            val broken = byteArrayOf(0xC3.toByte(), 0x28)
            ManifestParser.parse(broken, sha256Hex(broken))
        }
    }

    @Test
    fun `refuses what this player cannot play`() {
        assertFailure(StagingFailureCode.INCOMPATIBLE) {
            parseEdited {
                it.editArray("playlists", 0) { playlist ->
                    playlist["transition"] = JsonObject(mapOf("kind" to JsonPrimitive("FADE"), "durationMs" to JsonPrimitive(500)))
                }
            }
        }
        assertFailure(StagingFailureCode.INCOMPATIBLE) {
            parseEdited { it.editArray("media", 0) { media -> media["contentType"] = JsonPrimitive("image/webp") } }
        }
        assertFailure(StagingFailureCode.INCOMPATIBLE) {
            parseEdited { it.editArray("outputs", 0) { output -> output["key"] = JsonPrimitive("area-1") } }
        }
    }

    @Test
    fun `refuses inconsistent content`() {
        assertFailure(StagingFailureCode.INVALID_MANIFEST) {
            parseEdited {
                it.editArray("outputs", 0) { output ->
                    val rules = output.getValue("rules").jsonArray.toMutableList()
                    val rule = rules[0].jsonObject.toMutableMap()
                    rule["endTime"] = rule.getValue("startTime")
                    rules[0] = JsonObject(rule)
                    output["rules"] = JsonArray(rules)
                }
            }
        }
        assertFailure(StagingFailureCode.INVALID_MANIFEST) {
            parseEdited { it.editArray("outputs", 0) { output -> output["defaultPlaylistId"] = JsonPrimitive("missing") } }
        }
        assertFailure(StagingFailureCode.INVALID_MANIFEST) {
            parseEdited {
                it.editArray("playlists", 1) { playlist ->
                    val items = playlist.getValue("items").jsonArray.toMutableList()
                    items[0] = JsonObject(items[0].jsonObject + ("durationMs" to JsonNull))
                    playlist["items"] = JsonArray(items)
                }
            }
        }
        assertFailure(StagingFailureCode.INVALID_MANIFEST) {
            parseEdited { it.editArray("media", 0) { media -> media["sha256"] = JsonPrimitive("ABC") } }
        }
    }

    @Test
    fun `accepts an empty playlist, which shows neutral output`() {
        val edited = edit {
            it.editArray("playlists", 1) { playlist -> playlist["items"] = JsonArray(emptyList()) }
        }
        val publication = ManifestParser.parse(edited, sha256Hex(edited))
        val default = publication.outputs.getValue(ManifestParser.OUTPUT).defaultPlaylistId!!
        assertEquals(0, publication.playlists.getValue(default).items.size)
    }
}
