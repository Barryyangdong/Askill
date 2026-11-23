import pytest

from sources import review_abnormal as review


def test_near_only_uses_dated_closed_snapshot(monkeypatch):
    payload = {"date": 20261120, "open": 0, "pages": 1, "count": 3, "data": [
        {"c": "688033", "m": 1, "s": 5, "n": "股票甲", "e": 5, "x": -43.82, "a": -7.21, "o": 0},
        {"c": "688033", "m": 1, "s": 5, "n": "股票甲", "e": 5, "x": -49, "a": -7.21, "o": 2},
        {"c": "301391", "m": 0, "s": 4, "n": "股票乙", "e": 4, "x": 66.76, "a": -8.11, "o": 0},
    ]}
    monkeypatch.setattr(review, "_anomaly_get", lambda *_: payload)
    rows = review._near("2026-11-20")
    assert [(row["code"], row["deviation"], row["threshold"]) for row in rows] == [("688033", -43.82, -50)]
    with pytest.raises(RuntimeError, match="收盘异动快照"):
        review._near("2026-11-19")
    payload["open"] = 1
    with pytest.raises(RuntimeError, match="收盘异动快照"):
        review._near("2026-11-20")


def test_monitor_dates_are_given_by_source(monkeypatch):
    records = [
        {"code": "605255", "market": "SH", "name": "天普股份", "start": "2026-11-19", "end": "2026-12-02"},
        {"code": "513850", "market": "SH", "name": "美国50", "start": "2026-11-19", "end": "2026-12-02"},
        {"code": "920575", "market": "BJ", "name": "北交所股票", "start": "2026-11-23", "end": "2026-11-27"},
    ]
    monkeypatch.setattr(review, "em_stock_monitor", lambda **_: records)
    rows = review._monitor("2026-11-20", "2026-11-20")
    assert [(row["code"], row["start"], row["end"]) for row in rows] == [("605255", "2026-11-19", "2026-12-02")]
    with pytest.raises(RuntimeError, match="未保留"):
        review._monitor("2026-11-18", "2026-11-20")
