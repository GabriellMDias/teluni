package app.teluni.player.core.store

import java.io.IOException
import java.nio.file.Files
import java.nio.file.Path
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue
import org.junit.jupiter.api.io.TempDir

class PlayerStoreTest {
    @TempDir
    lateinit var root: Path

    private class Crash : IOException("power cut")

    @Test
    fun `replaces a record atomically whatever step a power cut interrupts`() {
        val target = root.resolve("state.json")
        AtomicFiles().write(target, "old".encodeToByteArray())
        for (step in WriteStep.entries) {
            val files = AtomicFiles { _, at -> if (at == step) throw Crash() }
            assertFailsWith<Crash> { files.write(target, "new".encodeToByteArray()) }
            val seen = AtomicFiles().read(target)?.decodeToString()
            // Up to the rename the old record stands; from the rename on, the new one.
            val expected = if (step.ordinal < WriteStep.RENAMED.ordinal) "old" else "new"
            assertEquals(expected, seen, "interrupted at $step")
            AtomicFiles().write(target, "old".encodeToByteArray())
        }
    }

    @Test
    fun `reads an unreadable or unknown state as empty`() {
        val store = PlayerStore(root)
        assertEquals(PlayerState(), store.state())
        store.saveRecord(PlayerStore.Record.STATE, "{not json".encodeToByteArray())
        assertEquals(PlayerState(), store.state())
        store.saveRecord(PlayerStore.Record.STATE, """{"format":2}""".encodeToByteArray())
        assertEquals(PlayerState(), store.state())
        val state = PlayerState(active = StoredGeneration("p1", "a".repeat(64), "2026-10-20T12:00:00Z"))
        store.saveState(state)
        assertEquals(state, PlayerStore(root).state())
    }

    @Test
    fun `keeps media write-once by SHA-256 and collects the rest`() {
        val store = PlayerStore(root)
        val keep = "1".repeat(64)
        val drop = "2".repeat(64)
        val partial = "3".repeat(64)
        for (sha in listOf(keep, drop)) {
            Files.write(store.partialFile(sha), byteArrayOf(1, 2, 3))
            store.commitMedia(sha)
        }
        Files.write(store.partialFile(partial), byteArrayOf(9))
        store.saveManifest("p1", "{}".encodeToByteArray())
        store.saveManifest("p2", "{}".encodeToByteArray())
        Files.write(root.resolve(".state.json.tmp"), byteArrayOf(0))
        assertTrue(store.hasMedia(keep, 3))
        assertFalse(store.hasMedia(keep, 4))

        store.collect(setOf("p1"), setOf(keep), null)
        assertTrue(store.hasMedia(keep, 3))
        assertFalse(store.hasMedia(drop, 3))
        assertTrue(Files.exists(store.partialFile(partial)))
        assertContentEquals("{}".encodeToByteArray(), store.manifest("p1"))
        assertNull(store.manifest("p2"))
        assertFalse(Files.exists(root.resolve(".state.json.tmp")))

        store.collect(setOf("p1"), setOf(keep), emptySet())
        assertFalse(Files.exists(store.partialFile(partial)))
    }

    @Test
    fun `refuses names that could leave the store`() {
        val store = PlayerStore(root)
        assertFailsWith<IllegalArgumentException> { store.mediaFile("../state.json") }
        assertFailsWith<IllegalArgumentException> { store.manifest("../../etc") }
    }

    @Test
    fun `erases everything`() {
        val store = PlayerStore(root)
        store.saveState(PlayerState(active = StoredGeneration("p1", "a".repeat(64), "2026-10-20T12:00:00Z")))
        store.saveRecord(PlayerStore.Record.CREDENTIAL, byteArrayOf(1))
        store.saveManifest("p1", "{}".encodeToByteArray())
        store.eraseAll()
        assertEquals(PlayerState(), store.state())
        assertNull(store.record(PlayerStore.Record.CREDENTIAL))
        assertNull(store.manifest("p1"))
    }
}
