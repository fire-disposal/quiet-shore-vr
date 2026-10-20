package com.quietshore.portal;

import android.app.Activity;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.os.Bundle;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

/**
 * 壳的唯一界面：三个入口按钮 + 版本信息。
 * 界面本身不含业务，进入训练后所有内容都在 Web 层。
 */
public class MainActivity extends Activity {
    private static final int COLOR_BACKGROUND = Color.rgb(13, 17, 23);
    private static final int COLOR_MUTED = Color.rgb(139, 152, 168);

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        PortalActions.startServer(this);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER);
        root.setBackgroundColor(COLOR_BACKGROUND);
        int pad = dp(48);
        root.setPadding(pad, pad, pad, pad);

        TextView title = new TextView(this);
        title.setText("静岸");
        title.setTextColor(Color.WHITE);
        title.setTextSize(TypedValue.COMPLEX_UNIT_SP, 32);
        title.setGravity(Gravity.CENTER);
        root.addView(title);

        TextView status = new TextView(this);
        status.setText("本地训练服务 " + PortalActions.URL + "\n不修改默认桌面");
        status.setTextColor(COLOR_MUTED);
        status.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        status.setGravity(Gravity.CENTER);
        status.setPadding(0, dp(10), 0, dp(20));
        root.addView(status);

        addButton(root, "进入训练", new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                PortalActions.enter(MainActivity.this);
            }
        });
        addButton(root, "全部应用", new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                PortalActions.allApps(MainActivity.this);
            }
        });
        addButton(root, "返回桌面", new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                PortalActions.home(MainActivity.this);
            }
        });

        TextView version = new TextView(this);
        version.setText(versionLabel());
        version.setTextColor(COLOR_MUTED);
        version.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        version.setGravity(Gravity.CENTER);
        version.setPadding(0, dp(18), 0, 0);
        root.addView(version);

        setContentView(root);
    }

    private void addButton(LinearLayout root, String label, View.OnClickListener listener) {
        Button button = new Button(this);
        button.setText(label);
        button.setTextSize(TypedValue.COMPLEX_UNIT_SP, 20);
        button.setOnClickListener(listener);
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                dp(56));
        params.setMargins(0, dp(6), 0, dp(6));
        root.addView(button, params);
    }

    private String versionLabel() {
        try {
            PackageInfo info = getPackageManager().getPackageInfo(getPackageName(), 0);
            String name = info.versionName != null ? info.versionName : "?";
            return "v" + name + " (" + info.versionCode + ")";
        } catch (PackageManager.NameNotFoundException error) {
            return "";
        }
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}
