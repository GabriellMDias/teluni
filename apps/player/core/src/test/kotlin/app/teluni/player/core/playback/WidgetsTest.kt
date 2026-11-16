package app.teluni.player.core.playback

import app.teluni.player.core.Fixtures
import app.teluni.player.core.protocol.AuthorizedPublication
import app.teluni.player.core.protocol.ManifestParser
import app.teluni.player.core.protocol.StagingFailure
import app.teluni.player.core.protocol.Statement
import app.teluni.player.core.protocol.Widget
import app.teluni.player.core.protocol.WidgetBatch
import app.teluni.player.core.protocol.WidgetLive
import app.teluni.player.core.protocol.WidgetSourceData
import app.teluni.player.core.protocol.sha256Hex
import app.teluni.player.core.schedule.ZoneOffsets
import app.teluni.player.core.string
import app.teluni.player.core.time.TrustedTime
import java.time.Duration
import java.time.Instant
import java.time.LocalDateTime
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertIs
import kotlin.test.assertTrue
import kotlinx.serialization.json.jsonObject

class WidgetsTest {
    private val fixture = Fixtures.conformance.getValue("widgetManifest").jsonObject
    private val raw = fixture.getValue("bytes").string
    private val publication = ManifestParser.parse(raw.encodeToByteArray(), fixture.getValue("sha256").string)
    private val now = Instant.parse("2026-11-16T12:34:56Z")
    private val zone = ZoneOffsets(listOf(ZoneOffsets.Period(now.minusSeconds(86400), -10800)), now.plusSeconds(86400))
    private val statement = Statement("jws", "device", publication.header.companyId, now.minusSeconds(1), now.plusSeconds(3600), listOf(AuthorizedPublication(publication.header.publicationId, publication.sha256)))
    private val weather = WidgetLive("ready", now.toString(), now.plusSeconds(3600).toString(), WidgetSourceData.Weather(24.5, 70.0, "clearsky_day", now.toString()))
    private val headlines = WidgetLive("ready", now.toString(), now.plusSeconds(900).toString(), WidgetSourceData.Rss("Science", listOf(WidgetSourceData.Headline("First discovery", "https://example.org/1"), WidgetSourceData.Headline("Second discovery", "https://example.org/2"))))
    private fun batch() = WidgetBatch(publication.header.publicationId, listOf(WidgetBatch.Item("weather", weather), WidgetBatch.Item("rss", headlines)))

    @Test
    fun `parses all five API-generated widget types and refuses protocol 2 smuggling`() {
        assertEquals(3, publication.header.protocol)
        assertEquals(listOf("clock", "qr", "ticker", "weather", "rss"), publication.layout!!.areas.map { it.key })
        assertIs<Widget.Qr>(publication.layout.areas[1].widget)
        for (edited in listOf(raw.replace("\"protocol\":3", "\"protocol\":2"), raw.replace("\"version\":1", "\"version\":2"), raw.replace("\"speed\":60", "\"speed\":0"), raw.replace("\"foreground\":\"#FFFFFF\"", "\"foreground\":\"red\""))) {
            assertFailsWith<StagingFailure> { ManifestParser.parse(edited.encodeToByteArray(), sha256Hex(edited.encodeToByteArray())) }
        }
    }

    @Test
    fun `clock uses server offsets and trusted time and all widgets stop at authorization expiry`() {
        val data = WidgetCache.data(WidgetCacheRecord(batches = listOf(batch())), publication, now)
        val plan = assertIs<Plan.Compose>(PlaybackPlanner.plan(publication, statement, TrustedTime.Anchored(now, Duration.ZERO), zone, widgets = data))
        val clock = assertIs<AreaPlan.Widget>(plan.areas[0])
        assertEquals("09:34:56", clock.text.primary)
        assertEquals(false, plan.degraded)
        assertEquals("25°C", assertIs<AreaPlan.Widget>(plan.areas[3]).text.primary)
        assertEquals(PlaybackCondition.AUTHORIZATION_EXPIRED, assertIs<Plan.Neutral>(PlaybackPlanner.plan(publication, statement, TrustedTime.Anchored(statement.expiresAt, Duration.ZERO), zone, widgets = data)).condition)
        assertEquals(PlaybackCondition.CLOCK_UNTRUSTED, assertIs<Plan.Neutral>(PlaybackPlanner.plan(publication, statement, TrustedTime.Untrusted, zone, widgets = data)).condition)
    }

    @Test
    fun `retains previous data after source failures marks stale and expires at 24 hours`() {
        var record = WidgetCache.merge(WidgetCacheRecord(), batch(), publication, now, setOf(publication.header.publicationId))
        record = WidgetCache.merge(record, WidgetBatch(publication.header.publicationId, listOf(WidgetBatch.Item("weather", WidgetLive("unavailable", null, null, null)))), publication, now.plusSeconds(60), setOf(publication.header.publicationId))
        assertEquals(2, WidgetCache.data(record, publication, now.plusSeconds(60)).size)
        assertEquals("stale", WidgetCache.data(record, publication, now.plusSeconds(3601)).getValue("weather").status)
        assertTrue(WidgetCache.data(record, publication, now.plusSeconds(86400)).isEmpty())
        val foreign = batch().copy(publicationId = "foreign")
        assertTrue(WidgetCache.data(WidgetCacheRecord(batches = listOf(foreign)), publication, now).isEmpty())
        assertFailsWith<IllegalArgumentException> { WidgetCache.merge(record, foreign, publication, now, emptySet()) }
    }

    @Test
    fun `rejects duplicate wrong-type nonfinite and future live data`() {
        for (batch in listOf(batch().copy(items = batch().items + batch().items), WidgetBatch(publication.header.publicationId, listOf(WidgetBatch.Item("weather", headlines))), WidgetBatch(publication.header.publicationId, listOf(WidgetBatch.Item("weather", weather.copy(fetchedAt = now.plusSeconds(180).toString())))), WidgetBatch(publication.header.publicationId, listOf(WidgetBatch.Item("weather", weather.copy(data = WidgetSourceData.Weather(Double.NaN, 1.0, "rain", now.toString()))))))) {
            assertTrue(WidgetCache.data(WidgetCacheRecord(batches = listOf(batch)), publication, now).isEmpty())
        }
    }

    @Test
    fun `feed text bounds count Unicode code points consistently with the API`() {
        val source = "😀".repeat(120)
        val title = "😀".repeat(200)
        fun accepted(label: String, headline: String): Boolean {
            val live = headlines.copy(data = WidgetSourceData.Rss(label, listOf(WidgetSourceData.Headline(headline, null))))
            val batch = WidgetBatch(publication.header.publicationId, listOf(WidgetBatch.Item("rss", live)))
            return "rss" in WidgetCache.data(WidgetCacheRecord(batches = listOf(batch)), publication, now)
        }
        assertTrue(accepted(source, title))
        assertTrue(!accepted(source + "a", title))
        assertTrue(!accepted(source, title + "a"))
        assertTrue(!accepted("Source\n", title))
        assertTrue(!accepted(source, "Headline\u007f"))
    }

    @Test
    fun `headlines cycle by trusted epoch and missing sources produce explicit placeholders`() {
        val rss = assertIs<Widget.Rss>(publication.layout!!.areas[4].widget)
        val first = WidgetPresentation.text(rss, headlines, Instant.EPOCH, LocalDateTime.of(2026, 11, 16, 0, 0))
        val second = WidgetPresentation.text(rss, headlines, Instant.EPOCH.plusSeconds(10), LocalDateTime.of(2026, 11, 16, 0, 0))
        assertEquals("First discovery", first.primary)
        assertEquals("Second discovery", second.primary)
        val missing = WidgetPresentation.text(rss, null, now, LocalDateTime.of(2026, 11, 16, 0, 0))
        assertTrue(missing.unavailable)
        assertEquals("Notícias indisponíveis", missing.secondary)
    }
}
