import pandas as pd
import pytest
from backtest.strategies import RangeBreakout


def test_breakout_uses_prior_window_and_exits_on_known_breakdown():
    close = [10, 10, 10, 12, 11, 8]
    frame = pd.DataFrame({'close': close, 'high': [v+.2 for v in close], 'low': [v-.2 for v in close]})
    assert RangeBreakout(3, 2).generate({'a': frame})['a'].tolist() == [0, 0, 0, 1, 1, 0]
    for length in range(1, len(frame)):
        pd.testing.assert_series_equal(RangeBreakout(3, 2).generate({'a': frame.iloc[:length]})['a'], RangeBreakout(3, 2).generate({'a': frame})['a'].iloc[:length])


@pytest.mark.parametrize('entry,exit', [(3, 3), (1, 2), (True, 2), (251, 2)])
def test_invalid_parameters_are_rejected(entry, exit):
    with pytest.raises(ValueError):
        RangeBreakout(entry, exit)
