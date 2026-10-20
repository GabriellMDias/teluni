package app.teluni.player.core.sync

import app.teluni.player.core.protocol.sha256Hex
import app.teluni.player.core.time.FakeClock
import com.nimbusds.jose.JOSEObjectType
import com.nimbusds.jose.JWSAlgorithm
import com.nimbusds.jose.JWSHeader
import com.nimbusds.jose.JWSObject
import com.nimbusds.jose.Payload
import com.nimbusds.jose.crypto.ECDSASigner
import com.nimbusds.jose.jwk.Curve
import com.nimbusds.jose.jwk.ECKey
import com.nimbusds.jose.jwk.JWKSet
import com.nimbusds.jose.jwk.gen.ECKeyGenerator
import java.io.ByteArrayInputStream
import java.io.IOException
import java.io.InputStream
import java.security.MessageDigest
import java.time.Duration
import java.time.Instant
import java.util.Base64
import java.util.Collections
import java.util.concurrent.atomic.AtomicInteger
import kotlin.random.Random
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray

/** A publication as the fake server holds it: exact manifest bytes and media contents. */
class FakePublication(val id: String, val bytes: ByteArray, val media: Map<String, ByteArray>) {
    val sha256: String = sha256Hex(bytes)
}

/**
 * An in-memory API that behaves like the publications and devices modules
 * for one screen: enrollment, sync with signed statements, manifests and
 * media of the desired publication only, keys and erasure.
 */
class FakeServer(private val clock: FakeClock) : DeviceApi {
    val deviceId = "8b2f9a6e-0c4d-4e1f-9a2b-3c4d5e6f7a8b"
    val companyId = "1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d"
    var key: ECKey = ECKeyGenerator(Curve.P_256).keyID("k1").generate()
    var status = "active"
    var desired: FakePublication? = null

    val branchId = "5c1d2e3f-4a5b-4c6d-8e7f-8091a2b3c4d5"

    /** The protocol the answer names for the desired publication. */
    var desiredProtocol = 1
    var manifestRequests = 0
    var iatShift: Duration = Duration.ZERO
    val publications = mutableMapOf<String, FakePublication>()
    val reports: MutableList<SyncReport> = Collections.synchronizedList(mutableListOf())
    val mediaRequests: MutableList<Pair<String, Long>> = Collections.synchronizedList(mutableListOf())
    var failMediaAfter: Long? = null
    var corruptMedia = false
    var onMedia: () -> Unit = {}

    /** How many next media requests answer RATE_LIMITED with a three-second Retry-After. */
    val rateLimitedMedia = AtomicInteger(0)
    var keyFetches = 0
    var erasures = 0
    private var credentialHash: String? = null
    private var paired = false

    val now: Instant get() = Instant.ofEpochMilli(clock.wall)

    private fun authorize(credential: String) {
        val hash = Base64.getUrlEncoder().withoutPadding()
            .encodeToString(MessageDigest.getInstance("SHA-256").digest(Base64.getUrlDecoder().decode(credential)))
        if (!paired || hash != credentialHash) throw ApiFailure(401, "DEVICE_UNAUTHORIZED", null)
    }

    override fun startEnrollment(credentialHash: String, report: DeviceReport): EnrollmentStarted {
        this.credentialHash = credentialHash
        paired = false
        return EnrollmentStarted("e-1", "BCDF-GHJK", now.plusSeconds(600).toString(), 5)
    }

    override fun enrollmentStatus(enrollmentId: String, credential: String): EnrollmentStatus {
        paired = true
        authorize(credential)
        return EnrollmentStatus("paired", deviceId, 5)
    }

    override fun confirmErasure(credential: String) {
        authorize(credential)
        erasures += 1
    }

    fun publish(publication: FakePublication) {
        publications[publication.id] = publication
        desired = publication
    }

    override fun sync(credential: String, report: SyncReport): Timed<SyncAnswer> {
        authorize(credential)
        reports += report
        val sent = clock.monotonic
        val serverTime = now
        val unlinked = status == "unlinked"
        val active = status == "active"
        val wanted = desired.takeIf { active }
        val statement = if (active) sign(serverTime, authorized(wanted, report)) else null
        val answer = SyncAnswer(
            protocol = 1,
            serverTime = serverTime.toString(),
            status = status,
            clearRequired = unlinked,
            timeZone = if (unlinked) null else "America/Sao_Paulo",
            zoneOffsets = if (unlinked) null else ZoneOffsetsAnswer(
                until = serverTime.plus(Duration.ofDays(35)).toString(),
                periods = listOf(ZoneOffsetsAnswer.Period(serverTime.minus(Duration.ofDays(3)).toString(), -10_800)),
            ),
            rotation = if (unlinked) null else 0,
            branchId = if (unlinked) null else branchId,
            desired = wanted?.let {
                SyncAnswer.Desired(it.id, 1, it.sha256, it.bytes.size.toLong(), "group", desiredProtocol)
            },
            authorization = statement,
            nextSyncSeconds = 30,
        )
        return Timed(answer, sent, sent)
    }

    /** The publication design's authorization list. */
    private fun authorized(wanted: FakePublication?, report: SyncReport): List<FakePublication> {
        if (wanted == null) return emptyList()
        if (report.active?.publicationId == wanted.id) return listOf(wanted)
        return (listOf(wanted) + listOfNotNull(report.active?.publicationId, report.recovery?.publicationId)
            .mapNotNull(publications::get)).distinctBy { it.id }
    }

    fun sign(at: Instant, list: List<FakePublication>, signer: ECKey = key): String {
        val iat = at.plus(iatShift).epochSecond
        val payload = buildJsonObject {
            put("sub", deviceId)
            put("company", companyId)
            put("iat", iat)
            put("exp", iat + 7 * 86_400)
            putJsonArray("publications") {
                for (item in list) add(buildJsonObject { put("id", item.id); put("sha256", item.sha256) })
            }
        }
        val header = JWSHeader.Builder(JWSAlgorithm.ES256)
            .type(JOSEObjectType("teluni-authorization+jws")).keyID(signer.keyID).build()
        return JWSObject(header, Payload(payload.toString())).apply { sign(ECDSASigner(signer)) }.serialize()
    }

    override fun keys(credential: String): String {
        authorize(credential)
        keyFetches += 1
        return JWKSet(key.toPublicJWK()).toString()
    }

    override fun manifest(credential: String, publicationId: String): ByteArray {
        authorize(credential)
        manifestRequests += 1
        val wanted = desired
        if (wanted == null || wanted.id != publicationId) throw ApiFailure(404, "RESOURCE_NOT_FOUND", null)
        return wanted.bytes
    }

    override fun media(credential: String, mediaId: String, offset: Long, body: (InputStream) -> Unit) {
        authorize(credential)
        if (rateLimitedMedia.getAndUpdate { maxOf(it - 1, 0) } > 0) {
            throw ApiFailure(429, "RATE_LIMITED", Duration.ofSeconds(3))
        }
        mediaRequests += mediaId to offset
        onMedia()
        val wanted = desired ?: throw ApiFailure(404, "RESOURCE_NOT_FOUND", null)
        val bytes = wanted.media[mediaId] ?: throw ApiFailure(404, "RESOURCE_NOT_FOUND", null)
        val served = if (corruptMedia) bytes.copyOf().also { it[it.size - 1] = (it.last() + 1).toByte() } else bytes
        val limit = failMediaAfter
        val remaining = served.copyOfRange(offset.toInt(), served.size)
        if (limit != null && remaining.size > limit) {
            body(ByteArrayInputStream(remaining.copyOf(limit.toInt())))
            throw IOException("connection reset")
        }
        body(ByteArrayInputStream(remaining))
    }

    companion object {
        /** A protocol 1 manifest whose media are random bytes of the given sizes. */
        fun publication(
            id: String,
            companyId: String,
            images: Int = 1,
            videos: Int = 1,
            seed: Int = 1,
        ): FakePublication {
            val random = Random(seed)
            val media = mutableMapOf<String, ByteArray>()
            val described = buildJsonArray {
                repeat(images + videos) { index ->
                    val video = index >= images
                    val mediaId = "m$seed-$index"
                    val bytes = random.nextBytes(if (video) 5_000 else 1_500)
                    media[mediaId] = bytes
                    add(
                        buildJsonObject {
                            put("id", mediaId)
                            put("kind", if (video) "VIDEO" else "IMAGE")
                            put("contentType", if (video) "video/mp4" else "image/jpeg")
                            put("size", bytes.size)
                            put("sha256", sha256Hex(bytes))
                            put("width", 1920)
                            put("height", 1080)
                            put("durationMs", if (video) JsonPrimitive(12_000) else JsonNull)
                            put("hasAudio", false)
                        },
                    )
                }
            }
            val items = JsonArray(
                media.keys.mapIndexed { index, mediaId ->
                    buildJsonObject {
                        put("mediaId", mediaId)
                        put("durationMs", if (index >= images) JsonNull else JsonPrimitive(10_000))
                    }
                },
            )
            val manifest = buildJsonObject {
                put("format", "teluni.publication")
                put("protocol", 1)
                put("publicationId", id)
                put("companyId", companyId)
                put("programId", "program-1")
                put("generation", seed)
                put("publishedAt", "2026-10-20T00:00:00.000Z")
                putJsonArray("outputs") {
                    add(
                        buildJsonObject {
                            put("key", "screen")
                            put("defaultPlaylistId", "evening")
                            putJsonArray("rules") {
                                add(
                                    buildJsonObject {
                                        put("id", "r1")
                                        put("playlistId", "day")
                                        putJsonArray("weekdays") { (1..7).forEach { add(it) } }
                                        put("allDay", false)
                                        put("startTime", "08:00")
                                        put("endTime", "18:00")
                                        put("startsOn", "2026-01-01")
                                        put("endsOn", JsonNull)
                                    },
                                )
                            }
                        },
                    )
                }
                putJsonArray("playlists") {
                    add(buildJsonObject { put("id", "day"); put("transition", JsonObject(mapOf("kind" to JsonPrimitive("CUT")))); put("items", items) })
                    add(
                        buildJsonObject {
                            put("id", "evening")
                            put("transition", JsonObject(mapOf("kind" to JsonPrimitive("CUT"))))
                            put("items", JsonArray(items.take(1)))
                        },
                    )
                }
                put("media", described)
            }
            return FakePublication(id, manifest.toString().encodeToByteArray(), media)
        }
    }
}
