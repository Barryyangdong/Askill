#!/usr/bin/env python3
"""A 股交易日历(全市场维度):最近一个交易日、今天是否交易日、近 N 天日历。源:baostock `query_trade_dates`(零鉴权 TCP)。

用途:判定 fetch_quote 的报价日期差异是"全市场休市 / 盘前"还是"个股停牌 / 陈旧"(company-research §2 依赖矩阵)。
输出(均为 evidence,symbol=MARKET,market=CN):
  last_trading_day       最近一个交易日(≤ 今天)
  previous_trading_day   上一个交易日(< last_trading_day)
  is_today_trading_day   今天是否交易日
  session_phase          pre_open(交易日 09:30 前)/ trading(09:30–15:00)/ post_close(15:00 后)/ non_trading_day
  reference_quote_day    此刻一条"新鲜"报价应携带的日期:pre_open → previous_trading_day;其余 → last_trading_day
判定规则(SOP 引用):quote_date == reference_quote_day → 正常;quote_date < reference_quote_day → 该股停牌或数据陈旧 → stale;
  pre_open 时 fetch_quote 的 is_stale=true(成交额 0 且现价 == 昨收)是盘前正常现象,不算僵尸。
与个股无关,--symbol 仅用于落盘归档(仍校验格式)。
用法:python fetch_trade_calendar.py --symbol 300308 --days 30 [--out-dir ...]
"""
from __future__ import annotations

import json
import os
import sys
from datetime import date, datetime, timedelta
from datetime import time as dtime
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import (TZ_SH, base_parser, bs_paging_error, evidence, finish, lib_versions, now_iso, parse_symbol_or_exit, quiet_stdout,
                    record_error, result_skeleton, save_raw)

SCRIPT = "fetch_trade_calendar"
EP = "query_trade_dates"


def window_rows(rows, start, today):
    """Validate the source's daily flags, including weekends, before resolving a trading day."""
    if not isinstance(rows, list):
        raise ValueError("交易日历格式无效")
    days = {}
    for row in rows:
        if not isinstance(row, dict) or row.get("is_trading_day") not in ("0", "1"):
            raise ValueError("交易日历缺少有效交易标记")
        key = row.get("calendar_date")
        if not isinstance(key, str) or date.fromisoformat(key).isoformat() != key or key in days:
            raise ValueError("交易日历日期无效或重复")
        days[key] = row
    count = (today - start).days + 1
    if not 0 < count <= len(days):
        raise ValueError("交易日历没有完整覆盖查询窗口")
    required = [(start + timedelta(days=i)).isoformat() for i in range(count)]
    if any(key not in days for key in required):
        raise ValueError("交易日历没有完整覆盖查询窗口")
    return [days[key] for key in required]


def fetch_rows(start, today):
    import baostock as bs
    with quiet_stdout():
        lg = bs.login()
        if lg.error_code != "0":
            raise RuntimeError(f"baostock 登录失败 {lg.error_code} {lg.error_msg}")
        try:
            rs = bs.query_trade_dates(start_date=start.isoformat(), end_date=today.isoformat())
            if rs.error_code != "0":
                raise RuntimeError(f"baostock 查询失败 {rs.error_code} {rs.error_msg}")
            rows = []
            while rs.next():
                rows.append(dict(zip(rs.fields, rs.get_row_data())))
            why = bs_paging_error(rs)
            if why:
                raise RuntimeError(f"baostock 翻页失败 {why}（只取到 {len(rows)} 行）")
        finally:
            bs.logout()
    return window_rows(rows, start, today)


def calendar_rows(start, today, out_dir):
    try:
        rows = fetch_rows(start, today)
    except Exception:
        if not out_dir:
            raise
        raw_dir = Path(out_dir).resolve() / "raw"
        if raw_dir.resolve() != raw_dir:
            raise
        # Each local SDK export ends at its capture date. Earlier exports cannot cover today.
        pattern = f"extracted_baostock_query_trade_dates_{today:%Y%m%d}T*.json"
        for file in sorted(raw_dir.glob(pattern), reverse=True):
            try:
                if file.resolve() != file or file.stat().st_size > 4_000_000:
                    continue
                rows = window_rows(json.loads(file.read_bytes()), start, today)
                return rows, "raw/" + file.name, True
            except (ValueError, OSError, RecursionError):
                continue
        raise
    raw = save_raw(out_dir, "baostock", EP, json.dumps(rows, ensure_ascii=False).encode("utf-8"), "json", kind="extracted")
    return rows, raw["raw_ref"], False


def main() -> None:
    p = base_parser("A 股交易日历(baostock,全市场)")
    p.add_argument("--days", type=int, default=30, help="回看天数(默认 30)")
    args = p.parse_args()
    parse_symbol_or_exit(args.symbol, SCRIPT, args.out_dir)  # 只校验格式
    res = result_skeleton(SCRIPT, "MARKET", "CN")
    try:
        today = datetime.now(TZ_SH).date()
        start = today - timedelta(days=args.days)
        rows, raw_ref, restored = calendar_rows(start, today, args.out_dir)
        trading = [r["calendar_date"] for r in rows if r.get("is_trading_day") == "1"]
        if len(trading) < 2:
            raise ValueError("回看窗口内交易日不足 2 个,无法给出上一交易日")
        last_td, prev_td = trading[-1], trading[-2]
        is_today_td = last_td == today.isoformat()
        checked = datetime.now(TZ_SH)
        if checked.date() != today:
            raise ValueError("取数期间交易日历已跨日，请重新读取")
        now = checked.time()
        if not is_today_td:
            phase = "non_trading_day"
        elif now < dtime(9, 30):
            phase = "pre_open"
        elif now < dtime(15, 0):
            phase = "trading"
        else:
            phase = "post_close"
        ref_day = prev_td if phase == "pre_open" else last_td
        for f, v, u in (("last_trading_day", last_td, "date"), ("previous_trading_day", prev_td, "date"),
                        ("is_today_trading_day", is_today_td, "bool"), ("session_phase", phase, "text"),
                        ("reference_quote_day", ref_day, "date")):
            res["evidence"].append(evidence(script=SCRIPT, symbol="MARKET", market="CN", field=f, value=v, unit=u,
                                            period=today.isoformat(), source="baostock", endpoint=EP, raw_ref=raw_ref,
                                            currency="n/a", note="extracted:SDK 行数据拼装;全市场日历,非个股;"
                                                                 "session_phase 按 Asia/Shanghai 当前时刻推算"))
        res["extra"] = {"window": [rows[0]["calendar_date"], rows[-1]["calendar_date"]], "trading_days": len(trading),
                        "last_trading_day": last_td, "previous_trading_day": prev_td, "is_today_trading_day": is_today_td,
                        "session_phase": phase, "reference_quote_day": ref_day, "checked_at": now_iso(),
                        "restored_calendar_rows": restored, "provenance": lib_versions("baostock")}
        res["primary_source"] = "baostock"
        res["status"] = "ok"
        res["used_sources"].append("baostock")
    except Exception as e:  # noqa: BLE001
        record_error(res, "baostock", EP, e)
        res["status"] = "failed"
    finish(res, args.out_dir)


if __name__ == "__main__":
    main()
