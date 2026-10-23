#!/usr/bin/env bash
# Linux / WSL 上的真实验收：逻辑层（tools/verify.mjs）+ 宿主加载。
#
# 这个脚本存在的原因是五个已实测的环境坑（见 docs/preflight.md「环境坑」）：
#   1) /tmp 在 wsl.exe 两次调用之间会丢 —— 所以根目录放 $HOME 下，不碰 /tmp
#   2) WSL 的 PATH 里有 /mnt/c/.../npm 的 Windows v1 —— 所以一律用绝对路径调 Linux 版二进制
#   3) Debian 13.5 minimal 没有 xz —— 所以 Node 用 .tar.gz
#   4) `opencode run` 会读 stdin —— 所以每次调用都 </dev/null，否则管道里剩下的脚本会被当成用户输入
#   5) `opencode --version` 也会在 $HOME 下建目录 —— 所以 HOME/XDG 必须在第一次调用前就切到临时目录
#
# 用法：
#   bash tools/linux-verify.sh                 # 逻辑层 + 宿主加载
#   KEEP=1 bash tools/linux-verify.sh          # 保留临时根目录（排查用）
#   OPENCODE_VERSION=2.0.32 NODE_VERSION=22 …  # 覆盖版本
# 全程不需要 sudo、不写真实全局配置。
set -euo pipefail

NODE_VERSION="${NODE_VERSION:-22.23.3}"
OPENCODE_VERSION="${OPENCODE_VERSION:-2.0.32}"
ROOT="${SKILL_MGMT_LINUX_ROOT:-$HOME/.skmgmt-verify}"
KEEP="${KEEP:-0}"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

say() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
die() { printf '\033[31merror: %s\033[0m\n' "$*" >&2; exit 1; }

command -v curl >/dev/null || die "需要 curl"
command -v tar  >/dev/null || die "需要 tar"
command -v gzip >/dev/null || die "需要 gzip"

case "$(uname -m)" in
  x86_64)  ARCH=x64 ;;
  aarch64) ARCH=arm64 ;;
  *) die "未覆盖的架构：$(uname -m)" ;;
esac

# 真实家目录快照：跑完要证明没写进去
REAL_CFG="$HOME/.config/opencode"
REAL_DATA="$HOME/.local/share/opencode"
REAL_SNAP="$(ls -d "$REAL_CFG" "$REAL_DATA" 2>/dev/null || true)"

mkdir -p "$ROOT"
cleanup() {
  if [ "$KEEP" = "1" ]; then
    printf '\n保留临时根目录：%s\n' "$ROOT"
    return
  fi
  rm -rf "$ROOT"
}
trap cleanup EXIT

# 隔离必须从**第一次调用 opencode 之前**开始：`opencode --version` 也会在 $HOME 下
# 初始化 ~/.config/opencode 与 ~/.local/share/opencode。之前在第 4 步才切 HOME，
# 于是在干净的机器上第 5 步必然报「真实配置目录被改动了」（实测：目录就是被 --version 建的）。
# REAL_CFG / REAL_DATA 的快照已在上面按真实 HOME 拍好，这里之后一律用临时 HOME。
export HOME="$ROOT/home"
export XDG_CONFIG_HOME="$HOME/.config"
export XDG_DATA_HOME="$HOME/.local/share"
export XDG_CACHE_HOME="$HOME/.cache"
export XDG_STATE_HOME="$HOME/.local/state"
mkdir -p "$XDG_CONFIG_HOME/opencode/plugins"

say "0) 环境"
printf 'repo    %s\n' "$REPO"
printf 'root    %s\n' "$ROOT"
printf 'arch    %s / %s\n' "$(uname -s)" "$ARCH"
printf 'node    %s   opencode %s\n' "$NODE_VERSION" "$OPENCODE_VERSION"

say "1) Node $NODE_VERSION（.tar.gz，避开缺失的 xz）"
mkdir -p "$ROOT/node" "$ROOT/dl"
NODE_TGZ="node-v${NODE_VERSION}-linux-${ARCH}.tar.gz"
# 镜像优先（nodejs.org 在部分网络下会间歇 404 / 断流），官方站作后备
SHA_MIRROR="https://npmmirror.com/mirrors/node/v${NODE_VERSION}/SHASUMS256.txt"
SHA_OFFICIAL="https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt"
curl -fsSL --retry 3 --retry-connrefused -o "$ROOT/dl/SHA256.txt" "$SHA_MIRROR" \
  || curl -fsSL --retry 3 --retry-connrefused -o "$ROOT/dl/SHA256.txt" "$SHA_OFFICIAL" \
  || die "取不到 Node 校验清单"
curl -fsSL --retry 3 --retry-connrefused -o "$ROOT/dl/$NODE_TGZ" \
    "https://npmmirror.com/mirrors/node/v${NODE_VERSION}/${NODE_TGZ}" \
  || curl -fsSL --retry 3 --retry-connrefused -o "$ROOT/dl/$NODE_TGZ" \
    "https://nodejs.org/dist/v${NODE_VERSION}/${NODE_TGZ}" \
  || die "下载 $NODE_TGZ 失败"
EXPECT="$(grep " $NODE_TGZ\$" "$ROOT/dl/SHA256.txt" | awk '{print $1}')"
[ -n "$EXPECT" ] || die "校验清单里没有 $NODE_TGZ"
ACTUAL="$(sha256sum "$ROOT/dl/$NODE_TGZ" | awk '{print $1}')"
[ "$EXPECT" = "$ACTUAL" ] || die "Node 校验失败（expected $EXPECT, actual $ACTUAL）"
tar -xzf "$ROOT/dl/$NODE_TGZ" -C "$ROOT/node" --strip-components=1
export PATH="$ROOT/node/bin:$PATH"
printf 'node %s / npm %s\n' "$(node -v)" "$(npm -v)"

say "2) opencode $OPENCODE_VERSION（linux-${ARCH}）"
npm_config_cache="$ROOT/npmcache" npm install --prefix "$ROOT/oc" --no-audit --no-fund \
  "@opencode/cli@${OPENCODE_VERSION}" >/dev/null
OC="$ROOT/oc/node_modules/.bin/opencode"
[ -x "$OC" ] || die "找不到 $OC"
"$OC" --version

say "3) 逻辑层：node tools/verify.mjs"
rm -rf "$ROOT/repo"
cp -a "$REPO" "$ROOT/repo"
rm -rf "$ROOT/repo/.git"
( cd "$ROOT/repo" && node tools/verify.mjs 2>&1 | tail -3 )

say "4) 宿主加载（临时 HOME + XDG，全在 $ROOT 下）"
cp "$ROOT/repo/src/skill_management.js" "$XDG_CONFIG_HOME/opencode/plugins/"
"$OC" debug paths | sed 's/^/  /'

# 坑 1：不带 --builtin 时本地目录插件不出现（会显示 No plugins found）
# 另外：在全新 HOME 里第一次 `plugin list` 可能返回空（宿主初始化未完成），重试几次再判断。
LIST=""
for attempt in 1 2 3 4; do
  LIST="$("$OC" plugin list --builtin </dev/null)"
  printf '%s\n' "$LIST" | grep -q "^skill_management" && break
  [ "$attempt" = 4 ] || sleep 2
done
printf '%s\n' "$LIST" | grep -q "^skill_management" \
  || { printf '%s\n' "$LIST"; die "plugin list --builtin 里没有 skill_management"; }
printf '%s\n' "$LIST" | grep "^skill_management" | sed 's/^/  /'

say "5) 没有写到真实家目录"
AFTER_SNAP="$(ls -d "$REAL_CFG" "$REAL_DATA" 2>/dev/null || true)"
if [ "$AFTER_SNAP" = "$REAL_SNAP" ]; then
  printf '  ok：%s 与跑前一致\n' "${REAL_CFG} / ${REAL_DATA}"
else
  printf '  跑前：%s\n  跑后：%s\n' "${REAL_SNAP:-（都不存在）}" "${AFTER_SNAP:-（都不存在）}"
  die "真实配置目录被改动了"
fi

printf '\n\033[32mLinux 验收通过\033[0m\n'
