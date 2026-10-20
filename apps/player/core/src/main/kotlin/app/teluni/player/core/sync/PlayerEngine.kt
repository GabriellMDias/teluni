package app.teluni.player.core.sync

import app.teluni.player.core.playback.Plan
import app.teluni.player.core.playback.PlaybackCondition
import app.teluni.player.core.playback.PlaybackPlanner
import app.teluni.player.core.protocol.KeySet
import app.teluni.player.core.protocol.Manifest
import app.teluni.player.core.protocol.ManifestParser
import app.teluni.player.core.protocol.Publication
import app.teluni.player.core.protocol.StagingFailure
import app.teluni.player.core.protocol.StagingFailureCode
import app.teluni.player.core.protocol.Statement
import app.teluni.player.core.protocol.StatementRejected
import app.teluni.player.core.protocol.StatementVerifier
import app.teluni.player.core.protocol.sha256Hex
import app.teluni.player.core.schedule.ZoneOffsets
import app.teluni.player.core.store.PlayerState
import app.teluni.player.core.store.PlayerStore
import app.teluni.player.core.store.StoredGeneration
import app.teluni.player.core.time.ClockRecord
import app.teluni.player.core.time.ClockSource
import app.teluni.player.core.time.TrustedClock
import app.teluni.player.core.time.instantOrNull
import java.io.IOException
import java.io.InterruptedIOException
import java.io.InputStream
import java.nio.ByteBuffer
import java.nio.channels.FileChannel
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardOpenOption
import java.security.MessageDigest
import java.security.SecureRandom
import java.time.DateTimeException
import java.time.Duration
import java.time.Instant
import java.util.Base64
import java.util.concurrent.Callable
import java.util.concurrent.ExecutionException
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicLong
import kotlinx.serialization.KSerializer
import kotlinx.serialization.SerializationException
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/** Keeps the device credential; the Android app wraps it with an Android Keystore key. */
public interface CredentialVault {
    /** The 32-byte credential, or null when none is stored or it cannot be read back. */
    public fun load(): ByteArray?

    public fun save(credential: ByteArray)

    public fun erase()
}

/** Who this screen is: its device ID once paired and the company pinned from its first statement. */
@Serializable
public data class Identity(val deviceId: String, val companyId: String? = null)

/** The latest configuration a sync answer gave, kept for offline restarts. */
@Serializable
public data class SyncRecord(
    val status: String,
    val timeZone: String? = null,
    val zoneOffsets: ZoneOffsetsAnswer? = null,
    val rotation: Int? = null,
    val desired: SyncAnswer.Desired? = null,
)

public sealed interface SyncOutcome {
    /** Synchronized; staging is needed when the desired publication is not active or an old attempt remains. */
    public data class Synced(val next: Duration, val stagingNeeded: Boolean) : SyncOutcome

    /**
     * The screen was unlinked: it stopped staging, erased everything it kept
     * and, when `confirmed`, the server recorded the erasure. Enroll again.
     */
    public data class Cleared(val confirmed: Boolean) : SyncOutcome

    /** The API no longer recognizes the credential; keep playing until the statement expires. */
    public data object Unauthorized : SyncOutcome

    /** No protocol in common with the server: report and keep the active generation. */
    public data object Incompatible : SyncOutcome

    /** The request failed; try again after `retry`. */
    public data class Failed(val retry: Duration) : SyncOutcome

    public data object NotPaired : SyncOutcome
}

public sealed interface StagingOutcome {
    public data object Idle : StagingOutcome

    public data class Activated(val publicationId: String) : StagingOutcome

    /** A newer desired publication replaced this attempt; synchronize and stage again. */
    public data object Superseded : StagingOutcome

    public data class Failed(val code: StagingFailureCode) : StagingOutcome
}

/**
 * The player's synchronization, staging and activation (player design,
 * "Synchronization" and "Local storage, activation and recovery"). Every
 * call blocks: the app runs `sync` every `nextSyncSeconds` and `stage` when
 * a sync asks for it, on background threads, and asks `plan` for what to
 * show. State changes take one lock and are persisted before they count.
 */
public class PlayerEngine(
    private val store: PlayerStore,
    private val api: DeviceApi,
    private val vault: CredentialVault,
    private val clockSource: ClockSource,
    private val appVersion: String,
    private val random: SecureRandom = SecureRandom(),
    /** Waits between media requests and after `RATE_LIMITED`; replaceable in tests. */
    private val sleep: (Long) -> Unit = { Thread.sleep(it) },
) {
    private val json = Json {
        ignoreUnknownKeys = true
        encodeDefaults = true
    }
    private val lock = Any()
    private val syncing = Any()
    private val staging = Any()
    private var statement: Statement? = null
    private var publications = mutableMapOf<String, Publication>()

    @Volatile
    private var progress: SyncReport.Staging? = null

    @Volatile
    private var failures = 0

    /** Set while an erasure waits for staging to stop. */
    @Volatile
    private var erasing = false

    private val pacing = Any()
    private var nextMediaRequest = Long.MIN_VALUE

    /** What the renderer shows, reported in each sync. */
    @Volatile
    public var playback: PlaybackCondition = PlaybackCondition.SETUP

    public val clock: TrustedClock = TrustedClock(clockSource, readRecord(PlayerStore.Record.CLOCK, ClockRecord.serializer()))

    init {
        forgetWithoutCredential()
        reconcile()
    }

    // Records

    private fun <T> readRecord(name: PlayerStore.Record, serializer: KSerializer<T>): T? {
        val bytes = store.record(name) ?: return null
        return try {
            json.decodeFromString(serializer, bytes.decodeToString())
        } catch (_: SerializationException) {
            null
        } catch (_: IllegalArgumentException) {
            null
        }
    }

    private fun <T> saveRecord(name: PlayerStore.Record, serializer: KSerializer<T>, value: T) {
        store.saveRecord(name, json.encodeToString(serializer, value).encodeToByteArray())
    }

    public fun identity(): Identity? = readRecord(PlayerStore.Record.IDENTITY, Identity.serializer())

    public fun syncRecord(): SyncRecord? = readRecord(PlayerStore.Record.SYNC, SyncRecord.serializer())

    private fun credential(): String? {
        val credential = vault.load() ?: return null.also { forgetWithoutCredential() }
        return Base64.getUrlEncoder().withoutPadding().encodeToString(credential)
    }

    /**
     * A paired screen whose credential cannot be read back (for example after
     * a Keystore reset) erases everything it kept, so neither content nor a
     * stale identity outlives the credential; it then enrolls again.
     */
    private fun forgetWithoutCredential() {
        if (store.record(PlayerStore.Record.IDENTITY) == null || vault.load() != null) return
        synchronized(lock) {
            store.eraseAll()
            vault.erase()
            statement = null
            publications.clear()
            progress = null
        }
    }

    /** Persists the trusted clock's record; the app calls this every minute. */
    public fun checkpoint() {
        // One writer at a time, so an older record never overwrites a newer bound.
        synchronized(clock) {
            saveRecord(PlayerStore.Record.CLOCK, ClockRecord.serializer(), clock.checkpoint())
        }
    }

    // Enrollment

    /**
     * Starts an enrollment with a new credential, from an empty store as the
     * device enrollment design requires; an expired code always starts a new one.
     */
    public fun startEnrollment(report: DeviceReport): EnrollmentStarted {
        synchronized(lock) {
            store.eraseAll()
            statement = null
            publications.clear()
            progress = null
        }
        val credential = ByteArray(32).also(random::nextBytes)
        vault.save(credential)
        val hash = MessageDigest.getInstance("SHA-256").digest(credential)
        return api.startEnrollment(Base64.getUrlEncoder().withoutPadding().encodeToString(hash), report)
    }

    /** Polls an enrollment; when paired, records the device ID. */
    public fun pollEnrollment(enrollmentId: String): EnrollmentStatus {
        val credential = credential() ?: throw IllegalStateException("No credential to enroll with")
        val status = api.enrollmentStatus(enrollmentId, credential)
        if (status.status == "paired") {
            saveRecord(PlayerStore.Record.IDENTITY, Identity.serializer(), Identity(requireNotNull(status.deviceId)))
        }
        return status
    }

    // Synchronization

    public fun report(): SyncReport {
        val state = store.state()
        return SyncReport(
            protocols = listOf(ManifestParser.PROTOCOL),
            appVersion = appVersion,
            active = state.active?.let { SyncReport.Active(it.publicationId, requireNotNull(it.activatedAt)) },
            recovery = state.recovery?.let { SyncReport.Recovery(it.publicationId) },
            staging = progress,
            playback = playback.name,
            storage = store.space().let { SyncReport.Storage(it.free, it.total) }.takeIf { it.freeBytes <= it.totalBytes },
            deviceTime = Instant.ofEpochMilli(clockSource.wallMillis()).toString(),
        )
    }

    /**
     * One exchange at a time; concurrent callers wait for each other. An
     * unlinked screen erases itself here, after the exchange releases its lock.
     */
    public fun sync(): SyncOutcome {
        val outcome = synchronized(syncing) { exchange() }
        return if (outcome is SyncOutcome.Cleared) SyncOutcome.Cleared(erase()) else outcome
    }

    private fun exchange(): SyncOutcome {
        val identity = identity() ?: return SyncOutcome.NotPaired
        val credential = credential() ?: return SyncOutcome.NotPaired
        val timed = try {
            api.sync(credential, report())
        } catch (failure: ApiFailure) {
            return when (failure.code) {
                "DEVICE_UNAUTHORIZED" -> SyncOutcome.Unauthorized
                "PROTOCOL_UNSUPPORTED" -> SyncOutcome.Incompatible
                else -> failed(failure.retryAfter)
            }
        } catch (_: IOException) {
            return failed(null)
        }
        failures = 0
        val answer = timed.value
        val serverTime = try {
            Instant.parse(answer.serverTime)
        } catch (_: DateTimeException) {
            return failed(null)
        }
        clock.anchor(serverTime, timed.sentMonotonic, timed.receivedMonotonic)
        checkpoint()
        if (answer.clearRequired || answer.status == "unlinked") return SyncOutcome.Cleared(confirmed = false)
        saveRecord(
            PlayerStore.Record.SYNC,
            SyncRecord.serializer(),
            SyncRecord(answer.status, answer.timeZone, answer.zoneOffsets, answer.rotation, answer.desired),
        )
        answer.authorization?.let { accept(it, identity, credential) }
        val state = store.state()
        val desired = answer.desired?.publicationId
        // A leftover attempt for anything else is cleared by the next stage.
        val stagingNeeded = (desired != null && desired != state.active?.publicationId) ||
            (state.staging != null && state.staging.publicationId != desired)
        return SyncOutcome.Synced(Duration.ofSeconds(answer.nextSyncSeconds.toLong().coerceIn(5, 3600)), stagingNeeded)
    }

    private fun failed(retryAfter: Duration?): SyncOutcome.Failed {
        failures += 1
        val backoff = minOf(30L shl minOf(failures - 1, 2), 120L)
        val jitter = 0.8 + random.nextDouble() * 0.4
        val delay = Duration.ofMillis((backoff * 1000 * jitter).toLong())
        return SyncOutcome.Failed(if (retryAfter != null && retryAfter > delay) retryAfter else delay)
    }

    /** Verifies a statement, fetching the key set once for an unknown key, and keeps it if it is newer. */
    private fun accept(jws: String, identity: Identity, credential: String) {
        val pinned = store.record(PlayerStore.Record.KEYS)?.decodeToString()?.let(::parseKeys)
        val keyId = StatementVerifier.keyId(jws)
        val keys = if (pinned != null && (keyId == null || keyId in pinned.ids)) {
            pinned
        } else {
            val fetched = try {
                api.keys(credential)
            } catch (_: IOException) {
                return
            }
            val parsed = parseKeys(fetched) ?: return
            store.saveRecord(PlayerStore.Record.KEYS, fetched.encodeToByteArray())
            parsed
        }
        val verified = try {
            StatementVerifier.verify(jws, keys, identity.deviceId, identity.companyId)
        } catch (_: StatementRejected) {
            return
        }
        synchronized(lock) {
            val current = latestStatement()
            if (current != null && verified.issuedAt < current.issuedAt) return
            store.saveRecord(PlayerStore.Record.STATEMENT, jws.encodeToByteArray())
            statement = verified
            if (identity.companyId == null) {
                saveRecord(PlayerStore.Record.IDENTITY, Identity.serializer(), identity.copy(companyId = verified.company))
            }
        }
    }

    private fun parseKeys(json: String): KeySet? = try {
        KeySet.parse(json)
    } catch (_: IllegalArgumentException) {
        null
    }

    /** The latest verified statement, read back from storage after a restart. */
    public fun latestStatement(): Statement? = synchronized(lock) {
        statement ?: run {
            val identity = identity() ?: return null
            val jws = store.record(PlayerStore.Record.STATEMENT)?.decodeToString() ?: return null
            val keys = store.record(PlayerStore.Record.KEYS)?.decodeToString()?.let(::parseKeys) ?: return null
            try {
                StatementVerifier.verify(jws, keys, identity.deviceId, identity.companyId)
            } catch (_: StatementRejected) {
                null
            }?.also { statement = it }
        }
    }

    // Staging and activation

    /**
     * Stages the desired publication of the latest sync and activates it
     * when complete. Progress and failures appear in the next report.
     */
    public fun stage(): StagingOutcome = synchronized(staging) { stageDesired() }

    private fun stageDesired(): StagingOutcome {
        val identity = identity() ?: return StagingOutcome.Idle
        val credential = credential() ?: return StagingOutcome.Idle
        val desired = syncRecord()?.desired
        if (desired == null || store.state().active?.publicationId == desired.publicationId) {
            dropStaging()
            return StagingOutcome.Idle
        }
        val target = StoredGeneration(desired.publicationId, desired.manifestSha256)
        synchronized(lock) { store.saveState(store.state().copy(staging = target)) }
        progress = SyncReport.Staging(desired.publicationId, "DOWNLOADING", null, 0, 0)
        return try {
            val publication = fetchManifest(desired, identity, credential)
            // A superseded attempt's files are no longer protected: free their space first.
            synchronized(lock) { collect(store.state()) }
            val needed = publication.media.values.filter { !store.hasMedia(it.sha256, it.size) }.distinctBy { it.sha256 }
            val total = needed.sumOf { it.size }
            preflight(needed.sumOf { it.size - partialSize(it.sha256, it.size) })
            download(publication, needed, total, credential, desired.publicationId)
            progress = SyncReport.Staging(desired.publicationId, "VERIFYING", null, total, total)
            activate(publication, desired.publicationId)
        } catch (failure: StagingFailure) {
            progress = progress?.copy(state = "FAILED", failure = failure.code.name)
            StagingOutcome.Failed(failure.code)
        } catch (_: Superseded) {
            progress = null
            StagingOutcome.Superseded
        } catch (_: IOException) {
            // Storage errors outside a download, such as storing the manifest.
            progress = progress?.copy(state = "FAILED", failure = StagingFailureCode.DOWNLOAD_FAILED.name)
            StagingOutcome.Failed(StagingFailureCode.DOWNLOAD_FAILED)
        }
    }

    /** Forgets an attempt that is no longer desired, with the files only it used. */
    private fun dropStaging() {
        synchronized(lock) {
            val state = store.state()
            if (state.staging == null) return
            val cleared = state.copy(staging = null)
            store.saveState(cleared)
            progress = null
            collect(cleared)
        }
    }

    private class Superseded : Exception()

    private fun stillDesired(publicationId: String) {
        if (erasing || syncRecord()?.desired?.publicationId != publicationId) throw Superseded()
    }

    private fun fetchManifest(desired: SyncAnswer.Desired, identity: Identity, credential: String): Publication {
        val bytes = store.manifest(desired.publicationId)?.takeIf { sha256Hex(it) == desired.manifestSha256 }
            ?: try {
                api.manifest(credential, desired.publicationId)
            } catch (failure: ApiFailure) {
                if (failure.status == 404) throw Superseded()
                throw StagingFailure(StagingFailureCode.DOWNLOAD_FAILED, "Manifest download failed")
            } catch (_: IOException) {
                throw StagingFailure(StagingFailureCode.DOWNLOAD_FAILED, "Manifest download failed")
            }
        if (bytes.size.toLong() != desired.manifestSize) {
            throw StagingFailure(StagingFailureCode.INTEGRITY_FAILED, "The manifest size does not match")
        }
        val publication = ManifestParser.parse(bytes, desired.manifestSha256)
        if (publication.manifest.publicationId != desired.publicationId ||
            (identity.companyId != null && publication.manifest.companyId != identity.companyId)
        ) {
            throw StagingFailure(StagingFailureCode.INVALID_MANIFEST, "The manifest belongs to another publication")
        }
        store.saveManifest(desired.publicationId, bytes)
        synchronized(lock) { publications[desired.publicationId] = publication }
        return publication
    }

    private fun partialSize(sha256: String, size: Long): Long {
        val file = store.partialFile(sha256).toFile()
        return if (file.isFile && file.length() <= size) file.length() else 0
    }

    /**
     * AT-05: keep at least max(1 GiB, 10% of the volume) free after the planned
     * downloads. A generation whose media are all stored needs no room, so a
     * schedule-only change activates even on a volume already below the reserve.
     */
    private fun preflight(bytes: Long) {
        if (bytes <= 0) return
        val space = store.space()
        val reserve = maxOf(1L shl 30, space.total / 10)
        if (space.free - bytes < reserve) {
            throw StagingFailure(StagingFailureCode.STORAGE_FULL, "Not enough space for this publication")
        }
    }

    private fun download(
        publication: Publication,
        needed: List<Manifest.Media>,
        total: Long,
        credential: String,
        publicationId: String,
    ) {
        if (needed.isEmpty()) return
        val done = AtomicLong(needed.sumOf { partialSize(it.sha256, it.size) })
        val pool = Executors.newFixedThreadPool(MAX_DOWNLOADS)
        try {
            val tasks = needed.map { media ->
                pool.submit(
                    Callable {
                        stillDesired(publicationId)
                        fetchMedia(media, credential, publicationId) { bytes ->
                            val value = done.addAndGet(bytes)
                            progress = SyncReport.Staging(publicationId, "DOWNLOADING", null, value, total)
                        }
                    },
                )
            }
            for (task in tasks) {
                try {
                    task.get()
                } catch (error: ExecutionException) {
                    tasks.forEach { it.cancel(true) }
                    throw error.cause ?: error
                }
            }
        } finally {
            pool.shutdownNow()
        }
        check(publication.media.values.all { store.hasMedia(it.sha256, it.size) })
    }

    /**
     * Downloads one media file into its partial file, resuming from what is
     * there, and moves it into the store once its length and SHA-256 match.
     * A complete partial file that does not match is downloaded again; fresh
     * bytes that do not match fail the attempt as `INTEGRITY_FAILED`.
     */
    private fun fetchMedia(
        media: Manifest.Media,
        credential: String,
        publicationId: String,
        onBytes: (Long) -> Unit,
    ) {
        val partial = store.partialFile(media.sha256)
        val file = partial.toFile()
        if (file.isFile && file.length() > media.size) Files.delete(partial)
        var digest = MessageDigest.getInstance("SHA-256")
        var offset = if (file.isFile) file.length() else 0L
        if (offset > 0) Files.newInputStream(partial).use { input -> digestAll(input, digest) }
        if (offset == media.size) {
            if (hex(digest) == media.sha256) {
                store.commitMedia(media.sha256)
                return
            }
            Files.delete(partial)
            digest = MessageDigest.getInstance("SHA-256")
            offset = 0
        }
        var limited = 0
        while (true) {
            awaitMediaTurn(publicationId)
            try {
                requestMedia(partial, media, credential, offset, digest, onBytes)
                break
            } catch (failure: ApiFailure) {
                if (failure.status == 404) throw Superseded()
                // The API counts each credential's requests; wait as it says, then resume.
                if (failure.status == 429 && limited < MAX_RATE_LIMITED_RETRIES) {
                    limited += 1
                    sleep(minOf(failure.retryAfter?.toMillis() ?: DEFAULT_RETRY_MILLIS, MAX_RETRY_MILLIS))
                    continue
                }
                stillDesired(publicationId)
                throw StagingFailure(StagingFailureCode.DOWNLOAD_FAILED, "Media download failed")
            } catch (failure: StagingFailure) {
                Files.deleteIfExists(partial)
                throw failure
            } catch (_: IOException) {
                // The partial file stays for the next attempt to resume.
                throw StagingFailure(StagingFailureCode.DOWNLOAD_FAILED, "Media download failed")
            }
        }
        if (file.length() < media.size) {
            throw StagingFailure(StagingFailureCode.DOWNLOAD_FAILED, "The download ended early")
        }
        if (hex(digest) != media.sha256) {
            Files.deleteIfExists(partial)
            throw StagingFailure(StagingFailureCode.INTEGRITY_FAILED, "Media does not match its SHA-256")
        }
        store.commitMedia(media.sha256)
    }

    /**
     * Spaces media requests to at most one per [MEDIA_REQUEST_INTERVAL_MILLIS],
     * so a large publication never takes the requests a sync needs under the
     * API's per-credential limit (120 per minute).
     */
    private fun awaitMediaTurn(publicationId: String) {
        val wait = synchronized(pacing) {
            val now = clockSource.monotonicMillis()
            val turn = maxOf(now, nextMediaRequest)
            nextMediaRequest = turn + MEDIA_REQUEST_INTERVAL_MILLIS
            turn - now
        }
        if (wait > 0) sleep(wait)
        stillDesired(publicationId)
    }

    /** One media request, appending to the partial file and the digest. */
    private fun requestMedia(
        partial: Path,
        media: Manifest.Media,
        credential: String,
        offset: Long,
        digest: MessageDigest,
        onBytes: (Long) -> Unit,
    ) {
        FileChannel.open(partial, StandardOpenOption.CREATE, StandardOpenOption.WRITE, StandardOpenOption.APPEND)
            .use { channel ->
                api.media(credential, media.id, offset) { input ->
                    val buffer = ByteArray(64 * 1024)
                    var written = offset
                    while (true) {
                        if (erasing || Thread.currentThread().isInterrupted) throw InterruptedIOException()
                        val read = input.read(buffer)
                        if (read < 0) break
                        if (written + read > media.size) {
                            throw StagingFailure(StagingFailureCode.INTEGRITY_FAILED, "Media is longer than declared")
                        }
                        digest.update(buffer, 0, read)
                        val chunk = ByteBuffer.wrap(buffer, 0, read)
                        while (chunk.hasRemaining()) channel.write(chunk)
                        written += read
                        onBytes(read.toLong())
                    }
                }
                channel.force(true)
            }
    }

    private fun hex(digest: MessageDigest): String = digest.digest().joinToString("") { "%02x".format(it) }

    private fun digestAll(input: InputStream, digest: MessageDigest) {
        val buffer = ByteArray(64 * 1024)
        while (true) {
            val read = input.read(buffer)
            if (read < 0) return
            digest.update(buffer, 0, read)
        }
    }

    private fun activate(publication: Publication, publicationId: String): StagingOutcome = synchronized(lock) {
        stillDesired(publicationId)
        val statement = latestStatement()
        val instant = clock.now().instantOrNull
        if (statement == null || instant == null || instant >= statement.expiresAt ||
            !statement.authorizes(publicationId, publication.sha256)
        ) {
            // Ready, but not authorized yet: the next sync brings a statement that lists it.
            progress = SyncReport.Staging(publicationId, "READY", null, progress?.bytesTotal ?: 0, progress?.bytesTotal ?: 0)
            return StagingOutcome.Idle
        }
        val state = store.state()
        val activated = StoredGeneration(publicationId, publication.sha256, instant.toString())
        val next = PlayerState(active = activated, recovery = state.active, staging = null)
        store.saveState(next)
        progress = null
        collect(next)
        StagingOutcome.Activated(publicationId)
    }

    // Startup, playback and erasure

    /** Startup reconciliation: drops broken pointers and everything no generation needs. */
    private fun reconcile() {
        synchronized(lock) {
            var state = store.state()
            val active = state.active?.let(::load)
            val recovery = state.recovery?.let(::load)
            state = when {
                active != null -> state.copy(recovery = state.recovery?.takeIf { recovery != null })
                recovery != null -> state.copy(active = state.recovery, recovery = null)
                else -> state.copy(active = null, recovery = null)
            }
            if (state != store.state()) store.saveState(state)
            collect(state)
        }
    }

    /** A stored generation's parsed manifest, or null when it is missing or does not verify. */
    private fun parsed(generation: StoredGeneration): Publication? {
        publications[generation.publicationId]?.takeIf { it.sha256 == generation.manifestSha256 }?.let { return it }
        val bytes = store.manifest(generation.publicationId) ?: return null
        val publication = try {
            ManifestParser.parse(bytes, generation.manifestSha256)
        } catch (_: StagingFailure) {
            return null
        }
        publications[generation.publicationId] = publication
        return publication
    }

    /** A stored generation with its manifest and every media file, or null when anything is missing. */
    private fun load(generation: StoredGeneration): Publication? =
        parsed(generation)?.takeIf { publication -> publication.media.values.all { store.hasMedia(it.sha256, it.size) } }

    /**
     * Deletes what no kept generation needs (AT-19): the active and recovery
     * generations and the staging attempt with the media it already has.
     */
    private fun collect(state: PlayerState) {
        val kept = listOfNotNull(state.active, state.recovery, state.staging)
        val keepPublications = kept.map { it.publicationId }.toSet()
        val keepMedia = kept.mapNotNull(::parsed).flatMap { publication -> publication.media.values.map { it.sha256 } }.toSet()
        // Partial files belong to the staging attempt; while its manifest is unknown, all are kept.
        val stagingMedia = state.staging?.let(::parsed)?.media?.values?.map { it.sha256 }?.toSet()
        store.collect(keepPublications, keepMedia, if (state.staging == null) emptySet() else stagingMedia)
        publications = publications.filterKeys { it in keepPublications }.toMutableMap()
    }

    /** What to show now, from the active generation, the latest statement and trusted time. */
    public fun plan(): Plan {
        // Activation and startup reconciliation already established that the active generation is complete.
        val (active, statement) = synchronized(lock) {
            store.state().active?.let(::parsed) to latestStatement()
        }
        val zone = syncRecord()?.zoneOffsets?.let(::zoneOffsets)
        return PlaybackPlanner.plan(active, statement, clock.now(), zone)
    }

    private fun zoneOffsets(answer: ZoneOffsetsAnswer): ZoneOffsets? = try {
        ZoneOffsets(
            answer.periods.map { ZoneOffsets.Period(Instant.parse(it.from), it.offsetSeconds) },
            Instant.parse(answer.until),
        )
    } catch (_: IllegalArgumentException) {
        null
    } catch (_: DateTimeException) {
        null
    }

    /**
     * Erases everything private, then confirms the erasure with the credential
     * still in memory (device enrollment design). A staging attempt stops and
     * no exchange runs meanwhile, so nothing is written after the erasure.
     * Returns whether the server confirmed; the player enrolls again either way.
     */
    public fun erase(): Boolean {
        erasing = true
        try {
            synchronized(staging) {
                synchronized(syncing) {
                    val credential = credential()
                    synchronized(lock) {
                        store.eraseAll()
                        vault.erase()
                        statement = null
                        publications.clear()
                        progress = null
                    }
                    if (credential == null) return false
                    return try {
                        api.confirmErasure(credential)
                        true
                    } catch (_: IOException) {
                        false
                    }
                }
            }
        } finally {
            erasing = false
        }
    }

    private companion object {
        const val MAX_DOWNLOADS = 2

        /** About 85 media requests per minute, leaving room for syncs under 120. */
        const val MEDIA_REQUEST_INTERVAL_MILLIS = 700L
        const val MAX_RATE_LIMITED_RETRIES = 5
        const val DEFAULT_RETRY_MILLIS = 5_000L
        const val MAX_RETRY_MILLIS = 60_000L
    }
}
