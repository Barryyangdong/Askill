import pytest

from sources import review_board_metrics as metrics


def test_weekend_cannot_be_labeled_with_a_trading_session_pool(monkeypatch):
    monkeypatch.setattr(metrics.S, "today_sh", lambda: "2026-11-21")
    monkeypatch.setattr(metrics, "_pool", lambda *_: pytest.fail("周末不应请求股票池"))
    with pytest.raises(metrics.DataNotAvailable):
        metrics.board_metrics("2026-11-14", "2026-11-13", "2026-11-12")


def test_scoped_metrics_use_prior_streaks_and_count_gaps(monkeypatch):
    day, prev, earlier = "2026-11-20", "2026-11-19", "2026-11-18"

    def stock(code, boards=1, board="10cm", **kwargs):
        return {"code": code, "boards": boards, "board": board, **kwargs}

    pools = {
        ("zt", day): [stock("000001", 2), stock("000002"), stock("300001", board="20cm")],
        ("zb", day): [stock("000003", close=10.45, limit_price=11)],
        ("zt", prev): [stock("000001"), stock("000003", 2)],
        ("zb", prev): [stock("000004"), stock("000005")],
        ("zt", earlier): [stock("000004")],
    }
    monkeypatch.setattr(metrics, "_pool", lambda kind, date: pools.get((kind, date)))
    monkeypatch.setattr(metrics, "_closing_returns", lambda _day, _codes: {"000004": -2.0})
    monkeypatch.setattr(metrics.S, "today_sh", lambda: "2026-11-21")
    monkeypatch.setattr(metrics.S, "settled_pool", lambda _day: [{"code": "000001", "ret": 10.0}])
    result = metrics.board_metrics(day, prev, earlier)
    main = result["values"]["main:all"]
    assert main["up"] == 2 and main["broken"] == 1
    assert main["drawdown"] == -5.0
    assert main["up_premium"] == {"value": 10.0, "sample": 1, "total": 2}
    assert main["broken_premium"] == {"value": -2.0, "sample": 1, "total": 2}
    assert main["ladder"][1] == {"count": 1, "promotion": 100.0}
    assert result["values"]["all:all"]["up"] == 3
    assert result["values"]["main:first"]["broken"] == 0
    assert result["values"]["main:chain"]["broken"] == 1
    assert result["values"]["main:chain"]["ladder"][1]["promotion"] == 100.0
    assert result["values"]["main:chain"]["broken_premium"]["sample"] == 1
    assert result["complete"] is False
