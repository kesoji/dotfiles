"""pytest設定ファイル"""

import pytest
from datetime import datetime

@pytest.fixture
def current_year():
    """現在の年を返すフィクスチャ"""
    return datetime.now().year

@pytest.fixture  
def sample_dates():
    """テスト用の日付サンプルを返すフィクスチャ"""
    return {
        'slash_formats': ['6/26', '12/1', '01/01', '12/31'],
        'iso_formats': ['2025-06-26', '2024-12-31', '2023-01-01'],
        'keywords': ['today', 'tomorrow', 'Today', 'TOMORROW'],
        'invalid': ['13/32', '0/1', '1/32', '2/29'],  # 非閏年での2/29は無効
        'other': ['next week', '月曜日', '2025/06/26', 'June 26']
    }