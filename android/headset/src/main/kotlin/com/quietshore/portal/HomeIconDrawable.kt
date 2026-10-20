package com.quietshore.portal

import android.graphics.Canvas
import android.graphics.ColorFilter
import android.graphics.Paint
import android.graphics.PixelFormat
import android.graphics.Rect
import android.graphics.drawable.Drawable

/** Small stroked house icon for the top-bar home action. */
internal class HomeIconDrawable(private val color: Int) : Drawable() {
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeCap = Paint.Cap.ROUND
        strokeJoin = Paint.Join.ROUND
        this.color = color
    }

    override fun draw(canvas: Canvas) {
        val bounds: Rect = bounds
        if (bounds.isEmpty) return
        val w = bounds.width().toFloat()
        val h = bounds.height().toFloat()
        val pad = w * 0.22f
        val left = bounds.left + pad
        val right = bounds.right - pad
        val top = bounds.top + pad
        val bottom = bounds.bottom - pad
        val midY = top + h * 0.42f
        paint.strokeWidth = w * 0.07f

        // Roof
        canvas.drawLine(left, midY, bounds.left + w / 2f, top, paint)
        canvas.drawLine(bounds.left + w / 2f, top, right, midY, paint)
        // Walls
        canvas.drawLine(left, midY, left, bottom, paint)
        canvas.drawLine(right, midY, right, bottom, paint)
        canvas.drawLine(left, bottom, right, bottom, paint)
        // Door
        val doorW = w * 0.18f
        val doorH = h * 0.22f
        canvas.drawRect(
            bounds.left + w / 2f - doorW / 2f,
            bottom - doorH,
            bounds.left + w / 2f + doorW / 2f,
            bottom,
            paint
        )
    }

    override fun setAlpha(alpha: Int) {
        paint.alpha = alpha
        invalidateSelf()
    }

    override fun setColorFilter(colorFilter: ColorFilter?) {
        paint.colorFilter = colorFilter
        invalidateSelf()
    }

    @Deprecated("Deprecated in Java")
    override fun getOpacity(): Int = PixelFormat.TRANSLUCENT
}
