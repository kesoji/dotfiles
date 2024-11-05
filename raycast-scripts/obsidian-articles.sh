#!/bin/bash

# Raycast Script Command Template
#
# Duplicate this file and remove ".template." from the filename to get started.
# See full documentation here: https://github.com/raycast/script-commands
#
# Required parameters:
# @raycast.schemaVersion 1
# @raycast.title Obsidian Articles
# @raycast.mode compact
#
# Optional parameters:
# @raycast.icon 🤖
# @raycast.packageName Raycast Scripts

# アクティブなブラウザのタブからタイトルとURLを取得
TITLE=$(osascript -e 'tell application "Arc" to get title of active tab of window 1')
URL=$(osascript -e 'tell application "Arc" to get URL of active tab of window 1')

# Markdownフォーマットで追記
ENTRY="- $TITLE\n  - $URL\n  - \n"

# Obsidianのarticles.mdに追記
echo -e "$ENTRY" >> "$HOME/Documents/Obsidian/MyVault/Articles.md"

open "obsidian://open?file=Articles"
