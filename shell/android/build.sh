#!/usr/bin/env bash
#
# 静岸 / Quiet Shore VR 的 APK 构建脚本。
#
# 不用 Gradle：只有 6 个 Java 文件，javac + d8 + aapt2 + zipalign + apksigner 足够，
# CI 与本机走同一条路径。
#
# 每次构建都会把 dist/standalone.html 重新复制到 shell/android/assets/index.html，
# 保证 APK 里的页面永远等于当前 Web 构建产物。
#
# 环境变量：
#   ANDROID_SDK_ROOT / ANDROID_HOME   Android SDK 根目录（默认探测 ~/Android/Sdk 等）
#   VERSION_CODE                      整数，默认 1
#   VERSION_NAME                      版本字符串，默认取 package.json 的 version
#   ANDROID_KEYSTORE                  签名 keystore 路径（优先）
#   ANDROID_KEYSTORE_BASE64           keystore 的 base64（CI 用；ANDROID_KEYSTORE 未给时使用）
#   ANDROID_KEYSTORE_PASSWORD         keystore 口令
#   ANDROID_KEY_ALIAS                 密钥别名
#   ANDROID_KEY_PASSWORD              密钥口令（缺省用 keystore 口令）
#
# 未提供 keystore 时，在 shell/android/build/debug.keystore 生成一次性 debug keystore，
# 产物仍可安装（仅用于侧载）。keystore 永不提交（见 .gitignore）。
#
# 输出：shell/android/build/quiet-shore.apk

set -euo pipefail

SHELL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SHELL_DIR/../.." && pwd)"

BUILD_DIR="$SHELL_DIR/build"
WORK_DIR="$BUILD_DIR/work"
ASSETS_DIR="$SHELL_DIR/assets"
ASSET_FILE="$ASSETS_DIR/index.html"
MANIFEST="$SHELL_DIR/AndroidManifest.xml"
SRC_DIR="$SHELL_DIR/src"
RES_DIR="$SHELL_DIR/res"
STANDALONE_FILE="$REPO_ROOT/dist/standalone.html"
APK_OUT="$BUILD_DIR/quiet-shore.apk"
DEBUG_KEYSTORE="$BUILD_DIR/debug.keystore"

# minSdk/targetSdk 以 AndroidManifest.xml 为准（26 / 27）；这里只给 d8 的 min-api。
MIN_SDK=26

log() {
  printf '[quiet-shore] %s\n' "$*"
}

die() {
  printf '[quiet-shore] ERROR: %s\n' "$*" >&2
  exit 1
}

# --- 工具链探测 ------------------------------------------------------------

resolve_sdk_root() {
  local candidate
  for candidate in \
    "${ANDROID_SDK_ROOT:-}" \
    "${ANDROID_HOME:-}" \
    "$HOME/Android/Sdk" \
    "$HOME/android-sdk" \
    /opt/android-sdk \
    /usr/lib/android-sdk; do
    if [ -n "$candidate" ] && [ -d "$candidate" ]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  return 1
}

pick_android_jar() {
  local preferred="$SDK_ROOT/platforms/android-33/android.jar"
  local candidate=""
  if [ -f "$preferred" ]; then
    printf '%s\n' "$preferred"
    return 0
  fi
  candidate="$(find "$SDK_ROOT/platforms" -maxdepth 2 -name android.jar 2>/dev/null | sort -V | tail -n 1)"
  if [ -n "$candidate" ]; then
    printf '%s\n' "$candidate"
    return 0
  fi
  return 1
}

pick_build_tools() {
  local candidate
  candidate="$(find "$SDK_ROOT/build-tools" -maxdepth 1 -mindepth 1 -type d 2>/dev/null | sort -V | tail -n 1)"
  if [ -n "$candidate" ] && [ -x "$candidate/aapt2" ]; then
    printf '%s\n' "$candidate"
    return 0
  fi
  return 1
}

SDK_ROOT="$(resolve_sdk_root)" || die "找不到 Android SDK；请设置 ANDROID_SDK_ROOT 或 ANDROID_HOME"
ANDROID_JAR="$(pick_android_jar)" || die "$SDK_ROOT 下没有 platforms/android-*/android.jar（需要 platforms;android-33）"
BUILD_TOOLS="$(pick_build_tools)" || die "$SDK_ROOT 下没有可用的 build-tools（需要 build-tools;33.0.2）"

for tool in javac keytool zip unzip; do
  command -v "$tool" >/dev/null 2>&1 || die "缺少 $tool"
done
for tool in aapt2 d8 zipalign apksigner; do
  [ -x "$BUILD_TOOLS/$tool" ] || die "$BUILD_TOOLS 下缺少 $tool"
done

log "SDK:         $SDK_ROOT"
log "android.jar: $ANDROID_JAR"
log "build-tools: $BUILD_TOOLS"

# --- 版本 ------------------------------------------------------------------

default_version_name() {
  local name=""
  if [ -f "$REPO_ROOT/package.json" ]; then
    name="$(sed -n 's/^[[:space:]]*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$REPO_ROOT/package.json" | head -n 1)"
  fi
  if [ -z "$name" ]; then
    name="0.1.0"
  fi
  printf '%s\n' "$name"
}

VERSION_CODE="${VERSION_CODE:-1}"
VERSION_NAME="${VERSION_NAME:-$(default_version_name)}"

case "$VERSION_CODE" in
  '' | *[!0-9]*) die "VERSION_CODE 必须是正整数：'$VERSION_CODE'" ;;
esac
case "$VERSION_NAME" in
  '' | *[!0-9A-Za-z._+-]*) die "VERSION_NAME 只允许 [0-9A-Za-z._+-]：'$VERSION_NAME'" ;;
esac

# --- 静态资产（每次构建都刷新） --------------------------------------------

[ -f "$STANDALONE_FILE" ] || die "找不到 $STANDALONE_FILE；先运行 npm run standalone"
mkdir -p "$ASSETS_DIR"
cp -f "$STANDALONE_FILE" "$ASSET_FILE"
[ -s "$ASSET_FILE" ] || die "复制后的 $ASSET_FILE 为空"

log "asset:       $ASSET_FILE ($(wc -c < "$ASSET_FILE") bytes)"
log "version:     $VERSION_NAME ($VERSION_CODE)"

# --- 工作目录 --------------------------------------------------------------

mkdir -p "$BUILD_DIR"
rm -rf "$WORK_DIR"
mkdir -p "$WORK_DIR/classes" "$WORK_DIR/dex"

# 把版本号写进临时 manifest：aapt2 各版本对 --version-code 的注入语义不一致，
# 直接替换属性最稳，也不会改到仓库里的源文件。
sed -E \
  -e "s/android:versionCode=\"[^\"]*\"/android:versionCode=\"$VERSION_CODE\"/" \
  -e "s/android:versionName=\"[^\"]*\"/android:versionName=\"$VERSION_NAME\"/" \
  "$MANIFEST" > "$WORK_DIR/AndroidManifest.xml"

grep -q "android:versionCode=\"$VERSION_CODE\"" "$WORK_DIR/AndroidManifest.xml" \
  || die "临时 manifest 里没有 android:versionCode=\"$VERSION_CODE\""
grep -q "android:versionName=\"$VERSION_NAME\"" "$WORK_DIR/AndroidManifest.xml" \
  || die "临时 manifest 里没有 android:versionName=\"$VERSION_NAME\""

# --- javac 1.8 -------------------------------------------------------------

find "$SRC_DIR" -name '*.java' | sort > "$WORK_DIR/sources.txt"
[ -s "$WORK_DIR/sources.txt" ] || die "$SRC_DIR 下没有 Java 源文件"

javac -source 1.8 -target 1.8 -Xlint:-options \
  -encoding UTF-8 \
  -bootclasspath "$ANDROID_JAR" \
  -d "$WORK_DIR/classes" \
  @"$WORK_DIR/sources.txt"

log "javac:       $(wc -l < "$WORK_DIR/sources.txt") 个源文件"

# --- d8 --------------------------------------------------------------------

find "$WORK_DIR/classes" -name '*.class' | sort > "$WORK_DIR/classes.txt"
[ -s "$WORK_DIR/classes.txt" ] || die "javac 没有产出 class 文件"

"$BUILD_TOOLS/d8" \
  --release \
  --min-api "$MIN_SDK" \
  --lib "$ANDROID_JAR" \
  --output "$WORK_DIR/dex" \
  @"$WORK_DIR/classes.txt"

# --- aapt2 link ------------------------------------------------------------

AAPT_RES_ARGS=()
if [ -d "$RES_DIR" ]; then
  "$BUILD_TOOLS/aapt2" compile --dir "$RES_DIR" -o "$WORK_DIR/res.zip"
  AAPT_RES_ARGS=("$WORK_DIR/res.zip")
  log "aapt2 res:   $(du -h "$WORK_DIR/res.zip" | cut -f1)"
fi

"$BUILD_TOOLS/aapt2" link \
  -o "$WORK_DIR/unsigned.apk" \
  -I "$ANDROID_JAR" \
  --manifest "$WORK_DIR/AndroidManifest.xml" \
  -A "$ASSETS_DIR" \
  "${AAPT_RES_ARGS[@]}"

# aapt2 只负责资源与 assets，dex 要自己塞进 APK。
( cd "$WORK_DIR/dex" && zip -q -X "$WORK_DIR/unsigned.apk" classes.dex )
APK_ENTRIES="$(unzip -Z1 "$WORK_DIR/unsigned.apk")"
printf '%s\n' "$APK_ENTRIES" | grep -qx 'classes.dex' || die "classes.dex 没有进入 APK"
printf '%s\n' "$APK_ENTRIES" | grep -qx 'assets/index.html' || die "assets/index.html 没有进入 APK"

# --- zipalign --------------------------------------------------------------

"$BUILD_TOOLS/zipalign" -f 4 "$WORK_DIR/unsigned.apk" "$WORK_DIR/aligned.apk"

# --- 签名 ------------------------------------------------------------------

KS_FILE=""
KS_PASSWORD="${ANDROID_KEYSTORE_PASSWORD:-}"
KEY_ALIAS="${ANDROID_KEY_ALIAS:-}"
KEY_PASSWORD="${ANDROID_KEY_PASSWORD:-}"

if [ -n "${ANDROID_KEYSTORE:-}" ]; then
  [ -f "$ANDROID_KEYSTORE" ] || die "ANDROID_KEYSTORE 指向的文件不存在：$ANDROID_KEYSTORE"
  KS_FILE="$ANDROID_KEYSTORE"
  SIGNING_MODE="release"
elif [ -n "${ANDROID_KEYSTORE_BASE64:-}" ]; then
  KS_FILE="$BUILD_DIR/upload.keystore"
  printf '%s' "$ANDROID_KEYSTORE_BASE64" | base64 -d > "$KS_FILE" \
    || die "ANDROID_KEYSTORE_BASE64 解码失败"
  SIGNING_MODE="release"
else
  KS_PASSWORD="${KS_PASSWORD:-quietshore}"
  KEY_ALIAS="${KEY_ALIAS:-quietshore-debug}"
  KEY_PASSWORD="${KEY_PASSWORD:-$KS_PASSWORD}"
  if [ ! -f "$DEBUG_KEYSTORE" ]; then
    log "生成一次性 debug keystore：$DEBUG_KEYSTORE"
    keytool -genkeypair -noprompt \
      -keystore "$DEBUG_KEYSTORE" \
      -storetype PKCS12 \
      -alias "$KEY_ALIAS" \
      -keyalg RSA -keysize 2048 -validity 10000 \
      -storepass "$KS_PASSWORD" \
      -keypass "$KEY_PASSWORD" \
      -dname "CN=Quiet Shore Debug" >/dev/null
  fi
  KS_FILE="$DEBUG_KEYSTORE"
  SIGNING_MODE="debug（一次性 keystore，仅侧载）"
fi

[ -n "$KEY_ALIAS" ] || die "缺少 ANDROID_KEY_ALIAS"
[ -n "$KS_PASSWORD" ] || die "缺少 ANDROID_KEYSTORE_PASSWORD"

SIGN_ARGS=(--ks "$KS_FILE" --ks-key-alias "$KEY_ALIAS" --ks-pass "pass:$KS_PASSWORD")
if [ -n "$KEY_PASSWORD" ]; then
  SIGN_ARGS+=(--key-pass "pass:$KEY_PASSWORD")
fi

rm -f "$APK_OUT"
"$BUILD_TOOLS/apksigner" sign \
  "${SIGN_ARGS[@]}" \
  --out "$APK_OUT" \
  "$WORK_DIR/aligned.apk"

"$BUILD_TOOLS/apksigner" verify --print-certs "$APK_OUT" >/dev/null \
  || die "apksigner verify 失败"

# --- 汇总 ------------------------------------------------------------------

SIZE_BYTES="$(wc -c < "$APK_OUT")"
if command -v sha256sum >/dev/null 2>&1; then
  CHECKSUM="$(sha256sum "$APK_OUT" | cut -d' ' -f1)"
else
  CHECKSUM="$(shasum -a 256 "$APK_OUT" | cut -d' ' -f1)"
fi

log "signing:     $SIGNING_MODE"
log "version:     $VERSION_NAME ($VERSION_CODE)"
log "size:        $SIZE_BYTES bytes"
log "sha256:      $CHECKSUM"
log "apk:         $APK_OUT"
