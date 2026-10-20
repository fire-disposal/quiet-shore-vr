package com.quietshore.portal

import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.RippleDrawable
import android.content.res.ColorStateList
import android.os.Build
import android.os.Bundle
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView

/**
 * Headset console, reachable from the notification, launcher icon and QS tile.
 *
 * It deliberately does not launch Firefox on open. The only entry action is
 * the explicit button below, guarded by a short cooldown so a double tap or a
 * notification tap cannot strand the user in another app.
 */
class PortalActivity : Activity() {
    private companion object {
        val BG_TOP: Int = 0xFF0A1211.toInt()
        val BG_BOTTOM: Int = 0xFF12211E.toInt()
        val SURFACE: Int = 0xFF172724.toInt()
        val BORDER: Int = 0xFF2E4A45.toInt()
        val TEXT: Int = 0xFFEEF4F0.toInt()
        val MUTED: Int = 0xFF9FB3AC.toInt()
        val ACCENT: Int = 0xFFE0BB78.toInt()
        val ACCENT_INK: Int = 0xFF1A1408.toInt()
        val OK: Int = 0xFF88D1C1.toInt()
        const val STATUS_REFRESH_MS = 800L
    }

    private var bluetoothText: TextView? = null
    private var hintText: TextView? = null
    private var enterButton: TextView? = null
    private var receiverRegistered = false

    private val statusReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            refreshStatus()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        PortalActions.startServer(this)
        window.statusBarColor = BG_TOP
        window.navigationBarColor = BG_TOP

        val root = FrameLayout(this).apply {
            background = GradientDrawable(
                GradientDrawable.Orientation.TL_BR,
                intArrayOf(BG_TOP, BG_BOTTOM)
            )
        }
        val scroll = ScrollView(this).apply {
            isFillViewport = true
            clipToPadding = false
            isVerticalScrollBarEnabled = false
        }
        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(dp(26), dp(28), dp(26), dp(24))
        }
        val contentWidth = minOf(dp(480), maxOf(dp(300), resources.displayMetrics.widthPixels - dp(32)))
        scroll.addView(
            content,
            FrameLayout.LayoutParams(
                contentWidth,
                ViewGroup.LayoutParams.WRAP_CONTENT,
                Gravity.CENTER_HORIZONTAL
            )
        )
        root.addView(scroll, FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        ))
        setContentView(root)

        content.addView(
            ImageView(this).apply { setImageBitmap(BrandAssets.largeBitmap(168)) },
            LinearLayout.LayoutParams(dp(68), dp(68)).apply { bottomMargin = dp(8) }
        )
        content.addView(label("静岸", 32f, TEXT, Typeface.BOLD, 0f).apply {
            gravity = Gravity.CENTER
        })
        content.addView(
            label("QUIET SHORE VR", 10f, ACCENT, Typeface.BOLD, 0.18f).apply {
                gravity = Gravity.CENTER
            },
            LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply { topMargin = dp(2) }
        )

        content.addView(statusLine(), LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        ).apply { topMargin = dp(22) })

        bluetoothText = label(PortalStatus.description(), 15f, TEXT, Typeface.NORMAL, 0f).apply {
            gravity = Gravity.CENTER
        }
        content.addView(bluetoothText, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        ).apply { topMargin = dp(8) })

        hintText = label("平板连接后可控制场景、声音和校准", 13f, MUTED, Typeface.NORMAL, 0f).apply {
            gravity = Gravity.CENTER
        }
        content.addView(hintText, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        ).apply { topMargin = dp(10) })

        val enter = actionButton("进入训练", true) {
            val launched = PortalActions.enter(this)
            if (launched) {
                enterButton?.text = "正在打开，请稍候"
                enterButton?.isEnabled = false
                hintText?.text = "进入后由平板控制，患者无需操作"
                enterButton?.postDelayed({
                    enterButton?.isEnabled = true
                    enterButton?.text = "进入训练"
                }, 1500)
            } else {
                hintText?.text = "请稍候再进入，避免重复拉起 Firefox"
            }
        }
        enterButton = enter
        content.addView(enter, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            dp(58)
        ).apply { topMargin = dp(22) })

        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        row.addView(
            actionButton("全部应用", false) { PortalActions.allApps(this) },
            LinearLayout.LayoutParams(0, dp(52), 1f).apply { rightMargin = dp(5) }
        )
        row.addView(
            actionButton("返回桌面", false) { PortalActions.chooseHome(this) },
            LinearLayout.LayoutParams(0, dp(52), 1f).apply { leftMargin = dp(5) }
        )
        content.addView(row, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        ).apply { topMargin = dp(12) })

        refreshStatus()
    }

    override fun onResume() {
        super.onResume()
        PortalActions.startServer(this)
        refreshStatus()
        if (!receiverRegistered) {
            val filter = IntentFilter(PortalStatus.ACTION_STATUS)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                registerReceiver(statusReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
            } else {
                registerReceiver(statusReceiver, filter)
            }
            receiverRegistered = true
        }
    }

    override fun onPause() {
        if (receiverRegistered) {
            unregisterReceiver(statusReceiver)
            receiverRegistered = false
        }
        super.onPause()
    }

    private fun refreshStatus() {
        bluetoothText?.text = PortalStatus.description()
    }

    private fun statusLine(): View {
        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
        }
        val dot = View(this).apply {
            background = GradientDrawable().apply {
                shape = GradientDrawable.OVAL
                setColor(OK)
            }
        }
        row.addView(dot, LinearLayout.LayoutParams(dp(7), dp(7)).apply { rightMargin = dp(7) })
        row.addView(label("服务已就绪 127.0.0.1:8130", 13f, MUTED, Typeface.NORMAL, 0f))
        return row
    }

    private fun actionButton(text: String, primary: Boolean, onClick: () -> Unit): TextView {
        val button = label(text, 17f, if (primary) ACCENT_INK else TEXT, Typeface.BOLD, 0f).apply {
            gravity = Gravity.CENTER
            isClickable = true
            isFocusable = true
            setPadding(dp(16), 0, dp(16), 0)
            setOnClickListener { onClick() }
        }
        val background = rounded(if (primary) ACCENT else SURFACE, 16, if (primary) ACCENT else BORDER, 1)
        val ripple = if (primary) 0x33000000 else 0x33FFFFFF
        button.background = RippleDrawable(ColorStateList.valueOf(ripple), background, null)
        return button
    }

    private fun label(
        text: String,
        sizeSp: Float,
        color: Int,
        style: Int,
        letterSpacing: Float
    ): TextView = TextView(this).apply {
        this.text = text
        setTextColor(color)
        setTextSize(TypedValue.COMPLEX_UNIT_SP, sizeSp)
        typeface = Typeface.create("sans-serif", style)
        includeFontPadding = false
        if (letterSpacing != 0f) {
            this.letterSpacing = letterSpacing
        }
    }

    private fun rounded(color: Int, radiusDp: Int, strokeColor: Int, strokeDp: Int): GradientDrawable =
        GradientDrawable().apply {
            setColor(color)
            setCornerRadius(dp(radiusDp).toFloat())
            if (strokeDp > 0) setStroke(dp(strokeDp), strokeColor)
        }

    private fun dp(value: Int): Int =
        (value * resources.displayMetrics.density + 0.5f).toInt()
}
