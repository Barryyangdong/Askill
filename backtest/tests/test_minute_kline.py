import pytest
from backtest import kline as K
from backtest.tests.test_kline import _fake_fetch

def test_minute_chart_preserves_intraday_time_and_uses_only_recent_raw_data(monkeypatch,tmp_path):
    calls=[]
    rows=[{'code':'sh600519','datetime':f'2026-11-16 10:{m:02d}','open':10,'high':11,'low':9,'close':10.5,'volume':100} for m in (0,5,10)]
    monkeypatch.setattr(K,'_run_fetch',_fake_fetch(calls,rows=rows))
    result=K.build({'symbol':'600519','period':'m5','charts':True},tmp_path)
    assert result['adjust']=='none'
    assert result['ui_only']['series']['dates']==[r['datetime'] for r in rows]
    assert calls==[('tx_kline','600519.SH',{'period':'m5','adjust':'','count':320})]
    assert any('不是完整历史分钟库' in n for n in result['notes'])

@pytest.mark.parametrize('payload',[{'symbol':'AAPL','period':'m5'},{'symbol':'600519','period':'m15','adjust':'qfq'}])
def test_unsupported_minute_basis_rejected_before_fetch(monkeypatch,tmp_path,payload):
    monkeypatch.setattr(K,'_run_fetch',lambda *a,**k:pytest.fail('must not fetch'))
    with pytest.raises(K.KlineError,match='分钟图'):
        K.build(payload,tmp_path)
