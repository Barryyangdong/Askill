"""个股 K 线的 **JSON 入口**：stdin 进 ``{symbol, period, adjust}``，stdout 出整段 K 线和均线。

给个股研究页画图用，不需要模型。取数仍走本产品的注册表端点（腾讯 K 线 / 新浪复权因子 / Yahoo chart），
代码规整、市场判定、同一只票的核对都复用 ``loader.py``，不另写一套。

🔴 A 股复权用**新浪复权因子等比换算**，不用腾讯自带的 qfq：腾讯的前复权是逐次减去每股分红的等差口径，
   高分红股的早年价格会被减成负数（茅台 2015 年 -117.6），周线 / 月线一拉长就取不到；
   不为负时涨跌幅也被放大（茅台 2020 年初原始 1130、等差前复权 870.7）。
   ⇒ 取腾讯不复权价，再用新浪因子换算，换算公式就是取数层的 ``apply_adjust``，只有一份。
🔴 成交量统一成「股」。腾讯 K 线科创板给股、其余给手 —— 按信封里证据写的单位换算，不按号段猜。
🔴 北交所明说画不了：腾讯只给最新 1 根，baostock 不支持北交所，不拿一张空图冒充。
🔴 只画 K 线、均线、成交量。不出买卖点、信号或任何「该不该买」的标记。

用法::

    echo '{"symbol":"600519","period":"day","adjust":"qfq","charts":true}' | python -m backtest.kline
"""

from __future__ import annotations

import json
import math
import sys
import tempfile
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional
from zoneinfo import ZoneInfo

import pandas as pd

from backtest.loader import (
    REPO_ROOT, LoaderError, _a_lookup, _frame_from_yahoo, _read_raw, _run_fetch, bare, canonical_code, market_of,
)
from backtest.stdio_utf8 import force_utf8_stdio

sys.path.insert(0, str(REPO_ROOT / ".agents" / "skills" / "data-access" / "scripts"))
from sources.sina import apply_adjust, parse_adjust_factor_js  # noqa: E402

PERIODS = {"day": "日线", "week": "周线", "month": "月线", "m5": "5 分钟", "m15": "15 分钟", "m60": "60 分钟"}
ADJUSTS = {"qfq": "前复权", "hfq": "后复权", "none": "不复权"}
MA_WINDOWS = (5, 10, 20, 60)
MARKET_LABELS = {"a_share": "A 股", "us_equity": "美股", "hk_equity": "港股"}
#: 各周期取多长。日线 5 年约 1200 根，界面默认只显示最近一段，其余拖动查看
A_SHARE_DAY_SPAN_DAYS = 365 * 5 + 2
A_SHARE_SPAN_DAYS: Dict[str, Optional[int]] = {"day": A_SHARE_DAY_SPAN_DAYS, "week": 365 * 10 + 3, "month": None}   # None = 从 1990-12 起
A_SHARE_FIRST_DAY = "1990-12-01"
YAHOO = {"day": ("1d", "5y"), "week": ("1wk", "10y"), "month": ("1mo", "max")}
MARKET_TZ = {"a_share": "Asia/Shanghai", "hk_equity": "Asia/Hong_Kong", "us_equity": "America/New_York"}
FETCH_TIMEOUT = 60


class KlineError(ValueError):
    """业务上画不了（代码认不出、北交所、取数失败）—— 作为 ``ok: false`` 的原因原样给界面。"""


def _num(v: Any, digits: int = 4) -> Optional[float]:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return round(f, digits) if math.isfinite(f) else None


def _envelope_ok(env: Dict[str, Any], endpoint: str) -> None:
    if env.get("status") == "failed":
        raise KlineError(f"{endpoint} 没有取到数据：{env.get('note') or env.get('degraded') or '未说明原因'}")


def _volume_unit(env: Dict[str, Any]) -> Optional[str]:
    units = {e.get("unit") for e in env.get("evidence") or [] if e.get("field") == "kline_volume"}
    return units.pop() if len(units) == 1 else None


def _market_today(market: str) -> date:
    """该市场当地的今天。不用本机 date.today()：本机在海外时区时日期可能还停在前一天，
    请求截止日写成昨天，下游按日期过滤就拿不到已收盘的当天（2026-10-11 审计）。"""
    return datetime.now(ZoneInfo(MARKET_TZ[market])).date()


def _a_share(code: str, period: str, adjust: str, out_dir: Path) -> Dict[str, Any]:
    six, ex = bare(code), code.split(".")[-1]
    if ex == "BJ":
        raise KlineError("北交所暂时画不了 K 线：腾讯 K 线对北交所只返回最新一根，baostock 也不提供北交所")
    try:
        _, is_stock = _a_lookup(six)
    except LoaderError:
        is_stock = True
    minute = period in ("m5", "m15", "m60")
    span = A_SHARE_SPAN_DAYS.get(period)
    today = _market_today("a_share")
    start = (today - timedelta(days=span)).isoformat() if span else A_SHARE_FIRST_DAY
    # 🔴 取**不复权**价，复权在下面用新浪因子做（原因见模块说明）
    args = {"period": period, "adjust": "", "count": 320} if minute else {"period": period, "adjust": "", "start": start, "end": today.isoformat()}
    env = _run_fetch("tx_kline", code, args, out_dir, sys.executable, FETCH_TIMEOUT)
    _envelope_ok(env, "腾讯 K 线")
    refs = [r for r in (env.get("extra") or {}).get("raw_files") or [] if Path(r).name.startswith("extracted_")]
    if not refs:
        raise KlineError("腾讯 K 线信封里没有抽取后的序列文件")
    rows = (_read_raw(out_dir, refs[-1]).get("rows")) or []
    if minute:
        stamps = set()
        for row in rows:
            stamp = row.get("datetime")
            try:
                datetime.strptime(stamp, "%Y-%m-%d %H:%M")
            except (TypeError, ValueError) as exc:
                raise KlineError("分钟线时间格式无效") from exc
            if stamp in stamps:
                raise KlineError("分钟线存在重复时刻")
            stamps.add(stamp)
            row["date"], row["adjust"] = stamp, "none"
    want = f"{ex.lower()}{six}"
    got = {str(r.get("code") or "") for r in rows}
    if got != {want}:
        raise KlineError(f"要的是 {want}，取回来的是 {sorted(got) or '空'} —— 不是同一只，已中止")
    if {str(r.get("adjust") or "") for r in rows} != {"none"}:
        raise KlineError("腾讯 K 线返回的不是不复权价，无法再按复权因子换算")
    notes: List[str] = []
    if minute:
        notes.append("北京时间，最多最近 320 根不复权分钟线；最后一根可能尚未结束。不是完整历史分钟库，不能据此进行长期分钟回测。")
        notes.append("分钟成交量可能由来源在下一交易日回填；涨跌幅相对上一根收盘，不是当日涨跌幅。")

    unit = _volume_unit(env)
    scale = {"股": 1, "手": 100}.get(unit or "")
    if scale is None:
        notes.append(f"成交量单位没法确认（信封写的是 {unit or '空'}），这次不画成交量")

    adjust_label, adjusted = ADJUSTS[adjust], False
    if adjust != "none":
        fenv = _run_fetch("sina_adjust_factor", code, {"kind": adjust}, out_dir, sys.executable, FETCH_TIMEOUT)
        factors: List[Dict[str, Any]] = []
        if fenv.get("status") != "failed":
            frefs = list((fenv.get("extra") or {}).get("raw_files") or [])
            if frefs:
                try:
                    factors = parse_adjust_factor_js((out_dir / frefs[0]).read_text(encoding="utf-8"), code)
                except (OSError, UnicodeDecodeError, ValueError, RuntimeError) as exc:
                    raise KlineError(f"复权因子读不了：{exc}") from exc
        if factors:
            try:
                rows = apply_adjust(rows, factors, kind=adjust)
            except (ValueError, RuntimeError) as exc:
                raise KlineError(f"按复权因子换算失败：{exc}。可以先切到「不复权」看") from exc
            adjust_label, adjusted = adjust_label + "（等比，按新浪复权因子）", True
            if period != "day":
                notes.append("周线 / 月线里含除权日的那一根，整根按该周期最后一天的因子换算，开盘价会有小偏差")
        elif is_stock:
            raise KlineError("复权因子没有取到，换算不了。可以先切到「不复权」看")
        else:
            # ETF / 指数：新浪对它们可能没有因子 —— 明说显示的是原始价，不当复权价
            adjust_label = "不复权（这只没有复权因子）"
    return {"rows": rows, "volume_scale": scale, "source": "腾讯 K 线" + ("、新浪复权因子" if adjusted else ""),
            "endpoint": "tx_kline", "fetched_at": env.get("fetched_at"), "adjust_label": adjust_label,
            "adjust": adjust if adjusted else "none", "notes": notes}


def _yahoo(code: str, market: str, period: str, adjust: str, out_dir: Path) -> Dict[str, Any]:
    interval, range_ = YAHOO[period]
    symbol = code if market == "hk_equity" else bare(code)
    env = _run_fetch("yahoo_kline", symbol, {"interval": interval, "range_": range_}, out_dir, sys.executable, FETCH_TIMEOUT)
    _envelope_ok(env, "Yahoo K 线")
    refs = list((env.get("extra") or {}).get("raw_files") or [])
    payload = _read_raw(out_dir, refs[0]) if refs else {}
    meta = (((payload.get("chart") or {}).get("result") or [{}])[0].get("meta") or {})
    want = str(int(bare(code))).zfill(4) + ".HK" if market == "hk_equity" else symbol
    if str(meta.get("symbol") or "").upper() != want.upper():
        raise KlineError(f"要的是 {want}，取回来的是 {meta.get('symbol') or '空'} —— 不是同一只，已中止")
    df, dropped = _frame_from_yahoo(payload, tz=str(meta.get("exchangeTimezoneName") or MARKET_TZ[market]))
    notes = []
    if period != "day" and len(df) >= 2:
        # Yahoo 的周线 / 月线末尾会多一行「当前报价」快照，与本周期那根重复（实测 AAPL、00700.HK 都有）；
        # 两者成交量口径不同，合并会重复计数 ⇒ 去掉快照，本周期那根可能还没算进今天
        last, prev = df.index[-1], df.index[-2]
        same = (last - prev).days < 7 if period == "week" else (last.year, last.month) == (prev.year, prev.month)
        if same:
            df = df.iloc[:-1]
            notes.append("最后一根是本周期至今的数据，可能还没算进今天")
        notes.append("周线 / 月线按周期第一天标日期")
    if adjust != "qfq":
        notes.append("港美股只有拆股已调整的价格，复权选项不适用")
    if dropped:
        notes.append(f"有 {dropped} 根缺开高低收或价格不为正，已去掉")
    rows = [{"date": str(pd.Timestamp(ix).date()), **{k: r[k] for k in ("open", "high", "low", "close", "volume")}}
            for ix, r in df.iterrows()]
    return {"rows": rows, "volume_scale": 1, "source": "Yahoo chart", "endpoint": "yahoo_kline",
            "fetched_at": env.get("fetched_at"), "adjust": "split", "adjust_label": "拆股已调整（不含分红）", "notes": notes}


def structure_series(series: Dict[str, Any]) -> Dict[str, Any]:
    """Trailing-only descriptive readings, with full windows and explicit gaps."""
    close = pd.Series(series["close"], dtype="float64")
    high = pd.Series(series["high"], dtype="float64")
    low = pd.Series(series["low"], dtype="float64")
    opened = pd.Series(series["open"], dtype="float64")
    volume = pd.Series(series["volume"], dtype="float64")
    span = (high - low).where(high > low)
    high20, low20 = high.rolling(20).max(), low.rolling(20).min()
    width20 = (high20 - low20).where(high20 > low20)
    previous_volume = volume.shift(1).rolling(5).mean()
    mean20, std20 = close.rolling(20).mean(), close.rolling(20).std(ddof=0)
    values = {
        "range20": (close - low20) / width20,
        "volume5": volume / previous_volume.where(previous_volume > 0),
        "upper_wick": (high - pd.concat([opened, close], axis=1).max(axis=1, skipna=False)) / span,
        "lower_wick": (pd.concat([opened, close], axis=1).min(axis=1, skipna=False) - low) / span,
        "band_upper": mean20 + 2 * std20,
        "band_middle": mean20,
        "band_lower": mean20 - 2 * std20,
    }
    return {key: [_num(v, 6) for v in values] for key, values in values.items()}


def build(req: Dict[str, Any], out_dir: Path) -> Dict[str, Any]:
    raw = req.get("symbol")
    if not isinstance(raw, str) or not raw.strip() or len(raw) > 20:
        raise KlineError("请给一个代码，如 600519 / AAPL / 00700.HK")
    period = req.get("period", "day")
    if period not in PERIODS:
        raise KlineError("period 只能是 day / week / month / m5 / m15 / m60")
    minute = period in ("m5", "m15", "m60")
    adjust = req.get("adjust", "none" if minute else "qfq")
    if adjust not in ADJUSTS:
        raise KlineError("adjust 只能是 qfq / hfq / none")
    try:
        code = canonical_code(raw)
        market = market_of(code)
    except LoaderError as exc:
        raise KlineError(str(exc)) from exc
    if minute and (market != "a_share" or adjust != "none"):
        raise KlineError("分钟图仅支持沪深不复权行情，请选择不复权；港美股分钟图暂未接入")
    try:
        got = _a_share(code, period, adjust, out_dir) if market == "a_share" else _yahoo(code, market, period, adjust, out_dir)
    except LoaderError as exc:
        raise KlineError(str(exc)) from exc

    rows = sorted(got["rows"], key=lambda r: r["date"])
    if not rows:
        raise KlineError("区间内一根 K 线都没有")
    close = pd.Series([float(r["close"]) for r in rows])
    scale = got["volume_scale"]
    series: Dict[str, Any] = {
        "dates": [r["date"] for r in rows],
        "open": [_num(r["open"]) for r in rows],
        "high": [_num(r["high"]) for r in rows],
        "low": [_num(r["low"]) for r in rows],
        "close": [_num(r["close"]) for r in rows],
        "volume": [(int(round(float(r["volume"]) * scale)) if scale and _num(r.get("volume")) is not None else None) for r in rows],
        # 相对上一根收盘；第一根没有上一根
        "change": [None] + [_num(close.iloc[i] / close.iloc[i - 1] - 1, 6) if close.iloc[i - 1] > 0 else None for i in range(1, len(rows))],
        # 收盘价简单移动平均；不够天数的位置是 None，不拿更短的窗口凑
        "ma": {str(n): [_num(v) for v in close.rolling(n).mean()] for n in MA_WINDOWS},
    }
    series["structure"] = structure_series(series)
    i_hi = max(range(len(rows)), key=lambda i: series["high"][i] or float("-inf"))
    i_lo = min(range(len(rows)), key=lambda i: series["low"][i] if series["low"][i] is not None else float("inf"))
    notes = list(got["notes"])
    if series["dates"][-1] == _market_today(market).isoformat():
        notes.append("最后一根是今天：在交易时段内取数时，它还没收盘")
    result: Dict[str, Any] = {
        "symbol": code, "market": market, "market_label": MARKET_LABELS[market],
        "period": period, "period_label": PERIODS[period],
        "adjust": got["adjust"], "adjust_label": got["adjust_label"],
        "source": got["source"], "endpoint": got["endpoint"], "fetched_at": got["fetched_at"],
        "volume_unit": "股" if scale else None,
        "bars": len(rows), "first": series["dates"][0], "last": series["dates"][-1],
        "latest": {k: series[k][-1] for k in ("open", "high", "low", "close", "volume", "change")},
        "ma_latest": {n: v[-1] for n, v in series["ma"].items()},
        "window_high": {"value": series["high"][i_hi], "date": series["dates"][i_hi]},
        "window_low": {"value": series["low"][i_lo], "date": series["dates"][i_lo]},
        "notes": notes,
    }
    if req.get("charts") is True:
        # 整段序列只给界面画图；Agent 那条路不带（上千根 K 线对写报告没用，还会挤占上下文）
        result["ui_only"] = {"series": series}
    return result


CATALOG = {
    "description": "个股 K 线 + 收盘价均线（5/10/20/60）+ 成交量。A 股走腾讯不复权价再按新浪复权因子等比换算；"
                   "港美股走 Yahoo（拆股已调整、不含分红）。不支持北交所。只给行情，不给买卖点。",
    "parameters": {
        "symbol": "600519 / 600519.SH / AAPL / 00700.HK",
        "period": "day（近 5 年）/ week（近 10 年）/ month（全部）/ m5、m15、m60（沪深最近最多 320 根，只有不复权）",
        "adjust": "qfq 前复权 / hfq 后复权 / none 不复权（只对 A 股有效）",
        "charts": "true 时附整段序列（界面画图用）",
    },
}


def main() -> None:
    force_utf8_stdio()
    raw = sys.stdin.read()
    try:
        req = json.loads(raw) if raw.strip() else {}
    except json.JSONDecodeError as exc:
        print(json.dumps({"ok": False, "error": f"入参不是合法 JSON：{exc}"}, ensure_ascii=False))
        return
    if not isinstance(req, dict):
        print(json.dumps({"ok": False, "error": "入参必须是对象"}, ensure_ascii=False))
        return
    if req.get("action") == "catalog":
        print(json.dumps({"ok": True, "catalog": CATALOG}, ensure_ascii=False))
        return
    try:
        with tempfile.TemporaryDirectory(prefix="vra-kline-") as scratch:
            result = build(req, Path(scratch))
    except KlineError as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
        return
    print(json.dumps({"ok": True, "result": result}, ensure_ascii=False, allow_nan=False))


if __name__ == "__main__":
    main()
