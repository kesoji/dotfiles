#!/bin/bash
# 新しい Mac のセットアップの入口。必要なスクリプトを順に流す。
# 各ステップの前に Y/n で聞く（n で飛ばす）。何度流してもよい。
#
#   ~/dotfiles/setup.sh
set -u

cd "$(dirname "$0")" || exit 1
DOTFILES="$(pwd)"

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BOLD='\033[1m'
NC='\033[0m'

if [ "$(uname)" != "Darwin" ]; then
	echo -e "${RED}macOS 用です（Windows は dotfilesLink.bat）${NC}" >&2
	exit 1
fi
if [ "$DOTFILES" != "$HOME/dotfiles" ]; then
	# dotfilesLink.sh・karabinerlink.sh・setup_mac.sh は ~/dotfiles を指すので、ここ以外だとリンク切れになる
	echo -e "${YELLOW}注意: dotfilesLink.sh 等は ~/dotfiles を前提にしている（いま: ${DOTFILES}）${NC}"
	read -r -p "$(echo -e "${YELLOW}このまま続けますか? (y/N): ${NC}")" go || go=n
	[[ $go =~ ^[Yy]$ ]] || { echo "止めました。~/dotfiles に clone してから流してください"; exit 1; }
fi

# Homebrew のインストーラーは PATH を書き換えないので、入れた直後のシェルでも brew を使えるようにする
brew_env() {
	local b
	for b in /opt/homebrew/bin/brew /usr/local/bin/brew; do
		[ -x "$b" ] && eval "$("$b" shellenv)" && break
	done
	return 0
}

done_steps=()
skipped_steps=()
failed_steps=()

# step <説明> <コマンド...>
step() {
	local desc="$1"; shift
	echo -e "\n${BOLD}${BLUE}== $desc${NC}"
	echo -e "   $*"
	# Ctrl-D（EOF）は「いいえ」
	read -r -p "$(echo -e "${YELLOW}実行しますか? (Y/n): ${NC}")" choice || choice=n
	if [[ -n $choice && ! $choice =~ ^[Yy]$ ]]; then
		skipped_steps+=("$desc")
		echo -e "${YELLOW}スキップしました${NC}"
		return 0
	fi
	if "$@"; then
		done_steps+=("$desc")
		echo -e "${GREEN}✓ $desc${NC}"
	else
		failed_steps+=("$desc")
		echo -e "${RED}✗ $desc が失敗しました${NC}"
		read -r -p "$(echo -e "${YELLOW}続けますか? (Y/n): ${NC}")" cont || cont=n
		[[ -n $cont && ! $cont =~ ^[Yy]$ ]] && summary && exit 1
	fi
}

# Xcode 本体は Brewfile の mas "Xcode" で入る（App Store にサインインしておく）。ここでは初期設定だけ
# brew bundle で入らなかったとき（mas は root が要ることがある）は、ここで sudo mas install を試す
xcode_init() {
	local app=/Applications/Xcode.app
	if [ ! -d "$app" ] && command -v mas >/dev/null 2>&1; then
		echo "Xcode が入っていないので App Store から入れる（sudo mas install 497799835。時間がかかる）"
		sudo mas install 497799835 || true
	fi
	if [ ! -d "$app" ]; then
		echo -e "${RED}Xcode が入っていない。App Store にサインインして sudo mas install 497799835 を流してから、もう一度${NC}" >&2
		return 1
	fi
	sudo xcode-select -s "$app/Contents/Developer" &&
		sudo xcodebuild -license accept &&
		sudo xcodebuild -runFirstLaunch
}

karabiner_link() {
	mkdir -p "$HOME/.config/karabiner" && sh ./karabinerlink.sh
}

summary() {
	echo -e "\n${BOLD}${BLUE}===== 結果 =====${NC}"
	for s in "${done_steps[@]+"${done_steps[@]}"}"; do echo -e "${GREEN}✓${NC} $s"; done
	for s in "${skipped_steps[@]+"${skipped_steps[@]}"}"; do echo -e "${YELLOW}-${NC} ${s}（スキップ）"; done
	for s in "${failed_steps[@]+"${failed_steps[@]}"}"; do echo -e "${RED}✗${NC} ${s}（失敗）"; done
	echo -e "\n${BOLD}手で行うこと${NC}"
	echo "  - Docker のインストール"
	echo "  - setup_mac.sh で家のモニターの仕組みを入れたなら、表示された sudoers の行を sudo visudo -f /etc/sudoers.d/displaysleep-home で貼る"
	echo "  - 新しいシェルを開き直す（zprofile の PATH 等を読み込むため）"
}

echo -e "${BOLD}${BLUE}===== Setup ($DOTFILES) =====${NC}"

# Brewfile の mas（Xcode など）は App Store にサインインしていないと入らない。mas からはサインインできない
echo -e "\n${BOLD}先に App Store アプリを開いてサインインしてください。${NC}"
read -r -p "$(echo -e "${YELLOW}サインインしたら Enter: ${NC}")" _ || true

brew_env
step "Homebrew とアプリ（setup_mac_app.sh・brew bundle）" bash ./setup_mac_app.sh
brew_env
step "Xcode の初期設定（xcode-select・ライセンス同意・初回起動の準備）" xcode_init
step "版と sha256 を固定したツール（homebrew/install-pinned.sh）" bash ./homebrew/install-pinned.sh
step "設定ファイルのリンク（dotfilesLink.sh）" sh ./dotfilesLink.sh
step "Karabiner の設定のリンク（karabinerlink.sh）" karabiner_link
step "macOS の設定（setup_mac.sh・項目ごとに聞く）" bash ./setup_mac.sh

summary
