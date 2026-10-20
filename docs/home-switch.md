# 桌面切换勘测：系统定制 / 静岸 / 普通桌面

目标：演示时在 PICO G2 4K 上快速切换默认 HOME，必要时可恢复原厂桌面。结论先行：

- **ADB 切换可行且已实机验证**：`cmd package set-home-activity` 可在三者之间可逆切换，无需 root。
- **APK 内静默切换不可行**：普通应用不能写默认 HOME；只能打开系统 HOME 选择器，由用户确认一次。
- **设备所有者（Device Owner）理论可行但不建议**：厂商已有系统级 ToB 管理组件，接管设备风险高。
- **开机回拉已实测通过**：把静岸设为默认 HOME 后重启，`resolve-activity` 与前台 Activity 仍是 `com.quietshore.portal/.MainActivity`；`com.pvr.tobservice` 的 `BOOT_COMPLETED` 没有把 HOME 拉回心景。厂商后续更新仍可能改变行为。

## 1. 实机勘测结果（2026-10-20）

### 当前 HOME

```text
cmd package resolve-activity --brief -a android.intent.action.MAIN -c android.intent.category.HOME
→ vr.xinjing.com.vrmc/.ui.SplashActivity
```

`vr.xinjing.com.vrmc`：

| 项 | 值 |
| --- | --- |
| APK | `/data/app/vr.xinjing.com.vrmc-.../base.apk`（用户安装，不是 system/priv-app） |
| userId | 10075 |
| 版本 | 1.1.4 / versionCode 37，targetSdk 30 |
| flags | `HAS_CODE ALLOW_CLEAR_USER_DATA ALLOW_BACKUP`，**无 SYSTEM** |
| 声明 | MAIN + HOME + LAUNCHER + DEFAULT |
| 后台 | `CollectService` 前台服务；绑定 `com.pvr.tobservice/.service.ToBService` |

Preferred Activities：

```text
vr.xinjing.com.vrmc/.ui.SplashActivity
  mMatch=0x100000 mAlways=true
  Selected from:
    com.pvr.launcher/.MainActivity
    vr.xinjing.com.vrmc/.ui.SplashActivity
    com.android.settings/.FallbackHome
```

也就是说：厂商把“心景”用户 APK 设成了默认 HOME，而不是系统 Launcher。

### 三个候选桌面

| 名称 | 组件 | 事实 |
| --- | --- | --- |
| 系统定制（心景） | `vr.xinjing.com.vrmc/.ui.SplashActivity` | 用户 APK，当前默认 HOME；带前台采集服务 |
| 普通/原厂桌面 | `com.pvr.launcher/.MainActivity` | `/system/priv-app/PVRLauncher`，userId 1000；声明 MAIN + HOME；按 Home 后会进入 `com.pvr.vrshell/.MainActivity` |
| 我们的桌面 | `com.quietshore.portal/.MainActivity` | 新加 MAIN + LAUNCHER + HOME；可被系统选择器/ADB 设为默认 |

补充：`com.pvr.home` 是 `/system/priv-app/PVRHome`，提供 `RecActivity`/`AllAppActivity`（最近任务/全部应用），不是完整的默认 HOME；`com.pvr.vrshell` 是系统 VR Shell。

### 权限与设备管理

- 无 root。
- 没有 Device Owner；`dumpsys device_policy` 只显示启用的系统 Admin：
  - `com.pvr.tobservice/.receiver.AdminReceiver`（uid 1000，system）
  - 策略含 `force-lock`，并声明 `BOOT_COMPLETED`
- 普通应用没有 `SET_PREFERRED_APPLICATIONS` 等签名权限，不能直接改 HOME。

## 2. 可行性矩阵

| 方案 | 静默 | 可逆 | 权限/条件 | 结论 |
| --- | --- | --- | --- | --- |
| ADB `cmd package set-home-activity` | 是 | 是 | 需要 USB/ADB | **演示首选，已实测** |
| APK 打开 HOME 选择器 | 否，需用户确认一次 | 是 | 无 | 可作为 APK 内入口 |
| APK 直接 `startActivity` 打开厂商桌面 | 是（只切前台，不改默认） | 按 Home 会回到当前默认 | 无 | 仅“看起来切了”，不是真切换 |
| Device Owner + `addPersistentPreferredActivity` | 是 | 是 | `dpm set-device-owner`，通常需设备未配置/恢复出厂 | 理论可行，不建议 |
| root / 写 secure settings | 是 | 是 | 无 root | 不可行 |

### 已实测的可逆切换

```bash
adb shell cmd package set-home-activity com.pvr.launcher/.MainActivity
adb shell input keyevent 3
# resolve → com.pvr.launcher/.MainActivity；实际前台为 com.pvr.vrshell/.MainActivity

adb shell cmd package set-home-activity vr.xinjing.com.vrmc/.ui.SplashActivity
adb shell input keyevent 3
# resolve → vr.xinjing.com.vrmc/.ui.SplashActivity
```

## 3. 仓库内实现

### ADB 脚本

```bash
./scripts/pico-adb.sh home status
./scripts/pico-adb.sh home ours      # 静岸成为默认 HOME
./scripts/pico-adb.sh home system    # PVRLauncher / 原厂桌面
./scripts/pico-adb.sh home vendor    # 心景（当前原状）
./scripts/pico-adb.sh home restore   # 等价 vendor
```

每次切换后脚本会按一次 Home 并打印当前解析结果。

### APK

- `AndroidManifest.xml`：`MainActivity` 增加 `CATEGORY_HOME` 与 `singleTask`。
- `MainActivity` 次级按钮“切换桌面”调用 `PortalActions.chooseHome()`：
  优先打开 `Settings.ACTION_HOME_SETTINGS`（实机显示“默认应用 → 主屏幕应用”，列出静岸/PVRLauncher/心景），
  缺失时回退到 `Intent.makeMainSelectorActivity(ACTION_MAIN, CATEGORY_HOME)`。
- 这不会静默改默认 HOME；用户在系统设置/弹窗里确认一次。
- 通知栏仍保留“返回桌面”，它只打开当前默认桌面。

## 4. 推荐演示流程

1. 连接 USB，`./scripts/pico-adb.sh home ours`，按 Home 进入静岸场景选择页。
2. 点“进入训练”拉起 Firefox Reality；返回 Home 仍回到静岸。
3. 需要恢复原厂/心景：`./scripts/pico-adb.sh home vendor`（或 `home system`）。
4. 演示结束始终执行一次 `home vendor`，避免设备停在非原厂桌面。

APK 内无 ADB 时：点“切换桌面” → 系统选择器 → 选择静岸/PVRLauncher/心景。

## 5. 风险与待验证

- **开机回拉**：已实测一次重启不回拉；`com.pvr.tobservice` 仍有 `BOOT_COMPLETED`，系统更新或厂商策略变化后需复测。
- **心景后台服务**：切走 HOME 不等于停掉 `vr.xinjing.com.vrmc/.service.CollectService`；它仍可能前台运行。不要 force-stop/清数据，避免影响厂商临床数据。
- **设备所有者**：把静岸设为 Device Owner 会与厂商 ToB 管理冲突，且卸载/恢复成本高；临床设备不建议。
- **HOME 崩溃兜底**：静岸作为 HOME 时必须保证 `MainActivity` 可重复启动、服务可重试；已有通知/磁贴作为保底入口。
- **系统更新/恢复出厂**：HOME 偏好会重置，需重新执行切换。
