"""Conservative, auditable opening-auction replay for frozen historical pools.

This is a simulation, not proof of queue priority. Input must come from a
historical-data adapter; current quotes and daily volume are not substitutes
for opening-auction volume. Missing evidence refuses the whole run.
"""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal, ROUND_FLOOR, ROUND_HALF_UP
import math
from typing import TypedDict


class Position(TypedDict):
    qty: int
    day: str


class Fill(TypedDict):
    date: str
    code: str
    side: str
    quantity: int
    price: float
    fee: float


class Order(TypedDict):
    date: str
    code: str
    side: str
    requested: int
    filled: int
    reason: str


class EquityPoint(TypedDict):
    date: str
    cash: float
    equity: float


class EvidenceMissing(ValueError):
    pass


def number(value, field, minimum=0):
    if isinstance(value, bool) or not isinstance(value, (float, int)) or not math.isfinite(value) or value < minimum:
        raise EvidenceMissing(f"{field} 缺失或无效")
    return Decimal(str(value))


def money(value):
    return value.quantize(Decimal('.01'), rounding=ROUND_HALF_UP)


def replay(bundle: dict, *, pattern='leader', initial_cash=1_000_000, capacity=5,
           commission_rate=.00025, minimum_commission=5, stamp_tax=.0005,
           transfer_fee=.00001, slippage=.001, participation=.01):
    """Yesterday's frozen pool -> today's open -> next session's open exit.

    Equal slot budgets, code order for ties, no reinvestment assumptions from
    today's close. Unsold shares stay marked at the actual close; no forced
    final liquidation. Only ordinary main-board 100-share lots are supported.
    Fee rates are explicit experiment assumptions, not broker quotations.
    """
    if pattern not in ('leader', 'first_board'):
        raise EvidenceMissing('弱转强需要触发时刻逐笔/盘口资料，本入口只支持空间龙头和首板次日')
    if type(capacity) is not int or not 1 <= capacity <= 20:
        raise ValueError('capacity 必须为1–20')
    cash = number(initial_cash, 'initial_cash', 1)
    initial = cash
    comm = number(commission_rate, 'commission_rate')
    minimum = number(minimum_commission, 'minimum_commission')
    stamp = number(stamp_tax, 'stamp_tax')
    transfer = number(transfer_fee, 'transfer_fee')
    slip = number(slippage, 'slippage')
    part = number(participation, 'participation', .000001)
    if part > Decimal('.01') or slip > Decimal('.05'):
        raise ValueError('开盘成交量参与上限为1%，滑点上限5%')
    if bundle.get('price_basis') != 'raw' or not bundle.get('source'):
        raise EvidenceMissing('必须提供未复权行情和来源')
    days = bundle.get('sessions', [])
    if not days or days != sorted(set(days)):
        raise EvidenceMissing('需要有序且无重复的完整交易日历')
    for day in days:
        date.fromisoformat(day)
    if bundle.get('calendar_complete') is not True:
        raise EvidenceMissing('交易日历完整性未确认')
    pools = bundle.get('pools', {})
    bars = bundle.get('bars', {})
    holdings: dict[str, Position] = {}
    fills: list[Fill] = []
    orders: list[Order] = []
    equity: list[EquityPoint] = []

    def bar_for(day, code):
        b = bars.get(day, {}).get(code)
        if not b or b.get('source') is None or b.get('corporate_action') is not False:
            raise EvidenceMissing(f'{day} {code} 行情/来源/除权状态缺失；除权事件尚不支持')
        if type(b.get('trading')) is not bool:
            raise EvidenceMissing(f'{day} {code} 交易状态未知')
        for k in ('open', 'close', 'limit_up', 'limit_down'):
            number(b.get(k), f'{day} {code} {k}', .01)
        number(b.get('auction_volume'), f'{day} {code} auction_volume')
        if not Decimal(str(b['limit_down'])) <= Decimal(str(b['open'])) <= Decimal(str(b['limit_up'])):
            raise EvidenceMissing(f'{day} {code} 开盘价超出已提供涨跌停范围')
        if not Decimal(str(b['limit_down'])) <= Decimal(str(b['close'])) <= Decimal(str(b['limit_up'])):
            raise EvidenceMissing(f'{day} {code} 收盘价超出已提供涨跌停范围')
        return b

    def execution(day, code, side, wanted, b):
        opening = Decimal(str(b['open']))
        lower, upper = Decimal(str(b['limit_down'])), Decimal(str(b['limit_up']))
        price = money(opening * (1 + slip if side == 'buy' else 1 - slip))
        reason = None
        if not b['trading']:
            reason = '停牌'
        elif (side == 'buy' and opening >= upper) or (side == 'sell' and opening <= lower):
            reason = '涨跌停排队不可确认，不模拟成交'
        elif not lower <= price <= upper:
            reason = '滑点后超出涨跌停价'
        max_size = int((Decimal(str(b['auction_volume'])) * part / 100).to_integral_value(rounding=ROUND_FLOOR)) * 100
        qty = min(wanted, max_size) if not reason else 0
        if not qty and not reason:
            reason = '开盘成交量参与额度不足一手'
        def fee(q):
            value = q * price
            return money(max(value * comm, minimum) + value * transfer + (value * stamp if side == 'sell' else 0))
        if side == 'buy':
            while qty and qty * price + fee(qty) > min(cash,buy_cash):
                qty -= 100
            if not qty and not reason:
                reason = '现金不足（含费用）'
        orders.append({'date':day,'code':code,'side':side,'requested':wanted,'filled':qty,
                       'reason':reason or ('成交量约束，部分成交' if qty<wanted else '按保守假设撮合')})
        if qty:
            charge = fee(qty)
            fills.append({'date':day,'code':code,'side':side,'quantity':qty,'price':float(price),'fee':float(charge)})
            return qty, price, charge
        return 0, price, Decimal(0)

    for i, day in enumerate(days):
        # Orders share one auction: do not fund buys using unconfirmed sales
        # from that same auction, or size using the future opening valuation.
        buy_cash = cash
        free_slots = capacity-len(holdings)
        budget = Decimal(str(equity[-1]['equity']))/capacity if equity else initial/capacity
        p = pools.get(day)
        if not p or p.get('complete') is not True or p.get('total') != len(p.get('stocks', [])):
            raise EvidenceMissing(f'{day} 前日完整涨停池缺失')
        if not p.get('previous_session') or p['previous_session'] >= day or (i and p['previous_session'] != days[i-1]):
            raise EvidenceMissing(f'{day} 样本日期不是前一交易日')
        known = datetime.fromisoformat(p.get('available_at', ''))
        opening_time = datetime.fromisoformat(day+'T09:15:00+08:00')
        if known.tzinfo is None or known >= opening_time:
            raise EvidenceMissing(f'{day} 样本在下单前不可用')
        stocks = p['stocks']
        if len({s['code'] for s in stocks}) != len(stocks):
            raise EvidenceMissing('样本代码重复')
        for s in stocks:
            if type(s.get('boards')) is not int or s['boards'] < 1 or type(s.get('st')) is not bool:
                raise EvidenceMissing('历史连板数/ST状态缺失')
        highest = max((s['boards'] for s in stocks), default=0)
        selected = sorted(s['code'] for s in stocks if not s['st'] and
                          (s['boards'] == 1 if pattern == 'first_board' else s['boards'] == highest and highest >= 2))
        for code in set(selected) | set(holdings):
            if not (len(code)==6 and code.isdigit() and code.startswith(('600','601','603','605','000','001','002','003'))):
                raise EvidenceMissing(f'{code} 不是本版本支持的主板普通股票；不能套用100股规则')
            bar_for(day, code)
        # Existing positions are eligible only on a later session (T+1).
        exited = set()
        for code in sorted(holdings):
            pos = holdings[code]
            if pos['day'] < day:
                qty, price, fee = execution(day, code, 'sell', pos['qty'], bar_for(day,code))
                cash += qty * price - fee
                pos['qty'] -= qty
                exited.add(code)  # no same-session churn, including blocked exits
        holdings = {c:p for c,p in holdings.items() if p['qty']}
        for code in selected:
            if code in holdings or code in exited or free_slots<=0:
                continue
            b = bar_for(day,code)
            reference = Decimal(str(b['limit_up']))
            wanted = int((min(budget,buy_cash)/reference/100).to_integral_value(rounding=ROUND_FLOOR))*100
            qty, price, fee = execution(day,code,'buy',wanted,b)
            if qty:
                cash -= qty * price + fee
                buy_cash -= qty * price + fee
                free_slots -= 1
                holdings[code] = {'qty':qty,'day':day}
        nav = cash + sum(p['qty']*Decimal(str(bar_for(day,c)['close'])) for c,p in holdings.items())
        equity.append({'date':day,'cash':float(cash),'equity':float(nav)})
    return {'status':'simulated','pattern':pattern,'fills':fills,'orders':orders,'equity':equity,
            'open_positions':holdings,'initial_cash':float(initial),'final_equity':equity[-1]['equity'],
            'fees':sum(f['fee'] for f in fills),'source':bundle['source'],
            'assumptions':{'capacity':capacity,'participation':participation,'slippage':slippage,
                           'commission_rate':commission_rate,'minimum_commission':minimum_commission,
                           'stamp_tax':stamp_tax,'transfer_fee':transfer_fee},
            'note':'保守开盘撮合实验；不是逐笔队列重建或真实成交。涨跌停排队不成交，成交量仅用开盘竞价量，期末不强平。费用为本次实验假设。'}


def main():
    import json
    import sys
    from backtest.stdio_utf8 import force_utf8_stdio
    force_utf8_stdio()
    try:
        request=json.load(sys.stdin)
        result=replay(request['bundle'], **request.get('parameters', {}))
        print(json.dumps({'ok':True,'result':result},ensure_ascii=False))
    except (EvidenceMissing, ValueError, TypeError, KeyError) as exc:
        print(json.dumps({'ok':False,'refused':{'reason':str(exc),'remedy':'补齐授权历史数据；不以当前名单、日成交量或估算涨跌停价替代。'}},ensure_ascii=False))


if __name__ == '__main__':
    main()
