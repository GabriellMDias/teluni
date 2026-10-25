package app.teluni.player.core.store

import java.io.IOException
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json

/** Private, bounded crash evidence for this pairing; only the count enters a sync report. */
public class CrashJournal(private val store: PlayerStore) {
    @Serializable
    private data class Record(val format: Int = 1, val count: Int?, val frames: List<String>)

    private val json = Json { encodeDefaults = true }
    private val frame = Regex("app\\.teluni\\.player\\.[A-Za-z0-9_.$]+\\.[A-Za-z0-9_$<>]+:[0-9]{1,7}")

    /** Zero before a crash; null for unreadable/unknown evidence rather than a fabricated zero. */
    public fun count(): Int? = try {
        val bytes = store.record(PlayerStore.Record.DIAGNOSTICS)
        if (bytes == null) 0 else if (bytes.size > 16 * 1024) null else {
            val record = json.decodeFromString(Record.serializer(), bytes.decodeToString())
            record.count?.takeIf { record.format == 1 && it >= 0 }
        }
    } catch (_: IOException) {
        null
    } catch (_: SerializationException) {
        null
    } catch (_: IllegalArgumentException) {
        null
    }

    /** Never accepts exception messages, causes, thread names or arbitrary stack text. */
    @Synchronized
    public fun record(frames: List<String>) {
        val count = count()?.let { if (it == Int.MAX_VALUE) it else it + 1 }
        val allowed = frames.filter { it.length <= 240 && frame.matches(it) }.take(20)
        store.saveRecord(PlayerStore.Record.DIAGNOSTICS,
            json.encodeToString(Record.serializer(), Record(count = count, frames = allowed)).encodeToByteArray())
    }
}
