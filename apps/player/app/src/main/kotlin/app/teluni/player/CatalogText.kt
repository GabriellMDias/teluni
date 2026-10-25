package app.teluni.player

import java.math.BigDecimal
import java.text.NumberFormat
import java.util.Currency
import java.util.Locale

/** Money's scale belongs to its ISO currency; the schema's decimals property describes number fields. */
internal object CatalogText {
    fun money(amount: Long, currencyCode: String, locale: Locale): String {
        val currency = Currency.getInstance(currencyCode)
        val scale = currency.defaultFractionDigits
        require(scale >= 0) { "UNSUPPORTED_CURRENCY" }
        return NumberFormat.getCurrencyInstance(locale).apply {
            this.currency = currency
            minimumFractionDigits = scale
            maximumFractionDigits = scale
        }.format(BigDecimal.valueOf(amount, scale))
    }
}
