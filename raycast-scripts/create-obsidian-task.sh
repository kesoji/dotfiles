#!/bin/bash

# Required parameters:
# @raycast.schemaVersion 1
# @raycast.title Add Obsidian Task
# @raycast.mode fullOutput
# @raycast.argument1 { "type": "text", "placeholder": "Task description" }
# @raycast.argument2 { "type": "text", "placeholder": "Due date (optional)", "optional": true }

# Documentation:
# @raycast.author kesoji
# @raycast.authorURL https://raycast.com/kesoji

# 設定ファイルのパス
CONFIG_DIR="$HOME/.config/obsidian-raycast"
CONFIG_FILE="$CONFIG_DIR/config"

# 設定ファイルの存在確認
if [ ! -f "$CONFIG_FILE" ]; then
    echo "❌ エラー: 設定ファイルが見つかりません"
    echo ""
    echo "以下のコマンドで設定ファイルを作成してください:"
    echo ""
    echo "mkdir -p $CONFIG_DIR"
    echo "cat > $CONFIG_FILE << EOF"
    echo "VAULT_NAME=\"YourVaultName\""
    echo "TASKS_FILE=\"All Tasks.md\""
    echo "DATE_FORMAT=\"%Y-%m-%d\""
    echo "EOF"
    echo ""
    exit 1
fi

# 設定ファイルを読み込み
source "$CONFIG_FILE"

# 必須変数のチェック
if [ -z "$VAULT_NAME" ]; then
    echo "❌ エラー: VAULT_NAMEが設定されていません"
    echo "設定ファイル: $CONFIG_FILE"
    exit 1
fi

urlencode_python() {
    python3 -c "import urllib.parse; print(urllib.parse.quote('$1'))"
}

# デフォルト値の設定
TASKS_FILE="${TASKS_FILE:-Tasks.md}"
DATE_FORMAT="${DATE_FORMAT:-%Y-%m-%d}"

# タスクと日付の準備
task="$1"
due_date="$2"
created_date=$(date +"${DATE_FORMAT}")

# タスク文字列を構築
task_string="$task ➕ $created_date"

# Due dateが指定されていれば追加
if [ -n "$due_date" ]; then
    # 日付の形式を検証（簡易的）
    if [[ "$due_date" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
        task_string="$task_string 📅 $due_date"
    elif [[ "$due_date" == "today" ]]; then
        task_string="$task_string 📅 $created_date"
    elif [[ "$due_date" == "tomorrow" ]]; then
        tomorrow=$(date -v+1d +"${DATE_FORMAT}" 2>/dev/null || date -d "+1 day" +"${DATE_FORMAT}")
        task_string="$task_string 📅 $tomorrow"
    else
        # その他の形式（月曜日、来週など）はそのまま渡す
        task_string="$task_string 📅 $due_date"
    fi
fi

# URLエンコード
encoded_vault=$(urlencode_python "$VAULT_NAME")
encoded_file=$(urlencode_python "$TASKS_FILE")
encoded_task=$(urlencode_python "$task_string")

# URIを開く
uri="obsidian://advanced-uri?vault=${encoded_vault}&filepath=${encoded_file}&data=-%20%5B%20%5D%20${encoded_task}&mode=prepend"
open "$uri"

echo "✅ タスクを追加しました: $task"
if [ -n "$due_date" ]; then
    echo "   期限: $due_date"
fi
echo "   作成日: $created_date"