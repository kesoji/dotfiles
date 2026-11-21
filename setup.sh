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
	echo -e "${YELLOW}注意: dotfilesLink.sh 等は ~/dotfiles を前提にしている（いま: ${DOTFILES}）${NC}"
fi

done_steps=()
skipped_steps=()
failed_steps=()

# step <説明> <コマンド...>
step() {
	local desc="$1"; shift
	echo -e "\n${BOLD}${BLUE}== $desc${NC}"
	echo -e "   $*"
	read -r -p "$(echo -e "${YELLOW}実行しますか? (Y/n): ${NC}")" choice
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
		read -r -p "$(echo -e "${YELLOW}続けますか? (Y/n): ${NC}")" cont
		[[ -n $cont && ! $cont =~ ^[Yy]$ ]] && summary && exit 1
	fi
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

step "Homebrew とアプリ（setup_mac_app.sh・brew bundle）" bash ./setup_mac_app.sh
step "設定ファイルのリンク（dotfilesLink.sh）" sh ./dotfilesLink.sh
step "Karabiner の設定のリンク（karabinerlink.sh）" karabiner_link
step "macOS の設定（setup_mac.sh・項目ごとに聞く）" bash ./setup_mac.sh

summary
