#!/usr/bin/env python3

import pytest
from datetime import datetime, timedelta
import sys
import os

# テスト対象のモジュールをインポート
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# モジュール名にハイフンが含まれるため、importlibを使用
import importlib.util
spec = importlib.util.spec_from_file_location("create_obsidian_task", 
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "create-obsidian-task.py"))
create_obsidian_task = importlib.util.module_from_spec(spec)
spec.loader.exec_module(create_obsidian_task)

normalize_date = create_obsidian_task.normalize_date

class TestNormalizeDate:
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """テスト前の準備"""
        self.current_year = datetime.now().year
    
    @pytest.mark.parametrize("input_date,expected", [
        ("2025-06-26", "2025-06-26"),
        ("2024-12-31", "2024-12-31"),
        ("2023-01-01", "2023-01-01")
    ])
    def test_yyyy_mm_dd_format(self, input_date, expected):
        """YYYY-MM-DD形式はそのまま返されることを確認"""
        assert normalize_date(input_date) == expected
    
    @pytest.mark.parametrize("input_date,expected", [
        ("6/26", lambda year: f"{year}-06-26"),
        ("1/1", lambda year: f"{year}-01-01"), 
        ("12/31", lambda year: f"{year}-12-31")
    ])
    def test_m_d_format(self, input_date, expected):
        """M/D形式が正しく変換されることを確認"""
        assert normalize_date(input_date) == expected(self.current_year)
    
    @pytest.mark.parametrize("input_date,expected", [
        ("06/26", lambda year: f"{year}-06-26"),
        ("01/01", lambda year: f"{year}-01-01"),
        ("12/31", lambda year: f"{year}-12-31")
    ])
    def test_mm_dd_format(self, input_date, expected):
        """MM/DD形式が正しく変換されることを確認"""
        assert normalize_date(input_date) == expected(self.current_year)
    
    @pytest.mark.parametrize("input_date,expected", [
        ("6/01", lambda year: f"{year}-06-01"),
        ("12/1", lambda year: f"{year}-12-01")
    ])
    def test_mixed_format(self, input_date, expected):
        """M/DDやMM/D形式が正しく変換されることを確認"""
        assert normalize_date(input_date) == expected(self.current_year)
    
    @pytest.mark.parametrize("invalid_date", [
        "13/32",  # 無効な月/日
        "0/1",    # 無効な月
        "1/32"    # 無効な日
    ])
    def test_invalid_dates(self, invalid_date):
        """無効な日付は元のまま返されることを確認"""
        assert normalize_date(invalid_date) == invalid_date
    
    def test_special_keywords(self):
        """特殊キーワードが正しく処理されることを確認"""
        today = datetime.now().strftime('%Y-%m-%d')
        tomorrow = (datetime.now() + timedelta(days=1)).strftime('%Y-%m-%d')
        yesterday = (datetime.now() - timedelta(days=1)).strftime('%Y-%m-%d')
        
        # 今日
        assert normalize_date("today") == today
        assert normalize_date("Today") == today
        assert normalize_date("TODAY") == today
        assert normalize_date("今日") == today
        assert normalize_date("きょう") == today
        
        # 明日
        assert normalize_date("tomorrow") == tomorrow
        assert normalize_date("Tomorrow") == tomorrow
        assert normalize_date("TOMORROW") == tomorrow
        assert normalize_date("明日") == tomorrow
        assert normalize_date("あした") == tomorrow
        assert normalize_date("あす") == tomorrow
        
        # 昨日
        assert normalize_date("yesterday") == yesterday
        assert normalize_date("Yesterday") == yesterday
        assert normalize_date("YESTERDAY") == yesterday
        assert normalize_date("昨日") == yesterday
        assert normalize_date("きのう") == yesterday
    
    @pytest.mark.parametrize("other_format", [
        "next week",
        "月曜日",
        "2025/06/26",
        "June 26"
    ])
    def test_other_formats(self, other_format):
        """その他の形式はそのまま返されることを確認"""
        assert normalize_date(other_format) == other_format
    
    @pytest.mark.parametrize("empty_input", ["", None])
    def test_empty_input(self, empty_input):
        """空の入力に対してNoneが返されることを確認"""
        assert normalize_date(empty_input) is None
    
    def test_edge_cases(self):
        """エッジケースのテスト"""
        # 閏年の2月29日
        if self.current_year % 4 == 0 and (self.current_year % 100 != 0 or self.current_year % 400 == 0):
            assert normalize_date("2/29") == f"{self.current_year}-02-29"
        else:
            assert normalize_date("2/29") == "2/29"  # 非閏年では無効
        
        # 月末日
        assert normalize_date("4/30") == f"{self.current_year}-04-30"
        assert normalize_date("2/28") == f"{self.current_year}-02-28"

class TestIntegration:
    """統合テスト（実際のObsidian URIは開かない）"""
    
    @pytest.mark.parametrize("input_date,expected", [
        ("6/26", lambda: f"{datetime.now().year}-06-26"),
        ("12/1", lambda: f"{datetime.now().year}-12-01"),
        ("2025-01-01", lambda: "2025-01-01"),
        ("today", lambda: datetime.now().strftime('%Y-%m-%d')),
        ("tomorrow", lambda: (datetime.now() + timedelta(days=1)).strftime('%Y-%m-%d')),
        ("今日", lambda: datetime.now().strftime('%Y-%m-%d')),
        ("明日", lambda: (datetime.now() + timedelta(days=1)).strftime('%Y-%m-%d')),
        ("昨日", lambda: (datetime.now() - timedelta(days=1)).strftime('%Y-%m-%d')),
    ])
    def test_date_formats_in_context(self, input_date, expected):
        """様々な日付フォーマットが文脈で正しく動作することを確認"""
        result = normalize_date(input_date)
        assert result == expected()

if __name__ == '__main__':
    # テストの実行
    print("🧪 create-obsidian-task のテストを実行中...")
    print("=" * 50)
    
    pytest.main(["-v", __file__])