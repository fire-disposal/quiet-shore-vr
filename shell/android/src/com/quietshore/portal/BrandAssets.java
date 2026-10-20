package com.quietshore.portal;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RectF;
import android.graphics.drawable.Icon;

/**
 * Programmatic brand art for the shell. The APK has no image resources, so
 * the launcher/notification/tile marks are drawn once and cached by the
 * platform as bitmaps.
 */
final class BrandAssets {
    static final int ACCENT = 0xFFE0BB78;
    static final int TEAL = 0xFF7FC8B8;
    static final int SURFACE = 0xFF12211E;
    static final int BORDER = 0xFF2E4A45;

    private BrandAssets() {
    }

    static Icon smallIcon(Context context) {
        return Icon.createWithBitmap(bitmap(96, true));
    }

    static Icon largeIcon(Context context) {
        return Icon.createWithBitmap(bitmap(192, false));
    }

    static Icon actionIcon(Context context, String kind) {
        return Icon.createWithBitmap(actionBitmap(kind));
    }

    static Bitmap largeBitmap(Context context, int size) {
        return bitmap(size, false);
    }

    private static Bitmap bitmap(int size, boolean silhouette) {
        Bitmap bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(bitmap);
        Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);

        if (!silhouette) {
            paint.setColor(SURFACE);
            canvas.drawRoundRect(new RectF(0, 0, size, size), size * 0.24f, size * 0.24f, paint);
            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeWidth(size * 0.018f);
            paint.setColor(BORDER);
            float inset = size * 0.02f;
            canvas.drawRoundRect(new RectF(inset, inset, size - inset, size - inset),
                    size * 0.23f, size * 0.23f, paint);
        }

        float cx = size * 0.5f;
        float cy = size * 0.41f;
        float radius = size * 0.155f;
        paint.setStyle(Paint.Style.FILL);
        paint.setColor(silhouette ? Color.WHITE : ACCENT);
        canvas.drawCircle(cx, cy, radius, paint);

        paint.setStyle(Paint.Style.STROKE);
        paint.setStrokeWidth(size * 0.055f);
        paint.setStrokeCap(Paint.Cap.ROUND);
        paint.setColor(silhouette ? Color.WHITE : TEAL);
        Path wave = new Path();
        float y = size * 0.67f;
        float left = size * 0.22f;
        float right = size * 0.78f;
        wave.moveTo(left, y);
        wave.cubicTo(left + size * 0.14f, y - size * 0.08f,
                left + size * 0.28f, y - size * 0.08f, cx, y);
        wave.cubicTo(cx + size * 0.14f, y + size * 0.08f,
                right - size * 0.14f, y + size * 0.08f, right, y);
        canvas.drawPath(wave, paint);

        paint.setStrokeWidth(size * 0.032f);
        paint.setColor(silhouette ? Color.WHITE : BORDER);
        Path lower = new Path();
        float y2 = size * 0.79f;
        lower.moveTo(left, y2);
        lower.cubicTo(left + size * 0.14f, y2 - size * 0.05f,
                left + size * 0.28f, y2 - size * 0.05f, cx, y2);
        lower.cubicTo(cx + size * 0.14f, y2 + size * 0.05f,
                right - size * 0.14f, y2 + size * 0.05f, right, y2);
        canvas.drawPath(lower, paint);

        return bitmap;
    }

    private static Bitmap actionBitmap(String kind) {
        int size = 96;
        Bitmap bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(bitmap);
        Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        paint.setColor(Color.WHITE);
        paint.setStrokeCap(Paint.Cap.ROUND);
        paint.setStrokeJoin(Paint.Join.ROUND);

        if ("apps".equals(kind)) {
            paint.setStyle(Paint.Style.FILL);
            float cell = size * 0.24f;
            float gap = size * 0.1f;
            float left = (size - (cell * 2 + gap)) / 2f;
            for (int row = 0; row < 2; row++) {
                for (int col = 0; col < 2; col++) {
                    float x = left + col * (cell + gap);
                    float y = left + row * (cell + gap);
                    canvas.drawRoundRect(new RectF(x, y, x + cell, y + cell),
                            cell * 0.28f, cell * 0.28f, paint);
                }
            }
        } else if ("home".equals(kind)) {
            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeWidth(size * 0.075f);
            Path house = new Path();
            house.moveTo(size * 0.22f, size * 0.48f);
            house.lineTo(size * 0.5f, size * 0.22f);
            house.lineTo(size * 0.78f, size * 0.48f);
            house.lineTo(size * 0.78f, size * 0.78f);
            house.lineTo(size * 0.22f, size * 0.78f);
            house.close();
            canvas.drawPath(house, paint);
        } else {
            paint.setStyle(Paint.Style.FILL);
            Path play = new Path();
            play.moveTo(size * 0.34f, size * 0.24f);
            play.lineTo(size * 0.76f, size * 0.5f);
            play.lineTo(size * 0.34f, size * 0.76f);
            play.close();
            canvas.drawPath(play, paint);
        }

        return bitmap;
    }
}
