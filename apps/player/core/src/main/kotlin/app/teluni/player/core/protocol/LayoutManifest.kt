package app.teluni.player.core.protocol

import app.teluni.player.core.catalog.PriceFacts
import app.teluni.player.core.catalog.Promotion
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive

/**
 * The protocol 2 manifest exactly as the catalog and composition design
 * defines it (docs/project/catalog-composition-design.md, "Publication
 * protocol 2"): a program with a layout, its area outputs and the catalog
 * snapshots its views show.
 */
@Serializable
public data class LayoutManifest(
    val format: String,
    val protocol: Int,
    val publicationId: String,
    val companyId: String,
    val programId: String,
    val generation: Int,
    val publishedAt: String,
    val layout: Layout,
    val outputs: List<Output>,
    val catalogs: List<Catalog>,
    val playlists: List<Manifest.Playlist>,
    val media: List<Manifest.Media>,
) {
    @Serializable
    public data class Layout(
        val orientation: String,
        val width: Int,
        val height: Int,
        val audioMixConfirmed: Boolean,
        val areas: List<Area>,
        val pages: List<Page>,
    )

    @Serializable
    public data class Area(
        val key: String,
        val x: Int,
        val y: Int,
        val width: Int,
        val height: Int,
        val z: Int,
        val background: String,
        val fit: String,
        val muted: Boolean,
        val volume: Int,
        val kind: String,
        val pageControlled: Boolean,
        val view: View?,
    )

    @Serializable
    public data class View(
        val catalogId: String,
        val fields: List<ViewField>,
        val presentation: String,
        val textSize: Int,
        val unavailable: String,
        val pageSeconds: Int,
        val pages: List<List<Entry>>,
        val groups: List<Group>,
    )

    @Serializable
    public data class ViewField(val fieldId: String, val role: String)

    @Serializable
    public data class Entry(val recordId: String, val group: String?)

    @Serializable
    public data class Group(val group: String, val recordIds: List<String>)

    @Serializable
    public data class Page(val durationSeconds: Int, val contents: List<PageContent>)

    @Serializable
    public data class PageContent(
        val areaKey: String,
        val mediaId: String?,
        val viewPage: Int?,
        val groupChoiceId: String?,
    )

    @Serializable
    public data class Output(val key: String, val default: Default?, val rules: List<Manifest.Rule>)

    /** `{"playlistId": …}` or `{"view": true}`. */
    @Serializable
    public data class Default(val playlistId: String? = null, val view: Boolean? = null)

    @Serializable
    public data class Catalog(
        val id: String,
        val fields: List<Field>,
        val records: List<Record>,
        val prices: List<Price>,
    )

    @Serializable
    public data class Field(
        val id: String,
        val type: String,
        val label: String,
        val currency: String? = null,
        val decimals: Int? = null,
        val choices: List<Choice>? = null,
    )

    @Serializable
    public data class Choice(val id: String, val label: String)

    @Serializable
    public data class Record(val id: String, val available: Boolean, val values: Map<String, JsonElement>)

    @Serializable
    public data class Price(
        val recordId: String,
        val fieldId: String,
        val base: Long?,
        val overrides: List<Override>,
        val promotions: List<PromotionWindow>,
    )

    @Serializable
    public data class Override(val branchId: String, val amount: Long)

    @Serializable
    public data class PromotionWindow(
        val id: String,
        val branchId: String?,
        val amount: Long,
        val startsAt: String,
        val endsAt: String,
    )
}

// The checked form a planner uses

public enum class AreaKind { MEDIA, CATALOG }

/** A checked protocol 2 layout with its catalog snapshots. */
public data class Layout(
    val orientation: String,
    val width: Int,
    val height: Int,
    val audioMixConfirmed: Boolean,
    /** Areas in stacking order, from the back. */
    val areas: List<Area>,
    val pages: List<Page>,
    val catalogs: Map<String, Catalog>,
)

public data class Area(
    val key: String,
    val x: Int,
    val y: Int,
    val width: Int,
    val height: Int,
    val z: Int,
    val background: String,
    /** `contain` or `cover`: media never distort. */
    val fit: String,
    val muted: Boolean,
    val volume: Int,
    val kind: AreaKind,
    val pageControlled: Boolean,
    val view: View?,
)

public data class View(
    val catalogId: String,
    val fields: List<LayoutManifest.ViewField>,
    val presentation: String,
    val textSize: Int,
    /** Whether unavailable records stay listed, marked unavailable. */
    val showUnavailable: Boolean,
    val pageSeconds: Int,
    /** The records of each page, paginated at publication. */
    val pages: List<List<LayoutManifest.Entry>>,
    /** The records of each group a layout page names. */
    val groups: Map<String, List<String>>,
)

/** What a page-controlled area shows on one page. */
public sealed interface PageContent {
    public data class Media(val mediaId: String) : PageContent

    /** A view page, from 0. */
    public data class ViewPage(val index: Int) : PageContent

    public data class Group(val group: String) : PageContent
}

public data class Page(val durationSeconds: Int, val contents: Map<String, PageContent>)

public data class Catalog(
    val id: String,
    val fields: Map<String, LayoutManifest.Field>,
    val records: Map<String, LayoutManifest.Record>,
    /** By record, then money field. */
    val prices: Map<String, Map<String, PriceFacts>>,
)

/** Protocol 2 checks; shared parts come from [ManifestParser]. */
internal object LayoutManifestChecks {
    private const val PROTOCOL = 2
    private val canvases = mapOf("landscape" to (1920 to 1080), "portrait" to (1080 to 1920))
    private val keyPattern = Regex("[a-z][a-z0-9-]{0,15}")
    private val colorPattern = Regex("#[0-9A-Fa-f]{6}")
    private val currencyPattern = Regex("[A-Z]{3}")
    private val localMinutePattern = Regex("""\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d""")
    private val fieldTypes = setOf(
        "text", "longText", "number", "boolean", "date", "time",
        "weekdays", "selection", "money", "media", "reference",
    )
    private val roles = setOf("title", "subtitle", "price", "image", "detail", "group")
    private val presentations = setOf("list", "table", "menu", "agenda")

    private fun invalid(message: String) = ManifestParser.invalid(message)

    fun check(manifest: LayoutManifest, sha256: String): Publication {
        val header = ManifestParser.header(
            manifest.format,
            PublicationHeader(
                manifest.protocol,
                manifest.publicationId,
                manifest.companyId,
                manifest.programId,
                manifest.generation,
                manifest.publishedAt,
            ),
            PROTOCOL,
        )
        val media = ManifestParser.media(manifest.media)
        val playlists = ManifestParser.playlists(manifest.playlists, media)
        val catalogs = ManifestParser.unique(manifest.catalogs) { it.id }.mapValues { (_, catalog) -> catalog(catalog, media) }
        val layout = layout(manifest.layout, catalogs, media)

        if (manifest.outputs.map { it.key } != layout.areas.map { it.key }) {
            throw invalid("Every area needs exactly one output, in area order")
        }
        val areas = layout.areas.associateBy { it.key }
        val outputs = manifest.outputs.associate { output ->
            val area = areas.getValue(output.key)
            val default = output.default
            val checked = when {
                area.kind == AreaKind.CATALOG ->
                    if (default == LayoutManifest.Default(view = true)) {
                        OutputDefault.View
                    } else {
                        throw invalid("A catalog area defaults to its view")
                    }
                default == null -> OutputDefault.None
                default.view == null && default.playlistId != null && default.playlistId in playlists ->
                    OutputDefault.Playlist(default.playlistId)
                else -> throw invalid("Invalid default of area ${output.key}")
            }
            output.key to Output(output.key, ManifestParser.rules(output.rules, playlists), checked)
        }
        return Publication(header, sha256, outputs, playlists, media, layout)
    }

    private fun layout(
        layout: LayoutManifest.Layout,
        catalogs: Map<String, Catalog>,
        media: Map<String, Manifest.Media>,
    ): Layout {
        val (width, height) = canvases[layout.orientation] ?: throw invalid("Unknown orientation")
        if (layout.width != width || layout.height != height) throw invalid("The canvas does not match the orientation")
        if (layout.areas.size !in 1..12) throw invalid("A layout has 1 to 12 areas")
        if (layout.pages.isNotEmpty() && layout.pages.size !in 2..20) throw invalid("A layout has none or 2 to 20 pages")
        val areas = layout.areas.map { area(it, width, height, catalogs, layout.pages.isNotEmpty()) }
        ManifestParser.unique(areas) { it.key }
        if (areas.map { it.z }.toSet().size != areas.size) throw invalid("Stacking orders must be unique")
        if (areas.count { !it.muted } > 1 && !layout.audioMixConfirmed) throw invalid("Mixed audio needs confirmation")

        val byKey = areas.associateBy { it.key }
        val controlled = areas.filter { it.pageControlled }.map { it.key }.toSet()
        val pages = layout.pages.map { page ->
            if (page.durationSeconds !in 1..600) throw invalid("A page lasts 1 to 600 seconds")
            val contents = ManifestParser.unique(page.contents) { it.areaKey }.mapValues { (key, content) ->
                val area = byKey[key]?.takeIf { it.pageControlled } ?: throw invalid("Page content for an area that pages do not control")
                pageContent(area, content, media)
            }
            if (contents.keys != controlled) throw invalid("Every page names what each page-controlled area shows")
            Page(page.durationSeconds, contents)
        }
        return Layout(layout.orientation, width, height, layout.audioMixConfirmed, areas, pages, catalogs)
    }

    private fun area(
        area: LayoutManifest.Area,
        canvasWidth: Int,
        canvasHeight: Int,
        catalogs: Map<String, Catalog>,
        paged: Boolean,
    ): Area {
        if (!keyPattern.matches(area.key)) throw invalid("Invalid area key")
        if (area.x < 0 || area.y < 0 || area.width < 40 || area.height < 40 ||
            area.x + area.width > canvasWidth || area.y + area.height > canvasHeight
        ) {
            throw invalid("Area ${area.key} is outside the canvas")
        }
        if (area.z !in 0..99) throw invalid("Invalid stacking order")
        if (!colorPattern.matches(area.background)) throw invalid("Invalid background")
        if (area.fit != "contain" && area.fit != "cover") throw invalid("Invalid fit")
        if (area.volume !in 0..100) throw invalid("Invalid volume")
        if (area.pageControlled && !paged) throw invalid("A page-controlled area needs pages")
        val kind = when (area.kind) {
            "media" -> AreaKind.MEDIA
            "catalog" -> AreaKind.CATALOG
            else -> throw invalid("Unknown area kind ${area.kind}")
        }
        if ((kind == AreaKind.CATALOG) != (area.view != null)) throw invalid("Only catalog areas have a view")
        return Area(
            area.key, area.x, area.y, area.width, area.height, area.z, area.background, area.fit,
            area.muted, area.volume, kind, area.pageControlled,
            area.view?.let { view(it, catalogs) },
        )
    }

    private fun view(view: LayoutManifest.View, catalogs: Map<String, Catalog>): View {
        val catalog = catalogs[view.catalogId] ?: throw invalid("A view uses a catalog the manifest lacks")
        if (view.fields.isEmpty() || view.fields.size > 8) throw invalid("A view binds 1 to 8 fields")
        for (field in view.fields) {
            if (field.fieldId !in catalog.fields) throw invalid("A view binds a field the catalog lacks")
            if (field.role !in roles) throw invalid("Unknown role ${field.role}")
        }
        if (view.presentation !in presentations) throw invalid("Unknown presentation ${view.presentation}")
        if (view.textSize !in 24..200) throw invalid("Invalid text size")
        if (view.pageSeconds !in 5..120) throw invalid("Invalid page seconds")
        val showUnavailable = when (view.unavailable) {
            "hide" -> false
            "show" -> true
            else -> throw invalid("Invalid unavailable setting")
        }
        for (entry in view.pages.flatten()) {
            if (entry.recordId !in catalog.records) throw invalid("A view page lists an unknown record")
        }
        if (view.pages.any { it.isEmpty() }) throw invalid("A view page is empty")
        val groups = ManifestParser.unique(view.groups) { it.group }.mapValues { (_, group) ->
            if (group.recordIds.any { it !in catalog.records }) throw invalid("A group lists an unknown record")
            group.recordIds
        }
        return View(
            view.catalogId, view.fields, view.presentation, view.textSize, showUnavailable,
            view.pageSeconds, view.pages, groups,
        )
    }

    private fun pageContent(
        area: Area,
        content: LayoutManifest.PageContent,
        media: Map<String, Manifest.Media>,
    ): PageContent {
        val mediaId = content.mediaId
        val viewPage = content.viewPage
        val group = content.groupChoiceId
        return when {
            area.kind == AreaKind.MEDIA && mediaId != null && viewPage == null && group == null ->
                if (mediaId in media) PageContent.Media(mediaId) else throw invalid("A page shows unknown media")
            area.kind == AreaKind.CATALOG && mediaId == null && viewPage != null && group == null ->
                if (viewPage in 1..area.view!!.pages.size) {
                    PageContent.ViewPage(viewPage - 1)
                } else {
                    throw invalid("A page shows a view page that does not exist")
                }
            area.kind == AreaKind.CATALOG && mediaId == null && viewPage == null && group != null ->
                if (group in area.view!!.groups) PageContent.Group(group) else throw invalid("A page shows an unknown group")
            else -> throw invalid("Invalid content of area ${area.key}")
        }
    }

    private fun catalog(catalog: LayoutManifest.Catalog, media: Map<String, Manifest.Media>): Catalog {
        val fields = ManifestParser.unique(catalog.fields) { it.id }
        for (field in fields.values) {
            if (field.type !in fieldTypes) throw invalid("Unknown field type ${field.type}")
            if ((field.type == "money") != (field.currency != null)) throw invalid("Only money fields have a currency")
            if (field.currency != null && !currencyPattern.matches(field.currency)) throw invalid("Invalid currency")
            if ((field.type == "selection") != (field.choices != null)) throw invalid("Only selection fields have choices")
            field.choices?.let { ManifestParser.unique(it) { choice -> choice.id } }
        }
        val records = ManifestParser.unique(catalog.records) { it.id }
        for (record in records.values) {
            for ((fieldId, value) in record.values) {
                val field = fields[fieldId] ?: throw invalid("A record has a value for an unknown field")
                if (field.type == "money") throw invalid("Prices travel apart from record values")
                if (field.type == "media" && (value as? JsonPrimitive)?.content !in media) {
                    throw invalid("A record shows media the manifest lacks")
                }
            }
        }
        val prices = mutableMapOf<String, MutableMap<String, PriceFacts>>()
        for (price in catalog.prices) {
            if (price.recordId !in records || fields[price.fieldId]?.type != "money") {
                throw invalid("A price for an unknown record or field")
            }
            val overrides = ManifestParser.unique(price.overrides) { it.branchId }.mapValues { (_, entry) -> amount(entry.amount) }
            val promotions = ManifestParser.unique(price.promotions) { it.id }.values.map {
                if (!localMinutePattern.matches(it.startsAt) || !localMinutePattern.matches(it.endsAt) || it.startsAt >= it.endsAt) {
                    throw invalid("Invalid promotion window")
                }
                Promotion(it.id, it.branchId, amount(it.amount), it.startsAt, it.endsAt)
            }
            val facts = PriceFacts(price.base?.let(::amount), overrides, promotions)
            if (prices.getOrPut(price.recordId) { mutableMapOf() }.put(price.fieldId, facts) != null) {
                throw invalid("Duplicate prices")
            }
        }
        return Catalog(catalog.id, fields, records, prices)
    }

    private fun amount(value: Long): Long = if (value >= 0) value else throw invalid("Negative amount")
}
