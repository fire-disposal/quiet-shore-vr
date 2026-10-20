package com.quietshore.portal

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.graphics.drawable.Icon

/**
 * Programmatic brand art for the shell. The APK has no image resources, so
 * the launcher/notification/tile marks are drawn once and cached by the
 * platform as bitmaps.
 */
internal object BrandAssets {
    val ACCENT: Int = 0xFF8F4634.toInt()
    private val TEAL: Int = 0xFF7FC8B8.toInt()
    private val SURFACE: Int = 0xFF12211E.toInt()
    private val BORDER: Int = 0xFF2E4A45.toInt()

    fun smallIcon(): Icon = Icon.createWithBitmap(bitmap(96, silhouette = true))

    fun largeIcon(): Icon = Icon.createWithBitmap(bitmap(192, silhouette = false))

    fun actionIcon(kind: String): Icon = Icon.createWithBitmap(actionBitmap(kind))

    fun largeBitmap(size: Int): Bitmap = bitmap(size, silhouette = false)

    private fun bitmap(size: Int, silhouette: Boolean): Bitmap {
        val bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        val paint = Paint(Paint.ANTI_ALIAS_FLAG)

        if (!silhouette) {
            paint.color = SURFACE
            canvas.drawRoundRect(RectF(0f, 0f, size.toFloat(), size.toFloat()), size * 0.24f, size * 0.24f, paint)
            paint.style = Paint.Style.STROKE
            paint.strokeWidth = size * 0.018f
            paint.color = BORDER
            val inset = size * 0.02f
            canvas.drawRoundRect(
                RectF(inset, inset, size - inset, size - inset),
                size * 0.23f,
                size * 0.23f,
                paint
            )
        }

        val cx = size * 0.5f
        val cy = size * 0.41f
        val radius = size * 0.155f
        paint.style = Paint.Style.FILL
        paint.color = if (silhouette) Color.WHITE else ACCENT
        canvas.drawCircle(cx, cy, radius, paint)

        paint.style = Paint.Style.STROKE
        paint.strokeWidth = size * 0.055f
        paint.strokeCap = Paint.Cap.ROUND
        paint.color = if (silhouette) Color.WHITE else TEAL
        val wave = Path()
        val y = size * 0.67f
        val left = size * 0.22f
        val right = size * 0.78f
        wave.moveTo(left, y)
        wave.cubicTo(
            left + size * 0.14f, y - size * 0.08f,
            left + size * 0.28f, y - size * 0.08f, cx, y
        )
        wave.cubicTo(
            cx + size * 0.14f, y + size * 0.08f,
            right - size * 0.14f, y + size * 0.08f, right, y
        )
        canvas.drawPath(wave, paint)

        paint.strokeWidth = size * 0.032f
        paint.color = if (silhouette) Color.WHITE else BORDER
        val lower = Path()
        val y2 = size * 0.79f
        lower.moveTo(left, y2)
        lower.cubicTo(
            left + size * 0.14f, y2 - size * 0.05f,
            left + size * 0.28f, y2 - size * 0.05f, cx, y2
        )
        lower.cubicTo(
            cx + size * 0.14f, y2 + size * 0.05f,
            right - size * 0.14f, y2 + size * 0.05f, right, y2
        )
        canvas.drawPath(lower, paint)

        return bitmap
    }

    private fun actionBitmap(kind: String): Bitmap {
        val size = 96
        val bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        val paint = Paint(Paint.ANTI_ALIAS_FLAG)
        paint.color = Color.WHITE
        paint.strokeCap = Paint.Cap.ROUND
        paint.strokeJoin = Paint.Join.ROUND

        when (kind) {
            "apps" -> {
                paint.style = Paint.Style.FILL
                val cell = size * 0.24f
                val gap = size * 0.1f
                val left = (size - (cell * 2 + gap)) / 2f
                for (row in 0..1) {
                    for (col in 0..1) {
                        val x = left + col * (cell + gap)
                        val y = left + row * (cell + gap)
                        canvas.drawRoundRect(
                            RectF(x, y, x + cell, y + cell),
                            cell * 0.28f,
                            cell * 0.28f,
                            paint
                        )
                    }
                }
            }

            "home" -> {
                paint.style = Paint.Style.STROKE
                paint.strokeWidth = size * 0.075f
                val house = Path()
                house.moveTo(size * 0.22f, size * 0.48f)
                house.lineTo(size * 0.5f, size * 0.22f)
                house.lineTo(size * 0.78f, size * 0.48f)
                house.lineTo(size * 0.78f, size * 0.78f)
                house.lineTo(size * 0.22f, size * 0.78f)
                house.close()
                canvas.drawPath(house, paint)
            }

            else -> {
                paint.style = Paint.Style.FILL
                val play = Path()
                play.moveTo(size * 0.34f, size * 0.24f)
                play.lineTo(size * 0.76f, size * 0.5f)
                play.lineTo(size * 0.34f, size * 0.76f)
                play.close()
                canvas.drawPath(play, paint)
            }
        }

        return bitmap
    }
}
