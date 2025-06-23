#!/usr/bin/env python3

# Required parameters:
# @raycast.schemaVersion 1
# @raycast.title Add Obsidian Task
# @raycast.mode fullOutput
# @raycast.argument1 { "type": "text", "placeholder": "Task description" }
# @raycast.argument2 { "type": "text", "placeholder": "Due date (optional)", "optional": true }

# Documentation:
# @raycast.author kesoji
# @raycast.authorURL https://raycast.com/kesoji

import os
import sys
import re
import subprocess
from datetime import datetime, timedelta
from urllib.parse import quote
from pathlib import Path
from configparser import ConfigParser

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

def normalize_date(date_str):
    """日付文字列を正規化する"""
    if not date_str:
        return None
    
    current_year = datetime.now().year
    
    # YYYY-MM-DD形式はそのまま
    if re.match(r'^\d{4}-\d{2}-\d{2}$', date_str):
        return date_str
    
    # M/D や MM/DD 形式を YYYY-MM-DD に変換
    match = re.match(r'^(\d{1,2})/(\d{1,2})$', date_str)
    if match:
        month = int(match.group(1))
        day = int(match.group(2))
        
        # 有効な日付かチェック
        try:
            normalized = datetime(current_year, month, day)
            return normalized.strftime('%Y-%m-%d')
        except ValueError:
            return date_str
    
    # 特殊なキーワード（英語・日本語）
    date_lower = date_str.lower()
    
    # 今日
    if date_lower in ['today', '今日', 'きょう']:
        return datetime.now().strftime('%Y-%m-%d')
    
    # 明日
    elif date_lower in ['tomorrow', '明日', 'あした', 'あす']:
        return (datetime.now() + timedelta(days=1)).strftime('%Y-%m-%d')
    
    # 昨日
    elif date_lower in ['yesterday', '昨日', 'きのう']:
        return (datetime.now() - timedelta(days=1)).strftime('%Y-%m-%d')
    
    # その他の形式はそのまま返す
    return date_str

def create_task(task_description, due_date=None):
    """Obsidianタスクを作成する"""
    config = load_config()
    
    vault_name = config['VAULT_NAME']
    tasks_file = config.get('TASKS_FILE', 'Tasks.md')
    date_format = config.get('DATE_FORMAT', '%Y-%m-%d')
    
    # 作成日
    created_date = datetime.now().strftime(date_format)
    
    # タスク文字列を構築
    task_string = f"{task_description} ➕ {created_date}"
    
    # Due dateが指定されていれば追加
    if due_date:
        normalized_date = normalize_date(due_date)
        task_string += f" 📅 {normalized_date}"
    
    # URLエンコード
    encoded_vault = quote(vault_name)
    encoded_file = quote(tasks_file)
    encoded_task = quote(task_string)
    
    # URIを構築
    uri = f"obsidian://advanced-uri?vault={encoded_vault}&filepath={encoded_file}&data=-%20%5B%20%5D%20{encoded_task}&mode=prepend"
    
    # URIを開く
    try:
        subprocess.run(['open', uri], check=True)
        print(f"✅ タスクを追加しました: {task_description}")
        if due_date:
            print(f"   期限: {normalize_date(due_date)}")
        print(f"   作成日: {created_date}")
    except subprocess.CalledProcessError as e:
        print(f"❌ エラー: URIを開けませんでした: {e}")
        sys.exit(1)

def main():
    if len(sys.argv) < 2:
        print("使用方法: create-obsidian-task.py <task_description> [due_date]")
        sys.exit(1)
    
    task_description = sys.argv[1]
    due_date = sys.argv[2] if len(sys.argv) > 2 else None
    
    create_task(task_description, due_date)

if __name__ == "__main__":
    main()