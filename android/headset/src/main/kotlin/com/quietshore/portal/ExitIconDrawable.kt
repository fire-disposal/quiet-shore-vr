package com.quietshore.portal

import android.graphics.Canvas
import android.graphics.ColorFilter
import android.graphics.Paint
import android.graphics.PixelFormat
import android.graphics.Rect
import android.graphics.drawable.Drawable

/** Line-art door with an outward arrow for the top-bar exit action. */
internal class ExitIconDrawable(private val color: Int) : Drawable() {
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
        paint.strokeWidth = w * 0.065f

        val left = bounds.left + w * 0.24f
        val doorRight = bounds.left + w * 0.58f
        val top = bounds.top + h * 0.22f
        val bottom = bounds.bottom - h * 0.22f
        val midY = bounds.top + h * 0.50f

        // Door frame, open on the right.
        canvas.drawLine(left, top, left, bottom, paint)
        canvas.drawLine(left, top, doorRight, top, paint)
        canvas.drawLine(left, bottom, doorRight, bottom, paint)

        // Outward arrow.
        canvas.drawLine(
            bounds.left + w * 0.40f,
            midY,
            bounds.left + w * 0.82f,
            midY,
            paint
        )
        canvas.drawLine(
            bounds.left + w * 0.68f,
            bounds.top + h * 0.38f,
            bounds.left + w * 0.82f,
            midY,
            paint
        )
        canvas.drawLine(
            bounds.left + w * 0.68f,
            bounds.bottom - h * 0.38f,
            bounds.left + w * 0.82f,
            midY,
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
