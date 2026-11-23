from contextlib import nullcontext
from pathlib import Path
import sys
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from sources import review_industry_members as industry


def test_history_filters_future_updates_and_non_a_shares(monkeypatch):
    sample = {"code": "sh.600000", "updateDate": "2026-11-16", "industry": "J66货币金融服务", "code_name": "浦发银行"}
    raw = [sample, dict(sample, industry="未来分类", updateDate="2026-11-23"), dict(sample, code="sh.900901")]
    proxy = SimpleNamespace(query_stock_industry=lambda date: raw)
    monkeypatch.setattr(industry, "bs_session", lambda: nullcontext(proxy))
    monkeypatch.setattr(industry, "_rs_rows", lambda rows: rows)
    result = industry.industry_members("2026-11-20")
    assert result["groups"] == {"J66货币金融服务": {"600000": "浦发银行"}}
