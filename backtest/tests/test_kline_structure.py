import pytest

from backtest.kline import structure_series


def bars(n=25):
    return {"open": [10.0] * n, "close": [11.0] * n, "high": [12.0] * n,
            "low": [8.0] * n, "volume": [100.0] * n}


def test_known_geometry_and_full_windows():
    result = structure_series(bars())
    assert result["range20"][:19] == [None] * 19
    assert result["range20"][19] == .75
    assert result["volume5"][:5] == [None] * 5
    assert result["volume5"][5] == 1
    assert result["upper_wick"][-1] == .25
    assert result["lower_wick"][-1] == .5
    assert result["band_upper"][-1] == 11
    assert result["band_lower"][-1] == 11


def test_no_lookahead_and_current_volume_excluded_from_denominator():
    data = bars()
    before = structure_series(data)
    data["volume"][-1] = 300
    data["close"][-1] = 12
    after = structure_series(data)
    for key in before:
        assert before[key][:-1] == after[key][:-1]
    assert after["volume5"][-1] == 3
    assert after["band_middle"][-1] == pytest.approx(11.05)
    assert after["band_upper"][-1] == pytest.approx(11.05 + 2 * (.95 / 20) ** .5, abs=1e-6)


def test_gaps_and_zero_denominators_are_not_zero_readings():
    data = bars()
    data["volume"] = [0] * 25
    data["high"] = data["low"] = [10] * 25
    result = structure_series(data)
    assert result["range20"][-1] is None
    assert result["volume5"][-1] is None
    assert result["upper_wick"][-1] is None
    data = bars()
    data["close"][10] = None
    result = structure_series(data)
    assert result["band_middle"][-1] is None
