import pytest

from sources import review_intraday as minute
from sources._http import DataNotAvailable


def test_dated_index_points_and_turnover_deltas(monkeypatch):
    day = "2026-11-20"
    current = {"date": "20261120", "data": [
        f"{clock} 3533.79 0 {100 + i * 25}.50" for i, clock in enumerate(minute._CLOCKS)
    ]}
    previous = {"date": "20261119", "data": ["1500 3577.62 0 1000"]}
    monkeypatch.setattr(minute, "http_json", lambda *_a, **_kw: {
        "code": 0, "data": {"sh000001": {"data": [current, previous]}},
    })
    result = minute.index_minutes(day)
    assert result["complete"] is True
    assert len(result["points"]) == 242
    assert result["prev_close"] == 3577.62
    assert result["points"][0] == {"time": "09:30", "price": 3533.79, "amount": 100.5}
    assert result["points"][121] == {"time": "13:00", "price": 3533.79, "amount": 25}

    del current["data"][1]
    incomplete = minute.index_minutes(day)
    assert incomplete["complete"] is False
    assert incomplete["points"][1]["time"] == "09:32"
    assert incomplete["points"][1]["amount"] is None
    with pytest.raises(DataNotAvailable):
        minute.index_minutes("2026-11-18")
