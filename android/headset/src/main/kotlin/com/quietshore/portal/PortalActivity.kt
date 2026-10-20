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
 * Headset console with three pages: Home, Settings, Help.
 *
 * The Activity owns presentation only. Launch parameters live in
 * [HeadsetSettings] and are converted to [LaunchOptions]; BLE and HTTP state
 * remain owned by [PortalService] and exposed through [PortalStatus].
 */
class PortalActivity : Activity() {
    private enum class Page(val label: String) {
        HOME("控制台"),
        SETTINGS("设置"),
        HELP("帮助")
    }

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
    }

    private lateinit var content: FrameLayout
    private lateinit var nav: LinearLayout
    private lateinit var modeChip: TextView
    private var currentPage = Page.HOME
    private var settingsPageIndex = 0
    private var helpPageIndex = 0
    private var settings = HeadsetSettings()
    private val sceneChips = mutableListOf<TextView>()
    private val qualityChips = mutableListOf<TextView>()
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
            setPadding(dp(24), dp(20), dp(24), dp(10))
        }
        val seal = TextView(this).apply {
            text = "静"
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
        header.addView(
            titles,
            LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        )
        modeChip = label("独立使用", 12f, MUTED, Typeface.NORMAL, 0f).apply {
            gravity = Gravity.CENTER
            minHeight = dp(32)
            setPadding(dp(12), 0, dp(12), 0)
            background = rounded(SURFACE, 2, BORDER, 1)
        }
        header.addView(modeChip, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT,
            dp(32)
        ))
        root.addView(header, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        ))

        content = FrameLayout(this)
        root.addView(content, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            0,
            1f
        ))

        nav = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            setPadding(dp(18), dp(8), dp(18), dp(16))
        }
        for (page in Page.values()) {
            val item = label(page.label, 14f, MUTED, Typeface.BOLD, 0f).apply {
                gravity = Gravity.CENTER
                minHeight = dp(48)
                isClickable = true
                isFocusable = true
                setOnClickListener { showPage(page) }
            }
            nav.addView(item, LinearLayout.LayoutParams(0, dp(48), 1f).apply {
                marginStart = dp(4)
                marginEnd = dp(4)
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
        sceneChips.clear()
        qualityChips.clear()

        val body = when (page) {
            Page.HOME -> buildHomePage()
            Page.SETTINGS -> buildSettingsPage()
            Page.HELP -> buildHelpPage()
        }
        content.removeAllViews()
        content.addView(
            body,
            FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
                Gravity.TOP
            )
        )
        refreshStatus()
        updateNav()
    }

    private fun updateNav() {
        for (index in 0 until nav.childCount) {
            val item = nav.getChildAt(index) as TextView
            val page = Page.values()[index]
            val selected = page == currentPage
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
        page.addView(
            label("开始训练或查看当前连接", 13f, MUTED, Typeface.NORMAL, 0f).apply {
                setPadding(0, dp(6), 0, dp(20))
            }
        )

        val card = sectionCard()
        val serviceRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        serviceRow.addView(dot(OK), LinearLayout.LayoutParams(dp(8), dp(8)).apply {
            marginEnd = dp(8)
        })
        serviceRow.addView(label("服务已就绪", 14f, TEXT, Typeface.BOLD, 0f))
        serviceRow.addView(
            label("127.0.0.1:8130", 12f, MUTED, Typeface.NORMAL, 0f).apply {
                gravity = Gravity.END
            },
            LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        )
        card.addView(serviceRow)

        homeBluetooth = label(PortalStatus.description(), 14f, MUTED, Typeface.NORMAL, 0f).apply {
            setPadding(0, dp(12), 0, 0)
        }
        card.addView(homeBluetooth)
        homeScene = label("当前场景  ${sceneLabel(settings.sceneId)}", 13f, MUTED, Typeface.NORMAL, 0f).apply {
            setPadding(0, dp(6), 0, 0)
        }
        card.addView(homeScene)
        page.addView(card)

        val enter = actionButton("进入训练", true) {
            launchTraining()
        }
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

        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
        }
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

    private fun buildSettingsPage(): View = when (settingsPageIndex) {
        0 -> buildSettingsStartPage()
        1 -> buildSettingsUsagePage()
        else -> buildSettingsAboutPage()
    }

    private fun buildSettingsStartPage(): View {
        val page = pageColumn()
        page.addView(titleLabel("设置"))
        page.addView(pageSubtitle("启动偏好保存在本机，无需重复设置"))
        val card = sectionCard()
        card.addView(sectionLabel("启动"))
        card.addView(label("默认场景", 15f, TEXT, Typeface.BOLD, 0f).apply {
            setPadding(0, dp(10), 0, dp(8))
        })
        for (rowIndex in 0 until 2) {
            val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
            for (column in 0 until 2) {
                val index = rowIndex * 2 + column
                val id = HeadsetSettings.SCENE_IDS[index]
                val chip = label(sceneLabel(id), 14f, TEXT, Typeface.BOLD, 0f).apply {
                    gravity = Gravity.CENTER
                    minHeight = dp(46)
                    isClickable = true
                    isFocusable = true
                    setOnClickListener {
                        settings = settings.copy(sceneId = id)
                        HeadsetSettings.save(this@PortalActivity, settings)
                        updateSceneChips()
                    }
                }
                sceneChips += chip
                row.addView(chip, LinearLayout.LayoutParams(0, dp(46), 1f).apply {
                    marginEnd = dp(4)
                    marginStart = dp(4)
                })
            }
            card.addView(row, LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply { bottomMargin = dp(6) })
        }
        updateSceneChips()

        card.addView(label("画质", 15f, TEXT, Typeface.BOLD, 0f).apply {
            setPadding(0, dp(12), 0, dp(8))
        })
        val qualityRow = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        for ((index, value) in listOf(HeadsetSettings.QUALITY_HIGH, HeadsetSettings.QUALITY_LOW).withIndex()) {
            val chip = label(if (value == HeadsetSettings.QUALITY_HIGH) "高画质" else "低画质", 14f, TEXT, Typeface.BOLD, 0f).apply {
                gravity = Gravity.CENTER
                minHeight = dp(46)
                isClickable = true
                isFocusable = true
                setOnClickListener {
                    settings = settings.copy(quality = value)
                    HeadsetSettings.save(this@PortalActivity, settings)
                    updateQualityChips()
                }
            }
            qualityChips += chip
            qualityRow.addView(chip, LinearLayout.LayoutParams(0, dp(46), 1f).apply {
                marginEnd = if (index == 0) dp(4) else 0
                marginStart = if (index == 0) 0 else dp(4)
            })
        }
        card.addView(qualityRow)
        updateQualityChips()
        page.addView(card)
        page.addView(pager(0, 3, onPrev = {}, onNext = {
            settingsPageIndex = 1
            showPage(Page.SETTINGS)
        }))
        return page
    }

    private fun buildSettingsUsagePage(): View {
        val page = pageColumn()
        page.addView(titleLabel("设置"))
        page.addView(pageSubtitle("使用偏好与连接"))
        val card = sectionCard()
        card.addView(sectionLabel("使用"))
        card.addView(settingSwitch("跳过方向校准", settings.skipCalibration) {
            settings = settings.copy(skipCalibration = it)
            HeadsetSettings.save(this, settings)
        })
        card.addView(settingSwitch("显示性能面板", settings.showHud) {
            settings = settings.copy(showHud = it)
            HeadsetSettings.save(this, settings)
        })
        card.addView(
            label("平板接管后会自动切到精简开始页", 14f, MUTED, Typeface.NORMAL, 0f).apply {
                setPadding(0, dp(10), 0, dp(10))
            }
        )
        card.addView(actionButton("打开蓝牙设置", false) {
            startActivity(Intent(Settings.ACTION_BLUETOOTH_SETTINGS))
        }, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            dp(50)
        ))
        page.addView(card)
        page.addView(pager(1, 3, onPrev = {
            settingsPageIndex = 0
            showPage(Page.SETTINGS)
        }, onNext = {
            settingsPageIndex = 2
            showPage(Page.SETTINGS)
        }))
        return page
    }

    private fun buildSettingsAboutPage(): View {
        val page = pageColumn()
        page.addView(titleLabel("设置"))
        page.addView(pageSubtitle("版本与服务"))
        val card = sectionCard()
        card.addView(sectionLabel("关于"))
        card.addView(infoRow("版本", versionName()))
        card.addView(infoRow("浏览器", "Firefox Reality 10"))
        card.addView(infoRow("本机服务", "127.0.0.1:8130"))
        card.addView(infoRow("控制方式", "平板先到先得"))
        page.addView(card)
        page.addView(pager(2, 3, onPrev = {
            settingsPageIndex = 1
            showPage(Page.SETTINGS)
        }, onNext = {}))
        return page
    }

    private fun buildHelpPage(): View = if (helpPageIndex == 0) {
        buildHelpStandalonePage()
    } else {
        buildHelpTabletPage()
    }

    private fun buildHelpStandalonePage(): View {
        val page = pageColumn()
        page.addView(titleLabel("帮助"))
        page.addView(pageSubtitle("没有平板时"))
        val card = sectionCard()
        card.addView(stepRow("1", "在启动页选择场景"))
        card.addView(stepRow("2", "看向进入按钮，将准星对准后按右侧中间确认键"))
        page.addView(card)
        page.addView(pager(0, 2, onPrev = {}, onNext = {
            helpPageIndex = 1
            showPage(Page.HELP)
        }))
        return page
    }

    private fun buildHelpTabletPage(): View {
        val page = pageColumn()
        page.addView(titleLabel("帮助"))
        page.addView(pageSubtitle("平板接管时"))
        val card = sectionCard()
        card.addView(stepRow("3", "在平板控制台搜索并连接头显"))
        card.addView(stepRow("4", "训练中的场景、声音和校准由平板控制"))
        page.addView(card)
        val note = sectionCard()
        note.addView(sectionLabel("控制权"))
        note.addView(
            label(
                "第一台发送 CLAIM 的平板获得控制。第二台会提示已被占用。平板释放或断开后，头显恢复完整启动页。",
                14f,
                MUTED,
                Typeface.NORMAL,
                0f
            ).apply { setPadding(0, dp(10), 0, 0) }
        )
        page.addView(note)
        page.addView(pager(1, 2, onPrev = {
            helpPageIndex = 0
            showPage(Page.HELP)
        }, onNext = {}))
        return page
    }

    private fun pageSubtitle(text: String): TextView =
        label(text, 14f, MUTED, Typeface.NORMAL, 0f).apply {
            setPadding(0, dp(6), 0, dp(16))
        }

    private fun pager(index: Int, count: Int, onPrev: () -> Unit, onNext: () -> Unit): View {
        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(0, dp(8), 0, 0)
        }
        row.addView(
            pagerButton("上一页", index > 0, onPrev),
            LinearLayout.LayoutParams(0, dp(44), 1f).apply { marginEnd = dp(4) }
        )
        row.addView(
            label("${index + 1} / $count", 12f, MUTED, Typeface.NORMAL, 0f).apply {
                gravity = Gravity.CENTER
            },
            LinearLayout.LayoutParams(dp(72), dp(44))
        )
        row.addView(
            pagerButton("下一页", index < count - 1, onNext),
            LinearLayout.LayoutParams(0, dp(44), 1f).apply { marginStart = dp(4) }
        )
        return row
    }

    private fun pagerButton(text: String, enabled: Boolean, onClick: () -> Unit): TextView =
        label(text, 14f, if (enabled) TEXT else MUTED, Typeface.BOLD, 0f).apply {
            gravity = Gravity.CENTER
            isEnabled = enabled
            isClickable = enabled
            background = rounded(SURFACE, 2, if (enabled) BORDER else SURFACE, 1)
            setOnClickListener { if (enabled) onClick() }
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
        modeChip.background = rounded(
            SURFACE,
            2,
            if (control) ACCENT else BORDER,
            1
        )
        homeBluetooth?.text = PortalStatus.description()
        homeScene?.text = "当前场景  ${sceneLabel(settings.sceneId)}"
    }

    private fun updateSceneChips() {
        for ((index, chip) in sceneChips.withIndex()) {
            val selected = HeadsetSettings.SCENE_IDS[index] == settings.sceneId
            styleChoice(chip, selected)
        }
    }

    private fun updateQualityChips() {
        for ((index, chip) in qualityChips.withIndex()) {
            val value = if (index == 0) HeadsetSettings.QUALITY_HIGH else HeadsetSettings.QUALITY_LOW
            styleChoice(chip, settings.quality == value)
        }
    }

    private fun styleChoice(chip: TextView, selected: Boolean) {
        chip.setTextColor(if (selected) ACCENT_INK else TEXT)
        chip.background = if (selected) {
            rounded(ACCENT, 2, ACCENT, 0)
        } else {
            rounded(SURFACE, 2, BORDER, 1)
        }
    }

    private fun settingSwitch(text: String, checked: Boolean, onChange: (Boolean) -> Unit): Switch =
        Switch(this).apply {
            this.text = text
            isChecked = checked
            setTextColor(TEXT)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
            minHeight = dp(56)
            buttonTintList = ColorStateList.valueOf(ACCENT)
            setPadding(0, dp(4), 0, dp(4))
            setOnCheckedChangeListener { _, value -> onChange(value) }
        }

    private fun stepRow(index: String, text: String): View {
        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(0, dp(10), 0, dp(10))
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
            setPadding(0, dp(8), 0, 0)
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
        setPadding(dp(24), dp(14), dp(24), dp(24))
    }

    private fun sectionCard(): LinearLayout = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(dp(18), dp(16), dp(18), dp(16))
        background = rounded(SURFACE, 4, BORDER, 1)
        layoutParams = LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        ).apply { bottomMargin = dp(14) }
    }

    private fun sectionLabel(text: String): TextView = label(
        text,
        11f,
        ACCENT,
        Typeface.BOLD,
        0.12f
    )

    private fun titleLabel(text: String): TextView = label(
        text,
        28f,
        TEXT,
        Typeface.NORMAL,
        0.04f
    ).apply {
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

    private fun sceneLabel(id: String): String = when (id) {
        "ward" -> "训练病区"
        "bathroom" -> "暖石浴室"
        "lab" -> "空间实验"
        else -> "湖畔晨岸"
    }

    private fun dp(value: Int): Int =
        (value * resources.displayMetrics.density + 0.5f).toInt()
}
