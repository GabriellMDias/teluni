package app.teluni.player.core.playback

import app.teluni.player.core.Fixtures
import app.teluni.player.core.catalog.EffectivePrice
import app.teluni.player.core.catalog.PriceFacts
import app.teluni.player.core.catalog.PriceSource
import app.teluni.player.core.catalog.Prices
import app.teluni.player.core.catalog.Promotion
import app.teluni.player.core.protocol.AuthorizedPublication
import app.teluni.player.core.protocol.ManifestParser
import app.teluni.player.core.protocol.Statement
import app.teluni.player.core.schedule.ZoneOffsets
import app.teluni.player.core.string
import app.teluni.player.core.time.TrustedTime
import java.time.Duration
import java.time.Instant
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.test.assertIs
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long

class CompositionTest {
    @Test
    fun `finds the page of every shared page cycle`() {
        for (cycle in Fixtures.conformance.getValue("pageCycles").jsonArray.map { it.jsonObject }) {
            val position = cycle.getValue("position").jsonObject
            assertEquals(
                PagePosition(
                    position.getValue("page").jsonPrimitive.int,
                    position.getValue("startsAt").jsonPrimitive.int,
                    position.getValue("endsAt").jsonPrimitive.int,
                ),
                PageCycle.pageAt(
                    cycle.getValue("durations").jsonArray.map { it.jsonPrimitive.int },
                    cycle.getValue("secondOfDay").jsonPrimitive.int,
                ),
                cycle.getValue("id").string,
            )
        }
        assertEquals(null, PageCycle.pageAt(emptyList(), 0))
    }

    @Test
    fun `prices every shared case as the API does`() {
        for (case in Fixtures.conformance.getValue("prices").jsonArray.map { it.jsonObject }) {
            val facts = case.getValue("facts").jsonObject
            val price = case.getValue("price").jsonObject
            val expected = EffectivePrice(
                price.getValue("amount").takeUnless { it == JsonNull }?.jsonPrimitive?.long,
                PriceSource.valueOf(price.getValue("source").string.uppercase()),
                price.getValue("promotionId").takeUnless { it == JsonNull }?.string,
            )
            val actual = Prices.effective(
                PriceFacts(
                    facts.getValue("base").takeUnless { it == JsonNull }?.jsonPrimitive?.long,
                    facts.getValue("overrides").jsonArray.associate {
                        it.jsonObject.getValue("branchId").string to it.jsonObject.getValue("amount").jsonPrimitive.long
                    },
                    facts.getValue("promotions").jsonArray.map {
                        val promotion = it.jsonObject
                        Promotion(
                            promotion.getValue("id").string,
                            promotion.getValue("branchId").takeUnless { id -> id == JsonNull }?.string,
                            promotion.getValue("amount").jsonPrimitive.long,
                            promotion.getValue("startsAt").string,
                            promotion.getValue("endsAt").string,
                        )
                    },
                ),
                case.getValue("branchId").takeUnless { it == JsonNull }?.string,
                case.getValue("at").string,
            )
            assertEquals(expected, actual, case.getValue("id").string)
        }
    }

    // The conformance publication: a page-controlled media area with a
    // weekday lunch rule, and a menu that pages itself every 10 seconds.
    private val fixture = Fixtures.conformance.getValue("layoutManifest").jsonObject
    private val publication = ManifestParser.parse(
        fixture.getValue("bytes").string.encodeToByteArray(),
        fixture.getValue("sha256").string,
    )

    /** São Paulo, UTC-3 all along. */
    private val zone = ZoneOffsets(
        listOf(ZoneOffsets.Period(Instant.parse("2026-10-01T00:00:00Z"), -10_800)),
        Instant.parse("2026-12-01T00:00:00Z"),
    )
    private val centro = "3e402d85-8bd7-4d68-8c26-9f4abbccdd4f"

    private fun planAt(local: String, branchId: String? = centro, unavailable: Set<String> = emptySet()): Plan.Compose {
        val now = Instant.parse("${local}Z").plusSeconds(10_800)
        val statement = Statement(
            "jws",
            "device",
            publication.header.companyId,
            now,
            now.plus(Duration.ofDays(7)),
            listOf(AuthorizedPublication(publication.header.publicationId, publication.sha256)),
        )
        return assertIs<Plan.Compose>(
            PlaybackPlanner.plan(publication, statement, TrustedTime.Anchored(now, Duration.ZERO), zone, branchId, unavailable),
        )
    }

    private fun Plan.Compose.area(key: String): AreaPlan = areas.single { it.area.key == key }

    @Test
    fun `follows the page cycle and pages the menu by local time`() {
        // 09:00:20 on a Tuesday: the second page (45 s) shows the video.
        val plan = planAt("2026-10-20T09:00:20")
        assertEquals(listOf("video", "menu"), plan.areas.map { it.area.key })
        assertEquals(listOf(0, 1), plan.areas.map { it.area.z })
        val still = assertIs<AreaPlan.Still>(plan.area("video"))
        assertEquals("61d350b8-be0a-409b-9fb9-c27e8f900112", still.media.id)
        val menu = assertIs<AreaPlan.Catalog>(plan.area("menu"))
        assertEquals(3, menu.records.size)
        // The menu's 10-second page ends first, at 09:00:30 local.
        assertEquals(Instant.parse("2026-10-20T12:00:30Z"), plan.until)

        val first = planAt("2026-10-20T09:00:05")
        assertEquals("50c24fa7-adf9-4f8a-8ea8-b16d7e8f9001", assertIs<AreaPlan.Still>(first.area("video")).media.id)
        assertEquals(Instant.parse("2026-10-20T12:00:10Z"), first.until)
    }

    @Test
    fun `lets a regional schedule override a page-controlled area while it lasts`() {
        val lunch = planAt("2026-10-20T12:30:05")
        val play = assertIs<AreaPlan.Play>(lunch.area("video"))
        assertEquals("3ea02d85-8bd7-4d68-8c86-9f4b5c6d7e8f", play.playlist.id)
        assertIs<AreaPlan.Catalog>(lunch.area("menu"))
        // On Saturday the rule does not apply and the pages return.
        assertIs<AreaPlan.Still>(planAt("2026-10-24T12:30:05").area("video"))
    }

    @Test
    fun `a damaged page media leaves the catalog and schedule boundaries intact`() {
        val intact = planAt("2026-10-20T09:00:20")
        val damaged = assertIs<AreaPlan.Still>(intact.area("video")).media
        val plan = planAt("2026-10-20T09:00:20", unavailable = setOf(damaged.sha256))
        assertEquals(intact.area("menu"), plan.area("menu"))
        assertEquals(intact.until, plan.until)
        assertIs<AreaPlan.Empty>(plan.area("video"))
        assertTrue(plan.degraded)
        assertEquals(publication.sha256, plan.publication.sha256)
        assertTrue(damaged.id in publication.media)
    }

    @Test
    fun `a damaged regional playlist skips only the affected items`() {
        val intact = planAt("2026-10-20T12:30:05")
        val playlist = assertIs<AreaPlan.Play>(intact.area("video")).playlist
        val damaged = publication.media.getValue(playlist.items.first().mediaId)
        val plan = planAt("2026-10-20T12:30:05", unavailable = setOf(damaged.sha256))
        val expected = playlist.items.filter { publication.media.getValue(it.mediaId).sha256 != damaged.sha256 }
        if (expected.isEmpty()) assertIs<AreaPlan.Empty>(plan.area("video"))
        else assertEquals(expected, assertIs<AreaPlan.Play>(plan.area("video")).playlist.items)
        assertEquals(intact.area("menu"), plan.area("menu"))
        assertTrue(plan.degraded)
    }

    @Test
    fun `shows each branch its prices and replans when a promotion starts`() {
        fun prices(plan: Plan.Compose) = assertIs<AreaPlan.Catalog>(plan.area("menu")).records.map { record ->
            record.prices.values.single().let { it.amount to it.source }
        }
        val before = planAt("2026-10-26T07:59:55")
        assertEquals(
            listOf(450L to PriceSource.OVERRIDE, null to PriceSource.NONE, 750L to PriceSource.BASE),
            prices(before),
        )
        assertEquals(Instant.parse("2026-10-26T11:00:00Z"), before.until)
        assertEquals(
            listOf(400L to PriceSource.PROMOTION, null to PriceSource.NONE, 750L to PriceSource.BASE),
            prices(planAt("2026-10-26T08:00:05")),
        )
        // Another branch sees the base price where Centro has its own.
        assertEquals(500L to PriceSource.BASE, prices(planAt("2026-10-25T09:00:00", "other-branch")).first())
    }
}
