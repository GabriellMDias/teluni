package app.teluni.player

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.os.SystemClock
import android.text.Layout
import android.text.StaticLayout
import android.text.TextPaint
import android.view.View
import app.teluni.player.core.playback.AreaPlan
import app.teluni.player.core.protocol.Widget
import kotlin.math.floor
import kotlin.math.min

/** Draws only core-authorized presentation; animation uses elapsed time. */
@SuppressLint("ViewConstructor")
internal class WidgetView(context: Context, private var plan: AreaPlan.Widget) : View(context) {
    private val paint = TextPaint(Paint.ANTI_ALIAS_FLAG)
    private val blocks = Paint().apply { isAntiAlias = false }
    private val started = SystemClock.uptimeMillis()
    init { importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_YES; describe() }
    private fun describe() { contentDescription = listOf(plan.text.primary, plan.text.secondary, plan.text.footer).filter { it.isNotBlank() }.joinToString(". ") }
    fun update(next: AreaPlan.Widget) { plan = next; describe(); invalidate() }
    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val widget = requireNotNull(plan.area.widget)
        val text = plan.text
        paint.color = Color.parseColor(widget.foreground)
        val padding = min(32f, min(width, height) * .08f)
        val available = (width - padding * 2).coerceAtLeast(1f)
        if (widget is Widget.Ticker) {
            paint.textSize = min(widget.textSize.toFloat(), height * .65f)
            val baseline = height / 2f - (paint.ascent() + paint.descent()) / 2f
            val length = paint.measureText(widget.text) + 100f
            val cycle = length + width
            val x = padding - ((SystemClock.uptimeMillis() - started) / 1000f * widget.speed % cycle)
            canvas.save(); canvas.clipRect(padding, 0f, width - padding, height.toFloat())
            canvas.drawText(widget.text, x, baseline, paint)
            canvas.drawText(widget.text, x + cycle, baseline, paint)
            canvas.restore()
            postInvalidateOnAnimation()
            return
        }
        if (widget is Widget.Qr) {
            val captionHeight = if (widget.caption.isEmpty()) 0f else min(widget.textSize * 1.8f, height * .23f)
            val size = min(available, height - padding * 2 - captionHeight).coerceAtLeast(1f)
            val cells = widget.modules.size + 8
            val cell = floor(size / cells).coerceAtLeast(1f)
            val square = cells * cell
            val left = (width - square) / 2f
            val top = (height - captionHeight - square) / 2f
            blocks.color = Color.WHITE
            canvas.drawRect(left, top, left + square, top + square, blocks)
            blocks.color = Color.BLACK
            widget.modules.forEachIndexed { y, row -> row.forEachIndexed { x, value -> if (value == '1') canvas.drawRect(left + (x + 4) * cell, top + (y + 4) * cell, left + (x + 5) * cell, top + (y + 5) * cell, blocks) } }
            if (captionHeight > 0) drawText(canvas, widget.caption, padding, top + square + padding / 2, available.toInt(), min(widget.textSize.toFloat(), captionHeight * .65f), 2, true)
            return
        }
        val mainSize = min(widget.textSize.toFloat() * if (widget is Widget.Clock || widget is Widget.Weather) 1.7f else 1f, height * .36f)
        val secondarySize = min(widget.textSize * .55f, height * .12f).coerceAtLeast(10f)
        val footerSize = min(widget.textSize * .32f, height * .08f).coerceAtLeast(10f)
        val mainLines = if (widget is Widget.Rss) 4 else if (widget is Widget.Clock && !widget.showTime) 3 else 2
        val footerHeight = if (text.footer.isEmpty()) 0f else footerSize * 2.5f
        val secondaryHeight = if (text.secondary.isEmpty()) 0f else secondarySize * 2.5f
        val mainHeight = drawText(canvas, text.primary, padding, padding, available.toInt(), mainSize, mainLines)
        if (text.secondary.isNotEmpty()) drawText(canvas, text.secondary, padding, (padding + mainHeight + 12).coerceAtMost((height - footerHeight - secondaryHeight).coerceAtLeast(padding)), available.toInt(), secondarySize, 2)
        if (text.footer.isNotEmpty()) {
            paint.alpha = 185
            drawText(canvas, text.footer, padding, (height - padding - footerHeight).coerceAtLeast(padding), available.toInt(), footerSize, 2)
            paint.alpha = 255
        }
    }
    private fun drawText(canvas: Canvas, value: String, left: Float, top: Float, width: Int, size: Float, maxLines: Int, center: Boolean = false): Int {
        paint.textSize = size
        val layout = StaticLayout.Builder.obtain(value, 0, value.length, paint, width.coerceAtLeast(1))
            .setAlignment(if (center) Layout.Alignment.ALIGN_CENTER else Layout.Alignment.ALIGN_NORMAL)
            .setIncludePad(false).setMaxLines(maxLines).setEllipsize(android.text.TextUtils.TruncateAt.END).build()
        canvas.save(); canvas.translate(left, top); layout.draw(canvas); canvas.restore()
        return layout.height
    }
}
