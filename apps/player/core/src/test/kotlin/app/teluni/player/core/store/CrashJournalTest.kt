package app.teluni.player.core.store

import java.io.IOException
import java.nio.file.Path
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue
import org.junit.jupiter.api.io.TempDir

class CrashJournalTest {
    @TempDir lateinit var root: Path

    @Test fun `counts crashes durably and keeps only bounded player code frames`() {
        val store = PlayerStore(root)
        val journal = CrashJournal(store)
        assertEquals(0, journal.count())
        journal.record(listOf("https://synthetic-secret.example", "message=SYNTHETIC_SECRET",
            "java.io.File.read:42", "app.teluni.player.PlayerActivity.onCreate:42"))
        journal.record(List(25) { "app.teluni.player.PlayerRuntime.start:100" } + "token=SYNTHETIC_SECRET")
        assertEquals(2, CrashJournal(PlayerStore(root)).count())
        val raw = requireNotNull(store.record(PlayerStore.Record.DIAGNOSTICS)).decodeToString()
        assertFalse(raw.contains("SYNTHETIC_SECRET"))
        assertFalse(raw.contains("java.io.File"))
        assertEquals(20, Regex("PlayerRuntime").findAll(raw).count())
    }

    @Test fun `unknown or damaged evidence remains unknown after another crash`() {
        val store = PlayerStore(root)
        val journal = CrashJournal(store)
        for (raw in listOf("{bad", """{"format":2,"count":5,"frames":[]}""", """{"format":1,"count":-1,"frames":[]}""")) {
            store.saveRecord(PlayerStore.Record.DIAGNOSTICS, raw.encodeToByteArray())
            assertNull(journal.count())
            journal.record(emptyList())
            assertNull(journal.count())
        }
    }

    @Test fun `counter saturation never wraps negative and erasure removes the evidence`() {
        val store = PlayerStore(root)
        store.saveRecord(PlayerStore.Record.DIAGNOSTICS, """{"format":1,"count":2147483647,"frames":[]}""".encodeToByteArray())
        val journal = CrashJournal(store)
        journal.record(emptyList())
        assertEquals(Int.MAX_VALUE, journal.count())
        store.eraseAll()
        assertEquals(0, journal.count())
        assertNull(store.record(PlayerStore.Record.DIAGNOSTICS))
    }

    @Test fun `an interrupted diagnostic write preserves the preceding complete count`() {
        var crash = false
        val store = PlayerStore(root, AtomicFiles { path, step ->
            if (crash && path.fileName.toString() == "diagnostics.json" && step == WriteStep.TEMP_SYNCED) throw IOException("Synthetic interruption")
        })
        val journal = CrashJournal(store)
        journal.record(emptyList())
        crash = true
        assertFailsWith<IOException> { journal.record(emptyList()) }
        assertEquals(1, CrashJournal(PlayerStore(root)).count())
        assertTrue(requireNotNull(store.record(PlayerStore.Record.DIAGNOSTICS)).isNotEmpty())
    }
}
