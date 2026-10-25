package app.teluni.player.core.sync

import java.time.Instant

/** Immutable secret state. Neither credentials nor their hashes belong in diagnostics. */
public class Credentials(current: ByteArray, pending: ByteArray? = null, public val rotatedAt: Instant? = null) {
    private val active = current.copyOf()
    private val candidate = pending?.copyOf()
    public val current: ByteArray get() = active.copyOf()
    public val pending: ByteArray? get() = candidate?.copyOf()

    init {
        require(active.size == 32 && (candidate == null || candidate.size == 32)) { "INVALID_CREDENTIAL_LENGTH" }
        require(candidate == null || !active.contentEquals(candidate)) { "INVALID_ROTATION_CANDIDATE" }
    }

    override fun toString(): String = "Credentials(REDACTED)"
}

/** The Android adapter atomically encrypts the entire bundle under one Keystore key. */
public interface CredentialVault {
    /** Null means absent or unreadable. A pending credential must survive process death with the current one. */
    public fun load(): Credentials?
    public fun save(credentials: Credentials)
    public fun erase()
}
