package app.teluni.player.core.catalog

// Effective prices of protocol 2 catalogs, ported from the API's catalogs
// domain (apps/api/src/features/catalogs/domain.ts) and checked against the
// conformance file's price cases. Amounts are integer minor units of the
// field's currency (ADR-0032); times are local minutes, `YYYY-MM-DDTHH:MM`,
// which compare in order as text.

/** A promotion window in local time; a null branch applies to every branch. */
public data class Promotion(
    val id: String,
    val branchId: String?,
    val amount: Long,
    val startsAt: String,
    val endsAt: String,
)

/** What a manifest carries for one record's money field. */
public data class PriceFacts(
    val base: Long?,
    val overrides: Map<String, Long>,
    val promotions: List<Promotion>,
)

public enum class PriceSource { PROMOTION, OVERRIDE, BASE, NONE }

public data class EffectivePrice(val amount: Long?, val source: PriceSource, val promotionId: String?)

public object Prices {
    /**
     * The price a branch shows at a local minute: an applicable promotion,
     * then the branch override, then the base price. A null branch sees
     * only scope-wide promotions and the base price.
     */
    public fun effective(facts: PriceFacts, branchId: String?, at: String): EffectivePrice {
        val promotion = facts.promotions.firstOrNull {
            (it.branchId == null || it.branchId == branchId) && it.startsAt <= at && at < it.endsAt
        }
        if (promotion != null) return EffectivePrice(promotion.amount, PriceSource.PROMOTION, promotion.id)
        val override = branchId?.let { facts.overrides[it] }
        if (override != null) return EffectivePrice(override, PriceSource.OVERRIDE, null)
        if (facts.base != null) return EffectivePrice(facts.base, PriceSource.BASE, null)
        return EffectivePrice(null, PriceSource.NONE, null)
    }

    /** The first local minute after `at` at which a promotion of these facts starts or ends. */
    public fun nextChange(facts: PriceFacts, at: String): String? =
        facts.promotions.flatMap { listOf(it.startsAt, it.endsAt) }.filter { it > at }.minOrNull()
}
