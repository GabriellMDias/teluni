package app.teluni.player.core.time

import java.time.Duration
import java.time.Instant
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue

class FakeClock(
    var monotonic: Long = 1_000,
    var wall: Long = Instant.parse("2026-10-20T12:00:00Z").toEpochMilli(),
    var automatic: Boolean = true,
    var boot: String = "boot-1",
) : ClockSource {
    override fun monotonicMillis(): Long = monotonic

    override fun wallMillis(): Long = wall

    override fun automaticTime(): Boolean = automatic

    override fun bootId(): String = boot

    fun advance(millis: Long) {
        monotonic += millis
        wall += millis
    }
}

class TrustedClockTest {
    private val server = Instant.parse("2026-10-20T12:00:00Z")

    @Test
    fun `is untrusted before any server answer`() {
        assertEquals(TrustedTime.Untrusted, TrustedClock(FakeClock(), null).now())
    }

    @Test
    fun `follows the monotonic clock from the midpoint of a sync`() {
        val source = FakeClock()
        val clock = TrustedClock(source, null)
        assertTrue(clock.anchor(server, sentMonotonic = 1_000, receivedMonotonic = 1_400))
        source.monotonic = 1_400
        // A wall clock set an hour wrong does not matter while anchored.
        source.wall += 3_600_000
        val now = assertIs<TrustedTime.Anchored>(clock.now())
        assertEquals(server.plusMillis(200), now.instant)
        assertEquals(Duration.ofMillis(200), now.uncertainty)
        assertEquals(Duration.ofMillis(3_600_000 - 200), clock.systemSkew())
        source.monotonic += 7 * 86_400_000L
        val week = assertIs<TrustedTime.Anchored>(clock.now())
        assertEquals(server.plusMillis(200).plus(Duration.ofDays(7)), week.instant)
        // Seven days at 100 ppm add about a minute of uncertainty.
        assertEquals(Duration.ofMillis(200 + 60_400), week.uncertainty)
    }

    @Test
    fun `keeps a better anchor over a slow answer`() {
        val source = FakeClock()
        val clock = TrustedClock(source, null)
        clock.anchor(server, 1_000, 1_100)
        assertFalse(clock.anchor(server.plusSeconds(100), 2_000, 2_000 + 20_000))
        source.monotonic = 1_050
        assertEquals(server, clock.now().instantOrNull)
        assertTrue(clock.anchor(server.plusSeconds(5), 6_000, 6_100))
    }

    @Test
    fun `survives a process restart within the same boot`() {
        val source = FakeClock()
        val first = TrustedClock(source, null)
        first.anchor(server, 1_000, 1_000)
        source.advance(60_000)
        val record = first.checkpoint()
        val second = TrustedClock(source, record)
        assertEquals(server.plusSeconds(60), second.now().instantOrNull)
        assertIs<TrustedTime.Anchored>(second.now())
    }

    @Test
    fun `after a reboot accepts only a network-set clock not earlier than the bound`() {
        val source = FakeClock()
        val clock = TrustedClock(source, null)
        clock.anchor(server, 1_000, 1_000)
        source.advance(120_000)
        val record = clock.checkpoint()
        assertEquals(server.plusSeconds(120).toEpochMilli(), record.lowerBoundMillis)

        val rebooted = FakeClock(monotonic = 500, wall = server.plusSeconds(600).toEpochMilli(), boot = "boot-2")
        assertEquals(TrustedTime.Estimated(server.plusSeconds(600)), TrustedClock(rebooted, record).now())
        // A box without a battery-backed clock boots in the past.
        rebooted.wall = Instant.parse("2020-01-01T00:00:00Z").toEpochMilli()
        assertEquals(TrustedTime.Untrusted, TrustedClock(rebooted, record).now())
        rebooted.wall = server.plusSeconds(600).toEpochMilli()
        rebooted.automatic = false
        assertEquals(TrustedTime.Untrusted, TrustedClock(rebooted, record).now())
    }

    @Test
    fun `detects the system clock going back while estimated`() {
        val source = FakeClock(boot = "boot-2")
        val clock = TrustedClock(source, ClockRecord(lowerBoundMillis = server.toEpochMilli()))
        assertIs<TrustedTime.Estimated>(clock.now())
        source.advance(300_000)
        clock.checkpoint()
        source.wall -= 600_000
        assertEquals(TrustedTime.Untrusted, clock.now())
        assertNull(clock.systemSkew())
    }

    @Test
    fun `ignores an anchor from a monotonic reading in the future`() {
        val source = FakeClock(monotonic = 100)
        val record = ClockRecord("boot-1", server.toEpochMilli(), 5_000, 10, server.toEpochMilli())
        assertIs<TrustedTime.Estimated>(TrustedClock(source, record).now())
    }
}
