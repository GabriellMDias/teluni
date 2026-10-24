package app.teluni.player

import android.content.Context
import android.os.SystemClock
import android.provider.Settings
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import app.teluni.player.core.store.AtomicFiles
import app.teluni.player.core.sync.CredentialVault
import app.teluni.player.core.time.ClockSource
import java.io.IOException
import java.net.URI
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
) : CredentialVault {
    private val files = AtomicFiles()

    @Synchronized
    override fun load(): ByteArray? = try {
        val bytes = files.read(path)
        if (bytes == null || bytes.size != 1 + 12 + 32 + 16 || bytes[0] != 1.toByte()) null else {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, bytes.copyOfRange(1, 13)))
            cipher.updateAAD(AAD)
            cipher.doFinal(bytes.copyOfRange(13, bytes.size)).takeIf { it.size == 32 }
        }
    } catch (_: GeneralSecurityException) {
        null
    } catch (_: IOException) {
        null
    }

    @Synchronized
    override fun save(credential: ByteArray) {
        require(credential.size == 32) { "INVALID_CREDENTIAL_LENGTH" }
        Files.createDirectories(path.parent)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key())
        cipher.updateAAD(AAD)
        files.write(path, byteArrayOf(1) + cipher.iv + cipher.doFinal(credential))
    }

    @Synchronized
    override fun erase() {
        Files.deleteIfExists(path)
        if (Files.isDirectory(path.parent)) AtomicFiles.syncDirectory(path.parent)
        deleteKey()
    }

    companion object {
        private const val ALIAS = "teluni-device-credential-v1"
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
