package app.teluni.player.core.protocol

import app.teluni.player.core.schedule.ScheduleRule
import app.teluni.player.core.schedule.parseTime
import app.teluni.player.core.schedule.ruleIssue
import java.security.MessageDigest
import java.time.Instant
import java.time.format.DateTimeParseException
import kotlinx.serialization.SerializationException
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/** Why staging a publication failed, as the sync report names it. */
public enum class StagingFailureCode {
    STORAGE_FULL,
    DOWNLOAD_FAILED,
    INTEGRITY_FAILED,
    INVALID_MANIFEST,
    INCOMPATIBLE,
}

public class StagingFailure(public val code: StagingFailureCode, message: String) : Exception(message)

/** The protocol 1 manifest exactly as the publication design defines it. */
@Serializable
public data class Manifest(
    val format: String,
    val protocol: Int,
    val publicationId: String,
    val companyId: String,
    val programId: String,
    val generation: Int,
    val publishedAt: String,
    val outputs: List<Output>,
    val playlists: List<Playlist>,
    val media: List<Media>,
) {
    @Serializable
    public data class Output(val key: String, val defaultPlaylistId: String?, val rules: List<Rule>)

    @Serializable
    public data class Rule(
        val id: String,
        val playlistId: String,
        val weekdays: List<Int>,
        val allDay: Boolean,
        val startTime: String? = null,
        val endTime: String? = null,
        val startsOn: String,
        val endsOn: String?,
    )

    @Serializable
    public data class Playlist(val id: String, val transition: Transition, val items: List<Item>)

    @Serializable
    public data class Transition(val kind: String, val durationMs: Long? = null)

    @Serializable
    public data class Item(val mediaId: String, val durationMs: Long?)

    @Serializable
    public data class Media(
        val id: String,
        val kind: String,
        val contentType: String,
        val size: Long,
        val sha256: String,
        val width: Int,
        val height: Int,
        val durationMs: Long?,
        val hasAudio: Boolean,
    )
}

/** A verified, interpretable protocol 1 publication. */
public data class Publication(
    val manifest: Manifest,
    val sha256: String,
    /** The single protocol 1 output's rules, ready for the evaluator. */
    val rules: List<ScheduleRule>,
    val defaultPlaylistId: String?,
    val playlists: Map<String, Manifest.Playlist>,
    val media: Map<String, Manifest.Media>,
)

/**
 * Parses and checks manifest bytes. The format changes only with a new
 * protocol, so unknown fields are refused; anything the player cannot
 * interpret fails as `INVALID_MANIFEST` or `INCOMPATIBLE`, never partly.
 */
public object ManifestParser {
    public const val PROTOCOL: Int = 1
    public const val OUTPUT: String = "screen"

    /** Display rendition types of the media library design that the player plays. */
    public val contentTypes: Map<String, Set<String>> = mapOf(
        "IMAGE" to setOf("image/jpeg", "image/png"),
        "VIDEO" to setOf("video/mp4"),
    )

    private val json = Json {
        ignoreUnknownKeys = false
        isLenient = false
        explicitNulls = true
    }
    private val sha256Pattern = Regex("[0-9a-f]{64}")

    /** AT-01: image items show for 1 to 3,600 seconds. */
    private val imageDurations = 1_000L..3_600_000L

    public fun parse(bytes: ByteArray, expectedSha256: String): Publication {
        val actual = sha256Hex(bytes)
        if (actual != expectedSha256) {
            throw StagingFailure(StagingFailureCode.INTEGRITY_FAILED, "The manifest does not match its SHA-256")
        }
        val manifest = try {
            json.decodeFromString(Manifest.serializer(), bytes.decodeToString(throwOnInvalidSequence = true))
        } catch (error: SerializationException) {
            throw invalid("The manifest is not protocol 1 JSON: ${error.message}")
        } catch (error: IllegalArgumentException) {
            throw invalid("The manifest is not protocol 1 JSON: ${error.message}")
        } catch (_: CharacterCodingException) {
            throw invalid("The manifest is not UTF-8")
        }
        return check(manifest, actual)
    }

    private fun check(manifest: Manifest, sha256: String): Publication {
        if (manifest.format != "teluni.publication") throw invalid("Unknown manifest format")
        if (manifest.protocol != PROTOCOL) throw incompatible("Protocol ${manifest.protocol} is not supported")
        if (manifest.generation < 1) throw invalid("Invalid generation")
        if (listOf(manifest.publicationId, manifest.companyId, manifest.programId).any { it.isBlank() }) {
            throw invalid("Missing identifiers")
        }
        try {
            Instant.parse(manifest.publishedAt)
        } catch (_: DateTimeParseException) {
            throw invalid("Invalid publication time")
        }
        val output = manifest.outputs.singleOrNull()
            ?: throw incompatible("Protocol 1 players show exactly one output")
        if (output.key != OUTPUT) throw incompatible("Unknown output ${output.key}")

        val media = unique(manifest.media) { it.id }
        for (item in media.values) checkMedia(item)
        val playlists = unique(manifest.playlists) { it.id }
        for (playlist in playlists.values) {
            when (playlist.transition.kind) {
                "CUT" -> if (playlist.transition.durationMs != null) throw invalid("A cut has no duration")
                "FADE" -> throw incompatible("Fades are not qualified on this player")
                else -> throw invalid("Unknown transition ${playlist.transition.kind}")
            }
            for (item in playlist.items) {
                val described = media[item.mediaId] ?: throw invalid("Item without its media")
                when (described.kind) {
                    "IMAGE" -> if (item.durationMs == null || item.durationMs !in imageDurations) {
                        throw invalid("Image items need a duration of 1 to 3,600 seconds")
                    }
                    else -> if (item.durationMs != null) throw invalid("Video items play their whole rendition")
                }
            }
        }

        val rules = output.rules.map { rule ->
            if (rule.playlistId !in playlists) throw invalid("Rule ${rule.id} uses an unknown playlist")
            val startMinute = rule.startTime?.let { parseTime(it) ?: throw invalid("Invalid start time") }
            val endMinute = rule.endTime?.let { parseTime(it) ?: throw invalid("Invalid end time") }
            ScheduleRule(
                rule.id,
                rule.playlistId,
                rule.weekdays,
                rule.allDay,
                startMinute,
                endMinute,
                rule.startsOn,
                rule.endsOn,
            ).also { if (ruleIssue(it) != null) throw invalid("Rule ${rule.id} is invalid") }
        }
        if (rules.map { it.id }.toSet().size != rules.size) throw invalid("Duplicate rule identifiers")
        if (output.defaultPlaylistId != null && output.defaultPlaylistId !in playlists) {
            throw invalid("The default uses an unknown playlist")
        }
        return Publication(manifest, sha256, rules, output.defaultPlaylistId, playlists, media)
    }

    private fun checkMedia(item: Manifest.Media) {
        val types = contentTypes[item.kind] ?: throw incompatible("Unknown media kind ${item.kind}")
        if (item.contentType !in types) throw incompatible("Unsupported rendition ${item.contentType}")
        if (!sha256Pattern.matches(item.sha256)) throw invalid("Invalid media SHA-256")
        if (item.size < 1 || item.width < 1 || item.height < 1) throw invalid("Invalid media size")
        when (item.kind) {
            "IMAGE" -> if (item.durationMs != null || item.hasAudio) throw invalid("Images have no duration or audio")
            else -> if (item.durationMs == null || item.durationMs < 1) throw invalid("Videos need a duration")
        }
    }

    private fun <T> unique(items: List<T>, key: (T) -> String): Map<String, T> {
        val map = items.associateBy(key)
        if (map.size != items.size) throw invalid("Duplicate identifiers")
        return map
    }

    private fun invalid(message: String) = StagingFailure(StagingFailureCode.INVALID_MANIFEST, message)

    private fun incompatible(message: String) = StagingFailure(StagingFailureCode.INCOMPATIBLE, message)
}

/** Lowercase hexadecimal SHA-256, as manifests and statements write it. */
public fun sha256Hex(bytes: ByteArray): String =
    MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
