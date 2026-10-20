package app.teluni.player.core.sync

import app.teluni.player.core.playback.Plan
import app.teluni.player.core.playback.PlaybackCondition
import app.teluni.player.core.protocol.StagingFailureCode
import app.teluni.player.core.protocol.sha256Hex
import app.teluni.player.core.store.PlayerState
import app.teluni.player.core.store.PlayerStore
import app.teluni.player.core.time.FakeClock
import app.teluni.player.core.time.TrustedTime
import com.nimbusds.jose.jwk.Curve
import com.nimbusds.jose.jwk.gen.ECKeyGenerator
import java.nio.file.Files
import java.nio.file.Path
import java.time.Duration
import java.time.Instant
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import org.junit.jupiter.api.io.TempDir

class MemoryVault : CredentialVault {
    var value: ByteArray? = null

    override fun load(): ByteArray? = value?.copyOf()

    override fun save(credential: ByteArray) {
        value = credential.copyOf()
    }

    override fun erase() {
        value = null
    }
}

class PlayerEngineTest {
    @TempDir
    lateinit var root: Path

    // 2026-10-20T12:00Z is 09:00 in São Paulo: inside the 08:00-18:00 rule.
    private val clock = FakeClock(wall = Instant.parse("2026-10-20T12:00:00Z").toEpochMilli())
    private val server = FakeServer(clock)
    private val vault = MemoryVault()
    private var space = PlayerStore.Space(free = 64L shl 30, total = 128L shl 30)
    private val report = DeviceReport("1.0.0", 1, "Synthetic", "TV", "14", DeviceReport.Display(1920, 1080), listOf(0))

    private fun engine() = PlayerEngine(PlayerStore(root, space = { space }), server, vault, clock, "1.0.0-test")

    private fun paired(): PlayerEngine = engine().also { engine ->
        val started = engine.startEnrollment(report)
        assertEquals("paired", engine.pollEnrollment(started.enrollmentId).status)
    }

    private fun publication(id: String, seed: Int = 1) = FakeServer.publication(id, server.companyId, seed = seed)

    private fun PlayerEngine.syncAndStage(): StagingOutcome {
        val synced = assertIs<SyncOutcome.Synced>(sync())
        return if (synced.stagingNeeded) stage() else StagingOutcome.Idle
    }

    @Test
    fun `pairs, synchronizes, stages, activates and plays by schedule`() {
        val engine = paired()
        assertEquals(server.deviceId, engine.identity()?.deviceId)
        server.publish(publication("pub-a"))

        assertEquals(StagingOutcome.Activated("pub-a"), engine.syncAndStage())
        assertEquals(1, server.keyFetches)
        assertEquals(server.companyId, engine.identity()?.companyId)
        val play = assertIs<Plan.Play>(engine.plan())
        assertEquals("day", play.playlist.id)
        assertEquals(Instant.parse("2026-10-20T21:00:00Z"), play.until)

        engine.playback = PlaybackCondition.PLAYING
        val acknowledged = engine.report()
        assertEquals("pub-a", acknowledged.active?.publicationId)
        assertNull(acknowledged.staging)
        assertEquals("PLAYING", acknowledged.playback)

        // The next statement lists only the active publication.
        assertIs<SyncOutcome.Synced>(engine.sync())
        assertEquals(listOf("pub-a"), engine.latestStatement()?.publications?.map { it.id })

        // After 18:00 local the default playlist plays.
        clock.advance(Duration.ofHours(9).toMillis())
        assertEquals("evening", assertIs<Plan.Play>(engine.plan()).playlist.id)
    }

    @Test
    fun `resumes an interrupted download from where it stopped`() {
        val engine = paired()
        server.publish(publication("pub-a"))
        server.failMediaAfter = 600
        val failed = assertIs<StagingOutcome.Failed>(engine.syncAndStage())
        assertEquals(StagingFailureCode.DOWNLOAD_FAILED, failed.code)
        assertEquals("FAILED", engine.report().staging?.state)
        assertIs<Plan.Neutral>(engine.plan())

        // Each download resumes from what its partial file holds.
        val store = PlayerStore(root)
        val publication = server.publications.getValue("pub-a")
        val held = publication.media.mapValues { (_, bytes) ->
            store.partialFile(sha256Hex(bytes)).toFile().let { if (it.isFile) it.length() else 0L }
        }
        assertTrue(held.values.any { it == 600L })
        server.failMediaAfter = null
        server.mediaRequests.clear()
        assertEquals(StagingOutcome.Activated("pub-a"), engine.syncAndStage())
        assertEquals(held.toList().sortedBy { it.first }, server.mediaRequests.sortedBy { it.first })
    }

    @Test
    fun `keeps what a staging attempt already downloaded across a restart`() {
        val engine = paired()
        server.publish(publication("pub-a"))
        engine.syncAndStage()
        server.publish(publication("pub-b", seed = 2))
        // The image (1,500 bytes) completes; the video stops after 1,500 bytes.
        server.failMediaAfter = 1_500
        assertIs<StagingOutcome.Failed>(engine.syncAndStage())

        val restarted = engine()
        val image = server.publications.getValue("pub-b").media.getValue("m2-0")
        assertTrue(PlayerStore(root).hasMedia(sha256Hex(image), image.size.toLong()))
        server.failMediaAfter = null
        server.mediaRequests.clear()
        assertEquals(StagingOutcome.Activated("pub-b"), restarted.syncAndStage())
        assertEquals(listOf("m2-1" to 1_500L), server.mediaRequests.toList())
    }

    @Test
    fun `frees a superseded staging attempt's files before checking the reserve`() {
        val engine = paired()
        server.publish(publication("pub-a"))
        engine.syncAndStage()
        // The volume holds the active generation plus one more publication, not two.
        val budget = du() + 6_500 + 4_000
        space = PlayerStore.Space(free = (1L shl 30) + budget, total = 2L shl 30)
        val measured = { PlayerStore.Space(free = (1L shl 30) + budget - du(), total = 2L shl 30) }
        val constrained = PlayerEngine(PlayerStore(root, space = measured), server, vault, clock, "1.0.0-test")
        server.publish(publication("pub-b", seed = 2))
        server.failMediaAfter = 1_500
        assertIs<StagingOutcome.Failed>(constrained.syncAndStage())
        server.failMediaAfter = null

        server.publish(publication("pub-c", seed = 3))
        assertEquals(StagingOutcome.Activated("pub-c"), constrained.syncAndStage())
        val store = PlayerStore(root)
        for (bytes in server.publications.getValue("pub-b").media.values) {
            assertTrue(!Files.exists(store.mediaFile(sha256Hex(bytes))) && !Files.exists(store.partialFile(sha256Hex(bytes))))
        }
    }

    private fun du(): Long = Files.walk(root).use { paths -> paths.filter(Files::isRegularFile).mapToLong(Files::size).sum() }

    @Test
    fun `erases everything when the credential can no longer be read`() {
        val engine = paired()
        server.publish(publication("pub-a"))
        engine.syncAndStage()
        assertIs<Plan.Play>(engine.plan())
        // A Keystore reset: the wrapped credential cannot be decrypted.
        vault.value = null
        assertEquals(SyncOutcome.NotPaired, engine.sync())
        assertNull(engine.identity())
        assertEquals(PlayerState(), PlayerStore(root).state())
        assertEquals(PlaybackCondition.AUTHORIZATION_EXPIRED, assertIs<Plan.Neutral>(engine.plan()).condition)
    }

    @Test
    fun `starts over from a cleared store when the credential is gone at startup`() {
        paired().also { server.publish(publication("pub-a")) }.syncAndStage()
        vault.value = null
        val restarted = engine()
        assertNull(restarted.identity())
        assertNull(PlayerStore(root).manifest("pub-a"))
        assertIs<Plan.Neutral>(restarted.plan())
    }

    @Test
    fun `refuses corrupted media and keeps playing the active generation`() {
        val engine = paired()
        server.publish(publication("pub-a"))
        engine.syncAndStage()
        server.publish(publication("pub-b", seed = 2))
        server.corruptMedia = true
        val failed = assertIs<StagingOutcome.Failed>(engine.syncAndStage())
        assertEquals(StagingFailureCode.INTEGRITY_FAILED, failed.code)
        val play = assertIs<Plan.Play>(engine.plan())
        assertEquals("pub-a", play.publication.manifest.publicationId)

        server.corruptMedia = false
        assertEquals(StagingOutcome.Activated("pub-b"), engine.syncAndStage())
        assertEquals("pub-a", engine.report().recovery?.publicationId)
    }

    @Test
    fun `refuses to stage without room for the reserve`() {
        val engine = paired()
        server.publish(publication("pub-a"))
        space = PlayerStore.Space(free = (1L shl 30) + 1_000, total = 8L shl 30)
        val failed = assertIs<StagingOutcome.Failed>(engine.syncAndStage())
        assertEquals(StagingFailureCode.STORAGE_FULL, failed.code)
        assertEquals("STORAGE_FULL", engine.report().staging?.failure)
    }

    @Test
    fun `abandons a staging attempt when a newer publication is desired`() {
        val engine = paired()
        server.publish(publication("pub-a"))
        val once = AtomicBoolean(false)
        server.onMedia = {
            if (once.compareAndSet(false, true)) {
                server.publish(publication("pub-b", seed = 2))
                engine.sync()
            }
        }
        assertEquals(StagingOutcome.Superseded, engine.syncAndStage())
        assertEquals(StagingOutcome.Activated("pub-b"), engine.syncAndStage())
    }

    @Test
    fun `shows neutral output for an unpublished destination and after expiry`() {
        val engine = paired()
        server.publish(publication("pub-a"))
        engine.syncAndStage()
        assertIs<Plan.Play>(engine.plan())

        // Assigned to a destination without a publication: an empty statement.
        server.desired = null
        assertIs<SyncOutcome.Synced>(engine.sync())
        assertEquals(PlaybackCondition.NEUTRAL, assertIs<Plan.Neutral>(engine.plan()).condition)

        server.desired = server.publications.getValue("pub-a")
        engine.sync()
        assertIs<Plan.Play>(engine.plan())
        // Seven days without a renewal end protected output.
        clock.advance(Duration.ofDays(7).plusSeconds(1).toMillis())
        assertEquals(PlaybackCondition.AUTHORIZATION_EXPIRED, assertIs<Plan.Neutral>(engine.plan()).condition)
    }

    @Test
    fun `keeps a suspended company's screen on its last statement`() {
        val engine = paired()
        server.publish(publication("pub-a"))
        engine.syncAndStage()
        server.status = "suspended"
        assertIs<SyncOutcome.Synced>(engine.sync())
        assertIs<Plan.Play>(engine.plan())
        clock.advance(Duration.ofDays(8).toMillis())
        engine.sync()
        assertEquals(PlaybackCondition.AUTHORIZATION_EXPIRED, assertIs<Plan.Neutral>(engine.plan()).condition)
    }

    @Test
    fun `plays offline after a restart and stops when the clock cannot be trusted`() {
        val first = paired()
        server.publish(publication("pub-a"))
        first.syncAndStage()
        clock.advance(120_000)
        first.checkpoint()

        // The process restarts within the same boot: the anchor still holds.
        val restarted = engine()
        assertIs<TrustedTime.Anchored>(restarted.clock.now())
        assertIs<Plan.Play>(restarted.plan())

        // A reboot without the server: the network-set clock is accepted.
        clock.boot = "boot-2"
        clock.monotonic = 5_000
        clock.advance(60_000)
        val rebooted = engine()
        assertIs<TrustedTime.Estimated>(rebooted.clock.now())
        assertIs<Plan.Play>(rebooted.plan())

        // A box that boots with its clock in the past shows neutral output.
        clock.wall = Instant.parse("2020-01-01T00:00:00Z").toEpochMilli()
        assertEquals(PlaybackCondition.CLOCK_UNTRUSTED, assertIs<Plan.Neutral>(engine().plan()).condition)
    }

    @Test
    fun `fetches the key set again only for a statement with an unknown key`() {
        val engine = paired()
        server.publish(publication("pub-a"))
        engine.syncAndStage()
        engine.sync()
        assertEquals(1, server.keyFetches)
        server.key = ECKeyGenerator(Curve.P_256).keyID("k2").generate()
        engine.sync()
        assertEquals(2, server.keyFetches)
        assertIs<Plan.Play>(engine.plan())
    }

    @Test
    fun `never replaces a statement with an older one`() {
        val engine = paired()
        server.publish(publication("pub-a"))
        engine.syncAndStage()
        val latest = assertNotNull(engine.latestStatement())
        server.iatShift = Duration.ofHours(-1)
        engine.sync()
        assertEquals(latest.issuedAt, engine.latestStatement()?.issuedAt)
    }

    @Test
    fun `erases everything and confirms when unlinked`() {
        val engine = paired()
        server.publish(publication("pub-a"))
        engine.syncAndStage()
        server.status = "unlinked"
        assertEquals(SyncOutcome.ClearRequired, engine.sync())
        assertTrue(engine.erase())
        assertEquals(1, server.erasures)
        assertNull(vault.value)
        assertNull(engine.identity())
        assertEquals(SyncOutcome.NotPaired, engine.sync())
        assertEquals(PlaybackCondition.AUTHORIZATION_EXPIRED, assertIs<Plan.Neutral>(engine.plan()).condition)
    }

    @Test
    fun `falls back to the recovery generation when the active one is broken`() {
        val engine = paired()
        server.publish(publication("pub-a"))
        engine.syncAndStage()
        server.publish(publication("pub-b", seed = 2))
        engine.syncAndStage()
        val store = PlayerStore(root)
        assertEquals("pub-b", store.state().active?.publicationId)
        val onlyInB = server.publications.getValue("pub-b").media.values.first()
        Files.delete(store.mediaFile(sha256Hex(onlyInB)))

        engine()
        val state = PlayerStore(root).state()
        assertEquals("pub-a", state.active?.publicationId)
        assertNull(state.recovery)
    }
}
