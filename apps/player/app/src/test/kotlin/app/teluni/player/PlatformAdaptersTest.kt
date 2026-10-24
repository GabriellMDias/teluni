package app.teluni.player

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
        vault.save(credential)
        val first = Files.readAllBytes(path)
        assertFalse(first.toList().windowed(credential.size).any { it == credential.toList() })
        assertArrayEquals(credential, vault.load())
        vault.save(credential)
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
        vault.save(ByteArray(32) { 42 })
        val bytes = Files.readAllBytes(path)
        bytes[bytes.lastIndex] = (bytes.last().toInt() xor 1).toByte()
        Files.write(path, bytes)
        assertNull(vault.load())
        Files.write(path, byteArrayOf(1, 2))
        assertNull(vault.load())
        vault.save(ByteArray(32))
        assertNull(KeystoreVault(path, { throw GeneralSecurityException("synthetic") }, {}).load())
        assertThrows(IllegalArgumentException::class.java) { vault.save(ByteArray(16)) }
    }
}
