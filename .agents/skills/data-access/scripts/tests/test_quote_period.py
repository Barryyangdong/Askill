from test_registry_sources import _ctx
from sources import mappers_cn


def test_quote_period_uses_exchange_stamp_not_fetch_day(monkeypatch):
    monkeypatch.setattr(mappers_cn, "today_str", lambda: "2026-11-16")
    ctx = _ctx(symbol="600825", market="CN", source="tencent", ep={"id": "tx_quote"})
    data = mappers_cn.tencent_quotes_map({"sh600825": {"price": 13.11, "name": "样本", "quote_time": "20261113161455"}}, ctx)
    price = next(e for e in data["evidence"] if e["field"] == "price")
    assert price["period"] == "2026-11-13"
    assert "抓取日=2026-11-16" in price["note"]


def test_unknown_quote_date_is_explicit_not_today():
    ctx = _ctx(symbol="600825", market="CN", source="tencent", ep={"id": "tx_quote"})
    data = mappers_cn.tencent_quotes_map({"sh600825": {"price": 13.11, "quote_time": "bad"}}, ctx)
    assert next(e for e in data["evidence"] if e["field"] == "price")["period"] == "unknown"
    assert any(e["field"] == "quote_time" for e in data["missing"])
