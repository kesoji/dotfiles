#!/bin/bash

# カラー定義
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color
BOLD='\033[1m'

# 確認・実行の共通関数
confirm_and_execute() {
    local description="$1"
    local read_command=$2
    local write_command="$3"

    echo -e "${BLUE}${description}${NC}"
    echo -e "${BOLD}現在の設定値: ${GREEN}$(eval "$read_command" 2>&1)${NC}"
    read -p "$(echo -e ${YELLOW}"${write_command} を実行しますか? (Y/n): "${NC})" choice

    if [[ $choice =~ ^[Yy]$ || -z $choice ]]; then
        eval "$write_command"
        echo -e "${GREEN}✓${NC}\n"
        return 0
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

# スクリーンセーバー設定の反映
confirm_and_execute \
    "スクリーンセーバー設定の反映" \
    "echo '現在の設定を反映します'" \
    "killall cfprefsd"

# ホットコーナーの設定
confirm_and_execute \
    "ホットコーナー左上の設定" \
    "defaults read com.apple.dock wvous-tl-corner" \
    "defaults write com.apple.dock wvous-tl-corner -int 5"

confirm_and_execute \
    "ホットコーナー左上のmodifier設定" \
    "defaults read com.apple.dock wvous-tl-modifier" \
    "defaults write com.apple.dock wvous-tl-modifier -int 0"

# ホットコーナー設定の反映
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
    "defaults write NSGlobalDomain InitialKeyRepeat -int 15" \
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

echo -e "${GREEN}${BOLD}スクリプトの実行が完了しました！${NC}"
