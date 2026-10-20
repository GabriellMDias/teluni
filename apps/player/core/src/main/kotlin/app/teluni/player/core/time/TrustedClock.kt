package app.teluni.player.core.time

import java.time.Duration
import java.time.Instant
import kotlinx.serialization.Serializable

/** What the platform tells the clock: the player never calls the system directly here. */
public interface ClockSource {
    /** Monotonic milliseconds since boot, counting deep sleep (`elapsedRealtime`). */
    public fun monotonicMillis(): Long

    /** The system wall clock in milliseconds since the epoch. */
    public fun wallMillis(): Long

    /** Whether the system sets its clock from the network. */
    public fun automaticTime(): Boolean

    /** Changes at every boot, so a monotonic reading is comparable only within one boot. */
    public fun bootId(): String
}

/** Business time as far as the player can trust it. */
public sealed interface TrustedTime {
    /** Anchored to a server answer received during this boot. */
    public data class Anchored(val instant: Instant, val uncertainty: Duration) : TrustedTime

    /** After a reboot without a server answer: the system clock, not earlier than the persisted bound. */
    public data class Estimated(val instant: Instant) : TrustedTime

    /** No trustworthy business time: time-dependent output stops (`CLOCK_UNTRUSTED`). */
    public data object Untrusted : TrustedTime
}

public val TrustedTime.instantOrNull: Instant?
    get() = when (this) {
        is TrustedTime.Anchored -> instant
        is TrustedTime.Estimated -> instant
        TrustedTime.Untrusted -> null
    }

/** What survives a restart: the anchor (valid within its boot) and the lower bound. */
@Serializable
public data class ClockRecord(
    val bootId: String? = null,
    val serverMillis: Long? = null,
    val monotonicMillis: Long? = null,
    val uncertaintyMillis: Long? = null,
    val lowerBoundMillis: Long? = null,
)

/**
 * Trusted time of the player design: a monotonic anchor set at each sync,
 * a persisted lower bound, and the system clock after a reboot only when it
 * is not earlier than that bound and set from the network.
 */
public class TrustedClock(private val source: ClockSource, record: ClockRecord?) {
    private var anchor: Anchor? = null
    private var lowerBound: Long? = record?.lowerBoundMillis

    private data class Anchor(val serverMillis: Long, val monotonicMillis: Long, val uncertaintyMillis: Long)

    init {
        // Monotonic time restarts at boot; an anchor from another boot means nothing.
        if (record != null && record.bootId == source.bootId() && record.serverMillis != null &&
            record.monotonicMillis != null && record.uncertaintyMillis != null &&
            record.monotonicMillis <= source.monotonicMillis()
        ) {
            anchor = Anchor(record.serverMillis, record.monotonicMillis, record.uncertaintyMillis)
        }
    }

    /**
     * Anchors to a server time read between two monotonic readings, using the
     * midpoint. A slow round trip never replaces a better anchor of this boot.
     * Returns whether the anchor changed.
     */
    public fun anchor(serverTime: Instant, sentMonotonic: Long, receivedMonotonic: Long): Boolean {
        require(receivedMonotonic >= sentMonotonic) { "The answer cannot arrive before the request" }
        val uncertainty = (receivedMonotonic - sentMonotonic + 1) / 2
        val current = anchor
        if (receivedMonotonic - sentMonotonic > MAX_ROUND_TRIP_MILLIS && current != null &&
            current.uncertaintyMillis + driftMillis(receivedMonotonic - current.monotonicMillis) <= uncertainty
        ) {
            return false
        }
        anchor = Anchor(serverTime.toEpochMilli(), sentMonotonic + (receivedMonotonic - sentMonotonic) / 2, uncertainty)
        raiseLowerBound(serverTime.toEpochMilli())
        return true
    }

    public fun now(): TrustedTime {
        val current = anchor
        if (current != null) {
            val elapsed = source.monotonicMillis() - current.monotonicMillis
            return TrustedTime.Anchored(
                Instant.ofEpochMilli(current.serverMillis + elapsed),
                Duration.ofMillis(current.uncertaintyMillis + driftMillis(elapsed)),
            )
        }
        val bound = lowerBound ?: return TrustedTime.Untrusted
        val wall = source.wallMillis()
        return if (source.automaticTime() && wall >= bound) TrustedTime.Estimated(Instant.ofEpochMilli(wall)) else TrustedTime.Untrusted
    }

    /** How far the system clock is from anchored time, for diagnostics; null without an anchor. */
    public fun systemSkew(): Duration? {
        val time = now() as? TrustedTime.Anchored ?: return null
        return Duration.ofMillis(source.wallMillis() - time.instant.toEpochMilli())
    }

    /** Raises the lower bound to the current trusted time; call every minute and persist the record. */
    public fun checkpoint(): ClockRecord {
        now().instantOrNull?.let { raiseLowerBound(it.toEpochMilli()) }
        return record()
    }

    public fun record(): ClockRecord {
        val current = anchor
        return ClockRecord(
            bootId = current?.let { source.bootId() },
            serverMillis = current?.serverMillis,
            monotonicMillis = current?.monotonicMillis,
            uncertaintyMillis = current?.uncertaintyMillis,
            lowerBoundMillis = lowerBound,
        )
    }

    private fun raiseLowerBound(millis: Long) {
        lowerBound = maxOf(lowerBound ?: millis, millis)
    }

    public companion object {
        /** Answers slower than this never replace a better anchor. */
        public const val MAX_ROUND_TRIP_MILLIS: Long = 10_000

        /** A conservative crystal drift for the reported uncertainty: 100 ppm. */
        private const val DRIFT_PER_MILLION = 100

        private fun driftMillis(elapsed: Long): Long = maxOf(elapsed, 0) / 1_000_000 * DRIFT_PER_MILLION
    }
}
