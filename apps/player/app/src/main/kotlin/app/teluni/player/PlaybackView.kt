package app.teluni.player

import android.content.Context
import android.annotation.SuppressLint
import android.graphics.Color
import android.net.Uri
import android.view.Gravity
import android.view.LayoutInflater
import android.widget.FrameLayout
import android.widget.TextView
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import app.teluni.player.core.playback.AreaPlan
import app.teluni.player.core.playback.Plan
import app.teluni.player.core.playback.PlaybackCondition
import app.teluni.player.core.protocol.Manifest
import app.teluni.player.core.protocol.Publication
import java.io.File

/** Renders only a core-authorized plan; plan equality preserves an unchanged area's playback position. */
@androidx.annotation.OptIn(markerClass = [UnstableApi::class])
@SuppressLint("ViewConstructor") // Programmatic-only view: a validated runtime must be injected, never inflated from XML.
internal class PlaybackView(context: Context, private val runtime: PlayerRuntime) : FrameLayout(context) {
    private val canvas = FrameLayout(context)
    private val media = mutableListOf<ExoPlayer>()
    private var previous: Plan? = null
    private var previousRotation = -1
    private var canvasWidth = 1920
    private var canvasHeight = 1080
    private var outputRotation = 0
    private val failedPlayers = mutableSetOf<ExoPlayer>()
    private val degraded: Boolean get() = failedPlayers.isNotEmpty() ||
        areaViews.values.any { (it.view.getChildAt(0) as? CatalogView)?.hasFailure == true }
    private var failedGeneration: String? = null
    val hasFailure: Boolean get() = degraded || previous?.degraded == true ||
        (previous as? Plan.Neutral)?.condition == PlaybackCondition.DEGRADED || failedGeneration != null
    private val areaViews = mutableMapOf<String, AreaOutput>()
    private data class AreaOutput(val plan: AreaPlan, val view: FrameLayout, val players: List<ExoPlayer>)

    init { setBackgroundColor(Color.BLACK); addView(canvas) }

    fun show(plan: Plan, rotation: Int) {
        val generation = when (plan) {
            is Plan.Play -> plan.publication.header.publicationId
            is Plan.Compose -> plan.publication.header.publicationId
            is Plan.Neutral -> null
        }
        if (generation != null && generation == failedGeneration) return
        try {
            render(plan, rotation)
            failedGeneration = null
            if (plan !is Plan.Neutral) {
                if (degraded || plan.degraded) runtime.reportPlayback(PlaybackCondition.DEGRADED)
                else if (media.isEmpty() || media.any { it.playbackState == Player.STATE_READY })
                    runtime.reportPlayback(PlaybackCondition.PLAYING)
            }
        } catch (_: Exception) {
            clearOutput()
            previous = null
            render(Plan.Neutral(PlaybackCondition.DEGRADED, null), rotation)
            failedGeneration = generation
            android.util.Log.e("TeluniPlayer", "RENDER_FAILED")
            runtime.reportPlayback(PlaybackCondition.DEGRADED)
        }
    }

    private fun render(plan: Plan, rotation: Int) {
        if (plan == previous && rotation == previousRotation) return
        val old = previous
        previous = plan
        previousRotation = rotation
        outputRotation = rotation
        when (plan) {
            is Plan.Neutral -> {
                clearOutput()
                val label = TextView(context).apply {
                    setText(R.string.brand_name)
                    setTextColor(Color.rgb(89, 211, 174))
                    textSize = 36f
                    gravity = Gravity.CENTER
                }
                canvas.addView(label, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
                canvasWidth = 1920; canvasHeight = 1080
                runtime.reportPlayback(plan.condition)
            }
            is Plan.Play -> {
                // A schedule horizon or refreshed statement must not restart the playlist.
                if (old !is Plan.Play || old.publication.header.publicationId != plan.publication.header.publicationId ||
                    old.playlist != plan.playlist || mediaChanged(old, plan, plan.publication,
                        plan.playlist.items.map { it.mediaId })) {
                    clearOutput()
                    canvasWidth = 1920; canvasHeight = 1080
                    addPlaylist(canvas, plan.publication, plan.playlist.items, false, "contain", 0f)
                }
            }
            is Plan.Compose -> {
                val layout = requireNotNull(plan.publication.layout)
                val samePublication = old is Plan.Compose &&
                    old.publication.header.publicationId == plan.publication.header.publicationId
                if (!samePublication) clearOutput()
                canvasWidth = layout.width; canvasHeight = layout.height
                for (areaPlan in plan.areas) {
                    val key = areaPlan.area.key
                    val kept = areaViews[key]
                    val ids = when (areaPlan) {
                        is AreaPlan.Play -> areaPlan.playlist.items.map { it.mediaId }
                        is AreaPlan.Still -> listOf(areaPlan.media.id)
                        is AreaPlan.Catalog, is AreaPlan.Empty -> emptyList()
                    }
                    if (kept?.plan == areaPlan && !mediaChanged(old, plan, plan.publication, ids)) {
                        if (areaPlan is AreaPlan.Catalog) {
                            (kept.view.getChildAt(0) as CatalogView).refreshMedia(plan.publication, plan.mediaVersions)
                        }
                        continue
                    }
                    if (kept != null) {
                        kept.players.forEach { it.release(); media.remove(it); failedPlayers.remove(it) }
                        canvas.removeView(kept.view)
                    }
                    val area = areaPlan.area
                    val container = FrameLayout(context).apply { setBackgroundColor(Color.parseColor(area.background)) }
                    canvas.addView(container, LayoutParams(area.width, area.height).apply {
                        leftMargin = area.x; topMargin = area.y
                    })
                    container.elevation = area.z.toFloat()
                    val before = media.toSet()
                    when (areaPlan) {
                        is AreaPlan.Play -> addPlaylist(container, plan.publication, areaPlan.playlist.items,
                            false, area.fit, if (area.muted) 0f else area.volume / 100f)
                        is AreaPlan.Still -> addPlaylist(container, plan.publication,
                            listOf(Manifest.Item(areaPlan.media.id, null)), true, area.fit,
                            if (area.muted) 0f else area.volume / 100f)
                        is AreaPlan.Catalog -> container.addView(CatalogView(context, runtime, plan.publication, areaPlan, plan.mediaVersions),
                            LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
                        is AreaPlan.Empty -> Unit
                    }
                    areaViews[key] = AreaOutput(areaPlan, container, media.filter { it !in before })
                }
            }
        }
        positionCanvas()
    }

    private fun mediaChanged(old: Plan?, next: Plan, publication: Publication, ids: List<String>): Boolean =
        ids.any { id -> publication.media[id]?.sha256?.let { old?.mediaVersions?.get(it) != next.mediaVersions[it] } == true }

    private fun addPlaylist(parent: FrameLayout, publication: Publication, items: List<Manifest.Item>,
        hold: Boolean, fit: String, volume: Float) {
        val surface = LayoutInflater.from(context).inflate(R.layout.media_surface, parent, false) as PlayerView
        surface.resizeMode = if (fit == "cover") AspectRatioFrameLayout.RESIZE_MODE_ZOOM else AspectRatioFrameLayout.RESIZE_MODE_FIT
        parent.addView(surface)
        val player = ExoPlayer.Builder(context).build()
        media += player
        surface.player = player
        player.volume = volume
        player.repeatMode = if (hold) Player.REPEAT_MODE_OFF else Player.REPEAT_MODE_ALL
        val failed = mutableSetOf<Int>()
        player.addListener(object : Player.Listener {
            override fun onPlaybackStateChanged(playbackState: Int) {
                if (playbackState == Player.STATE_READY) runtime.reportPlayback(
                    if (degraded || previous?.degraded == true) PlaybackCondition.DEGRADED else PlaybackCondition.PLAYING)
            }
            override fun onPlayerError(error: PlaybackException) {
                // Decoder exception messages can carry content paths; report only a bounded condition.
                failedPlayers += player
                runtime.reportPlayback(PlaybackCondition.DEGRADED)
                items.getOrNull(player.currentMediaItemIndex)?.let { publication.media[it.mediaId] }
                    ?.let { runtime.reportMediaFailure(it.sha256) }
                failed += player.currentMediaItemIndex
                if (failed.size >= items.size) { player.stop(); surface.visibility = INVISIBLE; return }
                var next = (player.currentMediaItemIndex + 1) % items.size
                while (next in failed) next = (next + 1) % items.size
                player.seekTo(next, 0)
                player.prepare()
            }
        })
        player.setMediaItems(items.map { item ->
            val source = publication.media.getValue(item.mediaId)
            MediaItem.Builder().setUri(Uri.fromFile(File(runtime.mediaPath(source.sha256))))
                .setMimeType(source.contentType).apply {
                    if (source.kind == "image") setImageDurationMs(if (hold) TimeUnitDays else requireNotNull(item.durationMs))
                }.build()
        })
        player.prepare()
        player.playWhenReady = true
    }

    private fun clearOutput() {
        media.forEach { it.release() }
        media.clear()
        areaViews.clear()
        canvas.removeAllViews()
        failedPlayers.clear()
    }

    fun release() { clearOutput(); previous = null; failedGeneration = null }

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) { positionCanvas() }

    private fun positionCanvas() {
        if (width == 0 || height == 0) return
        val swapped = outputRotation == 90 || outputRotation == 270
        val extentWidth = if (swapped) canvasHeight else canvasWidth
        val extentHeight = if (swapped) canvasWidth else canvasHeight
        val scale = minOf(width.toFloat() / extentWidth, height.toFloat() / extentHeight)
        canvas.layoutParams = LayoutParams(canvasWidth, canvasHeight)
        canvas.pivotX = 0f; canvas.pivotY = 0f
        canvas.scaleX = scale; canvas.scaleY = scale; canvas.rotation = outputRotation.toFloat()
        val left = (width - extentWidth * scale) / 2
        val top = (height - extentHeight * scale) / 2
        canvas.translationX = left + if (outputRotation == 90 || outputRotation == 180) extentWidth * scale else 0f
        canvas.translationY = top + if (outputRotation == 180 || outputRotation == 270) extentHeight * scale else 0f
    }

    companion object { private const val TimeUnitDays = 86_400_000L }
}
