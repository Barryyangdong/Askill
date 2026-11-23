import pandas as pd
import pytest
from backtest.strategies import RuleCombination

def frame(values):
    return pd.DataFrame({'close': values, 'high': [v+.1 for v in values], 'low': [v-.1 for v in values]})

def test_priority_dedup_capacity_and_unused_cash():
    data={'a':frame([10,10,10,10.05,10.05]), 'b':frame([10,10,10,12,12])}
    rules=[{'strategy':'range_breakout','params':{'entry':3,'exit':2}}, {'strategy':'ma_cross','params':{'fast':1,'slow':3}}]
    # b has breakout priority even though a sorts before b; b also meets MA but never consumes two slots.
    one=RuleCombination(rules,1).generate(data)
    assert one['b'].iloc[3]==1 and one['a'].iloc[3]==0
    three=RuleCombination(rules,3).generate(data)
    assert three['a'].iloc[3]==pytest.approx(1/3)
    assert three['b'].iloc[3]==pytest.approx(1/3)
    for length in range(1,6):
        prefix=RuleCombination(rules,3).generate({c:d.iloc[:length] for c,d in data.items()})
        for code in data:
            pd.testing.assert_series_equal(prefix[code],three[code].iloc[:length])

@pytest.mark.parametrize('rules,capacity', [([],1),([{'strategy':'rule_combination'}],1),([{'strategy':'ma_cross'}],True),([{'strategy':'ma_cross','shell':'no'}],1)])
def test_invalid_combinations_rejected(rules,capacity):
    with pytest.raises(ValueError):
        RuleCombination(rules,capacity)
