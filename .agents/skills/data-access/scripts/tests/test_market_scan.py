import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from sources import market_scan as m
import pytest


def test_inventory_filters_non_stocks_and_preserves_prefix(monkeypatch):
    monkeypatch.setattr(m, '_sina_list', lambda *a, **k: [
        {'symbol': 'sh600000', 'name': 'A'}, {'symbol': 'sz000001', 'name': 'B'},
        {'symbol': 'bj920001', 'name': 'C'}, {'symbol': 'sh510300', 'name': 'ETF'},
        {'symbol': 'sh900001', 'name': 'B股'}])
    result = m.universe_page(2)
    assert [r['symbol'] for r in result['stocks']] == ['sh600000', 'sz000001', 'bj920001']
    assert result['source_rows'] == 5
    assert result['total'] is None
    with pytest.raises(ValueError):
        m.universe_page(101)


def test_backup_requires_source_date_and_keeps_missing_limits(monkeypatch):
    monkeypatch.setattr(m, 'ev', lambda ctx, field, value, unit, period, **kw: {'field': field, 'value': value, 'unit': unit, 'period': period, **kw})
    values = ['0'] * 32
    values[1:6] = ['10', '9', '10.2', '10.5', '9.8']
    values[9] = '1000000'
    values[30:32] = ['2026-11-16', '10:00:00']
    result = m.quote_backup_map({'rows': {'sh600000': values}, 'raw': 'raw/test.txt'}, {})
    evs = {e['field']: e for e in result['evidence']}
    assert evs['quote_time']['value'] == '20261116100000'
    assert evs['turnover_amount']['value'] == 100
    assert 'limit_up_price' not in evs
    assert result['status'] == 'partial'
    values[30] = ''
    assert m.quote_backup_map({'rows': {'sh600000': values}, 'raw': None}, {})['status'] == 'failed'


def test_backup_rejects_arbitrary_destinations():
    with pytest.raises(ValueError):
        m.quote_backup(['https://example.com'])
