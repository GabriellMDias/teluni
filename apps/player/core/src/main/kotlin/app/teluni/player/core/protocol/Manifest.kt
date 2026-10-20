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
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.intOrNull

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

/** What identifies a publication in every protocol. */
public data class PublicationHeader(
    val protocol: Int,
    val publicationId: String,
    val companyId: String,
    val programId: String,
    val generation: Int,
    val publishedAt: String,
)

/** What an output shows where no rule applies. */
public sealed interface OutputDefault {
    public data class Playlist(val playlistId: String) : OutputDefault

    /** A catalog area's own view (protocol 2). */
    public data object View : OutputDefault

    public data object None : OutputDefault
}

/** An output's rules, ready for the evaluator, and its default. */
public data class Output(val key: String, val rules: List<ScheduleRule>, val default: OutputDefault) {
    /** The playlist the evaluator plays between rules, if any. */
    val defaultPlaylistId: String? get() = (default as? OutputDefault.Playlist)?.playlistId
}

/** A verified, interpretable publication of protocol 1 or 2. */
public data class Publication(
    val header: PublicationHeader,
    val sha256: String,
    /** Outputs by key: protocol 1 has only `screen`, protocol 2 one per area. */
    val outputs: Map<String, Output>,
    val playlists: Map<String, Manifest.Playlist>,
    val media: Map<String, Manifest.Media>,
    /** Protocol 2's layout with its catalog snapshots; null in protocol 1. */
    val layout: Layout? = null,
)

/**
 * Parses and checks manifest bytes. The format changes only with a new
 * protocol, so unknown fields are refused; anything the player cannot
 * interpret fails as `INVALID_MANIFEST` or `INCOMPATIBLE`, never partly.
 */
public object ManifestParser {
    /** The protocols this player interprets, as its sync report declares them. */
    public val PROTOCOLS: List<Int> = listOf(1, 2)
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
        return try {
            val text = bytes.decodeToString(throwOnInvalidSequence = true)
            // Each protocol has its own format, so read the protocol first:
            // an unknown one is incompatible, not an invalid manifest.
            when (val protocol = ((json.parseToJsonElement(text) as? JsonObject)?.get("protocol") as? JsonPrimitive)?.intOrNull) {
                1, null -> check(json.decodeFromString(Manifest.serializer(), text), actual)
                2 -> LayoutManifestChecks.check(json.decodeFromString(LayoutManifest.serializer(), text), actual)
                else -> throw incompatible("Protocol $protocol is not supported")
            }
        } catch (error: SerializationException) {
            throw invalid("The manifest does not match its protocol: ${error.message}")
        } catch (error: IllegalArgumentException) {
            throw invalid("The manifest does not match its protocol: ${error.message}")
        } catch (_: CharacterCodingException) {
            throw invalid("The manifest is not UTF-8")
        }
    }

    private fun check(manifest: Manifest, sha256: String): Publication {
        val header = header(
            manifest.format,
            PublicationHeader(
                manifest.protocol,
                manifest.publicationId,
                manifest.companyId,
                manifest.programId,
                manifest.generation,
                manifest.publishedAt,
            ),
            1,
        )
        val output = manifest.outputs.singleOrNull()
            ?: throw incompatible("Protocol 1 players show exactly one output")
        if (output.key != OUTPUT) throw incompatible("Unknown output ${output.key}")
        val media = media(manifest.media)
        val playlists = playlists(manifest.playlists, media)
        if (output.defaultPlaylistId != null && output.defaultPlaylistId !in playlists) {
            throw invalid("The default uses an unknown playlist")
        }
        val default = output.defaultPlaylistId?.let { OutputDefault.Playlist(it) } ?: OutputDefault.None
        return Publication(
            header,
            sha256,
            mapOf(OUTPUT to Output(OUTPUT, rules(output.rules, playlists), default)),
            playlists,
            media,
        )
    }

    // Checks both protocols share

    internal fun header(format: String, header: PublicationHeader, protocol: Int): PublicationHeader {
        if (format != "teluni.publication") throw invalid("Unknown manifest format")
        if (header.protocol != protocol) throw incompatible("Protocol ${header.protocol} is not supported")
        if (header.generation < 1) throw invalid("Invalid generation")
        if (listOf(header.publicationId, header.companyId, header.programId).any { it.isBlank() }) {
            throw invalid("Missing identifiers")
        }
        try {
            Instant.parse(header.publishedAt)
        } catch (_: DateTimeParseException) {
            throw invalid("Invalid publication time")
        }
        return header
    }

    internal fun media(items: List<Manifest.Media>): Map<String, Manifest.Media> {
        val media = unique(items) { it.id }
        for (item in media.values) checkMedia(item)
        return media
    }

    internal fun playlists(
        items: List<Manifest.Playlist>,
        media: Map<String, Manifest.Media>,
    ): Map<String, Manifest.Playlist> {
        val playlists = unique(items) { it.id }
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
        return playlists
    }

    internal fun rules(items: List<Manifest.Rule>, playlists: Map<String, Manifest.Playlist>): List<ScheduleRule> {
        val rules = items.map { rule ->
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
        return rules
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

    internal fun <T> unique(items: List<T>, key: (T) -> String): Map<String, T> {
        val map = items.associateBy(key)
        if (map.size != items.size) throw invalid("Duplicate identifiers")
        return map
    }

    internal fun invalid(message: String) = StagingFailure(StagingFailureCode.INVALID_MANIFEST, message)

    internal fun incompatible(message: String) = StagingFailure(StagingFailureCode.INCOMPATIBLE, message)
}

/** Lowercase hexadecimal SHA-256, as manifests and statements write it. */
public fun sha256Hex(bytes: ByteArray): String =
    MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
