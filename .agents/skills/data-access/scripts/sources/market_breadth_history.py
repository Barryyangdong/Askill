"""按已收盘交易日统计沪深京 A 股，并读取同日留存的东财涨跌分布。"""
from datetime import date as calendar_date, datetime
from decimal import Decimal, ROUND_CEILING
import json
from pathlib import Path

from common import TZ_SH
from sources import astock_ported, eastmoney
from sources._http import DataNotAvailable, capture, current_capture, last_raw_ref
from sources.shortline import review_day
from sources.shortline_watch import is_a_share


def archived_distribution(day, out_dir):
    if not out_dir:
        return []
    directory = Path(out_dir) / "raw"
    compact = day.replace("-", "")
    prefix = "eastmoney_push2ex_push2_ulist__" + compact + "T"
    if directory.is_symlink() or directory.resolve() != Path(out_dir).resolve() / "raw":
        return []
    for file in sorted(directory.glob(prefix + "*.json"), reverse=True):
        if file.is_symlink() or file.name[len(prefix):len(prefix)+6] < "150000":
            continue
        try:
            if file.stat().st_size > 64_000:
                continue
            source = json.loads(file.read_bytes()).get("data") or {}
            if str(source.get("qdate")) != compact:
                continue
            counts = {}
            for item in source.get("fenbu") or []:
                for key, count in item.items():
                    k = int(key)
                    if k in counts or type(count) is not int or count < 0:
                        raise ValueError("分档不完整")
                    counts[k] = count
            if set(counts) != set(range(-11, 12)) or not sum(counts.values()):
                continue
        except (OSError, ValueError, AttributeError, TypeError):
            continue
        return [{"key": k, "label": eastmoney._zdfb_label(k), "count": counts[k],
                 "_raw": "raw/" + file.name, "source": "eastmoney"} for k in range(11, -12, -1)]
    return []


def historical_breadth(date=None, out_dir=None):
    day = calendar_date.fromisoformat(date).isoformat() if date is not None else review_day(None)
    now = datetime.now(TZ_SH)
    if day > now.date().isoformat() or (day == now.date().isoformat() and now.hour < 15):
        raise DataNotAvailable(f"{day} 尚未收盘")
    distribution = archived_distribution(day, out_dir)
    try:
        frame = astock_ported.tdx_daily_package(day)
        if set(frame["date"]) != {day}:
            raise DataNotAvailable("盘后包与所选日期不一致")
    except (ValueError, RuntimeError, DataNotAvailable):
        # The daily package can arrive hours after close. A same-day, dated distribution
        # is already usable, and the raw response is then also available to later visits.
        if not distribution and out_dir and day == now.date().isoformat():
            outer = current_capture()
            with capture(out_dir, "eastmoney", "push2ex_push2_ulist_") as realtime:
                eastmoney.em_json("https://push2ex.eastmoney.com/getTopicZDFenBu",
                                  params={"ut": eastmoney.ZTB_UT, "dpt": "wz.ztzt"}, headers=eastmoney._REF, timeout=15)
            if outer:
                outer.raws.extend(realtime.raws)
            distribution = archived_distribution(day, out_dir)
        if not distribution:
            raise
        return {"date": day, "distribution_date": day, "buckets": distribution, "exchanges": [],
                "notes": ["该日盘后包未取得，交易所家数和成交额暂缺。"]}

    ref = last_raw_ref()
    bins = dict.fromkeys(range(-10, 11), 0)
    exchanges = {}
    for row in frame.itertuples(index=False):
        if not is_a_share(row.market, row.code) or row.amount <= 0 or row.close <= 0 or row.prev_close <= 0:
            continue
        mkt = row.market.upper()
        if mkt not in exchanges:
            exchanges[mkt] = {"market": mkt, "label": {"SH": "沪市", "SZ": "深市", "BJ": "北交所"}[mkt],
                              "up": 0, "down": 0, "flat": 0, "amount": 0.0, "source": "tdx",
                              "_raw": ref, "source_close_date": day}
        rec = exchanges[mkt]
        prev = Decimal(str(row.prev_close))
        pct = (Decimal(str(row.close)) - prev) * 100 / prev
        side = 1 if pct > 0 else -1 if pct < 0 else 0
        rec[{1: "up", -1: "down", 0: "flat"}[side]] += 1
        rec["amount"] += row.amount
        bins[side * min(10, int(abs(pct).to_integral_value(rounding=ROUND_CEILING)))] += 1
    if not exchanges:
        raise DataNotAvailable(f"{day} 无可核验的 A 股收盘记录")
    if not distribution:
        distribution = [{"key": k, "label": ("涨超 9%" if k == 10 else "跌超 9%" if k == -10 else eastmoney._zdfb_label(k)),
                         "count": bins[k], "source": "tdx", "_raw": ref} for k in range(10, -11, -1)]
    return {"date": day, "distribution_date": day, "buckets": distribution,
            "exchanges": list(exchanges.values()), "notes": []}
