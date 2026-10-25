package app.teluni.player

import android.app.Application
import app.teluni.player.core.store.CrashJournal
import app.teluni.player.core.store.PlayerStore

class PlayerApplication : Application() {
    internal val runtime: PlayerRuntime by lazy { PlayerRuntime(this) }

    override fun onCreate() {
        super.onCreate()
        // Remove the older uncounted location; pairing-scoped evidence now lives inside the erased store.
        filesDir.resolve("diagnostics").deleteRecursively()
        val journal by lazy { CrashJournal(PlayerStore(filesDir.toPath().resolve("player"))) }
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, failure ->
            try {
                // Never persist exception messages, causes, payloads, credentials or content.
                val frames = failure.stackTrace.filter { it.className.startsWith("app.teluni.player.") }.take(20)
                    .map { "${it.className}.${it.methodName}:${it.lineNumber}" }
                journal.record(frames)
            } catch (_: Exception) {
                android.util.Log.e("TeluniPlayer", "CRASH_RECORD_FAILED")
            }
            previous?.uncaughtException(thread, failure)
        }
    }
}
