package app.teluni.player.core.sync

import java.io.IOException
import java.time.Duration
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.jsonObject
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer

class HttpDeviceApiTest {
    private val server = MockWebServer()
    private var monotonic = 1_000L
    private lateinit var api: HttpDeviceApi

    @BeforeTest
    fun start() {
        server.start()
        api = HttpDeviceApi(server.url("/").toString(), { monotonic.also { monotonic += 40 } })
    }

    @AfterTest
    fun stop() {
        server.close()
    }

    private val report = SyncReport(
        protocols = listOf(1),
        appVersion = "1.0.0",
        active = null,
        recovery = null,
        staging = SyncReport.Staging("p", "DOWNLOADING", null, 1, 2),
        playback = "SETUP",
        storage = null,
        deviceTime = null,
    )

    @Test
    fun `synchronizes with the bearer credential and ignores unknown answer fields`() {
        server.enqueue(
            MockResponse.Builder().code(200).body(
                """{"protocol":1,"serverTime":"2026-10-20T12:00:00.000Z","status":"active","clearRequired":false,
                "timeZone":"America/Sao_Paulo","zoneOffsets":{"until":"2026-11-24T12:00:00.000Z",
                "periods":[{"from":"2026-10-17T12:00:00.000Z","offsetSeconds":-10800}]},"rotation":90,
                "desired":null,"authorization":null,"nextSyncSeconds":30,"somethingNew":true}""",
            ).build(),
        )
        val timed = api.sync("secret", report)
        assertEquals(1_000, timed.sentMonotonic)
        assertEquals(1_040, timed.receivedMonotonic)
        assertEquals(90, timed.value.rotation)
        assertEquals(-10_800, timed.value.zoneOffsets?.periods?.single()?.offsetSeconds)
        val request = server.takeRequest()
        assertEquals("POST", request.method)
        assertEquals("/device/sync", request.url.encodedPath)
        assertEquals("Bearer secret", request.headers["Authorization"])
        val body = Json.parseToJsonElement(requireNotNull(request.body).utf8()).jsonObject
        // Required nullable fields are always sent, as the API's schema requires.
        assertEquals(JsonNull, body.getValue("active"))
        assertEquals(JsonNull, body.getValue("staging").jsonObject.getValue("failure"))
    }

    @Test
    fun `rotates with only the candidate hash in the body and requires the documented acknowledgement`() {
        server.enqueue(MockResponse.Builder().code(204).build())
        api.rotateCredential("current-secret", "candidate-hash")
        val request = server.takeRequest()
        assertEquals("POST", request.method)
        assertEquals("/device/self/credential", request.url.encodedPath)
        assertEquals("Bearer current-secret", request.headers["Authorization"])
        assertEquals("""{"credentialHash":"candidate-hash"}""", requireNotNull(request.body).utf8())
        server.enqueue(MockResponse.Builder().code(429).addHeader("Retry-After", "41")
            .body("""{"error":{"code":"RATE_LIMITED"}}""").build())
        val failure = assertFailsWith<ApiFailure> { api.rotateCredential("current-secret", "candidate-hash") }
        assertEquals(Duration.ofSeconds(41), failure.retryAfter)
        server.enqueue(MockResponse.Builder().code(200).body("{}").build())
        assertFailsWith<ApiFailure> { api.rotateCredential("current-secret", "candidate-hash") }
    }

    @Test
    fun `maps the error envelope and Retry-After`() {
        server.enqueue(
            MockResponse.Builder().code(429).addHeader("Retry-After", "17")
                .body("""{"error":{"code":"RATE_LIMITED","message":"Slow down","requestId":"r"}}""").build(),
        )
        val failure = assertFailsWith<ApiFailure> { api.sync("secret", report) }
        assertEquals(429, failure.status)
        assertEquals("RATE_LIMITED", failure.code)
        assertEquals(Duration.ofSeconds(17), failure.retryAfter)

        server.enqueue(MockResponse.Builder().code(502).body("<html>bad gateway</html>").build())
        val gateway = assertFailsWith<ApiFailure> { api.keys("secret") }
        assertNull(gateway.code)
    }

    @Test
    fun `fetches exact manifest bytes and resumes media with a range`() {
        val bytes = byteArrayOf(0x7b, 0x7d, 0x0a)
        server.enqueue(MockResponse.Builder().code(200).body(okio.Buffer().write(bytes)).build())
        assertContentEquals(bytes, api.manifest("secret", "p1"))
        assertEquals("/device/publications/p1/manifest", server.takeRequest().url.encodedPath)

        server.enqueue(MockResponse.Builder().code(206).body("cdef").build())
        var received = ""
        api.media("secret", "m1", 2) { received = it.readBytes().decodeToString() }
        assertEquals("cdef", received)
        assertEquals("bytes=2-", server.takeRequest().headers["Range"])

        // A server that ignores the range would corrupt a resumed file.
        server.enqueue(MockResponse.Builder().code(200).body("abcdef").build())
        assertFailsWith<IOException> { api.media("secret", "m1", 2) { it.readBytes() } }
    }

    @Test
    fun `enrolls anonymously and polls with the credential`() {
        server.enqueue(
            MockResponse.Builder().code(201)
                .body("""{"enrollmentId":"e1","userCode":"BCDF-GHJK","expiresAt":"2026-10-20T12:10:00.000Z","pollIntervalSeconds":5}""")
                .build(),
        )
        val started = api.startEnrollment(
            "h".repeat(43),
            DeviceReport("1.0.0", 1, "Synthetic", "TV", "14", DeviceReport.Display(1920, 1080), listOf(0)),
        )
        assertEquals("BCDF-GHJK", started.userCode)
        assertNull(server.takeRequest().headers["Authorization"])

        server.enqueue(MockResponse.Builder().code(200).body("""{"status":"paired","deviceId":"d1","pollIntervalSeconds":5}""").build())
        assertEquals("d1", api.enrollmentStatus("e1", "secret").deviceId)
        val poll = server.takeRequest()
        assertEquals("/device-enrollments/e1/status", poll.url.encodedPath)
        assertTrue(poll.headers["Authorization"] == "Bearer secret")
    }
}
