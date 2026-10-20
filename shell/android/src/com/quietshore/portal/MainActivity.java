package com.quietshore.portal;

import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.res.ColorStateList;
import android.graphics.Color;
import android.net.Uri;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.RippleDrawable;
import android.os.Bundle;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

/**
 * The only shell UI: a branded 2D entry card for the local training service.
 * All training content lives in the Web layer; this screen only starts the
 * service and exposes the three safe entry points.
 */
public class MainActivity extends Activity {
    private static final int BG_TOP = Color.rgb(10, 18, 17);
    private static final int BG_BOTTOM = Color.rgb(18, 33, 30);
    private static final int SURFACE_2 = Color.rgb(23, 39, 36);
    private static final int BORDER = Color.rgb(46, 74, 69);
    private static final int TEXT = Color.rgb(238, 244, 240);
    private static final int MUTED = Color.rgb(159, 179, 172);
    private static final int ACCENT = Color.rgb(224, 187, 120);
    private static final int ACCENT_INK = Color.rgb(26, 20, 8);
    private static final int OK = Color.rgb(136, 211, 193);

    private static final String PREFS = "quietshore.portal";
    private static final String PREF_SCENE = "launchScene";
    private static final String DEFAULT_SCENE = "landscape";
    private static final String[][] SCENES = {
            {"landscape", "湖畔晨岸"},
            {"ward", "训练病房"},
            {"bathroom", "暖石浴室"},
            {"lab", "空间实验"}
    };
    private final TextView[] sceneChips = new TextView[SCENES.length];
    private TextView enterButton;

    private String launchScene = DEFAULT_SCENE;
    private boolean launchMinimal = true;
    private boolean launchSkipCalibration;
    private String launchQuality;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        readLaunchParams(getIntent());
        finishSceneSelection();
        PortalActions.startServer(this);

        Window window = getWindow();
        window.setStatusBarColor(BG_TOP);
        window.setNavigationBarColor(BG_TOP);

        FrameLayout root = new FrameLayout(this);
        root.setBackground(new GradientDrawable(
                GradientDrawable.Orientation.TL_BR,
                new int[]{BG_TOP, BG_BOTTOM}));

        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setClipToPadding(false);
        scroll.setVerticalScrollBarEnabled(false);

        LinearLayout content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        content.setGravity(Gravity.CENTER_HORIZONTAL);
        content.setPadding(dp(26), dp(24), dp(26), dp(22));

        int screenWidth = getResources().getDisplayMetrics().widthPixels;
        int contentWidth = Math.min(dp(460), Math.max(dp(280), screenWidth - dp(28)));
        scroll.addView(content, new ScrollView.LayoutParams(
                contentWidth, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.CENTER_HORIZONTAL));
        root.addView(scroll, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);

        ImageView mark = new ImageView(this);
        mark.setImageBitmap(BrandAssets.largeBitmap(this, 192));
        LinearLayout.LayoutParams markParams = new LinearLayout.LayoutParams(dp(76), dp(76));
        markParams.bottomMargin = dp(8);
        content.addView(mark, markParams);

        TextView title = label("静岸", 34, TEXT, Typeface.BOLD, 0);
        title.setGravity(Gravity.CENTER);
        content.addView(title);

        TextView english = label("QUIET SHORE VR", 11, ACCENT, Typeface.BOLD, 0.18f);
        english.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams englishParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        englishParams.topMargin = dp(2);
        content.addView(english, englishParams);

        content.addView(buildStatusLine(), statusLineParams());
        content.addView(buildScenePicker(), scenePickerParams());

        enterButton = actionButton("进入训练", true, new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                getSharedPreferences(PREFS, MODE_PRIVATE)
                        .edit()
                        .putString(PREF_SCENE, launchScene)
                        .apply();
                PortalActions.enter(
                        MainActivity.this,
                        launchScene,
                        launchMinimal,
                        launchSkipCalibration,
                        launchQuality);
            }
        });
        LinearLayout.LayoutParams enterParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(58));
        enterParams.bottomMargin = dp(8);
        content.addView(enterButton, enterParams);
        updateSceneChips();

        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);

        TextView apps = actionButton("全部应用", false, new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                PortalActions.allApps(MainActivity.this);
            }
        });
        TextView home = actionButton("切换桌面", false, new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                PortalActions.chooseHome(MainActivity.this);
            }
        });

        LinearLayout.LayoutParams appsParams = new LinearLayout.LayoutParams(0, dp(52), 1f);
        appsParams.rightMargin = dp(5);
        row.addView(apps, appsParams);
        LinearLayout.LayoutParams homeParams = new LinearLayout.LayoutParams(0, dp(52), 1f);
        homeParams.leftMargin = dp(5);
        row.addView(home, homeParams);
        content.addView(row, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        readLaunchParams(intent);
        finishSceneSelection();
        updateSceneChips();
    }

    private void readLaunchParams(Intent intent) {
        if (intent == null) {
            return;
        }
        launchScene = intent.getStringExtra(PortalActions.EXTRA_SCENE);
        launchMinimal = intent.getBooleanExtra(PortalActions.EXTRA_MINIMAL, true);
        launchSkipCalibration = intent.getBooleanExtra(
                PortalActions.EXTRA_SKIP_CALIBRATION, false);
        launchQuality = intent.getStringExtra(PortalActions.EXTRA_QUALITY);

        Uri data = intent.getData();
        if (data == null) {
            return;
        }
        if (launchScene == null) {
            launchScene = data.getQueryParameter(PortalActions.EXTRA_SCENE);
        }
        if (!intent.hasExtra(PortalActions.EXTRA_MINIMAL)) {
            String minimal = data.getQueryParameter(PortalActions.EXTRA_MINIMAL);
            if (minimal != null) {
                launchMinimal = "1".equals(minimal) || "true".equalsIgnoreCase(minimal);
            }
        }
        if (!intent.hasExtra(PortalActions.EXTRA_SKIP_CALIBRATION)) {
            String skip = data.getQueryParameter("nocal");
            if (skip != null) {
                launchSkipCalibration = "1".equals(skip) || "true".equalsIgnoreCase(skip);
            }
        }
        if (launchQuality == null) {
            launchQuality = data.getQueryParameter(PortalActions.EXTRA_QUALITY);
        }
    }

    private void finishSceneSelection() {
        if (launchScene == null) {
            launchScene = getSharedPreferences(PREFS, MODE_PRIVATE)
                    .getString(PREF_SCENE, DEFAULT_SCENE);
        }
        launchScene = normalizeScene(launchScene);
    }

    private LinearLayout buildScenePicker() {
        LinearLayout section = new LinearLayout(this);
        section.setOrientation(LinearLayout.VERTICAL);

        TextView heading = label("选择场景", 12, MUTED, Typeface.BOLD, 0.08f);
        LinearLayout.LayoutParams headingParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        headingParams.bottomMargin = dp(7);
        section.addView(heading, headingParams);

        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);

        for (int i = 0; i < SCENES.length; i++) {
            final String id = SCENES[i][0];
            TextView chip = label(SCENES[i][1], 14, TEXT, Typeface.BOLD, 0);
            chip.setGravity(Gravity.CENTER);
            chip.setClickable(true);
            chip.setFocusable(true);
            chip.setMinHeight(dp(44));
            chip.setPadding(dp(4), 0, dp(4), 0);
            chip.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View view) {
                    launchScene = id;
                    getSharedPreferences(PREFS, MODE_PRIVATE)
                            .edit()
                            .putString(PREF_SCENE, id)
                            .apply();
                    updateSceneChips();
                }
            });
            LinearLayout.LayoutParams chipParams = new LinearLayout.LayoutParams(0, dp(44), 1f);
            if (i > 0) {
                chipParams.leftMargin = dp(5);
            }
            row.addView(chip, chipParams);
            sceneChips[i] = chip;
        }
        section.addView(row, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        return section;
    }

    private void updateSceneChips() {
        for (int i = 0; i < SCENES.length; i++) {
            TextView chip = sceneChips[i];
            if (chip == null) {
                continue;
            }
            boolean selected = SCENES[i][0].equals(launchScene);
            chip.setTextColor(selected ? ACCENT_INK : TEXT);
            int ripple = selected ? 0x33000000 : 0x33FFFFFF;
            chip.setBackground(new RippleDrawable(
                    ColorStateList.valueOf(ripple),
                    rounded(selected ? ACCENT : SURFACE_2, 14,
                            selected ? ACCENT : BORDER, 1),
                    null));
        }
        if (enterButton != null) {
            enterButton.setText("进入 · " + sceneLabel(launchScene));
        }
    }

    private String sceneLabel(String id) {
        for (int i = 0; i < SCENES.length; i++) {
            if (SCENES[i][0].equals(id)) {
                return SCENES[i][1];
            }
        }
        return SCENES[0][1];
    }

    private String normalizeScene(String id) {
        if (id != null) {
            for (int i = 0; i < SCENES.length; i++) {
                if (SCENES[i][0].equals(id)) {
                    return id;
                }
            }
        }
        return DEFAULT_SCENE;
    }

    private LinearLayout.LayoutParams scenePickerParams() {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        params.bottomMargin = dp(14);
        return params;
    }

    private LinearLayout buildStatusLine() {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER);

        View dot = new View(this);
        dot.setBackground(circle(OK));
        LinearLayout.LayoutParams dotParams = new LinearLayout.LayoutParams(dp(6), dp(6));
        dotParams.rightMargin = dp(7);
        row.addView(dot, dotParams);

        TextView text = label("服务已就绪 · 127.0.0.1:8130", 12, MUTED, Typeface.NORMAL, 0);
        row.addView(text);
        return row;
    }

    private LinearLayout.LayoutParams statusLineParams() {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        params.topMargin = dp(8);
        params.bottomMargin = dp(14);
        return params;
    }

    private TextView actionButton(String text, boolean primary, View.OnClickListener listener) {
        TextView button = label(text, 17, primary ? ACCENT_INK : TEXT, Typeface.BOLD, 0);
        button.setGravity(Gravity.CENTER);
        button.setClickable(true);
        button.setFocusable(true);
        button.setPadding(dp(16), 0, dp(16), 0);
        button.setOnClickListener(listener);
        button.setElevation(dp(primary ? 3 : 0));

        GradientDrawable background = rounded(
                primary ? ACCENT : SURFACE_2,
                16,
                primary ? ACCENT : BORDER,
                1);
        int ripple = primary ? 0x33000000 : 0x33FFFFFF;
        button.setBackground(new RippleDrawable(
                ColorStateList.valueOf(ripple), background, null));
        return button;
    }

    private TextView label(String text, float sizeSp, int color, int style, float letterSpacing) {
        TextView view = new TextView(this);
        view.setText(text);
        view.setTextColor(color);
        view.setTextSize(TypedValue.COMPLEX_UNIT_SP, sizeSp);
        view.setTypeface(Typeface.create("sans-serif", style));
        view.setIncludeFontPadding(false);
        if (letterSpacing != 0f) {
            view.setLetterSpacing(letterSpacing);
        }
        return view;
    }

    private GradientDrawable rounded(int color, int radiusDp, int strokeColor, int strokeDp) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setShape(GradientDrawable.RECTANGLE);
        drawable.setColor(color);
        drawable.setCornerRadius(dp(radiusDp));
        if (strokeDp > 0) {
            drawable.setStroke(dp(strokeDp), strokeColor);
        }
        return drawable;
    }

    private GradientDrawable circle(int color) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setShape(GradientDrawable.OVAL);
        drawable.setColor(color);
        return drawable;
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}
