#!/bin/bash

# Raycast Script Command Template
#
# Duplicate this file and remove ".template." from the filename to get started.
# See full documentation here: https://github.com/raycast/script-commands
#
# Required parameters:
# @raycast.schemaVersion 1
# @raycast.title Obsidian Daily
# @raycast.mode compact
#
# Optional parameters:
# @raycast.icon 📖
# @raycast.packageName Raycast Scripts
# @raycast.argument1 { "type": "text", "placeholder": "テキスト" }

# 現在の日付を取得
DATE=$(date +"%Y-%m-%d")
TIME=$(date +"%H:%M")

# Obsidianのvaultパスを設定
VAULT_PATH="$HOME/Documents/Obsidian/MyVault"
DAILY_NOTE_PATH="$VAULT_PATH/Daily/$DATE.md"

# 入力されたテキストを追加
touch "$DAILY_NOTE_PATH"
echo "- $TIME $1" >> "$DAILY_NOTE_PATH"

# Obsidianを開く（必要な場合）
open "obsidian://open?file=Daily%2F$DATE"
