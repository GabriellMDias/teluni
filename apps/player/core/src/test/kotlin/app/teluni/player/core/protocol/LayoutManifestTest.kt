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

class LayoutManifestTest {
    private val fixture = Fixtures.conformance.getValue("layoutManifest").jsonObject
    private val bytes = fixture.getValue("bytes").string.encodeToByteArray()
    private val sha256 = fixture.getValue("sha256").string

    @Test
    fun `parses the API's protocol 2 manifest`() {
        assertEquals(sha256, sha256Hex(bytes))
        val publication = ManifestParser.parse(bytes, sha256)
        assertEquals(2, publication.header.protocol)
        val layout = requireNotNull(publication.layout)
        assertEquals(listOf("video", "menu"), layout.areas.map { it.key })
        assertEquals(listOf(AreaKind.MEDIA, AreaKind.CATALOG), layout.areas.map { it.kind })
        // Areas come back to front, whatever their order in the manifest.
        val swapped = parsed()
            .at(listOf("layout", "areas", 0, "z")) { JsonPrimitive(2) }
            .toString().encodeToByteArray()
        assertEquals(
            listOf("menu", "video"),
            ManifestParser.parse(swapped, sha256Hex(swapped)).layout?.areas?.map { it.key },
        )
        assertEquals(listOf(15, 45), layout.pages.map { it.durationSeconds })
        assertEquals(publication.media.keys.sorted(), layout.pages.map { (it.contents.getValue("video") as PageContent.Media).mediaId })

        val video = publication.outputs.getValue("video")
        assertEquals(OutputDefault.None, video.default)
        assertEquals(listOf("r1"), video.rules.map { it.id })
        assertEquals(OutputDefault.View, publication.outputs.getValue("menu").default)

        val view = requireNotNull(layout.areas[1].view)
        assertEquals(false, view.showUnavailable)
        assertEquals(1, view.pages.size)
        val catalog = layout.catalogs.getValue(view.catalogId)
        assertEquals(3, catalog.records.size)
        assertEquals(view.pages[0].map { it.recordId }.toSet(), catalog.records.keys)
        val prices = catalog.prices.values.flatMap { it.values }
        assertEquals(listOf(500L, 750L, null), catalog.records.keys.map { catalog.prices[it]?.values?.single()?.base })
        assertEquals(1, prices.sumOf { it.overrides.size })
        assertEquals(1, prices.sumOf { it.promotions.size })
    }

    private fun parsed(): JsonObject = Json.parseToJsonElement(bytes.decodeToString()).jsonObject

    /** Replaces the element at a path of object keys and array indexes. */
    private fun JsonElement.at(path: List<Any>, change: (JsonElement) -> JsonElement): JsonElement {
        if (path.isEmpty()) return change(this)
        return when (val key = path.first()) {
            is String -> JsonObject(jsonObject.toMutableMap().also { it[key] = it.getValue(key).at(path.drop(1), change) })
            is Int -> JsonArray(jsonArray.toMutableList().also { it[key] = it[key].at(path.drop(1), change) })
            else -> error("Unknown path segment")
        }
    }

    private fun parseEdited(vararg path: Any, change: (JsonElement) -> JsonElement) {
        val edited = parsed().at(path.toList(), change).toString().encodeToByteArray()
        ManifestParser.parse(edited, sha256Hex(edited))
    }

    private fun set(vararg path: Any, value: JsonElement) = parseEdited(*path) { value }

    private fun put(vararg path: Any, key: String, value: JsonElement) =
        parseEdited(*path) { JsonObject(it.jsonObject + (key to value)) }

    private fun assertFailure(code: StagingFailureCode, block: () -> Unit) {
        assertEquals(code, assertFailsWith<StagingFailure> { block() }.code)
    }

    @Test
    fun `refuses layouts that do not hold together`() {
        val invalid = StagingFailureCode.INVALID_MANIFEST
        // Unknown fields, areas outside the canvas, duplicate stacking and mixed audio.
        assertFailure(invalid) { put("layout", key = "extra", value = JsonPrimitive(1)) }
        assertFailure(invalid) { set("layout", "areas", 1, "width", value = JsonPrimitive(700)) }
        assertFailure(invalid) { set("layout", "areas", 1, "z", value = JsonPrimitive(0)) }
        fun unmuted(volume: Int) = parseEdited("layout") { layout ->
            layout
                .at(listOf("areas", 0, "muted")) { JsonPrimitive(false) }
                .at(listOf("areas", 1, "muted")) { JsonPrimitive(false) }
                .at(listOf("areas", 1, "volume")) { JsonPrimitive(volume) }
        }
        assertFailure(invalid) { unmuted(volume = 40) }
        // An unmuted area at volume 0 is silent, so nothing mixes.
        unmuted(volume = 0)
        // Pages must name what each page-controlled area shows, from the manifest.
        assertFailure(invalid) { set("layout", "pages", 0, "contents", value = JsonArray(emptyList())) }
        assertFailure(invalid) { set("layout", "pages", 0, "contents", 0, "mediaId", value = JsonPrimitive("missing")) }
        assertFailure(invalid) { parseEdited("layout", "pages") { JsonArray(it.jsonArray.take(1)) } }
        // Views list only their catalog's records.
        assertFailure(invalid) { set("layout", "areas", 1, "view", "pages", 0, 0, "recordId", value = JsonPrimitive("missing")) }
        assertFailure(invalid) { set("layout", "areas", 1, "view", "catalogId", value = JsonPrimitive("missing")) }
        val view = parsed().getValue("layout").jsonObject.getValue("areas").jsonArray[1].jsonObject.getValue("view")
        assertFailure(invalid) { set("layout", "areas", 0, "view", value = view) }
    }

    @Test
    fun `refuses outputs and catalogs that do not match the layout`() {
        val invalid = StagingFailureCode.INVALID_MANIFEST
        assertFailure(invalid) { parseEdited("outputs") { JsonArray(it.jsonArray.reversed()) } }
        assertFailure(invalid) { set("outputs", 1, "default", value = JsonNull) }
        assertFailure(invalid) {
            set("outputs", 0, "default", value = JsonObject(mapOf("playlistId" to JsonPrimitive("missing"))))
        }
        assertFailure(invalid) { set("catalogs", 0, "fields", 0, "type", value = JsonPrimitive("formula")) }
        val priceId = parsed().getValue("catalogs").jsonArray[0].jsonObject.getValue("fields").jsonArray[1].jsonObject.getValue("id")
        assertFailure(invalid) {
            parseEdited("catalogs", 0, "records", 0, "values") { JsonObject(it.jsonObject + (priceId.string to JsonPrimitive(1))) }
        }
        assertFailure(invalid) { set("catalogs", 0, "prices", 0, "base", value = JsonPrimitive(-1)) }
        assertFailure(invalid) { set("catalogs", 0, "prices", 2, "promotions", 0, "endsAt", value = JsonPrimitive("2026-10-26T07:00")) }
    }

    @Test
    fun `reports what this player cannot show as incompatible`() {
        val fade = JsonObject(mapOf("kind" to JsonPrimitive("FADE"), "durationMs" to JsonPrimitive(500)))
        assertFailure(StagingFailureCode.INCOMPATIBLE) { set("playlists", 0, "transition", value = fade) }
        assertFailure(StagingFailureCode.INCOMPATIBLE) { set("protocol", value = JsonPrimitive(3)) }
    }
}
