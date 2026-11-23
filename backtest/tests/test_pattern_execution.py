from copy import deepcopy
import pytest
from backtest.pattern_execution import replay, EvidenceMissing


def fixture():
    days=['2026-11-09','2026-11-10','2026-11-11']
    previous=['2026-11-06',*days[:-1]]
    return {'source':'synthetic-test-only','price_basis':'raw','calendar_complete':True,'sessions':days,
            'pools':{d:{'complete':True,'total':1,'previous_session':p,'available_at':p+'T16:00:00+08:00',
                        'stocks':[{'code':'600000','boards':3,'st':False}]} for d,p in zip(days,previous)},
            'bars':{d:{'600000':{'source':'synthetic','open':10,'close':10,'limit_up':11,'limit_down':9,
                                 'auction_volume':100000,'trading':True,'corporate_action':False}} for d in days}}


def test_partial_fills_and_cash_reconcile_without_forced_liquidation():
    result=replay(fixture(),initial_cash=100000,capacity=1)
    assert [f['side'] for f in result['fills']]==['buy','sell','buy']
    assert all(f['quantity']==1000 for f in result['fills'])
    assert result['fills'][1]['date']>result['fills'][0]['date']
    cash=100000
    for f in result['fills']:
        cash+=(1 if f['side']=='sell' else -1)*f['quantity']*f['price']-f['fee']
    assert result['equity'][-1]['cash']==pytest.approx(cash)
    assert result['final_equity']==pytest.approx(cash+10000)
    assert result['open_positions']['600000']['qty']==1000


def test_limit_down_exit_carries_position_until_later_session():
    data=fixture();data['bars']['2026-11-10']['600000']['open']=9
    result=replay(data,initial_cash=100000,capacity=1)
    assert [f['date'] for f in result['fills']]==['2026-11-09','2026-11-11']
    assert any('排队' in o['reason'] and o['filled']==0 for o in result['orders'])


@pytest.mark.parametrize('damage', ['pool','future','volume','band','action','st','calendar'])
def test_missing_evidence_refuses_instead_of_producing_returns(damage):
    data=deepcopy(fixture());p=data['pools']['2026-11-09'];b=data['bars']['2026-11-09']['600000']
    if damage=='pool':p['complete']=False
    if damage=='future':p['available_at']='2026-11-09T15:00:00+08:00'
    if damage=='volume':del b['auction_volume']
    if damage=='band':del b['limit_up']
    if damage=='action':b['corporate_action']=True
    if damage=='st':del p['stocks'][0]['st']
    if damage=='calendar':data['calendar_complete']=False
    with pytest.raises(EvidenceMissing):replay(data)


def test_highest_pool_includes_st_before_exclusion():
    data=fixture()
    for p in data['pools'].values():
        p['stocks'].append({'code':'600001','boards':4,'st':True});p['total']=2
    assert replay(data)['fills']==[]
