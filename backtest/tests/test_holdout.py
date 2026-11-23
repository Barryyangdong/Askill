from types import SimpleNamespace
import pytest
from backtest import holdout as h
from backtest.gate import plan_backtest, Plan
from backtest.run import BacktestNotValid
from backtest.loader import VibeLoader

def plan():
    p=plan_backtest(codes=['600519.SH'],start='2021-01-01',end='2025-12-31',style='swing')
    assert isinstance(p,Plan)
    return p

@pytest.mark.parametrize('split',['2021-01-01','2026-01-01','2025-12-30','bad',20230101])
def test_bad_or_short_segments_are_rejected(split):
    with pytest.raises(ValueError): h.split_plans(plan(),split)

def test_boundaries_parameters_cash_and_market_constraints_remain_fixed(monkeypatch,tmp_path):
    seen=[]
    def run(p,strategy,**kw):
        seen.append((p,strategy,kw))
        return SimpleNamespace(metrics={'total_return':.1,'execution_fees':12},limits=p.limits,notes=p.notes,missing={})
    monkeypatch.setattr(h,'run',run)
    out=h.compare(plan(),'2023-01-01','ma_cross',{'fast':20,'slow':60},VibeLoader(out_dir=tmp_path/'data'),tmp_path)
    a,b=seen
    assert a[0].end=='2022-12-31' and b[0].start=='2023-01-01'
    assert a[0].initial_cash==b[0].initial_cash==plan().initial_cash
    assert a[0].market==b[0].market==plan().market
    assert a[1].fast==b[1].fast==20
    assert out['complete'] and out['segments'][1]['metrics']['execution_fees']==12
    assert '不拼接收益' in out['note']

def test_insufficient_actual_bars_never_become_holdout_success(monkeypatch,tmp_path):
    def run(*a,**kw): raise BacktestNotValid('实际样本不足')
    monkeypatch.setattr(h,'run',run)
    out=h.compare(plan(),'2023-01-01','buy_and_hold',{},VibeLoader(out_dir=tmp_path/'data'),tmp_path)
    assert not out['complete'] and out['segments']==[]

def test_window_loader_cuts_future_bars_without_mutating_source(tmp_path):
    import pandas as pd
    source=VibeLoader(out_dir=tmp_path/'data')
    df=pd.DataFrame({'close':[10,20,30]},index=pd.to_datetime(['2022-12-30','2023-01-02','2023-01-03']))
    source._cache[('600519.SH','2021-01-01','2025-12-31')]=df
    window=h._WindowLoader(source,plan())
    before=window.fetch(['600519.SH'],'2021-01-01','2022-12-31')['600519.SH']
    after=window.fetch(['600519.SH'],'2023-01-01','2025-12-31')['600519.SH']
    assert list(before.close)==[10] and list(after.close)==[20,30]
    before.iloc[0,0]=999
    assert df.iloc[0,0]==10

def test_real_engine_preserves_costs_and_independent_windows(tmp_path):
    import pandas as pd
    p=plan()
    idx=pd.date_range(p.start,p.end,freq='B').astype('datetime64[ns]')
    prices=[100+i*.01 for i in range(len(idx))]
    df=pd.DataFrame({k:prices for k in ['open','high','low','close']},index=idx)
    df['volume']=1e7
    source=VibeLoader(out_dir=tmp_path/'data')
    source._cache[('600519.SH',p.start,p.end)]=df
    ticker=p.to_config()['benchmark']
    source._failed.add((ticker,p.start,p.end))
    out=h.compare(p,'2023-01-01','buy_and_hold',{},source,tmp_path/'runs')
    assert out['complete']
    assert all(s['metrics']['execution_fees']>0 for s in out['segments'])
    assert all(s['metrics']['fill_count']>=1 for s in out['segments'])
