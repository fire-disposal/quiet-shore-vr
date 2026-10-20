package com.quietshore.portal

import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.res.ColorStateList
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.RippleDrawable
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.Switch
import android.widget.TextView

/**
 * Headset console. Four fixed pages: Home, Scenes, Settings, Help.
 *
 * No page scrolls. Scene choice is a first-class page for standalone use;
 * when a tablet owns control, the page explains that the tablet decides.
 */
class PortalActivity : Activity() {
    private enum class Page(val label: String) {
        HOME("控制台"),
        SCENES("场景"),
        SETTINGS("设置"),
        HELP("帮助")
    }

    private data class SceneChoice(
        val id: String,
        val name: String,
        val tagline: String,
        val tint: Int
    )

    private companion object {
        val BG_TOP: Int = 0xFFF3EFE6.toInt()
        val BG_BOTTOM: Int = 0xFFE8E1D4.toInt()
        val SURFACE: Int = 0xFFECE6DA.toInt()
        val BORDER: Int = 0xFFD5CCBB.toInt()
        val TEXT: Int = 0xFF20251F.toInt()
        val MUTED: Int = 0xFF5E655A.toInt()
        val ACCENT: Int = 0xFF8F4634.toInt()
        val ACCENT_INK: Int = 0xFFF8F3E9.toInt()
        val OK: Int = 0xFF486B58.toInt()

        val SCENES = listOf(
            SceneChoice("landscape", "湖畔晨岸", "水面、芦苇与清晨的光", 0xFF6F8B7A.toInt()),
            SceneChoice("ward", "训练病区", "熟悉病房与床旁设备", 0xFF7C8578.toInt()),
            SceneChoice("bathroom", "暖石浴室", "柔和石材与水声", 0xFFB08A6A.toInt()),
            SceneChoice("lab", "空间实验", "空间 UI 与边界练习", 0xFF6A7F8C.toInt())
        )
    }

    private lateinit var content: FrameLayout
    private lateinit var nav: LinearLayout
    private lateinit var modeChip: TextView
    private var currentPage = Page.HOME
    private var settings = HeadsetSettings()
    private var homeBluetooth: TextView? = null
    private var homeScene: TextView? = null
    private var enterButton: TextView? = null
    private var homeHint: TextView? = null
    private var receiverRegistered = false

    private val statusReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            refreshStatus()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        settings = HeadsetSettings.read(this)
        PortalActions.startServer(this)
        window.statusBarColor = BG_TOP
        window.navigationBarColor = BG_TOP
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            window.decorView.systemUiVisibility = View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR
        }
        setContentView(buildShell())
        showPage(Page.HOME)
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

    private fun buildShell(): View {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            background = GradientDrawable(
                GradientDrawable.Orientation.TL_BR,
                intArrayOf(BG_TOP, BG_BOTTOM)
            )
        }

        val header = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(24), dp(18), dp(24), dp(10))
        }
        val seal = TextView(this).apply {
            text = "荷"
            gravity = Gravity.CENTER
            setTextColor(ACCENT)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 17f)
            typeface = Typeface.create("serif", Typeface.BOLD)
            background = rounded(0x00000000, 2, ACCENT, 1)
        }
        header.addView(seal, LinearLayout.LayoutParams(dp(40), dp(40)))
        val titles = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(12), 0, 0, 0)
        }
        titles.addView(label("静岸", 24f, TEXT, Typeface.BOLD, 0f))
        titles.addView(label("QUIET SHORE VR", 9f, ACCENT, Typeface.BOLD, 0.18f))
        header.addView(titles, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        modeChip = label("独立使用", 12f, MUTED, Typeface.NORMAL, 0f).apply {
            gravity = Gravity.CENTER
            minHeight = dp(32)
            setPadding(dp(12), 0, dp(12), 0)
            background = rounded(SURFACE, 2, BORDER, 1)
        }
        header.addView(modeChip, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, dp(32)))
        root.addView(header, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        ))
        root.addView(
            View(this).apply { setBackgroundColor(BORDER) },
            LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(1))
        )

        content = FrameLayout(this)
        root.addView(content, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))

        nav = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            setPadding(dp(14), dp(8), dp(14), dp(14))
        }
        for (page in Page.values()) {
            val item = label(page.label, 13f, MUTED, Typeface.BOLD, 0f).apply {
                gravity = Gravity.CENTER
                minHeight = dp(48)
                isClickable = true
                isFocusable = true
                setOnClickListener { showPage(page) }
            }
            nav.addView(item, LinearLayout.LayoutParams(0, dp(48), 1f).apply {
                marginStart = dp(3)
                marginEnd = dp(3)
            })
        }
        root.addView(nav, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        ))
        return root
    }

    private fun showPage(page: Page) {
        currentPage = page
        homeBluetooth = null
        homeScene = null
        enterButton = null
        homeHint = null
        val body = when (page) {
            Page.HOME -> buildHomePage()
            Page.SCENES -> buildScenesPage()
            Page.SETTINGS -> buildSettingsPage()
            Page.HELP -> buildHelpPage()
        }
        content.removeAllViews()
        content.addView(body, FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT,
            Gravity.TOP
        ))
        refreshStatus()
        updateNav()
    }

    private fun updateNav() {
        for (index in 0 until nav.childCount) {
            val item = nav.getChildAt(index) as TextView
            val selected = Page.values()[index] == currentPage
            item.setTextColor(if (selected) ACCENT_INK else MUTED)
            item.background = if (selected) {
                rounded(ACCENT, 2, ACCENT, 0)
            } else {
                rounded(SURFACE, 2, BORDER, 1)
            }
        }
    }

    private fun buildHomePage(): View {
        val page = pageColumn()
        page.addView(titleLabel("控制台"))
        page.addView(pageSubtitle("开始训练，或查看当前连接"))
        val card = sectionCard()
        val service = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        service.addView(dot(OK), LinearLayout.LayoutParams(dp(8), dp(8)).apply { marginEnd = dp(8) })
        service.addView(label("服务已就绪", 14f, TEXT, Typeface.BOLD, 0f))
        service.addView(
            label("127.0.0.1:8130", 12f, MUTED, Typeface.NORMAL, 0f).apply { gravity = Gravity.END },
            LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        )
        card.addView(service)
        homeBluetooth = label(PortalStatus.description(), 14f, MUTED, Typeface.NORMAL, 0f).apply {
            setPadding(0, dp(12), 0, 0)
        }
        card.addView(homeBluetooth)
        homeScene = label("当前场景  ${sceneLabel(settings.sceneId)}   选择", 13f, MUTED, Typeface.NORMAL, 0f).apply {
            setPadding(0, dp(8), 0, 0)
            isClickable = true
            isFocusable = true
            setOnClickListener { showPage(Page.SCENES) }
        }
        card.addView(homeScene)
        page.addView(card)

        val enter = actionButton("进入训练", true) { launchTraining() }
        enterButton = enter
        page.addView(enter, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            dp(60)
        ).apply { topMargin = dp(18) })
        homeHint = label("请看向按钮，按下右侧中间确认键", 12f, MUTED, Typeface.NORMAL, 0f).apply {
            gravity = Gravity.CENTER
            setPadding(0, dp(10), 0, dp(14))
        }
        page.addView(homeHint)

        val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        row.addView(
            actionButton("全部应用", false) { PortalActions.allApps(this) },
            LinearLayout.LayoutParams(0, dp(52), 1f).apply { marginEnd = dp(5) }
        )
        row.addView(
            actionButton("返回桌面", false) { PortalActions.chooseHome(this) },
            LinearLayout.LayoutParams(0, dp(52), 1f).apply { marginStart = dp(5) }
        )
        page.addView(row)
        return page
    }

    private fun buildScenesPage(): View {
        val page = pageColumn()
        page.addView(titleLabel("场景"))
        page.addView(pageSubtitle("独立使用时从这里选择。平板接管后由平板决定。"))
        val lockedByTablet = PortalStatus.isControlActive()
        for (rowIndex in 0 until 2) {
            val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
            for (column in 0 until 2) {
                val choice = SCENES[rowIndex * 2 + column]
                val selected = choice.id == settings.sceneId
                val card = sceneCard(choice, selected)
                card.isEnabled = !lockedByTablet
                card.alpha = if (lockedByTablet) 0.55f else 1f
                if (!lockedByTablet) {
                    card.setOnClickListener {
                        settings = settings.copy(sceneId = choice.id)
                        HeadsetSettings.save(this, settings)
                        showPage(Page.SCENES)
                    }
                }
                row.addView(card, LinearLayout.LayoutParams(0, dp(136), 1f).apply {
                    marginStart = dp(4)
                    marginEnd = dp(4)
                    bottomMargin = dp(8)
                })
            }
            page.addView(row, LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ))
        }
        page.addView(
            label(
                if (PortalStatus.isControlActive()) "平板控制中：当前场景由平板同步。"
                else "当前场景：${sceneLabel(settings.sceneId)}",
                13f,
                MUTED,
                Typeface.NORMAL,
                0f
            ).apply { setPadding(0, dp(10), 0, 0) }
        )
        return page
    }

    private fun sceneCard(choice: SceneChoice, selected: Boolean): LinearLayout =
        LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(16), dp(14), dp(16), dp(12))
            background = rounded(
                if (selected) 0xFFF4E9E2.toInt() else SURFACE,
                4,
                if (selected) ACCENT else BORDER,
                if (selected) 2 else 1
            )
            isClickable = true
            isFocusable = true
            addView(
                View(this@PortalActivity).apply { setBackgroundColor(choice.tint) },
                LinearLayout.LayoutParams(dp(28), dp(3)).apply { bottomMargin = dp(10) }
            )
            addView(label(choice.name, 20f, TEXT, Typeface.BOLD, 0.02f).apply {
                typeface = Typeface.create("serif", Typeface.BOLD)
            })
            addView(label(choice.tagline, 12f, MUTED, Typeface.NORMAL, 0f).apply {
                setPadding(0, dp(5), 0, 0)
            })
            if (selected) {
                addView(label("已选", 11f, ACCENT, Typeface.BOLD, 0.08f).apply {
                    setPadding(0, dp(8), 0, 0)
                })
            }
        }

    private fun buildSettingsPage(): View {
        val page = pageColumn()
        page.addView(titleLabel("设置"))
        page.addView(pageSubtitle("启动偏好保存在本机"))
        val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        val left = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        val right = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }

        val usage = sectionCard()
        usage.addView(sectionLabel("使用"))
        usage.addView(settingSwitch("跳过方向校准", settings.skipCalibration) {
            settings = settings.copy(skipCalibration = it)
            HeadsetSettings.save(this, settings)
        })
        usage.addView(settingSwitch("显示性能面板", settings.showHud) {
            settings = settings.copy(showHud = it)
            HeadsetSettings.save(this, settings)
        })
        left.addView(usage, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        ))

        val connection = sectionCard()
        connection.addView(sectionLabel("连接"))
        connection.addView(
            label("平板接管后场景、声音和校准由平板控制", 13f, MUTED, Typeface.NORMAL, 0f).apply {
                setPadding(0, dp(8), 0, dp(8))
            }
        )
        connection.addView(actionButton("打开蓝牙设置", false) {
            startActivity(Intent(Settings.ACTION_BLUETOOTH_SETTINGS))
        }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(46)))
        right.addView(connection, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        ))

        val about = sectionCard()
        about.addView(sectionLabel("关于"))
        about.addView(infoRow("版本", versionName()))
        about.addView(infoRow("浏览器", "Firefox Reality 10"))
        about.addView(infoRow("本机服务", "127.0.0.1:8130"))
        about.addView(infoRow("控制方式", "平板先到先得"))
        right.addView(about, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        ))

        row.addView(left, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply {
            marginEnd = dp(7)
        })
        row.addView(right, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply {
            marginStart = dp(7)
        })
        page.addView(row, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        ))
        return page
    }

    private fun buildHelpPage(): View {
        val page = pageColumn()
        page.addView(titleLabel("帮助"))
        page.addView(pageSubtitle("独立使用或平板接管"))
        val steps = sectionCard()
        steps.addView(stepRow("1", "没有平板时，在场景页选择场景"))
        steps.addView(stepRow("2", "有平板时，在平板控制台搜索并连接头显"))
        steps.addView(stepRow("3", "看向进入按钮，将准星对准后按右侧中间确认键"))
        steps.addView(stepRow("4", "训练中的场景、声音和校准由平板控制"))
        page.addView(steps)

        val note = sectionCard()
        note.addView(sectionLabel("控制权"))
        note.addView(
            label(
                "第一台发送 CLAIM 的平板获得控制。第二台会提示已被占用。平板释放或断开后，头显恢复独立场景页。",
                14f,
                MUTED,
                Typeface.NORMAL,
                0f
            ).apply { setPadding(0, dp(8), 0, 0) }
        )
        page.addView(note)
        return page
    }

    private fun launchTraining() {
        val launched = PortalActions.enter(this, settings.toLaunchOptions())
        if (launched) {
            enterButton?.text = "正在打开，请稍候"
            enterButton?.isEnabled = false
            homeHint?.text = "进入后由平板或头显内操作"
            enterButton?.postDelayed({
                enterButton?.isEnabled = true
                enterButton?.text = "进入训练"
            }, 1500)
        } else {
            homeHint?.text = "请稍候再进入，避免重复拉起 Firefox"
        }
    }

    private fun refreshStatus() {
        val control = PortalStatus.isControlActive()
        modeChip.text = if (control) "平板控制" else "独立使用"
        modeChip.setTextColor(if (control) ACCENT else MUTED)
        modeChip.background = rounded(SURFACE, 2, if (control) ACCENT else BORDER, 1)
        homeBluetooth?.text = PortalStatus.description()
        homeScene?.text = "当前场景  ${sceneLabel(settings.sceneId)}   选择"
    }

    private fun settingSwitch(text: String, checked: Boolean, onChange: (Boolean) -> Unit): Switch =
        Switch(this).apply {
            this.text = text
            isChecked = checked
            setTextColor(TEXT)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
            minHeight = dp(54)
            buttonTintList = ColorStateList.valueOf(ACCENT)
            setPadding(0, dp(4), 0, dp(4))
            setOnCheckedChangeListener { _, value -> onChange(value) }
        }

    private fun stepRow(index: String, text: String): View {
        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(0, dp(8), 0, dp(8))
        }
        row.addView(label(index, 12f, ACCENT_INK, Typeface.BOLD, 0f).apply {
            gravity = Gravity.CENTER
            background = rounded(ACCENT, 999, ACCENT, 0)
        }, LinearLayout.LayoutParams(dp(28), dp(28)).apply { marginEnd = dp(12) })
        row.addView(label(text, 13f, TEXT, Typeface.NORMAL, 0f))
        return row
    }

    private fun infoRow(labelText: String, value: String): View {
        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(0, dp(7), 0, 0)
        }
        row.addView(label(labelText, 13f, MUTED, Typeface.NORMAL, 0f))
        row.addView(
            label(value, 13f, TEXT, Typeface.NORMAL, 0f).apply { gravity = Gravity.END },
            LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        )
        return row
    }

    private fun pageColumn(): LinearLayout = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(dp(24), dp(14), dp(24), dp(20))
    }

    private fun pageSubtitle(text: String): TextView =
        label(text, 14f, MUTED, Typeface.NORMAL, 0f).apply {
            setPadding(0, dp(6), 0, dp(14))
        }

    private fun sectionCard(): LinearLayout = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(dp(18), dp(15), dp(18), dp(15))
        background = rounded(SURFACE, 4, BORDER, 1)
        layoutParams = LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        ).apply { bottomMargin = dp(12) }
    }

    private fun sectionLabel(text: String): TextView =
        label(text, 11f, ACCENT, Typeface.BOLD, 0.12f)

    private fun titleLabel(text: String): TextView =
        label(text, 28f, TEXT, Typeface.NORMAL, 0.04f).apply {
            typeface = Typeface.create("serif", Typeface.NORMAL)
        }

    private fun actionButton(text: String, primary: Boolean, onClick: () -> Unit): TextView {
        val button = label(text, 16f, if (primary) ACCENT_INK else TEXT, Typeface.BOLD, 0f).apply {
            gravity = Gravity.CENTER
            isClickable = true
            isFocusable = true
            minHeight = dp(52)
            setPadding(dp(16), 0, dp(16), 0)
            setOnClickListener { onClick() }
        }
        val background = rounded(if (primary) ACCENT else SURFACE, 2, if (primary) ACCENT else BORDER, 1)
        val ripple = if (primary) 0x33000000 else 0x33FFFFFF
        button.background = RippleDrawable(ColorStateList.valueOf(ripple), background, null)
        return button
    }

    private fun dot(color: Int): View = View(this).apply {
        background = GradientDrawable().apply {
            shape = GradientDrawable.OVAL
            setColor(color)
        }
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

    private fun versionName(): String = try {
        packageManager.getPackageInfo(packageName, 0).versionName ?: "unknown"
    } catch (error: Exception) {
        "unknown"
    }

    private fun sceneLabel(id: String): String =
        SCENES.firstOrNull { it.id == id }?.name ?: SCENES[0].name

    private fun dp(value: Int): Int =
        (value * resources.displayMetrics.density + 0.5f).toInt()
}
