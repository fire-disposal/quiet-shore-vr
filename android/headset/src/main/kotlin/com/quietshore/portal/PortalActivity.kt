package com.quietshore.portal

import android.app.Activity
import android.app.AlertDialog
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.res.ColorStateList
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.RippleDrawable
import android.os.BatteryManager
import android.os.Build
import android.os.Bundle
import android.text.Spannable
import android.text.SpannableString
import android.text.style.RelativeSizeSpan
import android.text.style.StyleSpan
import android.provider.Settings
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.Switch
import android.widget.TextView
import com.quietshore.control.protocol.ControlProtocol

/**
 * Headset console. One fixed page: Home.
 *
 * No page scrolls. The card states which scene will be entered; the tablet
 * owns that choice, and the console shows the stored selection.
 */
class PortalActivity : Activity() {
    private enum class Page(val label: String, val description: String) {
        HOME("静岸", "请保持舒适，等待工作人员"),
        SETTINGS("设置", "启动偏好与连接"),
        HELP("帮助", "进入方式与平板控制"),
        SUS("SUS 量表", "共 10 题，每题 1 到 5 分")
    }

    private companion object {
        const val BLE_PERMISSION_REQUEST = 41

        // Cool store variant: paper ground, white surface, one ice accent used
        // only as a fill with ink text on top. Red is reserved for exit/stop.
        val PAPER: Int = 0xFFF4F4F2.toInt()
        val SURFACE: Int = 0xFFFFFFFF.toInt()
        val HAIRLINE: Int = 0x1F161616
        val TEXT: Int = 0xFF161616.toInt()
        val MUTED: Int = 0xFF5E655A.toInt()
        val ACCENT: Int = 0xFF7DE6FF.toInt()
        val ACCENT_INK: Int = TEXT
        val DANGER: Int = 0xFFA34D3D.toInt()
        val OK: Int = TEXT
        val TRACK: Int = 0x1F161616
        val RIPPLE_INK: Int = 0x1F161616
        const val LOW_BATTERY_PERCENT = 20

        const val NUMBER_FEATURES = "tnum"

        val SUS_OPTION_LABELS = listOf(
            "非常不同意",
            "不同意",
            "一般",
            "同意",
            "非常同意"
        )

        val SUS_STATEMENTS = listOf(
            "我愿意经常使用这个系统。",
            "我觉得这个系统过于复杂。",
            "我觉得这个系统容易使用。",
            "我需要技术人员的帮助才能使用这个系统。",
            "我觉得系统里的各项功能整合得很好。",
            "我觉得系统存在太多不一致的地方。",
            "我认为大多数人能很快学会使用这个系统。",
            "我觉得这个系统使用起来很笨拙。",
            "我对使用这个系统很有信心。",
            "我需要先学习很多内容才能开始使用这个系统。"
        )

        /** Tagline per scene; names come from `ControlProtocol.SCENE_LABELS`. */
        val SCENE_TAGLINES = mapOf(
            "washroom" to "墙面干净，光线柔和",
            "shore" to "云、水面与一条日光"
        )
        val SCENE_TINT = 0xFF6F8B7A.toInt()
    }

    private lateinit var content: FrameLayout
    private lateinit var titleText: TextView
    private lateinit var subtitleText: TextView
    private lateinit var pageCount: TextView
    private lateinit var prevPage: TextView
    private lateinit var nextPage: TextView
    private var currentPage = Page.HOME
    private var internalIndex = 0
    private var settings = HeadsetSettings()
    private var homeStatusCard: View? = null
    private var homeStatusMac: TextView? = null
    private var batteryCardView: View? = null
    private var batteryLabel: TextView? = null
    private var batteryValue: TextView? = null
    private var batteryFill: View? = null
    private var batteryRest: View? = null
    private var batteryPercent = -1
    private var batteryCharging = false
    private var receiverRegistered = false
    private var firefoxWarningShown = false
    private val susAnswers = IntArray(10)
    private var susScoreText: TextView? = null
    private var susButtons: Array<TextView> = emptyArray()

    private val susReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            val delta = intent?.getIntExtra(PortalActions.EXTRA_SUS_DELTA, 0) ?: 0
            if (delta == 0) return
            if (currentPage != Page.SUS) {
                showPage(Page.SUS)
                return
            }
            val next = (internalIndex + delta).coerceIn(0, SUS_STATEMENTS.size - 1)
            if (next != internalIndex) {
                internalIndex = next
                renderPage()
            }
        }
    }

    private val statusReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            refreshStatus()
        }
    }

    /** Sticky battery broadcast; no entitlement, no polling. */
    private val batteryReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            if (intent == null) return
            val scale = intent.getIntExtra(BatteryManager.EXTRA_SCALE, 0)
            val level = intent.getIntExtra(BatteryManager.EXTRA_LEVEL, -1)
            if (level < 0 || scale <= 0) return
            val status = intent.getIntExtra(BatteryManager.EXTRA_STATUS, -1)
            batteryPercent = level * 100 / scale
            batteryCharging = status == BatteryManager.BATTERY_STATUS_CHARGING ||
                status == BatteryManager.BATTERY_STATUS_FULL
            renderBattery()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        ensureBlePermissions()
        settings = HeadsetSettings.read(this)
        PortalActions.startServer(this)
        window.statusBarColor = PAPER
        window.navigationBarColor = PAPER
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            window.decorView.systemUiVisibility = View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR
        }
        setContentView(buildShell())
        showPage(pageFromIntent(intent) ?: Page.HOME)
        val answer = intent?.getIntExtra(PortalActions.EXTRA_SUS_ANSWER, 0) ?: 0
        if (answer in 1..5) {
            applySusAnswer(answer)
        }
        window.decorView.post { warnIfFirefoxMissing() }
    }

    /**
     * Android 12+ gates advertising, GATT server writes and adapter renaming
     * behind runtime permissions. This app has no permission screen of its own,
     * so ask once when the console opens; without them `startAdvertising`
     * throws and the headset never becomes discoverable. The G2 4K runs
     * Android 8.1 and returns here immediately.
     */
    private fun ensureBlePermissions() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
            return
        }
        val needed = arrayOf(
            android.Manifest.permission.BLUETOOTH_ADVERTISE,
            android.Manifest.permission.BLUETOOTH_CONNECT
        ).filter {
            checkSelfPermission(it) != android.content.pm.PackageManager.PERMISSION_GRANTED
        }
        if (needed.isNotEmpty()) {
            requestPermissions(needed.toTypedArray(), BLE_PERMISSION_REQUEST)
        }
    }

    override fun onNewIntent(intent: Intent?) {
        super.onNewIntent(intent)
        setIntent(intent)
        val answer = intent?.getIntExtra(PortalActions.EXTRA_SUS_ANSWER, 0) ?: 0
        if (answer in 1..5) {
            applySusAnswer(answer)
        } else {
            pageFromIntent(intent)?.let { showPage(it) }
        }
    }

    /** Operator answer for the currently shown SUS item. */
    private fun applySusAnswer(value: Int) {
        if (currentPage != Page.SUS) {
            showPage(Page.SUS)
        }
        val index = internalIndex.coerceIn(0, SUS_STATEMENTS.size - 1)
        susAnswers[index] = value
        renderPage()
    }

    private fun pageFromIntent(intent: Intent?): Page? = when (intent?.getStringExtra(PortalActions.EXTRA_PAGE)) {
        "sus" -> Page.SUS
        "settings" -> Page.SETTINGS
        "home" -> Page.HOME
        else -> null
    }

    override fun onResume() {
        super.onResume()
        PortalActions.startServer(this)
        refreshStatus()
        if (!receiverRegistered) {
            val filter = IntentFilter(PortalStatus.ACTION_STATUS)
            filter.addAction(PortalActions.ACTION_SUS)
            val batteryFilter = IntentFilter(Intent.ACTION_BATTERY_CHANGED)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                registerReceiver(susReceiver, IntentFilter(PortalActions.ACTION_SUS), Context.RECEIVER_NOT_EXPORTED)
                registerReceiver(statusReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
                registerReceiver(batteryReceiver, batteryFilter, Context.RECEIVER_NOT_EXPORTED)
            } else {
                registerReceiver(susReceiver, IntentFilter(PortalActions.ACTION_SUS))
                registerReceiver(statusReceiver, filter)
                registerReceiver(batteryReceiver, batteryFilter)
            }
            receiverRegistered = true
        }
        renderBattery()
    }

    override fun onPause() {
        if (receiverRegistered) {
            unregisterReceiver(susReceiver)
            unregisterReceiver(statusReceiver)
            unregisterReceiver(batteryReceiver)
            receiverRegistered = false
        }
        super.onPause()
    }

    private fun buildShell(): View {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(PAPER)
        }

        val header = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(24), dp(12), dp(18), dp(10))
        }
        val titles = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        titleText = label("静岸", 28f, TEXT, Typeface.NORMAL)
        subtitleText = label("请舒适躺好，等待工作人员提示", 14f, MUTED, Typeface.NORMAL).apply {
            setPadding(0, dp(3), 0, 0)
        }
        titles.addView(titleText)
        titles.addView(subtitleText)
        header.addView(titles, LinearLayout.LayoutParams(
            0,
            ViewGroup.LayoutParams.WRAP_CONTENT,
            1f
        ))
        prevPage = pageButton("‹") { moveInternalPage(-1) }
        pageCount = label("1 / 1", 13f, MUTED, Typeface.NORMAL).apply {
            gravity = Gravity.CENTER
            numbers()
        }
        nextPage = pageButton("›") { moveInternalPage(1) }
        header.addView(prevPage, LinearLayout.LayoutParams(dp(40), dp(40)))
        header.addView(pageCount, LinearLayout.LayoutParams(dp(58), dp(40)))
        header.addView(nextPage, LinearLayout.LayoutParams(dp(40), dp(40)))
        val settingsButton = label("设置", 15f, TEXT, Typeface.BOLD).apply {
            gravity = Gravity.CENTER
            background = framed(SURFACE, HAIRLINE)
            isClickable = true
            isFocusable = true
            contentDescription = "设置"
            setOnClickListener { showPage(Page.SETTINGS) }
        }
        header.addView(settingsButton, LinearLayout.LayoutParams(dp(56), dp(40)).apply {
            marginStart = dp(8)
        })
        val homeButton = ImageView(this).apply {
            setImageDrawable(ExitIconDrawable(DANGER))
            setPadding(dp(9), dp(9), dp(9), dp(9))
            background = framed(SURFACE, DANGER)
            isClickable = true
            isFocusable = true
            contentDescription = "退出选项"
            setOnClickListener { showExitDialog() }
        }
        header.addView(homeButton, LinearLayout.LayoutParams(dp(40), dp(40)).apply {
            marginStart = dp(8)
        })

        root.addView(header, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        ))
        root.addView(
            View(this).apply { setBackgroundColor(HAIRLINE) },
            LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(1))
        )

        content = FrameLayout(this)
        root.addView(content, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            0,
            1f
        ))
        return root
    }

    private fun pageButton(text: String, onClick: () -> Unit): TextView =
        label(text, 26f, TEXT, Typeface.NORMAL).apply {
            gravity = Gravity.CENTER
            isClickable = true
            isFocusable = true
            background = framed(SURFACE, HAIRLINE)
            setOnClickListener { onClick() }
        }

    private fun showExitDialog() {
        val legacy = PortalActions.legacySystemLabel(this)
        val labels = ArrayList<String>()
        val actions = ArrayList<() -> Unit>()
        if (legacy != null) {
            labels.add("打开 $legacy")
            actions.add { PortalActions.openLegacySystem(this) }
        }
        labels.add("浏览所有应用")
        actions.add { PortalActions.allApps(this) }
        labels.add("返回默认桌面")
        actions.add { PortalActions.openDefaultDesktop(this) }

        AlertDialog.Builder(this, android.R.style.Theme_Material_Light_Dialog_Alert)
            .setTitle("离开静岸")
            .setItems(labels.toTypedArray()) { _, which ->
                actions.getOrNull(which)?.invoke()
            }
            .setNegativeButton("取消", null)
            .show()
    }

    private fun moveInternalPage(delta: Int) {
        val count = internalPageCount(currentPage)
        val next = (internalIndex + delta).coerceIn(0, count - 1)
        if (next != internalIndex) {
            internalIndex = next
            renderPage()
        }
    }

    private fun internalPageCount(page: Page): Int = when (page) {
        Page.SUS -> SUS_STATEMENTS.size
        else -> 1
    }

    private fun showPage(page: Page) {
        currentPage = page
        internalIndex = 0
        renderPage()
    }

    private fun renderPage() {
        homeStatusCard = null
        homeStatusMac = null
        batteryCardView = null
        batteryLabel = null
        batteryValue = null
        batteryFill = null
        batteryRest = null
        val page = currentPage
        val body = when (page) {
            Page.HOME -> buildHomePage()
            Page.SETTINGS -> buildSettingsPage()
            Page.HELP -> buildHelpPage()
            Page.SUS -> buildSusPage()
        }
        content.removeAllViews()
        content.addView(body, FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT,
            Gravity.TOP
        ))
        refreshStatus()
        renderBattery()
        titleText.text = page.label
        subtitleText.text = page.description
        val count = internalPageCount(page)
        val showPager = count > 1
        val pagerVisibility = if (showPager) View.VISIBLE else View.GONE
        prevPage.visibility = pagerVisibility
        pageCount.visibility = pagerVisibility
        nextPage.visibility = pagerVisibility
        pageCount.text = "${internalIndex + 1} / $count"
        val atStart = internalIndex == 0
        val atEnd = internalIndex == count - 1
        prevPage.alpha = if (atStart) 0.3f else 1f
        prevPage.isEnabled = !atStart
        nextPage.alpha = if (atEnd) 0.3f else 1f
        nextPage.isEnabled = !atEnd
    }

    private fun buildHomePage(): View {
        // Calm single-column composition: battery, scene, pairing state, then
        // the patient instruction. Nothing on this page is tappable.
        val page = pageColumn().apply {
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(28), dp(18), dp(28), dp(24))
        }
        page.addView(batteryCard())
        val sceneCard = sectionCard()
        val sceneHead = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        sceneHead.addView(label("即将进入", 13f, MUTED, Typeface.BOLD))
        sceneCard.addView(sceneHead)
        sceneCard.addView(
            View(this).apply { setBackgroundColor(SCENE_TINT) },
            LinearLayout.LayoutParams(dp(36), dp(3)).apply {
                topMargin = dp(10)
                bottomMargin = dp(14)
            }
        )
        val sceneId = HeadsetSettings.read(this).sceneId
        val sceneName = ControlProtocol.SCENE_LABELS[sceneId] ?: ControlProtocol.DEFAULT_SCENE
        val sceneTagline = SCENE_TAGLINES[sceneId] ?: ""
        sceneCard.addView(label(sceneName, 30f, TEXT, Typeface.BOLD))
        sceneCard.addView(label(sceneTagline, 15f, MUTED, Typeface.NORMAL).apply {
            setPadding(0, dp(6), 0, 0)
        })
        page.addView(sceneCard)

        val status = sectionCard().apply { visibility = View.GONE }
        val statusHead = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        statusHead.addView(dot(OK), LinearLayout.LayoutParams(dp(9), dp(9)).apply { marginEnd = dp(9) })
        statusHead.addView(label("平板已连接", 16f, TEXT, Typeface.BOLD))
        statusHead.addView(
            label("本机为受控端", 14f, MUTED, Typeface.NORMAL).apply { gravity = Gravity.END },
            LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        )
        status.addView(statusHead)
        homeStatusMac = label("蓝牙地址  —", 14f, MUTED, Typeface.NORMAL).apply {
            setPadding(0, dp(9), 0, 0)
            numbers()
        }
        status.addView(homeStatusMac)
        homeStatusCard = status
        page.addView(status)

        // No button: the page opens by itself and the patient's only interaction
        // is the one gesture Firefox Reality requires to enter immersive mode.
        page.addView(label(
            if (PortalActions.isFirefoxAvailable(this)) {
                "页面会自动打开"
            } else {
                "未检测到 Firefox Reality，训练无法开始"
            },
            14f,
            MUTED,
            Typeface.NORMAL
        ).apply {
            gravity = Gravity.CENTER
            setPadding(0, dp(18), 0, dp(14))
        })
        page.addView(
            label(
                "感到不适请立即告知工作人员",
                13f,
                MUTED,
                Typeface.NORMAL
            ).apply {
                gravity = Gravity.CENTER
                setPadding(0, dp(4), 0, 0)
            }
        )

        return page
    }

    /**
     * Battery sits directly under the header: one field row and one hairline-thin
     * measure.
     *
     * The number is the reading; the bar is only its proportion, so the track is
     * a 3 dp rule rather than a widget — same weight as every other divider on
     * this screen. Hidden entirely until a sticky battery broadcast arrives.
     */
    private fun batteryCard(): View {
        val card = sectionCard()
        val head = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        val labelView = label("电量", 14f, MUTED, Typeface.NORMAL)
        val value = label("—", 22f, TEXT, Typeface.BOLD).apply {
            gravity = Gravity.END
            numbers()
        }
        head.addView(labelView, LinearLayout.LayoutParams(
            0,
            ViewGroup.LayoutParams.WRAP_CONTENT,
            1f
        ))
        head.addView(value)
        card.addView(head)

        // Track spans the card's content width; two weighted segments keep the
        // fill exact at any percent without measuring.
        val fill = View(this).apply { setBackgroundColor(ACCENT) }
        val rest = View(this)
        val track = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setBackgroundColor(TRACK)
            addView(fill, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT, 0f))
            addView(rest, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT, 100f))
        }
        card.addView(track, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            dp(3)
        ).apply { topMargin = dp(8) })
        card.visibility = View.GONE

        batteryLabel = labelView
        batteryValue = value
        batteryFill = fill
        batteryRest = rest
        batteryCardView = card
        return card
    }

    private fun buildSettingsPage(): View {
        // Three action columns + a full-width about strip. The previous
        // two-column split stacked four cards in one column and pushed the
        // last system button below the content frame.
        val page = pageColumn().apply { setPadding(dp(24), dp(10), dp(24), dp(12)) }
        val top = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.TOP
        }

        val usage = sectionCard()
        usage.addView(sectionLabel("使用"))
        usage.addView(settingSwitch("跳过方向校准", settings.skipCalibration) {
            // Persist only the console keys: the scene is written by the tablet
            // path and merged-from-disk here would still be a second writer.
            settings = HeadsetSettings.read(this).copy(skipCalibration = it)
            HeadsetSettings.saveConsolePrefs(this, settings)
        })
        usage.addView(settingSwitch("显示性能面板", settings.showHud) {
            settings = HeadsetSettings.read(this).copy(showHud = it)
            HeadsetSettings.saveConsolePrefs(this, settings)
        })
        top.addView(usage, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply {
            marginEnd = dp(7)
        })

        val system = sectionCard()
        system.addView(sectionLabel("系统"))
        system.addView(actionButton("SUS 量表", false) {
            showPage(Page.SUS)
        }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(50)))
        system.addView(actionButton("全部应用", false) {
            PortalActions.allApps(this)
        }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(50)))
        system.addView(actionButton("系统设置", false) {
            PortalActions.systemSettings(this)
        }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(50)))
        top.addView(system, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply {
            marginStart = dp(7)
            marginEnd = dp(7)
        })

        val connection = sectionCard()
        connection.addView(sectionLabel("连接"))
        connection.addView(
            label("场景、声音和校准由平板控制", 15f, MUTED, Typeface.NORMAL).apply {
                setPadding(0, dp(8), 0, dp(10))
            }
        )
        connection.addView(actionButton("打开蓝牙设置", false) {
            startActivity(Intent(Settings.ACTION_BLUETOOTH_SETTINGS))
        }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(50)))
        top.addView(connection, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply {
            marginStart = dp(7)
        })

        page.addView(top, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        ))

        val about = sectionCard()
        about.addView(sectionLabel("关于"))
        val aboutRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(0, dp(4), 0, 0)
        }
        aboutRow.addView(aboutCell("版本", versionName()))
        aboutRow.addView(aboutCell("浏览器", if (PortalActions.isFirefoxAvailable(this)) {
            "Firefox Reality 10"
        } else {
            "Firefox Reality 未安装"
        }))
        aboutRow.addView(aboutCell("本机服务", "127.0.0.1:8130"))
        aboutRow.addView(aboutCell("控制方式", "平板先到先得"))
        about.addView(aboutRow, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        ))
        page.addView(about, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        ).apply { topMargin = dp(12) })
        return page
    }

    private fun aboutCell(title: String, value: String): LinearLayout =
        LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(10), 0, dp(10), 0)
            addView(label(title, 13f, MUTED, Typeface.BOLD))
            addView(label(value, 15f, TEXT, Typeface.NORMAL).apply {
                setPadding(0, dp(5), 0, 0)
            })
        }

    private fun buildSusPage(): View {
        val page = pageColumn()
        val index = internalIndex.coerceIn(0, SUS_STATEMENTS.size - 1)
        page.addView(
            label("第 ${index + 1} / ${SUS_STATEMENTS.size} 题", 13f, MUTED, Typeface.BOLD).apply {
                setPadding(0, 0, 0, dp(8))
            }
        )
        val card = sectionCard()
        card.addView(
            label(SUS_STATEMENTS[index], 25f, TEXT, Typeface.NORMAL).apply {
                setPadding(0, dp(8), 0, dp(16))
            }
        )
        val scale = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        val buttons = arrayOfNulls<TextView>(5)
        for (value in 1..5) {
            val selected = susAnswers[index] == value
            val button = label(value.toString(), 17f, if (selected) ACCENT_INK else MUTED, Typeface.NORMAL).apply {
                gravity = Gravity.CENTER
                minHeight = dp(56)
                isClickable = true
                isFocusable = true
                background = if (selected) rounded(ACCENT) else framed(SURFACE, HAIRLINE)
                val content = SpannableString("$value\n${SUS_OPTION_LABELS[value - 1]}")
                content.setSpan(
                    RelativeSizeSpan(0.62f),
                    2,
                    content.length,
                    Spannable.SPAN_EXCLUSIVE_EXCLUSIVE
                )
                content.setSpan(
                    StyleSpan(Typeface.BOLD),
                    0,
                    1,
                    Spannable.SPAN_EXCLUSIVE_EXCLUSIVE
                )
                text = content
                setLineSpacing(dp(2).toFloat(), 1f)
                setOnClickListener { setSusAnswer(index, value) }
            }
            buttons[value - 1] = button
            scale.addView(button, LinearLayout.LayoutParams(0, dp(60), 1f).apply {
                if (value > 1) marginStart = dp(6)
            })
        }
        susButtons = buttons.map { it!! }.toTypedArray()
        card.addView(scale)
        page.addView(card)
        susScoreText = label(
            if (susAnswers.all { it > 0 }) susScoreText?.text?.toString() ?: "完成 10 题后显示 SUS 得分"
            else "已答 ${susAnswers.count { it > 0 }} / ${SUS_STATEMENTS.size}",
            15f,
            if (susAnswers.all { it > 0 }) OK else MUTED,
            Typeface.NORMAL
        ).apply {
            setPadding(0, dp(10), 0, 0)
            numbers()
        }
        page.addView(susScoreText)
        val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        val previous = actionButton("上一题", false) { moveInternalPage(-1) }
        previous.isEnabled = index > 0
        previous.alpha = if (index > 0) 1f else 0.4f
        row.addView(previous, LinearLayout.LayoutParams(0, dp(50), 1f).apply { marginEnd = dp(5) })
        val next = actionButton(if (index == SUS_STATEMENTS.size - 1) "完成" else "下一题", false) {
            if (index < SUS_STATEMENTS.size - 1) moveInternalPage(1)
        }
        next.isEnabled = index < SUS_STATEMENTS.size - 1
        next.alpha = if (index < SUS_STATEMENTS.size - 1) 1f else 0.4f
        row.addView(next, LinearLayout.LayoutParams(0, dp(50), 1f).apply { marginStart = dp(5) })
        page.addView(row, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        ).apply { topMargin = dp(10) })
        return page
    }

    private fun setSusAnswer(index: Int, value: Int) {
        susAnswers[index] = value
        for (i in susButtons.indices) {
            val selected = i + 1 == value
            susButtons[i].setTextColor(if (selected) ACCENT_INK else MUTED)
            susButtons[i].background = if (selected) {
                rounded(ACCENT)
            } else {
                framed(SURFACE, HAIRLINE)
            }
        }
        if (susAnswers.all { it > 0 }) {
            var total = 0
            for (i in susAnswers.indices) {
                total += if (i % 2 == 0) susAnswers[i] - 1 else 5 - susAnswers[i]
            }
            val score = total * 2.5f
            susScoreText?.text = "SUS 得分  ${"%.1f".format(score)} / 100"
            susScoreText?.setTextColor(OK)
        } else {
            susScoreText?.text = "已答 ${susAnswers.count { it > 0 }} / ${SUS_STATEMENTS.size}"
            susScoreText?.setTextColor(MUTED)
        }
    }

    /**
     * The one page meant to be read by the patient before the headset goes on.
     * Large type, four lines, nothing to operate.
     */
    private fun buildHelpPage(): View {
        val page = pageColumn()
        val steps = sectionCard()
        steps.addView(sectionLabel("进入训练"))
        steps.addView(stepRow("1", "在平板控制台搜索并连接头显"))
        steps.addView(stepRow("2", "用准星对准进入按钮"))
        steps.addView(stepRow("3", "按右侧中间键确认"))
        page.addView(steps)

        val note = sectionCard()
        note.addView(sectionLabel("控制权"))
        note.addView(
            label(
                "第一台连接的平板获得控制\n第二台平板提示已被占用",
                16f,
                TEXT,
                Typeface.NORMAL
            ).apply {
                setPadding(0, dp(10), 0, 0)
                setLineSpacing(dp(6).toFloat(), 1f)
            }
        )
        note.addView(
            label("平板断开后头显回到本页", 15f, MUTED, Typeface.NORMAL).apply {
                setPadding(0, dp(10), 0, 0)
            }
        )
        page.addView(note)
        return page
    }

    private fun warnIfFirefoxMissing() {
        if (firefoxWarningShown || PortalActions.isFirefoxAvailable(this)) return
        firefoxWarningShown = true
        AlertDialog.Builder(this, android.R.style.Theme_Material_Light_Dialog_Alert)
            .setTitle("缺少 Firefox Reality")
            .setMessage("静岸的 WebXR 训练需要 Firefox Reality 10。本机未检测到该浏览器。")
            .setPositiveButton("知道了", null)
            .show()
    }

    private fun refreshStatus() {
        val control = PortalStatus.isControlActive()
        homeStatusCard?.visibility = if (control) View.VISIBLE else View.GONE
        homeStatusMac?.text = "蓝牙地址  ${PortalStatus.controllerAddress() ?: "—"}"
    }

    /** Writes the battery bar from the last sticky broadcast; hides when unknown. */
    private fun renderBattery() {
        val card = batteryCardView ?: return
        val value = batteryValue ?: return
        if (batteryPercent < 0) {
            card.visibility = View.GONE
            return
        }
        card.visibility = View.VISIBLE
        val low = batteryPercent <= LOW_BATTERY_PERCENT
        val suffix = when {
            batteryPercent >= 100 && batteryCharging -> "  已充满"
            batteryCharging -> "  充电中"
            else -> ""
        }
        value.text = "$batteryPercent%$suffix"
        // Accent is a fill, never ink on paper: at a fifth or less the reading
        // sits on an accent block with ink on top (12.6:1), instead of becoming
        // ice-coloured text on near-white (1.3:1, unreadable).
        if (low) {
            value.setBackgroundColor(ACCENT)
            value.setTextColor(TEXT)
            value.setPadding(dp(8), dp(2), dp(8), dp(2))
        } else {
            value.background = null
            value.setTextColor(TEXT)
            value.setPadding(0, 0, 0, 0)
        }
        batteryLabel?.setTextColor(MUTED)
        setWeight(batteryFill, batteryPercent.toFloat())
        setWeight(batteryRest, (100 - batteryPercent).toFloat())
    }

    private fun setWeight(view: View?, weight: Float) {
        val params = view?.layoutParams as? LinearLayout.LayoutParams ?: return
        params.width = 0
        params.weight = weight
        view.layoutParams = params
    }

    private fun settingSwitch(text: String, checked: Boolean, onChange: (Boolean) -> Unit): Switch =
        Switch(this).apply {
            this.text = text
            isChecked = checked
            setTextColor(TEXT)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
            minHeight = dp(58)
            buttonTintList = ColorStateList.valueOf(TEXT)
            setPadding(0, dp(4), 0, dp(4))
            setOnCheckedChangeListener { _, value -> onChange(value) }
        }

    private fun stepRow(index: String, text: String): View {
        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(0, dp(8), 0, dp(8))
        }
        row.addView(label(index, 14f, ACCENT_INK, Typeface.BOLD).apply {
            gravity = Gravity.CENTER
            background = rounded(ACCENT)
            numbers()
        }, LinearLayout.LayoutParams(dp(30), dp(30)).apply { marginEnd = dp(12) })
        row.addView(label(text, 15f, TEXT, Typeface.NORMAL))
        return row
    }

    private fun pageColumn(): LinearLayout = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(dp(24), dp(14), dp(24), dp(20))
    }

    private fun sectionCard(): LinearLayout = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(dp(18), dp(16), dp(18), dp(16))
        background = framed(SURFACE, HAIRLINE)
        layoutParams = LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        ).apply { bottomMargin = dp(12) }
    }

    private fun sectionLabel(text: String): TextView =
        label(text, 13f, MUTED, Typeface.BOLD)

    private fun actionButton(text: String, primary: Boolean, onClick: () -> Unit): TextView {
        val button = label(text, 17f, TEXT, Typeface.BOLD).apply {
            gravity = Gravity.CENTER
            isClickable = true
            isFocusable = true
            minHeight = dp(54)
            setPadding(dp(16), 0, dp(16), 0)
            setOnClickListener { onClick() }
        }
        button.background = RippleDrawable(
            ColorStateList.valueOf(RIPPLE_INK),
            if (primary) rounded(ACCENT) else framed(SURFACE, HAIRLINE),
            null
        )
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
        style: Int
    ): TextView = TextView(this).apply {
        this.text = text
        setTextColor(color)
        setTextSize(TypedValue.COMPLEX_UNIT_SP, sizeSp)
        typeface = Typeface.create("sans-serif", style)
        includeFontPadding = false
    }

    /** Monospace digits so the percentage and counters do not jitter. */
    private fun TextView.numbers() {
        setFontFeatureSettings(NUMBER_FEATURES)
    }

    /** Square, flat fill. No radius anywhere in the cool variant. */
    private fun rounded(color: Int): GradientDrawable = GradientDrawable().apply {
        setColor(color)
        setCornerRadius(0f)
    }

    /** Flat fill with a single 1px hairline; replaces stacked strokes. */
    private fun framed(color: Int, strokeColor: Int): GradientDrawable = GradientDrawable().apply {
        setColor(color)
        setCornerRadius(0f)
        setStroke(dp(1), strokeColor)
    }

    private fun versionName(): String = try {
        packageManager.getPackageInfo(packageName, 0).versionName ?: "unknown"
    } catch (error: Exception) {
        "unknown"
    }

    private fun dp(value: Int): Int =
        (value * resources.displayMetrics.density + 0.5f).toInt()
}
