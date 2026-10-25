package app.teluni.player.core.store

import java.io.File
import java.io.IOException
import java.nio.ByteBuffer
import java.nio.channels.FileChannel
import java.nio.file.AtomicMoveNotSupportedException
import java.nio.file.Files
import java.nio.file.NoSuchFileException
import java.nio.file.Path
import java.nio.file.StandardCopyOption
import java.nio.file.StandardOpenOption
import java.util.UUID
import kotlinx.serialization.SerializationException
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/** The steps of an atomic replacement, where tests inject crashes. */
public enum class WriteStep { TEMP_WRITTEN, TEMP_SYNCED, RENAMED, DIRECTORY_SYNCED }

/**
 * Atomic file replacement: write a temporary file, flush it, rename it over
 * the target and flush the directory. A reader sees the old or the new
 * content, never a mix, also after a power cut.
 */
public class AtomicFiles(private val hook: (Path, WriteStep) -> Unit = { _, _ -> }) {
    public fun write(target: Path, bytes: ByteArray) {
        // A unique temporary name lets concurrent writers of one record each replace it whole.
        val temporary = target.resolveSibling(".${target.fileName}.${UUID.randomUUID()}.tmp")
        FileChannel.open(
            temporary,
            StandardOpenOption.CREATE,
            StandardOpenOption.TRUNCATE_EXISTING,
            StandardOpenOption.WRITE,
        ).use { channel ->
            val buffer = ByteBuffer.wrap(bytes)
            while (buffer.hasRemaining()) channel.write(buffer)
            hook(target, WriteStep.TEMP_WRITTEN)
            channel.force(true)
        }
        hook(target, WriteStep.TEMP_SYNCED)
        move(temporary, target)
        hook(target, WriteStep.RENAMED)
        syncDirectory(target.parent)
        hook(target, WriteStep.DIRECTORY_SYNCED)
    }

    /** Renames a flushed file into place atomically and flushes its directory. */
    public fun move(source: Path, target: Path) {
        try {
            Files.move(source, target, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
        } catch (error: AtomicMoveNotSupportedException) {
            throw IOException("The storage cannot replace files atomically", error)
        }
    }

    public fun read(target: Path): ByteArray? = try {
        Files.readAllBytes(target)
    } catch (_: NoSuchFileException) {
        null
    }

    public companion object {
        /** Flushes a directory entry change; best effort where the platform refuses to open directories. */
        public fun syncDirectory(directory: Path) {
            try {
                FileChannel.open(directory, StandardOpenOption.READ).use { it.force(true) }
            } catch (_: IOException) {
                // Some file systems do not allow opening a directory; the rename stays atomic.
            }
        }
    }
}

/** A generation the player keeps: its publication and the SHA-256 of its manifest. */
@Serializable
public data class StoredGeneration(
    val publicationId: String,
    val manifestSha256: String,
    /** When the screen activated it, ISO-8601; null for a generation never activated here. */
    val activatedAt: String? = null,
)

/** The pointers that decide what plays, replaced atomically as one record. */
@Serializable
public data class PlayerState(
    val format: Int = FORMAT,
    val active: StoredGeneration? = null,
    val recovery: StoredGeneration? = null,
    val staging: StoredGeneration? = null,
) {
    public companion object {
        /** The local state format this release reads and writes. */
        public const val FORMAT: Int = 1
    }
}

/**
 * The player's app-private storage (player design, "Local storage, activation
 * and recovery"): small records replaced atomically, exact manifests per
 * generation and write-once media named by their SHA-256.
 */
public class PlayerStore(
    public val root: Path,
    private val files: AtomicFiles = AtomicFiles(),
    /** Free and total bytes of the volume; replaceable in tests. */
    private val space: () -> Space = { File(root.toString()).let { Space(it.usableSpace, it.totalSpace) } },
    /** File deletion result; replaceable for erasure fault qualification. */
    private val eraseTree: (Path) -> Boolean = { it.toFile().deleteRecursively() },
) {
    public data class Space(val free: Long, val total: Long)

    private val json = Json { ignoreUnknownKeys = false }
    private val generations: Path = root.resolve("generations")
    private val media: Path = root.resolve("media")
    private val sha256Pattern = Regex("[0-9a-f]{64}")
    private val idPattern = Regex("[0-9A-Za-z-]{1,64}")

    init {
        Files.createDirectories(generations)
        Files.createDirectories(media)
    }

    // Records

    public fun record(name: Record): ByteArray? = files.read(root.resolve(name.file))

    public fun saveRecord(name: Record, bytes: ByteArray) {
        files.write(root.resolve(name.file), bytes)
    }

    public fun deleteRecord(name: Record) {
        Files.deleteIfExists(root.resolve(name.file))
    }

    public enum class Record(public val file: String) {
        STATE("state.json"),
        CREDENTIAL("credential.bin"),
        IDENTITY("identity.json"),
        KEYS("keys.json"),
        STATEMENT("statement.jws"),
        SYNC("sync.json"),
        CLOCK("clock.json"),
        DIAGNOSTICS("diagnostics.json"),
    }

    /**
     * The state record. A missing, unreadable or unknown-format record reads
     * as empty, so the player synchronizes again instead of guessing.
     */
    public fun state(): PlayerState {
        val bytes = record(Record.STATE) ?: return PlayerState()
        val state = try {
            json.decodeFromString(PlayerState.serializer(), bytes.decodeToString())
        } catch (_: SerializationException) {
            return PlayerState()
        } catch (_: IllegalArgumentException) {
            return PlayerState()
        }
        return if (state.format == PlayerState.FORMAT) state else PlayerState()
    }

    public fun saveState(state: PlayerState) {
        saveRecord(Record.STATE, json.encodeToString(PlayerState.serializer(), state).encodeToByteArray())
    }

    // Manifests

    private fun manifestPath(publicationId: String): Path {
        require(idPattern.matches(publicationId)) { "Invalid publication identifier" }
        return generations.resolve(publicationId).resolve("manifest.json")
    }

    public fun manifest(publicationId: String): ByteArray? = files.read(manifestPath(publicationId))

    public fun saveManifest(publicationId: String, bytes: ByteArray) {
        val path = manifestPath(publicationId)
        Files.createDirectories(path.parent)
        AtomicFiles.syncDirectory(generations)
        files.write(path, bytes)
    }

    // Media

    public fun mediaFile(sha256: String): Path {
        require(sha256Pattern.matches(sha256)) { "Invalid media SHA-256" }
        return media.resolve(sha256)
    }

    public fun partialFile(sha256: String): Path = media.resolve("${mediaFile(sha256).fileName}.part")

    /** Whether a verified media file is in the store with its expected size. */
    public fun hasMedia(sha256: String, size: Long): Boolean {
        val file = mediaFile(sha256).toFile()
        return file.isFile && file.length() == size
    }

    /** Moves a flushed, verified partial file into the content store. */
    public fun commitMedia(sha256: String) {
        val target = mediaFile(sha256)
        files.move(partialFile(sha256), target)
        target.toFile().setReadOnly()
        AtomicFiles.syncDirectory(media)
    }

    // Space and cleanup

    public fun space(): Space = space.invoke()

    /**
     * Deletes every manifest, media file and partial download not in the
     * given sets (`keepPartials` null keeps every partial download), and
     * leftover temporary files. Called at startup and after activation;
     * protected generations must be in the sets.
     */
    public fun collect(keepPublications: Set<String>, keepMedia: Set<String>, keepPartials: Set<String>?) {
        Files.list(generations).use { entries ->
            for (entry in entries.toList()) {
                if (entry.fileName.toString() !in keepPublications) entry.toFile().deleteRecursively()
            }
        }
        Files.list(media).use { entries ->
            for (entry in entries.toList()) {
                val name = entry.fileName.toString()
                val keep = when {
                    name.endsWith(".part") -> keepPartials == null || name.removeSuffix(".part") in keepPartials
                    else -> name in keepMedia
                }
                if (!keep) Files.deleteIfExists(entry)
            }
        }
        Files.list(root).use { entries ->
            for (entry in entries.toList()) {
                if (entry.fileName.toString().let { it.startsWith(".") && it.endsWith(".tmp") }) Files.deleteIfExists(entry)
            }
        }
        AtomicFiles.syncDirectory(media)
    }

    /** Deletes everything this player keeps, for erasure. */
    public fun eraseAll() {
        Files.list(root).use { entries -> entries.toList().forEach {
            if (!eraseTree(it)) throw IOException("PLAYER_ERASURE_FAILED")
        } }
        AtomicFiles.syncDirectory(root)
        Files.createDirectories(generations)
        Files.createDirectories(media)
    }
}
