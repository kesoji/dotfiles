#!/bin/bash

# カラー定義
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color
BOLD='\033[1m'

# 失敗（✗）した項目の数。最後に非0で終わるために数える（スキップは失敗にしない）
failed=0

# 確認・実行の共通関数
confirm_and_execute() {
    local description="$1"
    local read_command=$2
    local write_command="$3"

    echo -e "${BLUE}${description}${NC}"
    echo -e "${BOLD}現在の設定値: ${GREEN}$(eval "$read_command" 2>&1)${NC}"
    # Ctrl-D（EOF）は「いいえ」
    read -r -p "$(echo -e "${YELLOW}${write_command} を実行しますか? (Y/n): ${NC}")" choice || choice=n

    if [[ $choice =~ ^[Yy]$ || -z $choice ]]; then
        if eval "$write_command"; then
            echo -e "${GREEN}✓${NC}\n"
            return 0
        else
            echo -e "${RED}✗ 失敗しました${NC}\n"
            failed=$((failed + 1))
            return 2
        fi
    else
        echo -e "${YELLOW}スキップしました${NC}\n"
        return 1
    fi
}

# ヘッダー表示
echo -e "${BOLD}${BLUE}===== Setup Mac =====${NC}\n"

confirm_and_execute \
    "起動音を無くす" \
    "nvram SystemAudioVolume" \
    "sudo nvram SystemAudioVolume=%00"

# スクリーンセーバーのパスワード設定
confirm_and_execute \
    "スクリーンセーバ起動時のパスワード要求設定" \
    "defaults read com.apple.screensaver askForPassword" \
    "defaults write com.apple.screensaver askForPassword -int 1"
confirm_and_execute \
    "パスワード要求までの遅延時間設定(効いていない...)" \
    "defaults read com.apple.screensaver askForPasswordDelay" \
    "defaults write com.apple.screensaver askForPasswordDelay -int 5"
confirm_and_execute \
    "スクリーンセーバー設定の反映" \
    "echo '現在の設定を反映します'" \
    "killall cfprefsd"

# ディスプレイのスリープ
# 外での値を先に入れる（家の仕組みを入れ忘れても長くならないように）
confirm_and_execute \
    "ディスプレイのスリープ（外の値: 電源5分・バッテリー2分）" \
    "pmset -g custom | grep -E 'Power:|displaysleep' | paste -sd ' ' -" \
    "sudo pmset -c displaysleep 5 && sudo pmset -b displaysleep 2"
# 家のモニターがつながっている間だけ長くする（bin/displaysleep-home）
confirm_and_execute \
    "家のモニターがつながっている間だけディスプレイのスリープを長くする（家のモニターをつないだ状態で）" \
    "$HOME/dotfiles/bin/displaysleep-home status | head -2" \
    "$HOME/dotfiles/bin/displaysleep-home add-current && $HOME/dotfiles/bin/displaysleep-home install"


# ホットコーナーの設定
confirm_and_execute \
    "ホットコーナー左上の設定" \
    "defaults read com.apple.dock wvous-tl-corner" \
    "defaults write com.apple.dock wvous-tl-corner -int 5"
confirm_and_execute \
    "ホットコーナー左上のmodifier設定" \
    "defaults read com.apple.dock wvous-tl-modifier" \
    "defaults write com.apple.dock wvous-tl-modifier -int 0"
confirm_and_execute \
    "ホットコーナー設定の反映" \
    "echo '現在の設定を反映します'" \
    "killall Dock"

# キーボードの設定
confirm_and_execute \
    "キーボードのFnキーの設定" \
    "defaults read NSGlobalDomain com.apple.keyboard.fnState" \
    "defaults write NSGlobalDomain com.apple.keyboard.fnState -bool true"
confirm_and_execute \
    "キーボードのリピート開始設定" \
    "defaults read NSGlobalDomain InitialKeyRepeat" \
    "defaults write NSGlobalDomain InitialKeyRepeat -int 11"
confirm_and_execute \
    "キーボードのリピート設定" \
    "defaults read NSGlobalDomain KeyRepeat" \
    "defaults write NSGlobalDomain KeyRepeat -int 1"

# Finderの設定
confirm_and_execute \
    "Finderの拡張子表示設定" \
    "defaults read NSGlobalDomain AppleShowAllExtensions" \
    "defaults write NSGlobalDomain AppleShowAllExtensions -bool true"
confirm_and_execute \
    "Finderのパスバー表示設定" \
    "defaults read com.apple.finder ShowPathbar" \
    "defaults write com.apple.finder ShowPathbar -bool true"
confirm_and_execute \
    "デフォルトでリストビュー" \
    "defaults read com.apple.finder FXPreferredViewStyle" \
    "defaults write com.apple.finder FXPreferredViewStyle -string 'Nlsv'"
confirm_and_execute \
    ".DS_Storeをネットワークボリュームに作成しない" \
    "defaults read com.apple.desktopservices DSDontWriteNetworkStores" \
    "defaults write com.apple.desktopservices DSDontWriteNetworkStores -bool true"
confirm_and_execute \
    ".DS_StoreをUSBメディアに作成しない" \
    "defaults read com.apple.desktopservices DSDontWriteUSBStores" \
    "defaults write com.apple.desktopservices DSDontWriteUSBStores -bool true"
confirm_and_execute \
    "Finderの設定の反映" \
    "echo '現在の設定を反映します'" \
    "killall Finder"


# Claude Code の設定
confirm_and_execute \
    "Claude Code に Playwright MCP サーバーを登録 (user scope)" \
    "claude mcp get playwright 2>&1 | head -n 1" \
    "claude mcp add --scope user playwright -- npx @playwright/mcp@latest"


if [ "$failed" -gt 0 ]; then
    echo -e "${RED}${BOLD}失敗した項目が ${failed} 件あります${NC}"
    exit 1
fi
echo -e "${GREEN}${BOLD}スクリプトの実行が完了しました！${NC}"
