#!/usr/bin/env python3

# Required parameters:
# @raycast.schemaVersion 1
# @raycast.title Record Done Task
# @raycast.mode fullOutput
# @raycast.argument1 { "type": "text", "placeholder": "Task description (what you did)" }

# Documentation:
# @raycast.author kesoji
# @raycast.authorURL https://raycast.com/kesoji

import os
import sys
import subprocess
from datetime import datetime
from urllib.parse import quote
from pathlib import Path

def load_config():
    """設定ファイルを読み込む"""
    config_dir = Path.home() / ".config" / "obsidian-raycast"
    config_file = config_dir / "config"
    
    if not config_file.exists():
        print("❌ エラー: 設定ファイルが見つかりません")
        print("")
        print("以下のコマンドで設定ファイルを作成してください:")
        print("")
        print(f"mkdir -p {config_dir}")
        print(f"cat > {config_file} << EOF")
        print('VAULT_NAME="YourVaultName"')
        print('TASKS_FILE="All Tasks.md"')
        print('DATE_FORMAT="%Y-%m-%d"')
        print("EOF")
        print("")
        sys.exit(1)
    
    # シェル形式の設定ファイルを読み込み
    config = {}
    with open(config_file, 'r') as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith('#'):
                key, value = line.split('=', 1)
                config[key] = value.strip('"\'')
    
    if 'VAULT_NAME' not in config:
        print("❌ エラー: VAULT_NAMEが設定されていません")
        print(f"設定ファイル: {config_file}")
        sys.exit(1)
    
    return config

def record_done_task(task_description):
    """完了したタスクを記録する"""
    config = load_config()
    
    vault_name = config['VAULT_NAME']
    tasks_file = config.get('TASKS_FILE', 'Tasks.md')
    date_format = config.get('DATE_FORMAT', '%Y-%m-%d')
    
    # 完了日（今日の日付）
    completed_date = datetime.now().strftime(date_format)
    
    # タスク文字列を構築（最初からDone状態）
    task_string = f"{task_description} ➕ {completed_date} ✅ {completed_date}"
    
    # URLエンコード
    encoded_vault = quote(vault_name)
    encoded_file = quote(tasks_file)
    encoded_task = quote(task_string)
    
    # URIを構築（完了状態のタスクとして追加）
    uri = f"obsidian://advanced-uri?vault={encoded_vault}&filepath={encoded_file}&data=-%20%5Bx%5D%20{encoded_task}&mode=prepend"
    
    # URIを開く
    try:
        subprocess.run(['open', uri], check=True)
        print(f"✅ 完了タスクを記録しました: {task_description}")
        print(f"   完了日: {completed_date}")
    except subprocess.CalledProcessError as e:
        print(f"❌ エラー: URIを開けませんでした: {e}")
        sys.exit(1)

def main():
    if len(sys.argv) < 2:
        print("使用方法: record-obsidian-done.py <task_description>")
        sys.exit(1)
    
    task_description = sys.argv[1]
    
    record_done_task(task_description)

if __name__ == "__main__":
    main()