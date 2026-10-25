package app.teluni.player

import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import app.teluni.player.core.playback.Plan
import app.teluni.player.core.playback.PlaybackCondition
import app.teluni.player.core.store.AtomicFiles
import app.teluni.player.core.store.PlayerStore
import app.teluni.player.core.sync.ApiFailure
import app.teluni.player.core.sync.DeviceApi
import app.teluni.player.core.sync.DeviceReport
import app.teluni.player.core.sync.HttpDeviceApi
import app.teluni.player.core.sync.PlayerEngine
import app.teluni.player.core.sync.StagingOutcome
import app.teluni.player.core.sync.SyncFailure
import app.teluni.player.core.sync.SyncOutcome
import app.teluni.player.core.sync.SyncReport
import app.teluni.player.core.sync.Timed
import app.teluni.player.core.sync.SyncAnswer
import app.teluni.player.core.time.instantOrNull
import java.io.IOException
import java.nio.file.Files
import java.time.Duration
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArraySet
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/** UI-only pairing data must never enter logs, reports or exception messages. */
internal class PlayerSnapshot(
    val configured: Boolean = false,
    val paired: Boolean = false,
    val userCode: String? = null,
    val status: String = "SETUP",
    val plan: Plan = Plan.Neutral(PlaybackCondition.SETUP, null),
    val rotation: Int = 0,
) {
    override fun toString(): String = "PlayerSnapshot(status=$status)"
}

/** Android lifecycle adapter; enrollment, sync and staging rules remain in PlayerEngine. */
internal class PlayerRuntime(private val context: Context) {
    private val main = Handler(Looper.getMainLooper())
    private val workers = Executors.newScheduledThreadPool(3)
    private val downloads = Executors.newSingleThreadExecutor()
    private val integrity = Executors.newSingleThreadScheduledExecutor { task ->
        Thread({
            android.os.Process.setThreadPriority(android.os.Process.THREAD_PRIORITY_BACKGROUND)
            task.run()
        }, "teluni-media-integrity")
    }
    private val pendingChecks = ConcurrentHashMap.newKeySet<String>()
    private val staging = AtomicBoolean(false)
    private val running = AtomicBoolean(false)
    private val listeners = CopyOnWriteArraySet<(PlayerSnapshot) -> Unit>()
    private val configFile = context.filesDir.toPath().resolve("endpoint.txt")
    private val clock = AndroidClock(context)
    @Volatile private var nextExchange = 0L
    private var failureCount = 0
    @Volatile private var engine: PlayerEngine? = null
    @Volatile private var blocked = false
    @Volatile private var state = PlayerSnapshot()
    @Volatile private var exchangeStatus = "CONNECTING"
    private val store by lazy { PlayerStore(context.filesDir.toPath().resolve("player")) }

    fun observe(listener: (PlayerSnapshot) -> Unit) {
        listeners += listener
        listener(state)
    }
    fun removeObserver(listener: (PlayerSnapshot) -> Unit) { listeners -= listener }

    fun configure(raw: String) {
        val endpoint = PlayerEndpoint.parse(raw, BuildConfig.DEBUG)
        check(!Files.exists(configFile)) { "ALREADY_CONFIGURED" }
        AtomicFiles().write(configFile, endpoint.toByteArray())
    }

    fun start() {
        if (!running.compareAndSet(false, true)) return
        workers.execute {
            try {
                if (!Files.exists(configFile)) {
                    publish(PlayerSnapshot())
                    running.set(false)
                    return@execute
                }
                val endpoint = PlayerEndpoint.parse(Files.readAllBytes(configFile).toString(Charsets.UTF_8), BuildConfig.DEBUG)
                val http = HttpDeviceApi(endpoint, clock::monotonicMillis)
                // Suppress the renderer before core erasure removes the files being displayed.
                val api = object : DeviceApi by http {
                    override fun sync(credential: String, report: SyncReport): Timed<SyncAnswer> =
                        http.sync(credential, report).also {
                            if (it.value.clearRequired || it.value.status == "unlinked") {
                                blocked = true
                                publish(PlayerSnapshot(configured = true, status = "UNLINKED"))
                            }
                        }
                }
                engine = PlayerEngine(store, api,
                    KeystoreVault(context.filesDir.toPath().resolve("vault/credential.bin")), clock, BuildConfig.VERSION_NAME)
                workers.scheduleWithFixedDelay(::exchange, 0, 1, TimeUnit.SECONDS)
                workers.scheduleWithFixedDelay({ safely("CHECKPOINT_FAILED") { engine?.checkpoint() } }, 60, 60, TimeUnit.SECONDS)
                integrity.scheduleWithFixedDelay({ checkMedia() }, 10, 60, TimeUnit.SECONDS)
                workers.execute(::renderTick)
            } catch (_: Exception) {
                Log.e("TeluniPlayer", "PLAYER_START_FAILED")
                publish(PlayerSnapshot(configured = true, status = "STORAGE_ERROR"))
                running.set(false)
            }
        }
    }

    private fun publish(snapshot: PlayerSnapshot) {
        state = snapshot
        main.post { listeners.forEach { it(state) } }
    }

    private fun exchange() {
        val player = engine ?: return
        val now = clock.monotonicMillis()
        if (now < nextExchange) return
        try {
            player.retryErasureConfirmation()
            if (player.identity() == null) {
                blocked = false
                val result = player.advanceEnrollment(deviceReport())
                exchangeStatus = if (result.paired) "CONNECTING" else "PAIRING"
                nextExchange = now + result.next.toMillis()
            } else {
                when (val result = player.sync()) {
                    is SyncOutcome.Synced -> {
                        exchangeStatus = "CONNECTED"
                        nextExchange = now + result.next.toMillis()
                        if (result.stagingNeeded && staging.compareAndSet(false, true)) {
                            downloads.execute {
                                try {
                                    when (player.stage()) {
                                        StagingOutcome.Superseded -> nextExchange = 0
                                        is StagingOutcome.Failed -> exchangeStatus = "STAGING_FAILED"
                                        else -> Unit
                                    }
                                } catch (_: Exception) {
                                    Log.e("TeluniPlayer", "STAGING_FAILED")
                                    exchangeStatus = "STAGING_FAILED"
                                } finally { staging.set(false) }
                            }
                        }
                    }
                    is SyncOutcome.Failed -> {
                        if (result.failure == SyncFailure.CREDENTIAL_ROTATION) Log.w("TeluniPlayer", "CREDENTIAL_ROTATION_RETRY")
                        exchangeStatus = "OFFLINE"
                        nextExchange = now + result.retry.toMillis()
                    }
                    SyncOutcome.Unauthorized -> { exchangeStatus = "UNAUTHORIZED"; nextExchange = now + 120_000 }
                    SyncOutcome.Incompatible -> { exchangeStatus = "INCOMPATIBLE"; nextExchange = now + 120_000 }
                    is SyncOutcome.Cleared, SyncOutcome.NotPaired -> nextExchange = 0
                }
            }
            failureCount = 0
        } catch (failure: IOException) {
            failureCount++
            exchangeStatus = "OFFLINE"
            val retry = maxOf((5L shl minOf(failureCount, 4)) * 1000, (failure as? ApiFailure)?.retryAfter?.toMillis() ?: 0)
            nextExchange = now + retry.coerceAtMost(TimeUnit.HOURS.toMillis(1))
        } catch (_: Exception) {
            Log.e("TeluniPlayer", "EXCHANGE_FAILED")
            exchangeStatus = "SYNC_ERROR"
            nextExchange = now + 30_000
        }
    }

    private fun renderTick() {
        var delay = 1000L
        safely("PLANNING_FAILED") {
            val player = engine ?: return@safely
            val paired = player.identity() != null
            val plan = if (paired && !blocked) player.plan() else Plan.Neutral(PlaybackCondition.SETUP, null)
            if (plan is Plan.Neutral) player.playback = plan.condition
            publish(PlayerSnapshot(true, paired, player.pendingEnrollment?.userCode, exchangeStatus, plan, player.syncRecord()?.rotation ?: 0))
            val now = player.clock.now().instantOrNull
            if (now != null && plan.until != null) delay = Duration.between(now, plan.until).toMillis().coerceIn(1, 1000)
        }
        workers.schedule(::renderTick, delay, TimeUnit.MILLISECONDS)
    }

    private fun checkMedia(sha256: String? = null) {
        try {
            if (engine?.scrubMedia(sha256) == true) nextExchange = 0
        } catch (_: Exception) {
            Log.e("TeluniPlayer", "MEDIA_CHECK_FAILED")
        }
    }

    fun reportMediaFailure(sha256: String) {
        if (!pendingChecks.add(sha256)) return
        integrity.execute {
            try { checkMedia(sha256) } finally { pendingChecks.remove(sha256) }
        }
    }

    fun reportPlayback(condition: PlaybackCondition) { engine?.playback = condition }
    fun mediaPath(sha256: String): String = store.mediaFile(sha256).toString()

    private fun deviceReport(): DeviceReport {
        val display = context.resources.displayMetrics
        return DeviceReport(BuildConfig.VERSION_NAME, 2, Build.MANUFACTURER.take(120), Build.MODEL.take(120),
            Build.VERSION.RELEASE.take(120), DeviceReport.Display(display.widthPixels, display.heightPixels), listOf(0, 90, 180, 270))
    }

    private inline fun safely(code: String, block: () -> Unit) {
        try { block() } catch (_: Exception) {
            Log.e("TeluniPlayer", code)
            publish(PlayerSnapshot(configured = true, paired = true, status = code,
                plan = Plan.Neutral(PlaybackCondition.DEGRADED, null)))
        }
    }
}
