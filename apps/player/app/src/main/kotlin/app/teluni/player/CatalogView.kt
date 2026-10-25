package app.teluni.player

import android.content.Context
import android.annotation.SuppressLint
import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.Paint
import android.util.TypedValue
import android.view.Gravity
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import app.teluni.player.core.playback.AreaPlan
import app.teluni.player.core.playback.ShownRecord
import app.teluni.player.core.protocol.Manifest
import app.teluni.player.core.protocol.LayoutManifest
import app.teluni.player.core.protocol.Publication
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive

/** Draws the already-paginated snapshot; branch prices and page selection come from core. */
@SuppressLint("ViewConstructor") // Programmatic-only output built from a core-authorized publication and page.
internal class CatalogView(context: Context, private val runtime: PlayerRuntime, publication: Publication, plan: AreaPlan.Catalog, versions: Map<String, Long> = emptyMap()) :
    LinearLayout(context) {
    private data class ImageBinding(
        val id: String,
        val view: ImageView,
        val size: Int,
        var source: Manifest.Media? = null,
        var version: Long? = null,
        var failed: Boolean = false,
    )
    private val images = mutableListOf<ImageBinding>()
    val hasFailure: Boolean get() = images.any { it.failed }
    init {
        orientation = VERTICAL
        val size = plan.view.textSize
        val padding = (size / 2f).toInt()
        setPadding(padding, padding, padding, padding)
        val catalog = requireNotNull(publication.layout).catalogs.getValue(plan.view.catalogId)
        var group: String? = null
        for (shown in plan.records) {
            if (!shown.record.available && !plan.view.showUnavailable) continue
            if (shown.group != null && shown.group != group) {
                group = shown.group
                val groupField = plan.view.fields.firstOrNull { it.role == "group" }?.fieldId?.let(catalog.fields::get)
                val heading = if (plan.view.presentation == "agenda") weekday(group) else
                    groupField?.choices?.firstOrNull { it.id == group }?.label ?: group
                addView(label(heading, size, true), LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT))
            }
            val row = LinearLayout(context).apply { orientation = HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
            val imageField = plan.view.fields.firstOrNull { it.role == "image" }
            val imageId = imageField?.let { (shown.record.values[it.fieldId] as? JsonPrimitive)?.content }
            if (imageId != null) {
                val image = ImageView(context).apply { scaleType = ImageView.ScaleType.FIT_CENTER }
                images += ImageBinding(imageId, image, size)
                row.addView(image, LayoutParams((size * 1.25f).toInt(), (size * 1.25f).toInt()).apply { rightMargin = padding })
            }
            val bindings = plan.view.fields.filter { it.role != "group" && it.role != "image" }
            if (plan.view.presentation == "table") {
                for ((index, binding) in bindings.withIndex()) {
                    val field = catalog.fields.getValue(binding.fieldId)
                    row.addView(label(value(field, shown, publication), size, binding.role == "title"),
                        LayoutParams(0, LayoutParams.WRAP_CONTENT, 1f).apply { rightMargin = if (index < bindings.lastIndex) padding else 0 })
                }
            } else {
                val time = if (plan.view.presentation == "agenda") bindings.firstOrNull {
                    catalog.fields.getValue(it.fieldId).type == "time"
                } else null
                if (time != null) {
                    row.addView(label(value(catalog.fields.getValue(time.fieldId), shown, publication), size, false),
                        LayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT).apply { rightMargin = padding })
                }
                val column = LinearLayout(context).apply { orientation = VERTICAL }
                val titleRow = LinearLayout(context).apply { orientation = HORIZONTAL }
                for (binding in bindings.filter { it.role == "title" }) {
                    titleRow.addView(label(value(catalog.fields.getValue(binding.fieldId), shown, publication), size, true),
                        LayoutParams(0, LayoutParams.WRAP_CONTENT, 1f))
                }
                for (binding in bindings.filter { it.role == "price" }) {
                    titleRow.addView(label(value(catalog.fields.getValue(binding.fieldId), shown, publication), size, true),
                        LayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT).apply { leftMargin = padding })
                }
                column.addView(titleRow)
                for (binding in bindings.filter { (it.role == "subtitle" || it.role == "detail") && it != time }) {
                    column.addView(label(value(catalog.fields.getValue(binding.fieldId), shown, publication), size, false))
                }
                row.addView(column, LayoutParams(0, LayoutParams.WRAP_CONTENT, 1f))
            }
            if (!shown.record.available) {
                row.alpha = 0.65f
                row.contentDescription = context.getString(R.string.unavailable)
                fun mark(view: android.view.View) {
                    if (view is TextView) view.paintFlags = view.paintFlags or Paint.STRIKE_THRU_TEXT_FLAG
                    if (view is android.view.ViewGroup) for (index in 0 until view.childCount) mark(view.getChildAt(index))
                }
                mark(row)
            }
            // The server's fit calculation budgets line heights, with no extra gap between rows.
            addView(row, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT))
        }
        refreshMedia(publication, versions)
    }

    /** Replaces affected bitmaps without rebuilding intact catalog text or its layout. */
    fun refreshMedia(publication: Publication, versions: Map<String, Long>) {
        for (binding in images) {
            val source = publication.media[binding.id]
            val version = source?.let { versions[it.sha256] }
            if (source == binding.source && version == binding.version) continue
            binding.source = source
            binding.version = version
            if (source == null) {
                binding.failed = true
                binding.view.setImageBitmap(null)
                continue
            }
            val options = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            val path = runtime.mediaPath(source.sha256)
            BitmapFactory.decodeFile(path, options)
            options.inSampleSize = 1
            while (options.outWidth / options.inSampleSize > binding.size * 2 || options.outHeight / options.inSampleSize > binding.size * 2) {
                options.inSampleSize *= 2
            }
            options.inJustDecodeBounds = false
            val bitmap = BitmapFactory.decodeFile(path, options)
            binding.failed = bitmap == null
            if (bitmap == null) runtime.reportMediaFailure(source.sha256)
            binding.view.setImageBitmap(bitmap)
        }
    }

    private fun label(content: String?, size: Int, bold: Boolean): TextView = TextView(context).apply {
        text = content.orEmpty()
        setTextColor(Color.WHITE)
        setTextSize(TypedValue.COMPLEX_UNIT_PX, size.toFloat())
        includeFontPadding = false
        setLineSpacing(0f, 1.25f)
        if (bold) setTypeface(typeface, android.graphics.Typeface.BOLD)
    }

    private fun value(field: LayoutManifest.Field, shown: ShownRecord, publication: Publication): String {
        if (field.type == "money") {
            val amount = shown.prices[field.id]?.amount ?: return "—"
            return CatalogText.money(amount, requireNotNull(field.currency), resources.configuration.locales[0])
        }
        val raw = shown.record.values[field.id]
        fun plain(value: JsonElement?): String = (value as? JsonPrimitive)?.content.orEmpty()
        return when (field.type) {
            "boolean" -> context.getString(if (plain(raw) == "true") R.string.value_yes else R.string.value_no)
            "selection" -> field.choices?.firstOrNull { it.id == plain(raw) }?.label.orEmpty()
            "weekdays" -> (raw as? JsonArray)?.joinToString(", ") { weekday(plain(it)) }.orEmpty()
            "reference" -> publication.layout?.catalogs?.values?.firstNotNullOfOrNull { catalog ->
                catalog.records[plain(raw)]?.let { record ->
                    catalog.fields.values.firstOrNull { it.type == "text" }?.let { plain(record.values[it.id]) }
                }
            }.orEmpty()
            else -> plain(raw)
        }
    }

    private fun weekday(value: String?): String = resources.getStringArray(R.array.weekdays)
        .getOrNull((value?.toIntOrNull() ?: 0) - 1).orEmpty()
}
