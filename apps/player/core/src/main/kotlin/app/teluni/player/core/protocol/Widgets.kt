package app.teluni.player.core.protocol

import java.net.URI
import java.security.MessageDigest
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/** Protocol 3 configuration. Unknown types/fields fail closed in the manifest parser. */
@Serializable
public sealed class Widget {
    public abstract val version: Int
    public abstract val locale: String
    public abstract val textSize: Int
    public abstract val foreground: String

    @Serializable @SerialName("clock")
    public data class Clock(
        override val version: Int, override val locale: String, override val textSize: Int, override val foreground: String,
        val showTime: Boolean, val showDate: Boolean, val seconds: Boolean, val hour12: Boolean, val dateStyle: String,
    ) : Widget()

    @Serializable @SerialName("qr")
    public data class Qr(
        override val version: Int, override val locale: String, override val textSize: Int, override val foreground: String,
        val targetUrl: String, val caption: String, val layoutId: String, val linkId: String, val qrUrl: String, val modules: List<String>,
    ) : Widget()

    @Serializable @SerialName("ticker")
    public data class Ticker(
        override val version: Int, override val locale: String, override val textSize: Int, override val foreground: String,
        val text: String, val speed: Int,
    ) : Widget()

    @Serializable @SerialName("weather")
    public data class Weather(
        override val version: Int, override val locale: String, override val textSize: Int, override val foreground: String,
        val latitude: Double, val longitude: Double, val label: String, val units: String,
    ) : Widget()

    @Serializable @SerialName("rss")
    public data class Rss(
        override val version: Int, override val locale: String, override val textSize: Int, override val foreground: String,
        val feedUrl: String, val title: String, val itemSeconds: Int, val maxItems: Int,
    ) : Widget()
}

internal object WidgetChecks {
    private fun invalid(): Nothing = throw ManifestParser.invalid("Invalid widget configuration")
    private fun text(value: String, max: Int, empty: Boolean = false): Boolean = value.codePointCount(0, value.length) <= max &&
        (empty || value.isNotBlank()) && value.none { it.code < 32 && it != '\n' && it != '\t' || it.code == 127 }
    private fun https(value: String): Boolean = try {
        val uri = URI(value)
        value.length <= 2048 && uri.scheme == "https" && !uri.host.isNullOrBlank() && uri.rawUserInfo == null &&
            uri.fragment == null && uri.port in listOf(-1, 443)
    } catch (_: java.net.URISyntaxException) { false }
    fun check(widget: Widget, areaKey: String) {
        if (widget.version != 1 || widget.locale !in setOf("pt-BR", "en-US") || widget.textSize !in 24..200 || !Regex("#[0-9a-fA-F]{6}").matches(widget.foreground)) invalid()
        when (widget) {
            is Widget.Clock -> if ((!widget.showTime && !widget.showDate) || widget.dateStyle !in setOf("short", "long")) invalid()
            is Widget.Qr -> {
                val identity = MessageDigest.getInstance("SHA-256").digest("teluni.qr.v1:${widget.layoutId}:$areaKey".encodeToByteArray()).joinToString("") { "%02x".format(it) }.take(32)
                val url = try { URI(widget.qrUrl) } catch (_: java.net.URISyntaxException) { invalid() }
                if (!https(widget.targetUrl) || !text(widget.caption, 120, true) || identity != widget.linkId ||
                    url.scheme !in setOf("http", "https") || url.host.isNullOrBlank() || url.rawUserInfo != null || url.query != null || url.fragment != null || url.path != "/q/${widget.linkId}" ||
                    widget.modules.size !in 21..177 || (widget.modules.size - 21) % 4 != 0 ||
                    widget.modules.any { it.length != widget.modules.size || it.any { cell -> cell != '0' && cell != '1' } }
                ) invalid()
            }
            is Widget.Ticker -> if (!text(widget.text, 2000) || widget.speed !in 20..160) invalid()
            is Widget.Weather -> if (!widget.latitude.isFinite() || widget.latitude !in -90.0..90.0 || !widget.longitude.isFinite() || widget.longitude !in -180.0..180.0 || !text(widget.label, 80) || widget.units !in setOf("celsius", "fahrenheit")) invalid()
            is Widget.Rss -> if (!https(widget.feedUrl) || !text(widget.title, 80) || widget.itemSeconds !in 5..120 || widget.maxItems !in 1..20) invalid()
        }
    }
}

@Serializable
public sealed class WidgetSourceData {
    @Serializable @SerialName("weather")
    public data class Weather(val temperatureC: Double, val humidity: Double, val symbol: String, val forecastAt: String) : WidgetSourceData()
    @Serializable @SerialName("rss")
    public data class Rss(val source: String, val items: List<Headline>) : WidgetSourceData()
    @Serializable
    public data class Headline(val title: String, val url: String?)
}
@Serializable
public data class WidgetLive(val status: String, val fetchedAt: String?, val validUntil: String?, val data: WidgetSourceData?)
@Serializable
public data class WidgetBatch(val publicationId: String, val items: List<Item>) {
    @Serializable
    public data class Item(val areaKey: String, val live: WidgetLive)
}
