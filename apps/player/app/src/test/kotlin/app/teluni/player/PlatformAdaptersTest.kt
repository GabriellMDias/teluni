package app.teluni.player

import app.teluni.player.core.sync.Credentials
import app.teluni.player.core.store.AtomicFiles
import app.teluni.player.core.store.WriteStep
import java.io.IOException
import java.time.Instant
import javax.crypto.Cipher
import java.nio.file.Files
import java.security.GeneralSecurityException
import javax.crypto.spec.SecretKeySpec
import java.util.Locale
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class PlatformAdaptersTest {
    @get:Rule val folder = TemporaryFolder()

    @Test fun `money uses ISO minor units without the optional number-field decimals property`() {
        assertEquals("R$ 17,90", CatalogText.money(1790, "BRL", Locale.forLanguageTag("pt-BR")))
        assertEquals("$19.90", CatalogText.money(1990, "USD", Locale.US))
        assertEquals("¥1,200", CatalogText.money(1200, "JPY", Locale.US))
        assertTrue(CatalogText.money(1234, "KWD", Locale.US).endsWith("1.234"))
        assertThrows(IllegalArgumentException::class.java) { CatalogText.money(100, "ZZZ", Locale.US) }
    }

    @Test fun `release requires HTTPS and endpoints cannot contain credentials queries or fragments`() {
        assertEquals("https://example.test/api", PlayerEndpoint.parse(" https://example.test/api/ ", false))
        for (address in listOf("http://example.test", "http://10.0.2.2:3000", "https://user:secret@example.test",
            "https://example.test?token=secret", "https://example.test/#secret", "file:///tmp/server", "https://example.test/a/../b")) {
            assertThrows(IllegalArgumentException::class.java) { PlayerEndpoint.parse(address, false) }
        }
    }

    @Test fun `debug permits only the explicit local API addresses over HTTP`() {
        for (host in listOf("localhost", "127.0.0.1", "10.0.2.2")) {
            assertEquals("http://$host:3000", PlayerEndpoint.parse("http://$host:3000", true))
        }
        for (host in listOf("example.test", "192.168.1.2", "10.0.2.2.example.test", "127.1")) {
            assertThrows(IllegalArgumentException::class.java) { PlayerEndpoint.parse("http://$host:3000", true) }
        }
    }

    @Test fun `vault round trips authenticated ciphertext uses fresh IVs and erases its key`() {
        val path = folder.root.toPath().resolve("vault/credential.bin")
        val key = SecretKeySpec(ByteArray(32) { 7 }, "AES")
        var erased = false
        val vault = KeystoreVault(path, { key }, { erased = true })
        val credential = ByteArray(32) { it.toByte() }
        vault.save(Credentials(credential))
        val first = Files.readAllBytes(path)
        assertFalse(first.toList().windowed(credential.size).any { it == credential.toList() })
        assertArrayEquals(credential, vault.load()?.current)
        vault.save(Credentials(credential))
        assertFalse(first.contentEquals(Files.readAllBytes(path)))
        vault.erase()
        assertTrue(erased)
        assertNull(vault.load())
        assertFalse(Files.exists(path))
    }

    @Test fun `tampering truncated ciphertext and unavailable keys fail closed`() {
        val path = folder.root.toPath().resolve("credential.bin")
        val key = SecretKeySpec(ByteArray(32) { 7 }, "AES")
        val vault = KeystoreVault(path, { key }, {})
        vault.save(Credentials(ByteArray(32) { 42 }))
        val bytes = Files.readAllBytes(path)
        bytes[bytes.lastIndex] = (bytes.last().toInt() xor 1).toByte()
        Files.write(path, bytes)
        assertNull(vault.load())
        Files.write(path, byteArrayOf(1, 2))
        assertNull(vault.load())
        vault.save(Credentials(ByteArray(32)))
        assertNull(KeystoreVault(path, { throw GeneralSecurityException("synthetic") }, {}).load())
        assertThrows(IllegalArgumentException::class.java) { vault.save(Credentials(ByteArray(16))) }
    }
    @Test fun `legacy ciphertext upgrades forward with both secrets encrypted and a durable rotation time`() {
        val path = folder.root.toPath().resolve("credential.bin")
        val key = SecretKeySpec(ByteArray(32) { 7 }, "AES")
        val current = ByteArray(32) { 41 }
        val candidate = ByteArray(32) { 99 }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key)
        cipher.updateAAD("teluni-device-credential-v1".toByteArray())
        Files.write(path, byteArrayOf(1) + cipher.iv + cipher.doFinal(current))
        val vault = KeystoreVault(path, { key }, {})
        assertArrayEquals(current, vault.load()?.current)
        assertNull(vault.load()?.rotatedAt)
        assertNull(vault.load()?.pending)
        val at = Instant.parse("2026-10-24T12:00:00Z")
        vault.save(Credentials(current, candidate, at))
        assertEquals(2, Files.readAllBytes(path)[0].toInt())
        val restored = requireNotNull(KeystoreVault(path, { key }, {}).load())
        assertArrayEquals(current, restored.current)
        assertArrayEquals(candidate, restored.pending)
        assertEquals(at, restored.rotatedAt)
        val disk = Files.readAllBytes(path).toList()
        assertFalse(disk.windowed(32).any { it == current.toList() || it == candidate.toList() })
        assertFalse(restored.toString().contains("99"))
    }

    @Test fun `interruption at every atomic step preserves a complete recoverable secret bundle`() {
        val key = SecretKeySpec(ByteArray(32) { 7 }, "AES")
        val old = ByteArray(32) { 1 }
        val next = ByteArray(32) { 2 }
        for (step in WriteStep.entries) for (promoting in listOf(false, true)) {
            val path = folder.newFolder().toPath().resolve("credential.bin")
            val stable = KeystoreVault(path, { key }, {})
            stable.save(Credentials(old, if (promoting) next else null))
            val interrupted = KeystoreVault(path, { key }, {}, AtomicFiles { _, currentStep ->
                if (step == currentStep) throw IOException("Synthetic write interruption")
            })
            try {
                interrupted.save(if (promoting) Credentials(next, rotatedAt = Instant.EPOCH) else Credentials(old, next))
                fail("Expected an interrupted write")
            } catch (_: IOException) { }
            val restored = requireNotNull(stable.load())
            if (promoting) assertTrue(restored.current.contentEquals(next) || restored.pending?.contentEquals(next) == true)
            else assertArrayEquals(old, restored.current)
            stable.erase()
            Files.list(path.parent).use { assertEquals(0L, it.count()) }
        }
    }

    @Test fun `credential bundles copy caller arrays and reject identical candidates`() {
        val current = ByteArray(32) { 1 }
        val next = ByteArray(32) { 2 }
        val bundle = Credentials(current, next)
        current[0] = 3; next[0] = 3
        bundle.current[0] = 4
        requireNotNull(bundle.pending)[0] = 4
        assertEquals(1, bundle.current[0].toInt())
        assertEquals(2, requireNotNull(bundle.pending)[0].toInt())
        assertThrows(IllegalArgumentException::class.java) { Credentials(current, current) }
    }

}
