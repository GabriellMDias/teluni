package app.teluni.player

import android.content.Context
import android.os.SystemClock
import android.provider.Settings
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import app.teluni.player.core.store.AtomicFiles
import app.teluni.player.core.sync.CredentialVault
import app.teluni.player.core.sync.Credentials
import app.teluni.player.core.time.ClockSource
import java.io.IOException
import java.net.URI
import java.nio.ByteBuffer
import java.time.Instant
import java.nio.file.Files
import java.nio.file.Path
import java.security.GeneralSecurityException
import java.security.KeyStore
import java.util.UUID
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Public, non-secret server address; changing a paired screen's server requires erasure. */
internal object PlayerEndpoint {
    fun parse(raw: String, debug: Boolean): String {
        val url = try { URI(raw.trim()) } catch (_: Exception) { throw IllegalArgumentException("INVALID_ENDPOINT") }
        require(url.host != null && url.rawUserInfo == null && url.rawQuery == null && url.rawFragment == null &&
            url.port in -1..65535 && url.port != 0 && url.normalize() == url) { "INVALID_ENDPOINT" }
        require(url.scheme == "https" ||
            (debug && url.scheme == "http" && url.host in setOf("10.0.2.2", "127.0.0.1", "localhost"))) {
            "HTTPS_REQUIRED"
        }
        return url.toASCIIString().trimEnd('/')
    }
}

internal class AndroidClock(context: Context) : ClockSource {
    private val resolver = context.contentResolver
    private val boot = Settings.Global.getInt(resolver, Settings.Global.BOOT_COUNT, -1).let {
        // An unavailable boot count must never reuse an earlier process's monotonic anchor.
        if (it >= 0) "boot-$it" else UUID.randomUUID().toString()
    }
    override fun monotonicMillis(): Long = SystemClock.elapsedRealtime()
    override fun wallMillis(): Long = System.currentTimeMillis()
    override fun automaticTime(): Boolean = Settings.Global.getInt(resolver, Settings.Global.AUTO_TIME, 0) == 1
    override fun bootId(): String = boot
}

/** Only authenticated ciphertext is written to disk; the AES key never leaves Android Keystore. */
internal class KeystoreVault(
    private val path: Path,
    private val key: () -> SecretKey = ::androidKey,
    private val deleteKey: () -> Unit = ::deleteAndroidKey,
    private val files: AtomicFiles = AtomicFiles(),
) : CredentialVault {
    @Synchronized
    override fun load(): Credentials? = try {
        val bytes = files.read(path)
        if (bytes == null || bytes.isEmpty()) null else {
            val legacy = bytes[0] == 1.toByte()
            val supported = if (legacy) bytes.size == 61 else bytes[0] == 2.toByte() && bytes.size in setOf(69, 101)
            if (!supported) null else {
                val cipher = Cipher.getInstance("AES/GCM/NoPadding")
                cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, bytes.copyOfRange(1, 13)))
                cipher.updateAAD(if (legacy) AAD else ROTATION_AAD)
                val plain = cipher.doFinal(bytes.copyOfRange(13, bytes.size))
                if (legacy) Credentials(plain) else {
                    val input = ByteBuffer.wrap(plain)
                    val at = input.long.takeUnless { it == Long.MIN_VALUE }?.let(Instant::ofEpochMilli)
                    val current = ByteArray(32).also(input::get)
                    val pending = if (input.hasRemaining()) ByteArray(32).also(input::get) else null
                    Credentials(current, pending, at)
                }
            }
        }
    } catch (_: GeneralSecurityException) {
        null
    } catch (_: IOException) {
        null
    } catch (_: IllegalArgumentException) {
        null
    }

    @Synchronized
    override fun save(credentials: Credentials) {
        Files.createDirectories(path.parent)
        val pending = credentials.pending
        val plain = ByteBuffer.allocate(8 + 32 + (pending?.size ?: 0))
            .putLong(credentials.rotatedAt?.toEpochMilli() ?: Long.MIN_VALUE).put(credentials.current)
            .apply { if (pending != null) put(pending) }.array()
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key())
        cipher.updateAAD(ROTATION_AAD)
        files.write(path, byteArrayOf(2) + cipher.iv + cipher.doFinal(plain))
    }

    @Synchronized
    override fun erase() {
        Files.deleteIfExists(path)
        if (Files.isDirectory(path.parent)) {
            Files.list(path.parent).use { entries ->
                entries.filter { it.fileName.toString().let { name -> name.startsWith(".${path.fileName}.") && name.endsWith(".tmp") } }
                    .forEach { Files.deleteIfExists(it) }
            }
            AtomicFiles.syncDirectory(path.parent)
        }
        deleteKey()
    }

    companion object {
        private const val ALIAS = "teluni-device-credential-v1"
        private val ROTATION_AAD = "teluni-device-credential-v2".toByteArray(Charsets.UTF_8)
        private val AAD = "teluni-device-credential-v1".toByteArray(Charsets.UTF_8)
        private fun androidKey(): SecretKey {
            val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
            (store.getKey(ALIAS, null) as? SecretKey)?.let { return it }
            return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
                init(KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setKeySize(256).build())
            }.generateKey()
        }
        private fun deleteAndroidKey() {
            KeyStore.getInstance("AndroidKeyStore").apply { load(null); deleteEntry(ALIAS) }
        }
    }
}
