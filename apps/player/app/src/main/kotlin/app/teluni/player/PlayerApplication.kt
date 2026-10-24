package app.teluni.player

import android.app.Application
import app.teluni.player.core.store.AtomicFiles
import java.nio.file.Files

class PlayerApplication : Application() {
    internal val runtime: PlayerRuntime by lazy { PlayerRuntime(this) }

    override fun onCreate() {
        super.onCreate()
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, failure ->
            try {
                val folder = filesDir.toPath().resolve("diagnostics")
                Files.createDirectories(folder)
                // Never persist exception messages, causes, payloads, credentials or content.
                val frames = failure.stackTrace.filter { it.className.startsWith("app.teluni.player.") }.take(20)
                    .joinToString("\n") { "${it.className}.${it.methodName}:${it.lineNumber}" }
                AtomicFiles().write(folder.resolve("last-crash.txt"), "PLAYER_CRASH\n$frames".toByteArray())
            } catch (_: Exception) {
                android.util.Log.e("TeluniPlayer", "CRASH_RECORD_FAILED")
            }
            previous?.uncaughtException(thread, failure)
        }
    }
}
