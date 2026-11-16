package app.teluni.player.core.playback

import app.teluni.player.core.protocol.Publication
import app.teluni.player.core.protocol.Widget
import app.teluni.player.core.protocol.WidgetBatch
import app.teluni.player.core.protocol.WidgetLive
import app.teluni.player.core.protocol.WidgetSourceData
import java.time.Duration
import java.time.Instant
import java.time.LocalDateTime
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale
import kotlin.math.roundToInt
import kotlinx.serialization.Serializable

@Serializable
public data class WidgetCacheRecord(val format: Int = 1, val batches: List<WidgetBatch> = emptyList())

/** Cached data never grants playback authority. The planner applies it only after statement checks. */
public object WidgetCache {
    public val maxAge: Duration = Duration.ofHours(24)
    public fun data(record: WidgetCacheRecord, publication: Publication, now: Instant): Map<String, WidgetLive> {
        if (record.format != 1 || record.batches.size > 3) return emptyMap()
        val batch = record.batches.singleOrNull { it.publicationId == publication.header.publicationId } ?: return emptyMap()
        if (batch.items.size > 12 || batch.items.map { it.areaKey }.toSet().size != batch.items.size) return emptyMap()
        val widgets = publication.layout?.areas?.associate { it.key to it.widget }.orEmpty()
        return batch.items.mapNotNull { item ->
            val widget = widgets[item.areaKey] ?: return@mapNotNull null
            val live = item.live
            val fetched = instant(live.fetchedAt) ?: return@mapNotNull null
            val expires = instant(live.validUntil) ?: return@mapNotNull null
            if (live.status !in setOf("ready", "stale") || fetched > now.plusSeconds(120) || expires < fetched || expires > fetched.plus(maxAge) || now >= fetched.plus(maxAge)) return@mapNotNull null
            val valid = when (val source = live.data) {
                is WidgetSourceData.Weather -> widget is Widget.Weather && source.temperatureC.isFinite() && source.temperatureC in -100.0..100.0 && source.humidity.isFinite() && source.humidity in 0.0..100.0 && Regex("[a-z0-9_]{1,64}").matches(source.symbol) && instant(source.forecastAt) != null
                is WidgetSourceData.Rss -> widget is Widget.Rss && source.source.length in 1..120 && source.items.size in 1..widget.maxItems && source.items.all { it.title.length in 1..400 && it.title.none { character -> character.code < 32 } && (it.url == null || it.url.length <= 2048) }
                null -> false
            }
            if (!valid) null else item.areaKey to live.copy(status = if (now >= expires) "stale" else live.status)
        }.toMap()
    }
    public fun merge(record: WidgetCacheRecord, batch: WidgetBatch, publication: Publication, now: Instant, keep: Set<String>): WidgetCacheRecord {
        require(batch.publicationId == publication.header.publicationId) { "Unexpected widget generation" }
        val fresh = data(WidgetCacheRecord(batches = listOf(batch)), publication, now)
        val previous = data(record, publication, now)
        val merged = WidgetBatch(batch.publicationId, (previous + fresh).map { WidgetBatch.Item(it.key, it.value) })
        return WidgetCacheRecord(batches = (listOf(merged) + record.batches.filter { it.publicationId != batch.publicationId && it.publicationId in keep }).take(3))
    }
    private fun instant(value: String?): Instant? = try { value?.let(Instant::parse) } catch (_: java.time.format.DateTimeParseException) { null }
}

/** Text and item choice are derived from trusted time/server offsets, independently of Android. */
public data class WidgetText(val primary: String, val secondary: String = "", val footer: String = "", val stale: Boolean = false, val unavailable: Boolean = false)
public object WidgetPresentation {
    public fun text(widget: Widget, live: WidgetLive?, now: Instant, local: LocalDateTime): WidgetText {
        val portuguese = widget.locale == "pt-BR"
        val locale = Locale.forLanguageTag(widget.locale)
        val stale = live?.status == "stale"
        val suffix = if (stale) if (portuguese) " · Dados desatualizados" else " · Cached data" else ""
        return when (widget) {
            is Widget.Clock -> {
                val pattern = if (widget.hour12) if (widget.seconds) "h:mm:ss a" else "h:mm a" else if (widget.seconds) "HH:mm:ss" else "HH:mm"
                val time = if (widget.showTime) local.format(DateTimeFormatter.ofPattern(pattern, locale)) else ""
                val date = if (widget.showDate) local.format(DateTimeFormatter.ofLocalizedDate(if (widget.dateStyle == "long") FormatStyle.FULL else FormatStyle.SHORT).withLocale(locale)) else ""
                WidgetText(time.ifEmpty { date }, if (time.isNotEmpty()) date else "")
            }
            is Widget.Qr -> WidgetText(widget.caption)
            is Widget.Ticker -> WidgetText(widget.text)
            is Widget.Weather -> {
                val data = live?.data as? WidgetSourceData.Weather
                if (data == null) WidgetText(widget.label, if (portuguese) "Clima indisponível" else "Weather unavailable", "MET Norway · CC BY 4.0", unavailable = true)
                else {
                    val temperature = if (widget.units == "fahrenheit") data.temperatureC * 9 / 5 + 32 else data.temperatureC
                    val condition = condition(data.symbol, portuguese)
                    WidgetText("${temperature.roundToInt()}°${if (widget.units == "fahrenheit") "F" else "C"}", "${widget.label} · $condition", "MET Norway · CC BY 4.0$suffix", stale)
                }
            }
            is Widget.Rss -> {
                val data = live?.data as? WidgetSourceData.Rss
                if (data == null || data.items.isEmpty()) WidgetText(widget.title, if (portuguese) "Notícias indisponíveis" else "News unavailable", unavailable = true)
                else {
                    val index = Math.floorMod(now.epochSecond / widget.itemSeconds, data.items.size.toLong()).toInt()
                    WidgetText(data.items[index].title, widget.title, "${data.source} · ${index + 1}/${data.items.size}$suffix", stale)
                }
            }
        }
    }
    private fun condition(symbol: String, pt: Boolean): String = when {
        "thunder" in symbol -> if (pt) "Trovoadas" else "Thunderstorms"
        "snow" in symbol || "sleet" in symbol -> if (pt) "Neve" else "Snow"
        "rain" in symbol -> if (pt) "Chuva" else "Rain"
        "fog" in symbol -> if (pt) "Neblina" else "Fog"
        "partlycloudy" in symbol || "fair" in symbol -> if (pt) "Parcialmente nublado" else "Partly cloudy"
        "cloudy" in symbol -> if (pt) "Nublado" else "Cloudy"
        "clearsky" in symbol -> if (pt) "Céu limpo" else "Clear sky"
        else -> if (pt) "Previsão do tempo" else "Forecast"
    }
}
