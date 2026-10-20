# 自更新 Spike：可行性、签名前提与实施方案

本文回答“静岸的两个 APK 能否自己更新”，给出可落地的方案与分阶段计划。结论基于当前仓库事实：

- 头显 `com.quietshore.portal`：`android/headset/build.gradle.kts`，`minSdk 26`、`targetSdk 33`、`versionCode 20`、`versionName 0.7.0`。
- 平板 `com.quietshore.control`：`android/control/build.gradle.kts`，`minSdk 26`、`targetSdk 33`、`versionCode 16`、`versionName 0.7.0`。
- 目标设备：PICO G2 4K，Android 8.1 / SDK 27，无 root，`ro.debuggable=0`，production build（`docs/pico-g2.md`、`docs/distribution.md`）；另一台 Android 平板型号/系统版本未记录。
- 分发：GitHub Releases；`.github/workflows/release.yml` 构建 `assembleDebug`，有 secrets 时用 `apksigner` 重新签名，无 secrets 时直接发布 debug 签名包；产物为 `quiet-shore-headset-$TAG.apk`、`quiet-shore-control-$TAG.apk`、`SHA256SUMS.txt`。
- 当前代码没有任何更新能力：两个 `AndroidManifest.xml` 都没有 `REQUEST_INSTALL_PACKAGES`、没有 FileProvider、没有安装器/下载器；`control` 甚至没有 `INTERNET` 权限。

## 0. 结论摘要

| 问题 | 结论 |
| --- | --- |
| 平板自更新 | **可行，风险低**。标准 Android 安装确认流程，`PackageInstaller` + 用户确认即可。 |
| 头显自更新 | **技术可行，但安装确认 UI 在 VR/3DoF 手柄环境中的可达性是最大未知**；必须先在 G2 上实测系统安装器页面，再承诺“可自更新”。 |
| 静默安装 | **当前分发形态下不可行**。只有系统特权（`INSTALL_PACKAGES`）或 OEM/企业 MDM 托管安装通道才可能静默；在 AOSP 上，普通旁加载应用即使成为 device owner 也拿不到该权限。PICO G2 是否提供托管通道未验证。 |
| 最大阻塞项 | **签名**。现有 release 在未配置 secrets 时使用 CI 上临时生成的 debug keystore，每次 runner 的证书都不同；这种包之间无法互相升级，必须先建立稳定的 release keystore 并固定证书。 |
| 推荐更新清单 | 静态 `update.json`，固定 URL `releases/latest/download/update.json`，不依赖 GitHub API。 |
| 推荐安装方式 | `PackageInstaller.Session`（两端一致），FileProvider + `ACTION_VIEW` 仅作为 PICO 兼容回退。 |
| 用户确认 | 必须。产品与合规上都不应假设“静默更新”。 |

三条硬前提，缺一不可：

1. **稳定签名**：同一 `applicationId` 的所有版本由同一把长期密钥签名；证书 SHA-256 固定在客户端。
2. **清单与 APK 的完整性校验**：HTTPS + 清单内 `sha256` + 签名证书比对 + `versionCode` 单调递增。
3. **安装必须由用户确认**：未知来源授权 + 系统安装对话框；头显在训练/接管期间不得弹出安装器。

---

## 1. 安装器可行性

### 1.1 未知来源与 `REQUEST_INSTALL_PACKAGES`

Android 8.0 起，未知来源不再是全局开关，而是“按应用授权”：

- 应用在 manifest 声明 `android.permission.REQUEST_INSTALL_PACKAGES`（normal 权限，无运行时弹窗）。
- 系统用 AppOps 记录该应用是否被允许“安装未知应用”；未允许时，提交安装会被拦截。
- 应用可用 `PackageManager.canRequestPackageInstalls()`（API 26）检查；为 false 时用
  `Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES` + `package:<applicationId>` 跳转到该应用的授权页。
- 用户授权后返回，应用在 `onResume` 重新检查，再继续安装。

两个 APK 都需要新增：

```xml
<uses-permission android:name="android.permission.REQUEST_INSTALL_PACKAGES" />
<!-- control 目前没有 INTERNET，自更新必须补 -->
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />

<receiver
    android:name=".UpdateStatusReceiver"
    android:exported="false" />
```

注意 PICO 的定制风险：`ACTION_MANAGE_UNKNOWN_APP_SOURCES` 页面可能不存在或被改名。必须处理
`ActivityNotFoundException`，退化为打开系统设置首页并给出文字指引；不能因为设置页缺失就崩溃。
这一点是 P0 之后、P2 之前必须实机确认的项（见 §9）。

### 1.2 FileProvider vs PackageInstaller

| 维度 | FileProvider + `ACTION_VIEW` | `PackageInstaller.Session` |
| --- | --- | --- |
| 依赖 | 头显需要新增 `androidx.core`（当前 `:headset` 只依赖 `:protocol`，是纯 framework 控件） | 平台 API 21+，无新依赖 |
| 安装入口 | 系统安装器 Activity，通过 `content://` URI 读取文件 | 系统安装器，通过 session 提交 |
| 状态反馈 | 只能靠 `MY_PACKAGE_REPLACED` 或用户回到应用，失败原因不可见 | `PendingIntent` 回调，`STATUS_SUCCESS` / `STATUS_FAILURE_*` 明确 |
| 安全 | 需要 `FLAG_GRANT_READ_URI_PERMISSION`；理论上可被第三方声明同 MIME 的应用劫持 | 系统安装器直接处理，不暴露 content URI |
| 文件生命周期 | 安装器读取期间不能删除文件 | 写入 session 后原文件可立即删除 |
| PICO 兼容性 | 更接近传统侧载路径，未知 | session 机制在 8.1 上标准，但 PICO 定制安装器未验证 |

**推荐**：两端都用 `PackageInstaller.Session`；只有实测 PICO 不支持 session（或 session 状态回调不工作）时，才加 FileProvider 回退。回退路径必须校验处理者：优先系统安装器，或 `PackageManager.checkSignatures(handlerPackage, "android") == SIGNATURE_MATCH`，避免任意应用接管 APK 安装。

`PackageInstaller` 的关键实现约束：

```kotlin
val params = PackageInstaller.SessionParams(
    PackageInstaller.SessionParams.MODE_FULL_INSTALL
)
params.setAppPackageName(packageName)   // 绑定到本应用，防止装错包
params.setSize(apk.length())
params.setInstallReason(PackageManager.INSTALL_REASON_USER)

val sessionId = installer.createSession(params)
installer.openSession(sessionId).use { session ->
    session.openWrite("base.apk", 0, apk.length()).use { out ->
        apk.inputStream().use { it.copyTo(out) }
        session.fsync(out)
    }
    session.commit(statusPendingIntent.intentSender)
}
```

回调 `PendingIntent` 必须是**显式** Intent，并且在 API 31+ 使用 `FLAG_MUTABLE`：

```kotlin
val intent = Intent(context, UpdateStatusReceiver::class.java)
    .setAction(ACTION_INSTALL_STATUS)
val flags = PendingIntent.FLAG_UPDATE_CURRENT or
    if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0
val pi = PendingIntent.getBroadcast(context, sessionId, intent, flags)
```

原因：系统通过 fill-in extras 把 `EXTRA_STATUS`、`EXTRA_INTENT` 填进回调；`FLAG_IMMUTABLE` 会丢弃这些 extras。`status == STATUS_PENDING_USER_ACTION` 时，取出 `EXTRA_INTENT` 并用 `FLAG_ACTIVITY_NEW_TASK` 启动，才是用户看到的安装确认页。

### 1.3 静默安装矩阵

| 方式 | 是否弹安装确认 | 前提 | 本项目可用性 |
| --- | --- | --- | --- |
| 普通应用 `PackageInstaller` | 是 | 用户授予“安装未知应用” | 可用（推荐） |
| `adb install -r` | 否 | USB 调试/ADB | 仅运维/验收，不是产品路径 |
| 特权应用调用 `PackageInstaller` | 否 | `INSTALL_PACKAGES`（signature\|privileged），装在 `/system/priv-app` 或平台签名 | 不可得（无 root、非系统应用） |
| Device Owner / 普通签名 DPC | 通常是（AOSP；OEM 可能有例外） | 设备恢复出厂后 `dpm set-device-owner` | 不解决静默；DPC 本身不获得 `INSTALL_PACKAGES` |
| OEM MDM / Android Management API | 否（由 OEM/托管组件代装） | 设备以托管方式初始化，OEM 系统组件代装 | PICO G2 是否支持未验证；需要恢复出厂设置 |
| root / `pm install` 提权 | 否 | root | 不可用（`ro.debuggable=0`，无 root） |

**明确结论**：不要设计“后台自动装好”的路径。即使 P0–P2 全部完成，用户每台设备、每个版本仍要看到并确认一次系统安装对话框。

### 1.4 头显安装器 UX

这是在 G2 上唯一必须先验证、再写代码的部分：

1. **安装对话框是否可见**：PICO 把 2D 应用渲染为虚拟屏；系统安装器是另一个包，可能以独立面板出现，也可能短暂黑屏/回到 launcher。3DoF 手柄能否点中“安装/取消”？是否需要摘下头显？
2. **训练会话是否被打断**：在 Firefox Reality 的 WebXR 会话中启动安装器，Firefox 会退到后台；已知 XR 会话退出约 26 秒（`docs/pico-g2.md`）。因此安装必须发生在会话结束之后，且要等页面报告 `session=false` 并留出宽限时间。
3. **安装后进程被杀**：更新会杀掉 `PortalService`，BLE 外设消失，平板链路断开。`BootReceiver` 已注册 `MY_PACKAGE_REPLACED`，会恢复服务与通知（`android/headset/.../BootReceiver.kt`），但不会自动拉起 Firefox（这是既有设计）。平板需要重新连接/接管。
4. **旧页面不会热更新**：Firefox 里已加载的旧 `assets/index.html` 仍在内存；更新后必须重新点“进入训练”，带新时间戳重新加载。

平板上没有这些问题：标准横屏系统对话框，Compose 里加一个更新条/对话框即可。

### 1.5 安装器可行性结论

- 平板：直接做，`PackageInstaller` + 未知来源授权 + 用户确认。
- 头显：先做一次“手工安装测试 APK 到 G2”的 UX 验证（P0 的一部分），确认对话框可见、可操作、不会让系统 watchdog/launcher 崩；通过后再进入 P2。若不通过，头显更新只能继续走 `adb install -r`，文档需要明确写出这一限制。

---

## 2. 签名前提

### 2.1 现状：debug 签名会随 CI runner 轮换

`.github/workflows/release.yml` 的 `Resolve signing material` 步骤：

- 三个 secrets（`ANDROID_KEYSTORE_BASE64`、`ANDROID_KEYSTORE_PASSWORD`、`ANDROID_KEY_ALIAS`）齐全 → `mode=release`，用 `apksigner` 重新签名。
- 缺任一 → `mode=debug`，直接把 `assembleDebug` 的产物 `cp` 成发布包。
- `Prepare named APKs` 只在 `KEYSTORE` 非空时重签；否则复制。
- `apksigner verify` 只验证“能通过”，没有断言证书指纹。

`assembleDebug` 的签名来自 Gradle 在 runner 的 `~/.android/debug.keystore`。GitHub 托管 runner 是一次性的：每次构建都会生成新的 debug 密钥（alias `androiddebugkey`，密码 `android`，CN=Android Debug）。因此：

- 不同 release 的 debug 签名 APK **证书不同**。
- `.github/workflows/build.yml` 上传的 `quiet-shore-apk` 工件是原始 debug 签名，与 release 重新签名后的包也不一定同证书。
- 用户设备上装的版本证书，取决于它当时从哪个 run 下载。

### 2.2 为什么这会直接破坏更新

Android 在安装更新时强制检查：同包名的新 APK 必须由**与已安装版本相同的证书**签名，否则返回
`INSTALL_FAILED_UPDATE_INCOMPATIBLE`。这不是应用层策略，无法绕过（除非卸载旧包）。

后果：

1. 自更新在第一台设备上就会失败；用户看到“应用未安装/签名不一致”。
2. 只能卸载重装。头显卸载会停掉前台服务、移除通知与磁贴、清掉 `HeadsetSettings`（场景、跳过校准、HUD、眼高）；平板目前没有持久设置，重装后重新连接即可（控制权本来就不落盘）。
3. 任何“先发一版修签名”的尝试，都必须先让所有设备手工卸载一次。这一步要在 P0 就规划，不能等到 P1 才发现。
4. 如果 CI 的 release keystore 未来被重新生成/轮换，同样的事会再发生一次。Android 8.1 不支持 APK Signature Scheme v3 的签名谱系（key rotation lineage 需要 API 28+），所以**在 G2 上不存在平滑换钥匙的路径**。

### 2.3 稳定 release keystore 要求

- 只生成一次：RSA 4096（或 EC P-256），有效期 ≥ 25 年，alias 固定（例如 `quietshore`）。
- keystore 文件与密码离线备份两份；密码进团队密码库；记录恢复流程（丢失 = 只能卸载重装，且再也无法给存量设备发更新）。
- 仓库 secrets 使用 `ANDROID_KEYSTORE_BASE64` / `ANDROID_KEYSTORE_PASSWORD` / `ANDROID_KEY_ALIAS` / `ANDROID_KEY_PASSWORD`，与现有 workflow 变量名保持一致。
- release workflow 放进受保护的 GitHub Environment（要求人工审批），并保护 `v*` tag，避免仓库被攻破后攻击者直接签名发布。当前 workflow 已有 `permissions: contents: write`，这是发布所需的最小集，不要再扩大。
- **未配置 keystore 时不应发布可被 `latest` 选中的 stable release**。建议二选一：直接 fail；或标为 prerelease 且不生成 `update.json`（prerelease 不会成为 `releases/latest`）。

### 2.4 证书固定与校验流程

签名是唯一可信根；清单里的 `sha256` 只防传输损坏，不防“清单和 APK 一起被换掉”。因此：

1. **构建期**：重签后执行
   `apksigner verify --print-certs --min-sdk-version 26 <apk>`，解析 `Signer #1 certificate SHA-256 digest`，与仓库变量 `EXPECTED_CERT_SHA256` 逐字节比较；不一致立即失败。把指纹写入 release notes、`update.json` 和 README 发布段。
2. **运行期（下载后、安装前）**：
   - 用 `PackageManager.getPackageArchiveInfo(apkPath, flags)` 读出包名、`versionCode`、签名。
   - flags 在 API 28+ 用 `GET_SIGNING_CERTIFICATES`，API 26/27 用 `GET_SIGNATURES`。
   - 必须恰好一个签名者；计算 `SHA-256(Signature.toByteArray())`，与编译期常量 `PINNED_CERT_SHA256` **以及**当前已安装包的证书摘要比较。
   - 包名必须等于自身；`versionCode` 必须严格大于当前；`minSdk` 必须 ≤ 设备 SDK。
3. **系统兜底**：即使第 2 步被绕过，`PackageInstaller` 仍会因证书不同拒绝安装。把
   `STATUS_FAILURE_INCOMPATIBLE` / `INSTALL_FAILED_UPDATE_INCOMPATIBLE` 映射为终态错误，提示“签名不一致，需要人工卸载重装”，不再重试。

```kotlin
private fun signerDigest(info: PackageInfo): ByteArray? {
    val signers = if (Build.VERSION.SDK_INT >= 28) {
        info.signingInfo?.apkContentsSigners
    } else {
        @Suppress("DEPRECATION") info.signatures
    } ?: return null
    if (signers.size != 1) return null
    return MessageDigest.getInstance("SHA-256").digest(signers[0].toByteArray())
}
```

`PINNED_CERT_SHA256` 应放在共享的 updater 模块里，两端共用；不要从服务器下发，否则等于没有固定。

### 2.5 签名相关的发布流程修正（P0）

- 显式指定签名方案：`apksigner sign --v1-signing-enabled true --v2-signing-enabled true --min-sdk-version 26 ...`。v1 有利于 8.1 上 `getPackageArchiveInfo` 的证书读取；v2 是 8.1 的实际校验方案。若所用 apksigner 允许，再额外开启 v3（8.1 会忽略；若工具因 `minSdk 26` 拒绝，则不加，不影响 8.1）。
- `apksigner verify --print-certs` 后断言“恰好一个 signer + 指纹等于期望值”。
- 每次发布必须 bump `versionCode`（当前 20 / 16）。`versionCode` 不变时，更新检查会认为已是最新；`versionName` 只是展示。
- 当前发布物是 **debug 构建**（`android:debuggable=true`），只是换了签名。长期看，自更新应改为 release variant；否则设备上任何能 `run-as` 的调试通道都能读写更新状态。过渡期可接受，但必须在 `docs/distribution.md` 和 release notes 里写明。

### 2.6 存量设备的一次性迁移

在 P1 上线前，对每台设备执行：

```bash
adb shell dumpsys package com.quietshore.portal | grep -A3 -i "signatures\|versionCode"
adb shell dumpsys package com.quietshore.control | grep -A3 -i "signatures\|versionCode"
```

把设备上的证书与新的 release 证书比对。若不同（大概率如此，因为历史包是不同 runner 的 debug 签名），P1 前安排一次手工卸载/安装：

```bash
adb uninstall com.quietshore.portal
adb install quiet-shore-headset-v0.7.1.apk
```

这次迁移会清空本机设置，但不会影响 Firefox Reality 或厂家数据；头显需要重新设置场景/眼高，平板重新连接即可（控制权本来就不落盘）。

---

## 3. 更新清单（update.json）

### 3.1 稳定 URL

推荐：

```
https://github.com/fire-disposal/quiet-shore-vr/releases/latest/download/update.json
```

`releases/latest/download/<asset>` 是 GitHub 的稳定入口：返回 302 到当前“latest” release 的资产，不需要 API、不计 API 速率限制、不需要 token（仓库是公开的）。限制：

- “latest” 指最近创建的、非 draft、非 prerelease 的 release；GitHub 按创建时间而不是语义版本选 latest。补发旧版本可能把 latest 指回旧 tag。发布时用 `softprops/action-gh-release` 的 `make_latest` 显式控制，并在发布后人工确认 `releases/latest` 指向正确。
- 资产名必须精确匹配；缺 `update.json` 时返回 404。
- CDN 可能短暂缓存旧内容；客户端接受旧清单（版本号比较会兜底），不要假设“发布即秒达”。

### 3.2 Schema

```json
{
  "schema": 1,
  "channel": "stable",
  "publishedAt": "2026-10-20T08:00:00Z",
  "release": {
    "tag": "v0.7.1",
    "protocolVersion": 2,
    "minProtocolVersion": 1,
    "critical": false,
    "notes": "修复平板重连；更新后需重新进入训练。",
    "notesUrl": "https://github.com/fire-disposal/quiet-shore-vr/releases/tag/v0.7.1"
  },
  "packages": {
    "com.quietshore.portal": {
      "versionCode": 21,
      "versionName": "0.7.1",
      "url": "https://github.com/fire-disposal/quiet-shore-vr/releases/download/v0.7.1/quiet-shore-headset-v0.7.1.apk",
      "sha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      "size": 2012345,
      "minSdk": 26,
      "minSupportedVersionCode": 18,
      "signingCertSha256": "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210"
    },
    "com.quietshore.control": {
      "versionCode": 17,
      "versionName": "0.7.1",
      "url": "https://github.com/fire-disposal/quiet-shore-vr/releases/download/v0.7.1/quiet-shore-control-v0.7.1.apk",
      "sha256": "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
      "size": 17800000,
      "minSdk": 26,
      "minSupportedVersionCode": 14,
      "signingCertSha256": "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210"
    }
  }
}
```

字段语义：

| 字段 | 作用 |
| --- | --- |
| `schema` | 清单结构版本；客户端只接受 ≤ 自身支持的版本，未知字段忽略，未知大版本拒绝。 |
| `channel` | `stable` / `canary`；stable 客户端拒绝其他 channel。 |
| `release.tag` | 便于日志/展示；也用于拼 URL 时做一致性校验。 |
| `release.protocolVersion` | 这一对 APK 使用的 BLE/回环协议版本；见 §5。 |
| `release.minProtocolVersion` | 本版仍能兼容的最低对端协议；低于它的平板/头显应被提示升级。 |
| `release.critical` | 仅用于改变提示语气与延后策略；**不允许**自动安装。 |
| `packages.<id>.versionCode` | 决定性版本号；必须严格大于本机已安装值。 |
| `packages.<id>.versionName` | 展示用。 |
| `url` | APK 地址；必须通过严格 allowlist（见 §6）。 |
| `sha256` | 下载后逐字节校验。 |
| `size` | 预期字节数；同时用于下载前空间检查与进度显示。 |
| `minSdk` | 防止把新包推给过旧系统。 |
| `minSupportedVersionCode` | 低于此版本不允许自动更新（数据/协议迁移不保证），提示人工重装。 |
| `signingCertSha256` | 冗余校验；必须等于本机固定值。 |

`rollout` 可选：

```json
"rollout": { "percent": 100, "minVersionCode": 0 }
```

但在“一头显 + 一平板”的规模下，百分比灰度没有统计意义。真正的灰度应靠“先手工装 RC、再发 stable”，见 §5.3。

更严格的替代方案：清单只给 `release.tag` 与资产文件名，URL 由客户端用编译期常量拼出：

```
https://github.com/fire-disposal/quiet-shore-vr/releases/download/<tag>/<asset>
```

这样清单里没有任何可被篡改成任意主机的 URL。代价是清单不能指向其他托管位置；对本项目足够。

### 3.3 GitHub API vs 静态清单

| 维度 | GitHub Releases API | 静态 `update.json` |
| --- | --- | --- |
| 限流 | 未认证 60 次/小时/IP；诊所共享 NAT 可能撞限 | 资产下载不走 API 限流 |
| 响应体 | 大（release + assets + body），客户端要自己选资产 | 几 KB，字段为本项目定制 |
| 稳定性 | API 字段随平台演进；需要处理分页/空值 | 由仓库自己版本化（`schema`） |
| 协议/通道/回滚字段 | 需要塞进 release body 或额外资产 | 原生支持 |
| 发布复杂度 | 无需额外步骤 | workflow 必须生成并上传清单 |
| 失败模式 | 403/429 常见，且与 release 是否存在耦合 | 404/旧缓存，语义清晰 |

**选择静态清单**。API 只在排障时用来确认 `latest` 指向，不作为客户端依赖。

### 3.4 生成与发布（P0 的 workflow 改动建议）

在 `Prepare named APKs` 之后、`Publish GitHub Release` 之前：

1. 用 `aapt2 dump badging`（build-tools 36.0.0 已在 workflow 中）读取两个 APK 的 `versionCode`/`versionName`/`minSdkVersion`，不要从 gradle 文件解析。
2. `sha256sum` 与 `stat -c %s` 得到 `sha256`/`size`。
3. 新增 `scripts/update-manifest.mjs`（或 Node 内联脚本）生成 `update.json`，URL 使用 `$TAG` 拼出。
4. 把 `update.json` 加进 `softprops/action-gh-release` 的 `files:`，并设置 `make_latest`。
5. 断言两件事：`versionCode` 大于上一发布；证书指纹等于 `EXPECTED_CERT_SHA256`。
6. 发布后 `curl -sL https://github.com/fire-disposal/quiet-shore-vr/releases/latest/download/update.json` 确认内容中的 `release.tag` 正确。

### 3.5 离线/无网行为

- 没有网络时**完全不检查**，不阻塞启动，不弹错误；设置页只显示“上次检查：…”。
- 清单缓存（`ETag` + 最后成功时间 + 最高已见 `versionCode`）只用于展示，**不用于直接安装**：安装前必须有一次当前会话内的成功清单获取，避免拿过期清单去下载已删除的资产。
- 失败退避：无网/超时 → 下次周期再试；HTTP 404 → 24 小时；403/429 → 24 小时；5xx → 1h/6h/24h 递增；同版本连续校验失败（hash/签名）→ 记为 `failedVersionCode`，不再自动尝试，直到出现更高版本或用户手动检查。
- 平板若用移动网络，默认“仅 Wi-Fi 下载”；清单检查（几 KB）可以走任意网络。
- 头显如果根本不在线，自更新不可用；继续用 `adb install -r`，这是可接受的运维路径。

---

## 4. 运行时流程

### 4.1 触发与调度

| 端 | 调度 |
| --- | --- |
| 头显 | `PortalService` 是 `START_STICKY` 前台服务，进程长期存在。服务内用 `Handler`/`ScheduledExecutorService` 做 12 小时周期 + ±10% 抖动；`BootReceiver` 启动后延迟 60 秒再查。不引入 WorkManager（`:headset` 保持零 AndroidX 依赖）。 |
| 平板 | 只在应用可见时检查：`MainActivity`/`ControlViewModel` 启动与 `onResume`，最小间隔 1 小时；另加手动“检查更新”，30 秒冷却。平板不使用常驻后台。 |

不把更新检查放进 WebView（`controller.html`）或回环页面；更新是原生能力，Web 层不应获得安装权限。

### 4.2 下载

- 只用 `HttpsURLConnection`（或等价的标准 TLS 栈），连接超时 10 秒、读取超时 30 秒；不使用 `DownloadManager`（无法在流式下载中做 hash 校验，且 PICO 上的存储/通知行为未知）。
- 逐跳校验重定向：最多 5 跳，每跳都必须是 `https` 且主机在 allowlist；最终 URL 也要校验。不能让 `github.com` 的 302 把客户端带到任意主机。
- 路径：`cacheDir/updates/<versionCode>-<sha256前12位>.apk.part`，完成后原子 rename；写完后 `fsync`。
- 下载前用 `StatFs` 检查剩余空间 ≥ `size + 32 MB`；下载中用 `Content-Length` 与 `size` 校验（允许 chunked，但总字节数不得超过上限）。
- 边下边算 SHA-256；不匹配立即断开、删除 `.part`、不创建安装会话。
- 完成后立刻校验（见 4.3），校验通过前不显示“安装”按钮的可点击态。

建议上限：单包 64 MB（当前本机构建：头显约 1.9 MB，平板约 17 MB；release 略有差异）。上限只是防御，不是产品约束。

### 4.3 校验顺序

1. 清单本身：`schema`、`channel`、包名条目存在、`versionCode > installed`、`minSdk ≤ Build.VERSION.SDK_INT`、`minSupportedVersionCode ≤ installed`、`size` 合理、`sha256` 为 64 位十六进制。
2. 文件：字节数 == `size`；SHA-256 == 清单值（`MessageDigest.isEqual`）。
3. 归档：`getPackageArchiveInfo` 能解析；包名 == 自身；`versionCode` == 清单值；`minSdk` 合法。
4. 签名：恰好一个签名者；证书 SHA-256 == `PINNED_CERT_SHA256` == 当前已安装包证书摘要。
5. 可选（stable 通道）：`applicationInfo.flags & FLAG_DEBUGGABLE == 0`。**当前发布物仍是 debug 构建，立即启用会挡住所有更新**；P0/P1 应先产出 release variant，或明确把这条件降级为警告并记录风险。
6. `minSupportedVersionCode` 检查失败：不自动安装，展示“需人工重装（会清空本机设置）”。

任何一步失败：删除文件、记录版本号、按 4.5 退避，不弹系统安装器。

### 4.4 用户同意与安装

- 头显：`PortalActivity` 的“设置”页已有“关于”卡片与 `infoRow("版本", versionName())`；在此加一行“更新”，显示“有新版本 v0.7.1（12.3 MB）”与“检查/安装”。详细说明与“稍后”放在 `AlertDialog`，不新增第五个页面（现有四页都不滚动）。
- 平板：`ControlApp` 顶层加更新横幅/对话框；不要在 `controller.html` 里做，避免 WebView 拿到安装触发能力。文案必须提醒“安装会断开与头显的连接”。
- 点击“安装”后：
  1. 检查 `canRequestPackageInstalls()`；false → 跳转授权页，返回后重试。
  2. 创建 session，写入 APK，`commit`。
  3. `STATUS_PENDING_USER_ACTION` → 启动系统安装页；用户确认/取消。
  4. `STATUS_SUCCESS` → 清理暂存文件，标记版本；进程随后被杀，`MY_PACKAGE_REPLACED` 触发 `BootReceiver` 恢复头显服务。
  5. 失败 → 按状态码映射文案；不循环重试。
- 若实测 PICO 不支持 session，回退到 FileProvider + `ACTION_VIEW`：把暂存 APK 放在 `cacheDir/updates/`，用 `content://<applicationId>.updates/...` 授权读并启动系统安装器；安装成功/失败后删除文件，状态靠 `MY_PACKAGE_REPLACED` 与包变更广播推断。不要使用已弃用的 `ACTION_INSTALL_PACKAGE`，也不要用 `file://` URI（8.1 会抛 `FileUriExposedException`）。
- 安装完成后不自动打开 Firefox；头显回到控制台，由用户重新“进入训练”。平板上重新扫描/连接/`CLAIM`。

### 4.5 错误、重试、取消

| 情况 | 行为 |
| --- | --- |
| 清单 404 / 无更新 | 静默；记录上次检查时间 |
| 清单解析失败 / schema 不支持 | 静默 + 日志；不安装 |
| TLS/证书错误（含设备时间错误） | 视为网络失败；设置页提示“网络或设备时间异常” |
| 下载中断 | 删除 `.part`；本次最多重试 3 次，之后进入退避 |
| hash/签名/包名不符 | 终态：删除、记录 `failedVersionCode`、提示“更新包校验失败”；不重试 |
| 空间不足 | 删除 `.part`，提示清理空间；不重试 |
| 用户取消下载/安装 | 中止连接、`session.abandon()`（若已创建）、删除暂存；24 小时不再提示同版本 |
| 系统安装失败（`STATUS_FAILURE_*`） | 映射为可读原因；`INCOMPATIBLE`（签名）为终态；`STORAGE` 可重试 |
| 未知来源未授权 | 引导授权；不重复弹窗轰炸 |
| 重启 | 启动时清理 `.part`、超过 7 天的暂存包、`getMySessions()` 里的陈旧会话；重新检查，不自动安装 |

### 4.6 头显：训练/接管期间必须延后

判定依据（全部来自现有代码）：

- `ControlState.session`：患者页面通过 `POST /state` 上报（`PortalService.handleState` → `BluetoothControl.publishState`）。当前 `BluetoothControl.lastState` 是私有的，需要在 `BluetoothControl` 上增加 `sessionActive()` 读取器，或在 `PortalService` 里保存最近一次 `ControlState`。
- `BluetoothControl.controllerAddress() != null`：有平板持有控制权。
- 最近一次遥测时间：`publishTelemetry` 的调用时间；超过 5 秒无遥测视为空闲。
- `session` 可能因页面崩溃而过期：记录最后一次 `POST /state` 的时间；超过 2 分钟没有状态且没有遥测时按空闲处理（或让页面在 `onSessionEnd` 显式上报 `session=false`）。
- Firefox 是否在前台：`ActivityManager.getRunningTasks` 在 8.1 上对第三方应用只返回自己的任务，看不到 Firefox，不能用来判断前台；以页面上报的 `session` 为准。

规则：

1. **会话或接管期间**：允许后台下载（Wi-Fi 且非会话高负载时；更保守的做法是连下载也延后），但绝不创建安装会话、绝不弹安装器、绝不显示阻塞式对话框。
2. 会话结束：页面上报 `session=false` 后，再等 60 秒（覆盖 XR 会话退出约 26 秒的已知耗时），且 `controllerAddress() == null`，才允许提示。
3. 提示方式：更新服务常驻通知追加一行/一个动作；`PortalActivity` 设置页显示状态。用户主动点“安装”才继续。
4. `critical=true` 也只改变提示语气与重复频率；**不得自动结束训练**。需要立即更新时，由操作者在平板上发 `exit`/`stop`（现有白名单命令），会话结束后再走正常流程。更新器本身不调用这两个命令，只等待 `session=false`。
5. 安装前再次确认 `session == false`、无控制者、无遥测；否则取消本次安装并提示“训练进行中，稍后安装”。

### 4.7 代码归属

建议新增 Android library 模块 `android/updater`（纯 Kotlin + Android framework，不依赖 AndroidX），两端共用：

- `UpdateManifest`（解析/校验）
- `UpdateClient`（HTTPS、重定向 allowlist、hash）
- `UpdateVerifier`（包名/版本/签名）
- `UpdateInstaller`（PackageInstaller/状态映射）
- `UpdateStore`（SharedPreferences：最后检查、failedVersionCode、暂存路径）
- `SigningCertPin`（常量）

`android/protocol` 保持纯 JVM，不引入 Android；只把 `PROTOCOL_VERSION` 这类常量放进去。UI 适配留在 `PortalActivity` 与 `ControlViewModel`/`ControlApp`。

---

## 5. 协议与版本兼容

### 5.1 现状

- 两端共用 `android/protocol/.../ControlProtocol.kt`，GATT UUID、命令白名单、`state` 编码都在这里。
- `POST /capabilities` 返回 `{"version":1,...}`，这是**回环能力描述版本**，不是 BLE 协议版本；平板通过 BLE 看不到它。
- `status` 只有 `CONNECTED` / `CONTROL_OK` / `CONTROL_BUSY` / `CONTROL_RELEASED` / `CONTROL_REQUIRED` / `OK:<cmd>` / `ready`，没有版本信息。
- 因此当前无法在连接时判断对端 APK 的版本/协议；版本偏斜只能靠“命令行为异常”发现。

### 5.2 提案

1. 在 `ControlProtocol` 增加 `PROTOCOL_VERSION: Int`（从 1 开始），破坏性变更才 +1；新增可选命令/字段不 +1。
2. 新增只读 GATT 特征 `info`（例如 `7a1e0001-6f3c-4f9a-9d2b-2f6a1c000006`），内容 UTF-8、≤ 20 字节：
   `"<protocol>;<versionCode>"`，例如 `"2;21"`。旧平板会忽略未知特征；新平板在连接后读取，读不到就按协议 1 处理。
3. 平板在 UI 上显示“头显 0.7.0 / 协议 1，平板 0.7.1 / 协议 2”，并在协议不兼容时只允许配对/查看状态，禁用可能改变患者状态的控制命令（fail closed）。
4. 头显若需要知道平板协议，可增加 `hello:<n>` 命令（新头显接受，旧头显会拒绝；平板必须容忍被拒绝，不把它当控制失败）。这不是必须项，优先做 `info`。
5. 清单的 `release.protocolVersion` 与 `release.minProtocolVersion` 用于发布侧表达兼容窗口；客户端在下载前就能判断“这次更新会不会让我和另一端的旧版本不兼容”。

### 5.3 分阶段发布 / 灰度

两个设备的现实决定了“百分比灰度”没有意义。可行做法：

1. **通道固定**：stable 客户端只读 `releases/latest/download/update.json`；canary 构建/隐藏设置读一个固定 tag 的清单（例如 `.../releases/download/v0.8.0-rc1/update.json`）。canary 使用 prerelease，`latest` 不会指向它。
2. **手工试点**：RC 包先 `adb install -r` 到一台头显/一台平板，跑完 §7 的验收，再发 stable。
3. **发布顺序**：先发两端同协议的 stable；如果必须分开发，先发“向后兼容”的一端（通常是头显先接受旧平板命令），再发另一端。清单同时列出两个包，但客户端只关心自己那一条。
4. `rollout.percent` 只作为未来的可选门控（本地哈希分桶，不上报设备标识）；当前默认 100。

### 5.4 回滚与降级

- Android 拒绝 `versionCode` 更低的安装（`INSTALL_FAILED_VERSION_DOWNGRADE`）。普通应用通过 `PackageInstaller` 无法设置 `INSTALL_ALLOW_DOWNGRADE`（那是 `pm install -d`/系统权限的路径）。
- 因此**自动回滚不可用**。回滚 = 发一个更高 `versionCode` 的“前滚修复”包。
- 保留最近几个 release 的 APK，供 `adb install -r -d` 人工降级（仍可能因数据迁移失败；`-d` 只绕过版本检查，不解决 prefs/schema）。
- 数据迁移必须遵守：只增不删、未知 key 保留、读写都容忍缺失字段（`HeadsetSettings` 当前已经是这种风格：非法值回落默认）。
- 协议回滚同样只能前滚：旧平板 + 新头显必须在 `minProtocolVersion` 窗口内工作；超出窗口就明确提示，而不是静默降级行为。

---

## 6. 安全边界

| 威胁 | 缓解 |
| --- | --- |
| 中间人篡改清单 | HTTPS（系统 CA 校验，不自定义 `TrustManager`/`HostnameVerifier`）；清单只控制“有无更新/下载地址”，不能产生合法签名。 |
| 中间人替换 APK | 清单 `sha256` + 固定证书 SHA-256 + 系统安装时的同证书校验。三者中只有证书是信任根。 |
| 清单指向任意主机 | APK URL 必须 `https` 且主机在 allowlist（`github.com`、`*.githubusercontent.com`），路径必须以 `/fire-disposal/quiet-shore-vr/releases/download/` 开头；逐跳校验 302；校验失败即拒绝。 |
| 降级攻击（重放旧签名包） | `versionCode` 严格大于本机；记录本通道见过的最高 `versionCode`，拒绝更低值；`publishedAt` 只展示，不作为时钟依据。 |
| 仓库/CI 被攻破 | release environment 人工审批、保护 `v*` tag、secrets 只在 release job 可见、`permissions` 最小化；发布后核对 `latest` 指向与证书指纹。 |
| 本机恶意应用触发安装 | 更新入口只在应用 UI；不把 `update`/`install` 加进回环 `/command` 白名单，也不加进 BLE 命令；回环接口无认证，不能成为安装触发器。 |
| 安装器被第三方劫持 | 首选 `PackageInstaller`；FileProvider 回退时解析 handler 并要求平台签名/系统安装器。Android 11+ 还需 `<queries>` 声明，否则解析不到。 |
| 暂存 APK 被其他应用读取 | 只写应用私有目录（`cacheDir`/`filesDir`），不写外部存储；安装后立即删除；不使用 `MODE_WORLD_READABLE`。 |
| 调试通道读取更新状态 | 当前 release 是 debuggable；过渡期接受并记录，P1/P2 前产出 release variant，stable 通道拒绝 debuggable 包。 |
| 流量与隐私 | 清单/下载不携带设备标识；灰度分桶如需使用 `ANDROID_ID`，只在本地哈希，不上报。 |
| 存储耗尽 | 单包上限 + 下载前空间检查 + 失败清理；不让 `.part` 长期堆积。 |
| 明文流量 | 两个 manifest 现在都有 `usesCleartextTraffic="true"`（为了 `127.0.0.1`）。建议评估 network security config，把 cleartext 收紧到 loopback（Android 8.1 对 IP 字面量的 `domain-config` 是否生效需实测）；无论配置如何，更新客户端必须在代码层拒绝非 `https` URL。 |

速率与滥用：

- 清单检查：12 小时周期 + 抖动；手动检查 30 秒冷却；`403/429` 退避 24 小时。
- 下载：单次最多 3 次重试；同一 `versionCode` 校验失败后不再自动尝试。
- 不做设备注册、不上报安装结果；排障靠日志与 release 资产下载统计。

---

## 7. 分阶段计划

### P0：签名与清单（不写更新代码）

交付：

1. 生成并离线备份 release keystore；配置四个 secrets；release environment 加人工审批。
2. 修改 `.github/workflows/release.yml`：
   - 缺 keystore 时 fail（或强制 prerelease，且不生成 `update.json`）；
   - `apksigner` 显式 v1/v2/v3，`verify --print-certs` 后断言指纹；
   - 生成 `update.json`（版本号从 APK 读，hash/size 从文件算），随 release 上传；
   - 发布后核对 `releases/latest`。
3. 在 G2 上做一次“手工装测试 APK”的安装器 UX 验证（见 §9 未知项 1–3）。
4. 盘点存量设备证书，安排一次性卸载/重装。

退出标准：连续两个 tag 的 APK 证书相同；指纹公开在 release notes/README；`update.json` 可匿名下载且字段正确；存量设备已迁移到新证书。

### P1：平板更新器

交付：

1. `android/updater` 模块（清单、下载、校验、安装、状态）。
2. `control` manifest 补 `INTERNET`、`ACCESS_NETWORK_STATE`、`REQUEST_INSTALL_PACKAGES`、状态 receiver。
3. `ControlApp` 顶层更新横幅/对话框；启动/恢复检查；仅 Wi-Fi 下载；手动检查。
4. 日志与错误文案（不暴露底层异常堆栈给操作者）。

退出标准：§8 的平板侧验收全部通过；BLE 配对/接管无回归；安装取消/失败后可继续正常使用。

### P2：头显空闲更新器

交付：

1. `PortalService` 内的周期检查与下载；`BluetoothControl.sessionActive()`/`PortalService` 保存最近 `ControlState`。
2. 安装门槛：`session=false` + 60 秒宽限 + 无控制者 + 无遥测；通知与设置页入口。
3. `PortalActivity` 设置页版本行扩展；`AlertDialog` 展示版本/大小/说明。
4. 安装完成后 `MY_PACKAGE_REPLACED` → `BootReceiver` 恢复服务；确认平板重连流程。
5. PICO 安装器页面实测；若不通过，回退到 `adb` 运维并更新文档。

退出标准：训练中绝不弹安装器；训练结束后可完成一次真实更新；更新后服务/通知/BLE 恢复；平板能重新接管。

### P3：device-owner 静默模式（go/no-go）

只在以下条件全部满足时做，否则明确关闭：

- PICO G2 支持以 device owner 方式初始化（通常需要恢复出厂设置），且不会破坏厂家 HOME/预装应用策略；
- DPC 能获得 `INSTALL_PACKAGES` 或 OEM 提供托管安装 API；
- 现场能接受恢复出厂与重新配置；
- 有可回滚的运维流程。

在此之前，产品文案不得暗示“自动更新/无感更新”。

---

## 8. 验收测试

建议在平板上用本地测试清单（debug 构建的 `UPDATE_MANIFEST_URL` 可指向测试分支的 raw 文件；生产常量固定），头显用同一清单做小流量验证。

| # | 场景 | 步骤 | 预期 |
| --- | --- | --- | --- |
| 1 | 损坏 APK | 下载后翻转 1 字节，清单仍给原 hash | hash 不符；`.part`/文件删除；不创建 session；提示校验失败；同版本不再自动重试 |
| 2 | 错误签名 | 用临时密钥签一个同版本号 APK，清单填其 hash | 证书不符，安装前拒绝；若绕过预检，系统返回 `INSTALL_FAILED_UPDATE_INCOMPATIBLE`；不改动已装应用 |
| 3 | 下载中断 | 下载中关闭 Wi-Fi/飞行模式 | 连接中止、`.part` 删除、无崩溃；网络恢复后按退避重试；不弹安装器 |
| 4 | 用户取消安装 | 系统安装页点取消/返回 | `STATUS_FAILURE_ABORTED`；session 清理；应用可用；24 小时内不重复提示 |
| 5 | 训练中触发更新 | 进入 WebXR 会话，手动检查更新 | 可下载但不弹安装器；通知/设置页显示“训练结束后安装”；`session=false` + 宽限后才提示 |
| 6 | 平板接管中触发 | 平板 `CLAIM` 后头显检查更新 | 不弹安装器；释放/断开后才提示；BLE 不中断 |
| 7 | 版本偏斜 | 只更新平板，连接旧头显 | 显示协议/版本不兼容；危险命令禁用或按协议 1 工作；不崩溃；更新头显后恢复 |
| 8 | 降级清单 | 清单 `versionCode` 低于本机 | 忽略；不下载；可选记录“已阻止降级” |
| 9 | 清单 404/畸形 | 删除 `update.json` / 截断 JSON | 静默或设置页提示；不崩溃；按退避重试 |
| 10 | 存储不足 | 填满 `/data` 后触发下载 | 下载前拒绝或中途失败；`.part` 清理；提示空间不足 |
| 11 | 重启 | 下载中 `adb reboot`；安装成功后重启 | 重启后清理 `.part`，不自动安装；安装成功后服务/通知恢复，Firefox 不自动启动 |
| 12 | 未知来源关闭 | 撤销“安装未知应用”后点安装 | 跳转授权页；返回后重试；PICO 设置页缺失时不崩溃，给出文字指引 |
| 13 | 头显更新后重连 | 头显更新完成，平板仍在控制页 | 平板显示断链；重新扫描/连接/`CLAIM` 成功；场景与眼高保持（未卸载的情况下） |
| 14 | 一次性签名迁移 | 在旧 debug 签名设备上装新 release | 首次必须卸载重装；重装后后续版本可正常更新 |

常用命令：

```bash
# 版本与签名
adb shell dumpsys package com.quietshore.portal | grep -E "versionCode|signatures" -A2
apksigner verify --print-certs --min-sdk-version 26 quiet-shore-headset-v0.7.1.apk

# 安装器环境
adb shell am start -a android.settings.MANAGE_UNKNOWN_APP_SOURCES \
  -d package:com.quietshore.portal
adb shell pm list packages | grep -i install
adb shell cmd package resolve-activity --brief \
  -a android.intent.action.VIEW -t application/vnd.android.package-archive

# 日志
adb logcat -s QuietShorePortal PackageInstaller UpdateClient
```

---

## 9. 需要实机确认的未知项与风险

| # | 未知项 | 为什么重要 | 验证方法 |
| --- | --- | --- | --- |
| 1 | PICO 8.1 是否有“安装未知应用”按应用授权页 | 没有它就无法从应用内发起安装 | `adb shell am start -a android.settings.MANAGE_UNKNOWN_APP_SOURCES -d package:com.quietshore.portal`；观察是否落到设置页 |
| 2 | 系统安装器在 VR/虚拟屏中的呈现与操作 | 决定头显自更新是否可用 | 手工装一个测试 APK，记录面板位置、是否能用手柄确认、是否黑屏 |
| 3 | PICO 使用的安装器包与 session 支持 | 决定 `PackageInstaller` 还是 FileProvider 回退 | `pm list packages \| grep -i install`；`logcat -s PackageInstaller`；提交一次 session 观察状态回调 |
| 4 | 安装时 Firefox Reality/WebXR 的行为 | 可能崩溃、卡死或 26 秒退出 | 训练中启动安装器，观察 Firefox 与系统；确认必须先结束会话 |
| 5 | `MY_PACKAGE_REPLACED` 在 PICO 上是否送达 | 更新后服务能否自动恢复 | 更新后 `adb logcat -s QuietShorePortal`，检查通知与 BLE 广播 |
| 6 | 头显/平板可用存储与 cache 清理策略 | 头显 ~2 MB、平板 ~17 MB 的包要同时占暂存文件与 `PackageInstaller` session 空间 | `adb shell df -h /data`；下载后观察 `/data/app/vmdl*` |
| 7 | 设备时钟是否正确 | TLS 证书校验失败会表现为“网络错误” | `adb shell date`；离线设备尤其要查 |
| 8 | 诊所网络是否做 TLS 拦截/是否可达 GitHub | 拦截会导致更新永远失败 | 在设备浏览器打开 `https://github.com/fire-disposal/quiet-shore-vr/releases/latest`；看是否证书告警 |
| 9 | GitHub `latest` 与 CDN 重定向主机 | allowlist 过严会自断更新 | `curl -sIL .../latest/download/update.json` 记录每一跳主机；客户端日志记录最终 host |
| 10 | 存量设备当前证书 | 决定是否必须一次性卸载重装 | `adb shell dumpsys package ... \| grep signatures`，与 release 指纹比对 |
| 11 | 平板型号/Android 版本 | Android 13+ 需要 `POST_NOTIFICATIONS`；`<queries>` 行为不同 | `adb shell getprop ro.build.version.release`；`getprop ro.product.model` |
| 12 | API 27 上 `getPackageArchiveInfo` 对 v2/v3 签名的证书读取 | 预检可能拿不到 signer，导致误判 | 用 release APK 在 G2 上跑一次校验日志；必要时启用 v1 签名 |
| 13 | `PendingIntent` 在 8.1 上传递 `EXTRA_STATUS` | 回调收不到状态就无法收尾 | 提交 session 后看 receiver 日志 |
| 14 | device owner / OEM 托管安装能力 | P3 的唯一前提 | 查 PICO 企业文档；`adb shell dumpsys device_policy`；是否允许 `dpm set-device-owner` |
| 15 | 头显是否联网 | 不联网则自更新不可用 | `adb shell ping -c1 github.com` 或在应用里请求清单并看日志 |
| 16 | 更新后平板重连是否自动 | 影响操作者流程 | 头显更新后观察平板 UI；当前 `docs/control-plane.md` 只描述断链释放，未承诺自动重连 |

已知风险（需要写进发布说明/运维手册）：

- **keystore 丢失 = 永久失去更新能力**；只能卸载重装，且存量设备无法再收到签名一致的包。
- **当前 APK 是 debuggable**；自更新把网络内容送进一个可调试进程，信任边界比 release 构建弱。
- **每次更新都要用户确认**；诊所现场需要有人会操作头显/平板，不能假设无人值守。
- **GitHub 可用性/限流/仓库安全**是外部依赖；静态清单降低了限流风险，但没有消除。
- **两端版本偏斜**在手动更新模式下是常态；协议设计必须向后兼容至少一个版本。
- **头显安装器 UX 可能不可用**；若不通过，头显只能继续 `adb` 更新，平板仍可自更新。
- **无法自动回滚**；只能前滚修复，数据迁移必须可容忍旧版本。
- **更新会中断 BLE 会话**；安装前必须确认训练已结束，安装后需要重新接管。

---

## 10. 明确不做

- 不做静默/无感安装；不申请系统签名或 root。
- 不引入 Play In-App Updates、Firebase App Distribution、A/B split APK。
- 不自建更新服务器；GitHub Releases 足够。
- 不在 BLE 命令或回环 `/command` 中加入任何安装/更新触发。
- 不修改厂家 HOME、不卸载/改写厂家应用、不依赖 Play Services。
- 不在训练进行中弹出任何阻塞式更新 UI。

---

## 11. 参考文件

- `.github/workflows/release.yml`：tag 触发、`assembleDebug`、可选 `apksigner` 重签、产物命名与 `SHA256SUMS.txt`。
- `.github/workflows/build.yml`：分支构建与 `quiet-shore-apk` 工件（未签名/调试签名路径）。
- `android/headset/build.gradle.kts`、`android/control/build.gradle.kts`：`applicationId`、`minSdk`/`targetSdk`、`versionCode`/`versionName`、依赖面。
- `android/headset/src/main/AndroidManifest.xml`、`android/control/src/main/AndroidManifest.xml`：现有权限、`BootReceiver`/`MY_PACKAGE_REPLACED`、缺失的 `INTERNET`/`REQUEST_INSTALL_PACKAGES`。
- `android/headset/src/main/kotlin/com/quietshore/portal/PortalService.kt`：前台服务、回环 HTTP、`POST /state`、通知。
- `android/headset/src/main/kotlin/com/quietshore/portal/BluetoothControl.kt`：`lastState`、`controllerAddress()`、GATT 特征。
- `android/headset/src/main/kotlin/com/quietshore/portal/PortalActivity.kt`：四页控制台、设置页“关于”卡片、`versionName()`。
- `android/protocol/src/main/kotlin/com/quietshore/control/protocol/ControlProtocol.kt`：命令白名单、`state` 编码、`CAPABILITIES`。
- `docs/pico-g2.md`：Android 8.1、无 root、Firefox Reality 10、XR 退出约 26 秒。
- `docs/control-plane.md`：BLE 接管、`/capabilities`、`/state`、断链释放。
- `docs/distribution.md`：分发形态、签名现状、CI/CD 与安全边界。

本文件只定义方案与验收；P0–P3 涉及的 workflow/代码改动应另开任务实施。
