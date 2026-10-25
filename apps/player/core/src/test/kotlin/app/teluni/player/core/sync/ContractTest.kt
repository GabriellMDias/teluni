package app.teluni.player.core.sync

import app.teluni.player.core.Fixtures
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlinx.serialization.KSerializer
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject

/**
 * The player's wire models against the API's generated OpenAPI document:
 * every field name of the device operations the player uses, so a renamed
 * or added field fails here before a screen meets it.
 */
class ContractTest {
    private val paths = Fixtures.openApi.getValue("paths").jsonObject

    private fun operation(path: String, method: String) = paths.getValue(path).jsonObject.getValue(method).jsonObject

    private fun JsonObject.json(): JsonObject = getValue("content").jsonObject.getValue("application/json").jsonObject

    private fun request(path: String, method: String) =
        operation(path, method).getValue("requestBody").jsonObject.json().getValue("schema").jsonObject

    private fun response(path: String, method: String, status: String) =
        operation(path, method).getValue("responses").jsonObject.getValue(status).jsonObject.json()
            .getValue("schema").jsonObject

    /** The object schema inside a nullable union, or the schema itself. */
    private fun objectOf(schema: JsonElement): JsonObject {
        val value = schema.jsonObject
        val union = value["anyOf"] ?: return value
        return union.jsonArray.map { it.jsonObject }.single { "properties" in it }
    }

    private fun properties(schema: JsonElement): Set<String> = objectOf(schema).getValue("properties").jsonObject.keys

    private fun property(schema: JsonElement, name: String): JsonElement =
        objectOf(schema).getValue("properties").jsonObject.getValue(name)

    private fun names(descriptor: SerialDescriptor): Set<String> = (0 until descriptor.elementsCount).map(descriptor::getElementName).toSet()

    private fun assertFields(schema: JsonElement, serializer: KSerializer<*>, label: String) {
        assertEquals(properties(schema), names(serializer.descriptor), label)
    }

    @Test
    fun `enrollment matches the API`() {
        val body = request("/device-enrollments", "post")
        assertEquals(setOf("credentialHash", "report"), properties(body))
        assertFields(property(body, "report"), DeviceReport.serializer(), "report")
        assertFields(property(property(body, "report"), "display"), DeviceReport.Display.serializer(), "display")
        assertFields(response("/device-enrollments", "post", "201"), EnrollmentStarted.serializer(), "started")
        assertFields(
            response("/device-enrollments/{enrollmentId}/status", "post", "200"),
            EnrollmentStatus.serializer(),
            "status",
        )
    }

    @Test
    fun `credential rotation matches the published hash-only request`() {
        assertFields(request("/device/self/credential", "post"), HttpDeviceApi.RotationRequest.serializer(), "rotation")
    }

    @Test
    fun `the sync exchange matches the API`() {
        val body = request("/device/sync", "post")
        assertFields(body, SyncReport.serializer(), "report")
        assertFields(property(body, "active"), SyncReport.Active.serializer(), "active")
        assertFields(property(body, "recovery"), SyncReport.Recovery.serializer(), "recovery")
        assertFields(property(body, "staging"), SyncReport.Staging.serializer(), "staging")
        assertFields(property(body, "storage"), SyncReport.Storage.serializer(), "storage")
        assertFields(property(body, "diagnostics"), SyncReport.Diagnostics.serializer(), "diagnostics")

        val answer = response("/device/sync", "post", "200")
        assertFields(answer, SyncAnswer.serializer(), "answer")
        assertFields(property(answer, "desired"), SyncAnswer.Desired.serializer(), "desired")
        assertFields(property(answer, "zoneOffsets"), ZoneOffsetsAnswer.serializer(), "zoneOffsets")
        val periods = objectOf(property(answer, "zoneOffsets")).getValue("properties").jsonObject.getValue("periods")
        assertFields(periods.jsonObject.getValue("items"), ZoneOffsetsAnswer.Period.serializer(), "period")
    }

    @Test
    fun `the player uses only operations the API declares`() {
        val used = mapOf(
            "/device-enrollments" to "post",
            "/device-enrollments/{enrollmentId}/status" to "post",
            "/device/self/credential" to "post",
            "/device/self/erasure" to "post",
            "/device/sync" to "post",
            "/device/keys" to "get",
            "/device/publications/{publicationId}/manifest" to "get",
            "/device/media/{mediaId}" to "get",
        )
        for ((path, method) in used) operation(path, method)
    }
}
