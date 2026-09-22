#!/usr/bin/env bash
# Sisyphus · macOS 构建脚本（对照 build/win-build.ps1）
#
# 用法：
#   bash build/mac-build.sh
#     --skip-tests          跳过测试闸（仅调试用）
#     --targets "dmg zip"   选择产物目标（默认 "dmg zip"）
#     --dir                 只产出未打包的 .app，不做 dmg/zip（本地自测最快）
#     --arch arm64          只构建指定架构；默认按 package.json 的 mac.target（arm64 + x64）
#
# 说明：
#   * 测试闸与 Windows 脚本一致：check-syntax → check-links → selftest → run-all。
#   * 代码签名是可选的：导出 CSC_LINK + CSC_KEY_PASSWORD（文件形态证书），
#     或让 electron-builder 在钥匙串里自动找身份，即可签出。两者都没有时
#     本脚本会补一次 ad-hoc 签名——Apple Silicon 上未签名的 .app 根本无法启动，
#     这一步不是可选项，否则「clone → 构建 → 双击」直接是坏的。
#   * 公证（notarization）需要 Apple Developer 账号，不在这里做；口径见
#     docs/release.md 的「代码签名」一节。
#   * 产物落在 release/ 下（mac-arm64/ 或 mac/），与 Windows 产物同一目录，
#     两者文件名不重叠，互不干扰。

set -euo pipefail

SKIP_TESTS=0
TARGETS="dmg zip"
DIR_ONLY=0
ARCH=""

while [ $# -gt 0 ]; do
  case "$1" in
    --skip-tests) SKIP_TESTS=1; shift ;;
    --targets) TARGETS="${2:-}"; shift 2 ;;
    --dir) DIR_ONLY=1; shift ;;
    --arch) ARCH="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,25p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "未知参数：${1}（用 --help 查看用法）" >&2; exit 2 ;;
  esac
done

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

if [ "$(uname -s)" != "Darwin" ]; then
  echo "本脚本只能在 macOS 上运行（当前：$(uname -s)）" >&2
  exit 2
fi

echo "== Sisyphus macOS 构建 =="
echo "repo: $REPO"

if [ "$SKIP_TESTS" -eq 0 ]; then
  echo "-- 闸：node tools/check-syntax.js";  node tools/check-syntax.js
  echo "-- 闸：node tools/check-links.js";   node tools/check-links.js
  echo "-- 闸：node tools/selftest.js";      node tools/selftest.js
  echo "-- 闸：node tests/run-all.js";       node tests/run-all.js
fi

if [ ! -d node_modules/electron-builder ]; then
  echo "-- 安装构建依赖（registry 走 .npmrc 里的镜像）"
  ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm install --no-audit --no-fund
fi

ARGS=(--mac)
if [ "$DIR_ONLY" -eq 1 ]; then
  ARGS+=(--dir)
else
  # shellcheck disable=SC2206  # 目标是空格分隔的短列表，按词拆分是预期行为
  ARGS+=($TARGETS)
fi
if [ -n "$ARCH" ]; then ARGS+=(--"$ARCH"); fi

echo "-- electron-builder ${ARGS[*]}"
npx --no-install electron-builder "${ARGS[@]}"

# ---------- 定位本次构建的 .app ----------
APP=""
for d in release/mac-arm64 release/mac release/mac-universal; do
  if [ -d "$d" ]; then
    APP="$(find "$d" -maxdepth 1 -name '*.app' -print -quit)"
    if [ -n "$APP" ]; then break; fi
  fi
done
if [ -z "$APP" ]; then
  echo "没有在 release/ 下找到 .app，构建可能失败了" >&2
  exit 1
fi
echo "-- 应用包：$APP"

# ---------- 签名：没有证书就补 ad-hoc ----------
# Apple Silicon 要求二进制必须有签名，ad-hoc 也认；否则双击时系统直接判定为损坏。
signing="disabled (no CSC_LINK / CSC_NAME; artifacts will be ad-hoc signed)"
if [ -n "${CSC_LINK:-}" ] || [ -n "${CSC_NAME:-}" ]; then
  signing="enabled (CSC_LINK/CSC_NAME present)"
fi
echo "-- 代码签名：$signing"

if ! codesign --verify "$APP" >/dev/null 2>&1; then
  echo "-- 未签名或签名已失效，补一次 ad-hoc 签名（否则 Apple Silicon 上无法启动）"
  codesign --force --deep --sign - "$APP"
fi

sig_text="未签名"
if codesign --verify "$APP" >/dev/null 2>&1; then
  sig_text="$(codesign -dv "$APP" 2>&1 | grep -E '^(Authority|Signature)=' | head -2 | paste -sd' ' - || true)"
  sig_text="${sig_text:-已签名}"
fi

if [ -n "${CSC_LINK:-}" ] && ! codesign -dv "$APP" 2>&1 | grep -q '^Authority='; then
  echo "CSC_LINK 已设置，但 $APP 没有有效证书签名" >&2
  exit 1
fi

# ---------- 打包内容与源码的一致性 ----------
# 与 Windows 一致：把本次构建的 app.asar 落到 release/current-build/，
# 交给 tools/check-asar-runtime.js 核对（抓「新文件没被打进包 / 产物过期」）。
CURR="release/current-build"
mkdir -p "$CURR"
cp "$APP/Contents/Resources/app.asar" "$CURR/app.asar"
for f in builder-debug.yml builder-effective-config.yaml; do
  [ -f "release/$f" ] && cp "release/$f" "$CURR/" || true
done
node tools/check-asar-runtime.js "$CURR/app.asar"

# ---------- 产物清单 ----------
echo "-- 产物"
shopt -s nullglob
artifacts=(release/*.dmg release/*.zip)

printf '  %s\n' "$APP"
printf '    签名：%s\n' "$sig_text"

if [ ${#artifacts[@]} -eq 0 ]; then
  # bash 3.2（macOS 自带）在 set -u 下对空数组做 "${arr[@]}" 会报 unbound，
  # 所以把遍历放进 else 分支，不靠空数组兜底
  if [ "$DIR_ONLY" -ne 1 ]; then
    echo "release/ 下没有 dmg/zip 产物" >&2
    exit 1
  fi
  echo "  （--dir 模式：只产出 .app，未生成 dmg/zip）"
else
  for f in "${artifacts[@]}"; do
    size_mb="$(echo "scale=1; $(stat -f%z "$f") / 1048576" | bc)"
    hash="$(shasum -a 256 "$f" | awk '{print $1}')"
    printf '  %s  %s MB  sha256:%s\n' "$(basename "$f")" "$size_mb" "$hash"
  done
fi

echo "BUILD OK"
