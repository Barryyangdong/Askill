"""Bounded public market inventory; quote freshness comes from Tencent timestamps."""
import re
import math
from datetime import datetime
from sources.sina import _sina_hq_multi
from sources.sina import _sina_list, _SINA_JSON, _SINA_HDR
from sources._http import http_get
from sources.mappers import ev, out, extracted
from sources.tencent import tencent_quotes


def quotes_batch(codes):
    if not isinstance(codes, list) or not 1 <= len(codes) <= 200 or any(not isinstance(c, str) or not re.fullmatch(r'(?:sh|sz|bj)\d{6}', c) for c in codes):
        raise ValueError('Expected 1..200 prefixed stock codes')
    return tencent_quotes(codes)


def quotes_map(result, ctx):
    from sources.mappers_cn import tencent_quotes_map
    mapped = tencent_quotes_map(result, ctx)
    keep = {'price', 'last_close', 'open', 'high', 'low', 'change_pct', 'turnover_amount', 'limit_up_price', 'quote_time'}
    mapped['evidence'] = [e for e in mapped.get('evidence', []) if e['field'] in keep]
    mapped['missing'] = [e for e in mapped.get('missing', []) if e['field'] in keep]
    return mapped


def universe_page(page=1):
    page = int(page)
    if not 1 <= page <= 100:
        raise ValueError('page must be 1..100')
    total = None
    if page == 1:
        text = http_get(_SINA_JSON + 'Market_Center.getHQNodeStockCount', params={'node': 'hs_a'}, headers=_SINA_HDR, timeout=10, ext='json').text
        total = int(text.strip().strip('"'))
        if not 1000 <= total <= 10000:
            raise ValueError('Unexpected market inventory count')
    rows = _sina_list('Market_Center.getHQNodeData', {'page': page, 'num': 100, 'sort': 'symbol', 'asc': 1, 'node': 'hs_a', 'symbol': '', '_s_r_a': 'page'})
    stocks = []
    for row in rows:
        symbol = str(row.get('symbol', ''))
        if re.fullmatch(r'(?:sh60\d{4}|sh68\d{4}|sz00\d{4}|sz30\d{4}|bj\d{6})', symbol):
            stocks.append({'symbol': symbol, 'name': str(row.get('name', ''))})
    return {'page': page, 'total': total, 'stocks': stocks, 'source_rows': len(rows)}


def universe_map(result, ctx):
    ref = extracted(ctx, result)
    return out([ev({**ctx, 'symbol': 'MARKET', 'market': 'CN'}, 'inventory_page_count', len(result['stocks']), '只', ctx.get('as_of') or '', raw_ref=ref)], extra={'result': result})


def quote_backup(codes):
    if not isinstance(codes, list) or not 1 <= len(codes) <= 100 or any(not isinstance(c, str) or not re.fullmatch(r'(?:sh|sz|bj)\d{6}', c) for c in codes):
        raise ValueError('Expected 1..100 prefixed stock codes')
    raw = _sina_hq_multi(codes)
    return {'rows': {code: raw.get(code, []) for code in codes}, 'raw': raw.get('_raw')}


def quote_backup_map(result, ctx):
    evidence = []
    for code, values in result['rows'].items():
        if len(values) < 32:
            continue
        try:
            stamp = datetime.strptime(values[30] + ' ' + values[31], '%Y-%m-%d %H:%M:%S')
        except ValueError:
            continue
        period = stamp.date().isoformat()
        rctx = {**ctx, 'market': 'CN'}
        for field, index, unit in [('price', 3, '元'), ('last_close', 2, '元'), ('open', 1, '元'), ('high', 4, '元'), ('low', 5, '元'), ('turnover_amount', 9, '万元')]:
            try:
                value = float(values[index])
            except (ValueError, TypeError):
                continue
            if not math.isfinite(value):
                continue
            if field == 'turnover_amount':
                value /= 10000
            evidence.append(ev(rctx, field, value, unit, period, record_key=code, raw_ref=result['raw']))
        evidence.append(ev(rctx, 'quote_time', stamp.strftime('%Y%m%d%H%M%S'), 'text', period, record_key=code, raw_ref=result['raw']))
    return out(evidence, status='partial' if evidence else 'failed', degraded='新浪备源；涨跌停价缺失，不参与封板判断')
