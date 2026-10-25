package app.teluni.player.core.sync

import java.io.IOException
import java.io.InputStream
import java.time.Duration
import kotlinx.serialization.KSerializer
import kotlinx.serialization.SerializationException
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response

/** The device's report at enrollment and in `PUT /device/self/report`. */
@Serializable
public data class DeviceReport(
    val appVersion: String,
    val protocolVersion: Int,
    val manufacturer: String,
    val model: String,
    val osVersion: String,
    val display: Display,
    val rotations: List<Int>,
) {
    @Serializable
    public data class Display(val width: Int, val height: Int)
}

@Serializable
public data class EnrollmentStarted(
    val enrollmentId: String,
    val userCode: String,
    val expiresAt: String,
    val pollIntervalSeconds: Int,
)

@Serializable
public data class EnrollmentStatus(val status: String, val deviceId: String?, val pollIntervalSeconds: Int)

/** `POST /device/sync` request: the screen's report (publication design). */
@Serializable
public data class SyncReport(
    val protocols: List<Int>,
    val appVersion: String,
    val active: Active?,
    val recovery: Recovery?,
    val staging: Staging?,
    val playback: String,
    val storage: Storage?,
    val deviceTime: String?,
    val diagnostics: Diagnostics? = null,
) {
    @Serializable
    public data class Active(val publicationId: String, val activatedAt: String)

    @Serializable
    public data class Recovery(val publicationId: String)

    @Serializable
    public data class Staging(
        val publicationId: String,
        val state: String,
        val failure: String?,
        val bytesDone: Long,
        val bytesTotal: Long,
    )

    @Serializable
    public data class Storage(val freeBytes: Long, val totalBytes: Long)

    @Serializable
    public data class Diagnostics(val clock: String, val systemSkewMillis: Long?, val crashCount: Int?)
}

@Serializable
public data class ZoneOffsetsAnswer(val until: String, val periods: List<Period>) {
    @Serializable
    public data class Period(val from: String, val offsetSeconds: Int)
}

/** `POST /device/sync` answer; unknown fields are ignored because the API may add some. */
@Serializable
public data class SyncAnswer(
    val protocol: Int,
    val serverTime: String,
    val status: String,
    val clearRequired: Boolean,
    val timeZone: String? = null,
    val zoneOffsets: ZoneOffsetsAnswer? = null,
    val rotation: Int? = null,
    /** The screen's branch, which protocol 2 catalog prices need. */
    val branchId: String? = null,
    val desired: Desired? = null,
    val authorization: String? = null,
    val nextSyncSeconds: Int,
) {
    @Serializable
    public data class Desired(
        val publicationId: String,
        val generation: Int,
        val manifestSha256: String,
        val manifestSize: Long,
        val source: String,
        /** The manifest's protocol; 1 from servers that did not report it. */
        val protocol: Int = 1,
    )
}

/** An answer with the monotonic readings around its request, for the trusted clock. */
public data class Timed<T>(val value: T, val sentMonotonic: Long, val receivedMonotonic: Long)

/** A failure the API answered with its error envelope. */
public class ApiFailure(
    public val status: Int,
    public val code: String?,
    public val retryAfter: Duration?,
) : IOException("API answered $status ${code ?: ""}".trim())

/** The device operations the player uses. Every call blocks; run them off the main thread. */
public interface DeviceApi {
    public fun startEnrollment(credentialHash: String, report: DeviceReport): EnrollmentStarted

    public fun enrollmentStatus(enrollmentId: String, credential: String): EnrollmentStatus

    public fun rotateCredential(credential: String, credentialHash: String)

    public fun confirmErasure(credential: String)

    public fun sync(credential: String, report: SyncReport): Timed<SyncAnswer>

    public fun keys(credential: String): String

    public fun manifest(credential: String, publicationId: String): ByteArray

    /**
     * Streams a media rendition from `offset`. The callback receives the body
     * positioned at `offset`; an answer that ignores the range fails.
     */
    public fun media(credential: String, mediaId: String, offset: Long, body: (InputStream) -> Unit)
}

/** [DeviceApi] over HTTPS with OkHttp. */
public class HttpDeviceApi(
    baseUrl: String,
    private val monotonic: () -> Long,
    client: OkHttpClient = OkHttpClient(),
) : DeviceApi {
    private val base: HttpUrl = baseUrl.toHttpUrl()
    private val json = Json {
        ignoreUnknownKeys = true
        encodeDefaults = true
    }
    private val jsonType = "application/json".toMediaType()
    private val calls = client.newBuilder()
        .connectTimeout(Duration.ofSeconds(10))
        .readTimeout(Duration.ofSeconds(30))
        .followRedirects(false)
        .build()

    @Serializable
    private data class Envelope(val error: Error) {
        @Serializable
        data class Error(val code: String)
    }

    @Serializable
    internal data class RotationRequest(val credentialHash: String)

    @Serializable
    private data class EnrollmentRequest(val credentialHash: String, val report: DeviceReport)

    private fun url(vararg segments: String): HttpUrl =
        base.newBuilder().apply { segments.forEach { addPathSegment(it) } }.build()

    private fun request(url: HttpUrl, credential: String?): Request.Builder =
        Request.Builder().url(url).apply { if (credential != null) header("Authorization", "Bearer $credential") }

    private fun <T> body(value: T, serializer: KSerializer<T>): RequestBody =
        json.encodeToString(serializer, value).toRequestBody(jsonType)

    private fun failure(response: Response): ApiFailure {
        val code = try {
            json.decodeFromString(Envelope.serializer(), response.body.string()).error.code
        } catch (_: SerializationException) {
            null
        } catch (_: IllegalArgumentException) {
            null
        }
        val retryAfter = response.header("Retry-After")?.toLongOrNull()?.let(Duration::ofSeconds)
        return ApiFailure(response.code, code, retryAfter)
    }

    private fun <T> call(request: Request, serializer: KSerializer<T>): T =
        calls.newCall(request).execute().use { response ->
            if (!response.isSuccessful) throw failure(response)
            try {
                json.decodeFromString(serializer, response.body.string())
            } catch (error: SerializationException) {
                throw IOException("Unexpected answer", error)
            } catch (error: IllegalArgumentException) {
                throw IOException("Unexpected answer", error)
            }
        }

    override fun startEnrollment(credentialHash: String, report: DeviceReport): EnrollmentStarted = call(
        request(url("device-enrollments"), null)
            .post(body(EnrollmentRequest(credentialHash, report), EnrollmentRequest.serializer())).build(),
        EnrollmentStarted.serializer(),
    )

    override fun enrollmentStatus(enrollmentId: String, credential: String): EnrollmentStatus = call(
        request(url("device-enrollments", enrollmentId, "status"), credential).post(ByteArray(0).toRequestBody()).build(),
        EnrollmentStatus.serializer(),
    )

    override fun rotateCredential(credential: String, credentialHash: String) {
        val request = request(url("device", "self", "credential"), credential)
            .post(body(RotationRequest(credentialHash), RotationRequest.serializer())).build()
        calls.newCall(request).execute().use { response -> if (response.code != 204) throw failure(response) }
    }

    override fun confirmErasure(credential: String) {
        val request = request(url("device", "self", "erasure"), credential).post(ByteArray(0).toRequestBody()).build()
        calls.newCall(request).execute().use { response -> if (!response.isSuccessful) throw failure(response) }
    }

    override fun sync(credential: String, report: SyncReport): Timed<SyncAnswer> {
        val request = request(url("device", "sync"), credential).post(body(report, SyncReport.serializer())).build()
        val sent = monotonic()
        val answer = call(request, SyncAnswer.serializer())
        return Timed(answer, sent, monotonic())
    }

    override fun keys(credential: String): String =
        calls.newCall(request(url("device", "keys"), credential).get().build()).execute().use { response ->
            if (!response.isSuccessful) throw failure(response)
            response.body.string()
        }

    override fun manifest(credential: String, publicationId: String): ByteArray =
        calls.newCall(request(url("device", "publications", publicationId, "manifest"), credential).get().build())
            .execute().use { response ->
                if (!response.isSuccessful) throw failure(response)
                response.body.bytes()
            }

    override fun media(credential: String, mediaId: String, offset: Long, body: (InputStream) -> Unit) {
        val request = request(url("device", "media", mediaId), credential).get().apply {
            // A resumed file is checked against the manifest's SHA-256 at the end.
            if (offset > 0) header("Range", "bytes=$offset-")
        }.build()
        calls.newCall(request).execute().use { response ->
            if (!response.isSuccessful) throw failure(response)
            if (offset > 0 && response.code != 206) throw IOException("The server ignored the range")
            if (offset == 0L && response.code != 200) throw IOException("Unexpected media answer ${response.code}")
            body(response.body.byteStream())
        }
    }
}
