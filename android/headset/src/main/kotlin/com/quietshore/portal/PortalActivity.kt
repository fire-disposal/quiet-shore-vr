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
        HELP("帮助", "使用方式与控制权"),
        ABOUT("开始前说明", "给患者看的说明"),
        SUS("SUS 量表", "系统可用性评分")
    }

    private companion object {
        /** One auto-launch per process: a recreate must not fight the browser. */
        var autoLaunchedThisProcess = false
        const val AUTO_LAUNCH_DELAY_MS = 1500L
        val BG_TOP: Int = 0xFFF3EFE6.toInt()
        val BG_BOTTOM: Int = 0xFFE8E1D4.toInt()
        val SURFACE: Int = 0xFFECE6DA.toInt()
        val BORDER: Int = 0xFFD5CCBB.toInt()
        val TEXT: Int = 0xFF20251F.toInt()
        val MUTED: Int = 0xFF5E655A.toInt()
        val ACCENT: Int = 0xFF8F4634.toInt()
        val ACCENT_INK: Int = 0xFFF8F3E9.toInt()
        val DANGER: Int = 0xFFA34D3D.toInt()
        val OK: Int = 0xFF486B58.toInt()

        // The headset is a status surface, not a console: every action lives on
        // the tablet, so only the home page remains.
        val NAV_PAGES = listOf(Page.HOME)

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
    private lateinit var nav: LinearLayout
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
    private var enterButton: TextView? = null
    private var homeHint: TextView? = null
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

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        settings = HeadsetSettings.read(this)
        PortalActions.startServer(this)
        autoLaunchTraining()
        window.statusBarColor = BG_TOP
        window.navigationBarColor = BG_TOP
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
        "about" -> Page.ABOUT
        else -> null
    }

    override fun onResume() {
        super.onResume()
        PortalActions.startServer(this)
        refreshStatus()
        if (!receiverRegistered) {
            val filter = IntentFilter(PortalStatus.ACTION_STATUS)
            filter.addAction(PortalActions.ACTION_SUS)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                registerReceiver(susReceiver, IntentFilter(PortalActions.ACTION_SUS), Context.RECEIVER_NOT_EXPORTED)
                registerReceiver(statusReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
            } else {
                registerReceiver(susReceiver, IntentFilter(PortalActions.ACTION_SUS))
                registerReceiver(statusReceiver, filter)
            }
            receiverRegistered = true
        }
    }

    override fun onPause() {
        if (receiverRegistered) {
            unregisterReceiver(susReceiver)
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
            setPadding(dp(24), dp(12), dp(18), dp(10))
        }
        val titles = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        titleText = label("静岸", 27f, TEXT, Typeface.NORMAL, 0.04f).apply {
            typeface = Typeface.create("serif", Typeface.NORMAL)
        }
        subtitleText = label("请舒适躺好，等待操作员提示", 12f, MUTED, Typeface.NORMAL, 0.01f).apply {
            setPadding(0, dp(2), 0, 0)
        }
        titles.addView(titleText)
        titles.addView(subtitleText)
        header.addView(titles, LinearLayout.LayoutParams(
            0,
            ViewGroup.LayoutParams.WRAP_CONTENT,
            1f
        ))
        prevPage = pageButton("‹") { moveInternalPage(-1) }
        pageCount = label("1 / 1", 12f, MUTED, Typeface.NORMAL, 0.04f).apply {
            gravity = Gravity.CENTER
        }
        nextPage = pageButton("›") { moveInternalPage(1) }
        header.addView(prevPage, LinearLayout.LayoutParams(dp(38), dp(38)))
        header.addView(pageCount, LinearLayout.LayoutParams(dp(54), dp(38)))
        header.addView(nextPage, LinearLayout.LayoutParams(dp(38), dp(38)))
        val settingsButton = label("设置", 13f, TEXT, Typeface.BOLD, 0.04f).apply {
            gravity = Gravity.CENTER
            background = rounded(SURFACE, 2, BORDER, 1)
            isClickable = true
            isFocusable = true
            contentDescription = "设置"
            setOnClickListener { showPage(Page.SETTINGS) }
        }
        header.addView(settingsButton, LinearLayout.LayoutParams(dp(52), dp(38)).apply {
            marginStart = dp(8)
        })
        val homeButton = ImageView(this).apply {
            setImageDrawable(ExitIconDrawable(DANGER))
            setPadding(dp(8), dp(8), dp(8), dp(8))
            background = rounded(SURFACE, 2, DANGER, 1)
            isClickable = true
            isFocusable = true
            contentDescription = "退出选项"
            setOnClickListener { showExitDialog() }
        }
        header.addView(homeButton, LinearLayout.LayoutParams(dp(38), dp(38)).apply {
            marginStart = dp(8)
        })

        root.addView(header, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        ))
        root.addView(
            View(this).apply { setBackgroundColor(BORDER) },
            LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(1))
        )

        content = FrameLayout(this)
        root.addView(content, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            0,
            1f
        ))
        // No bottom tabs: the only navigation is the settings and exit icons in
        // the header. A patient-facing device should not look like a console.
        nav = LinearLayout(this).apply { visibility = View.GONE }
        return root
    }

    private fun pageButton(text: String, onClick: () -> Unit): TextView =
        label(text, 24f, TEXT, Typeface.NORMAL, 0f).apply {
            gravity = Gravity.CENTER
            isClickable = true
            isFocusable = true
            background = rounded(SURFACE, 2, BORDER, 1)
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
        updateNav()
    }

    private fun renderPage() {
        homeStatusCard = null
        homeStatusMac = null
        enterButton = null
        homeHint = null
        val page = currentPage
        val body = when (page) {
            Page.HOME -> buildHomePage()
            Page.SETTINGS -> buildSettingsPage()
            Page.HELP -> buildHelpPage()
            Page.ABOUT -> buildAboutPage()
            Page.SUS -> buildSusPage()
        }
        content.removeAllViews()
        content.addView(body, FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT,
            Gravity.TOP
        ))
        refreshStatus()
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

    private fun updateNav() {
        for (index in 0 until nav.childCount) {
            val item = nav.getChildAt(index) as TextView
            val selected = index < NAV_PAGES.size && NAV_PAGES[index] == currentPage
            item.setTextColor(if (selected) ACCENT_INK else MUTED)
            item.background = if (selected) {
                rounded(ACCENT, 2, ACCENT, 0)
            } else {
                rounded(0x00000000, 2, BORDER, 1)
            }
        }
    }

    private fun buildHomePage(): View {
        // Calm single-column composition: scene, pairing state, and the patient
        // instruction. Nothing to tap, so the layout is centred instead of
        // stacking controls from the top.
        val page = pageColumn().apply {
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(28), dp(18), dp(28), dp(24))
        }
        val sceneCard = sectionCard()
        val sceneHead = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        sceneHead.addView(label("即将进入", 11f, ACCENT, Typeface.BOLD, 0.12f))
        sceneCard.addView(sceneHead)
        sceneCard.addView(
            View(this).apply { setBackgroundColor(SCENE_TINT) },
            LinearLayout.LayoutParams(dp(36), dp(3)).apply {
                topMargin = dp(10)
                bottomMargin = dp(10)
            }
        )
        val sceneId = HeadsetSettings.read(this).sceneId
        val sceneName = ControlProtocol.SCENE_LABELS[sceneId] ?: ControlProtocol.DEFAULT_SCENE
        val sceneTagline = SCENE_TAGLINES[sceneId] ?: ""
        sceneCard.addView(label(sceneName, 26f, TEXT, Typeface.BOLD, 0.02f).apply {
            typeface = Typeface.create("serif", Typeface.BOLD)
        })
        sceneCard.addView(label(sceneTagline, 13f, MUTED, Typeface.NORMAL, 0f).apply {
            setPadding(0, dp(5), 0, 0)
        })
        page.addView(sceneCard)

        val status = sectionCard().apply { visibility = View.GONE }
        val statusHead = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        statusHead.addView(dot(OK), LinearLayout.LayoutParams(dp(8), dp(8)).apply { marginEnd = dp(8) })
        statusHead.addView(label("配对成功", 14f, TEXT, Typeface.BOLD, 0f))
        statusHead.addView(
            label("平板控制", 12f, MUTED, Typeface.NORMAL, 0f).apply { gravity = Gravity.END },
            LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        )
        status.addView(statusHead)
        homeStatusMac = label("蓝牙 MAC  —", 13f, MUTED, Typeface.NORMAL, 0.02f).apply {
            setPadding(0, dp(8), 0, 0)
        }
        status.addView(homeStatusMac)
        homeStatusCard = status
        page.addView(status)

        // No button: the page opens by itself and the patient's only interaction
        // is the one gesture Firefox Reality requires to enter immersive mode.
        homeHint = label(
            if (PortalActions.isFirefoxAvailable(this)) {
                "请调整到舒适姿势，等待操作员提示；页面会自动打开"
            } else {
                "未检测到 Firefox Reality，无法进入训练"
            },
            12f,
            MUTED,
            Typeface.NORMAL,
            0f
        ).apply {
            gravity = Gravity.CENTER
            setPadding(0, dp(18), 0, dp(14))
        }
        page.addView(homeHint)
        page.addView(
            label(
                "若感到不适，请立即告知工作人员",
                11f,
                MUTED,
                Typeface.NORMAL,
                0.02f
            ).apply {
                gravity = Gravity.CENTER
                setPadding(0, dp(4), 0, 0)
            }
        )

        return page
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
            settings = settings.copy(skipCalibration = it)
            HeadsetSettings.save(this, settings)
        })
        usage.addView(settingSwitch("显示性能面板", settings.showHud) {
            settings = settings.copy(showHud = it)
            HeadsetSettings.save(this, settings)
        })
        top.addView(usage, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply {
            marginEnd = dp(7)
        })

        val system = sectionCard()
        system.addView(sectionLabel("系统"))
        system.addView(actionButton("SUS 量表", false) {
            showPage(Page.SUS)
        }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(46)))
        system.addView(actionButton("全部应用", false) {
            PortalActions.allApps(this)
        }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(46)))
        system.addView(actionButton("系统设置", false) {
            PortalActions.systemSettings(this)
        }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(46)))
        top.addView(system, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply {
            marginStart = dp(7)
            marginEnd = dp(7)
        })

        val connection = sectionCard()
        connection.addView(sectionLabel("连接"))
        connection.addView(
            label("平板接管后场景、声音和校准由平板控制", 13f, MUTED, Typeface.NORMAL, 0f).apply {
                setPadding(0, dp(8), 0, dp(10))
            }
        )
        connection.addView(actionButton("打开蓝牙设置", false) {
            startActivity(Intent(Settings.ACTION_BLUETOOTH_SETTINGS))
        }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(46)))
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
            addView(label(title, 11f, MUTED, Typeface.BOLD, 0.08f))
            addView(label(value, 13f, TEXT, Typeface.NORMAL, 0f).apply {
                setPadding(0, dp(5), 0, 0)
            })
        }

    private fun buildSusPage(): View {
        val page = pageColumn()
        val index = internalIndex.coerceIn(0, SUS_STATEMENTS.size - 1)
        page.addView(
            label("第 ${index + 1} / ${SUS_STATEMENTS.size} 题", 11f, ACCENT, Typeface.BOLD, 0.08f).apply {
                setPadding(0, 0, 0, dp(8))
            }
        )
        val card = sectionCard()
        card.addView(
            label(SUS_STATEMENTS[index], 22f, TEXT, Typeface.NORMAL, 0.01f).apply {
                typeface = Typeface.create("serif", Typeface.NORMAL)
                setPadding(0, dp(6), 0, dp(14))
            }
        )
        val scale = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        val buttons = arrayOfNulls<TextView>(5)
        for (value in 1..5) {
            val selected = susAnswers[index] == value
            val button = label(value.toString(), 17f, if (selected) ACCENT_INK else MUTED, Typeface.NORMAL, 0f).apply {
                gravity = Gravity.CENTER
                minHeight = dp(56)
                isClickable = true
                isFocusable = true
                background = if (selected) rounded(ACCENT, 3, ACCENT, 0) else rounded(SURFACE, 3, BORDER, 1)
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
            13f,
            if (susAnswers.all { it > 0 }) OK else MUTED,
            Typeface.NORMAL,
            0f
        ).apply { setPadding(0, dp(8), 0, 0) }
        page.addView(susScoreText)
        val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        val previous = actionButton("上一题", false) { moveInternalPage(-1) }
        previous.isEnabled = index > 0
        previous.alpha = if (index > 0) 1f else 0.4f
        row.addView(previous, LinearLayout.LayoutParams(0, dp(46), 1f).apply { marginEnd = dp(5) })
        val next = actionButton(if (index == SUS_STATEMENTS.size - 1) "完成" else "下一题", false) {
            if (index < SUS_STATEMENTS.size - 1) moveInternalPage(1)
        }
        next.isEnabled = index < SUS_STATEMENTS.size - 1
        next.alpha = if (index < SUS_STATEMENTS.size - 1) 1f else 0.4f
        row.addView(next, LinearLayout.LayoutParams(0, dp(46), 1f).apply { marginStart = dp(5) })
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
                rounded(ACCENT, 3, ACCENT, 0)
            } else {
                rounded(SURFACE, 3, BORDER, 1)
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
    private fun buildAboutPage(): View {
        val page = pageColumn()
        val card = sectionCard()
        card.addView(label("接下来会发生什么", 18f, TEXT, Typeface.BOLD, 0f))
        card.addView(label("您会看到一片缓慢移动的景物，身体会跟着轻轻起伏，还有水声。", 16f, TEXT, Typeface.NORMAL, 0.02f))
        card.addView(label("需要进入时，看向画面中间的圆，按下头显右侧的按钮。", 16f, TEXT, Typeface.NORMAL, 0.02f))
        card.addView(label("任何时刻觉得不舒服，直接说话；工作人员会立刻停下。", 16f, TEXT, Typeface.NORMAL, 0.02f))
        page.addView(card)
        return page
    }

    private fun buildHelpPage(): View {
        val page = pageColumn()
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

    private fun warnIfFirefoxMissing() {
        if (firefoxWarningShown || PortalActions.isFirefoxAvailable(this)) return
        firefoxWarningShown = true
        AlertDialog.Builder(this, android.R.style.Theme_Material_Light_Dialog_Alert)
            .setTitle("缺少 Firefox Reality")
            .setMessage("静岸的 WebXR 训练只能在 Firefox Reality 10 中运行。当前设备未检测到该浏览器，训练无法工作。")
            .setPositiveButton("知道了", null)
            .show()
    }

    /**
     * Opens the training page without waiting for a click.
     *
     * The headset has no in-app buttons by design: the operator drives
     * everything from the tablet, and the patient's only interaction is the
     * gesture Firefox Reality itself requires. The static guard keeps a
     * recreate/rotation from launching twice and fighting the browser.
     */
    private fun autoLaunchTraining() {
        if (autoLaunchedThisProcess || !PortalActions.isFirefoxAvailable(this)) {
            return
        }
        autoLaunchedThisProcess = true
        android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({
            if (isFinishing || isDestroyed) {
                return@postDelayed
            }
            // Never steal the foreground while a tablet is mid-session.
            if (!PortalStatus.isControlActive()) {
                PortalActions.enter(this, HeadsetSettings.read(this).toLaunchOptions())
            }
        }, AUTO_LAUNCH_DELAY_MS)
    }

    private fun launchTraining() {
        if (!PortalActions.isFirefoxAvailable(this)) {
            warnIfFirefoxMissing()
            return
        }
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
        homeStatusCard?.visibility = if (control) View.VISIBLE else View.GONE
        homeStatusMac?.text = "蓝牙 MAC  ${PortalStatus.controllerAddress() ?: "—"}"
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

    private fun dp(value: Int): Int =
        (value * resources.displayMetrics.density + 0.5f).toInt()
}
