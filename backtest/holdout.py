"""Explicit chronological holdout, with fixed parameters and independent capital.

This is not parameter optimization or proof the user never viewed the holdout.
Each segment keeps the normal data sufficiency and execution gates.
"""
from __future__ import annotations

from datetime import date, timedelta
from dataclasses import replace
from pathlib import Path
from typing import Any

from backtest.gate import Plan, plan_backtest
from backtest.run import run, BacktestNotValid
from backtest.strategies import BUILTIN
from backtest.loader import VibeLoader


class _WindowLoader(VibeLoader):
    """Slice the already-cached full request; never fetch separate adjusted versions."""
    def __init__(self, source: VibeLoader, plan: Plan):
        self.source, self.plan = source, plan
        self.failures = dict(source.failures)
        self.provenance = {}
        self.benchmark_failures = dict(source.benchmark_failures)
        self.benchmark_provenance = {}

    def fetch(self, codes, start_date, end_date, fields=None, interval="1D"):
        full = self.source.fetch(codes, self.plan.start, self.plan.end, fields=fields, interval=interval)
        self.failures.update(self.source.failures)
        self.benchmark_failures.update(self.source.benchmark_failures)
        result = {}
        for code, df in full.items():
            part = df.loc[start_date:end_date].copy()
            if part.empty:
                self.failures[code] = "分段内没有行情"
                continue
            result[code] = part
            for source, target in [(self.source.provenance,self.provenance), (self.source.benchmark_provenance,self.benchmark_provenance)]:
                if code in source:
                    target[code] = replace(source[code], rows=len(part), first_bar=str(part.index[0].date()),
                                           last_bar=str(part.index[-1].date()), halted_bars=int(part.get('halted', []).sum()) if 'halted' in part else 0)
        return result


def split_plans(plan: Plan, split: str) -> list[Plan]:
    if not isinstance(split, str) or len(split) != 10:
        raise ValueError("验证起始日必须是 YYYY-MM-DD")
    try:
        boundary = date.fromisoformat(split)
    except (TypeError, ValueError) as exc:
        raise ValueError("验证起始日必须是 YYYY-MM-DD") from exc
    if not plan.start < split <= plan.end:
        raise ValueError("验证起始日必须在回测区间内，且晚于起始日")
    plans = []
    for start, end in [(plan.start, (boundary-timedelta(days=1)).isoformat()), (split, plan.end)]:
        p = plan_backtest(codes=plan.codes, start=start, end=end, style=plan.style.key,
                          initial_cash=plan.initial_cash, allow_short=plan.allow_short)
        if not isinstance(p, Plan):
            raise ValueError(f"分段 {start} 至 {end} 不成立：{p.reason}")
        plans.append(p)
    return plans


def compare(plan: Plan, split: str, key: str, params: dict[str, Any], loader, root: Path) -> dict:
    plans = split_plans(plan, split)
    segments: list[dict[str, Any]] = []
    for label, segment in zip(("开发区间", "留出验证区间"), plans):
        try:
            result = run(segment, BUILTIN[key](**params), loader=_WindowLoader(loader, plan), run_dir=root/str(len(segments)),
                         config_overrides={"validation": None})
            segments.append({"label": label, "start": segment.start, "end": segment.end,
                             "metrics": {k: result.metrics.get(k) for k in (
                                 "total_return", "annual_return", "max_drawdown", "sharpe",
                                 "fill_count", "trade_count", "execution_fees", "benchmark_return")},
                             "limits": result.limits, "notes": result.notes,
                             "missing": result.missing, "benchmark": result.metrics.get("benchmark_label")})
        except BacktestNotValid as exc:
            return {"complete": False, "split": split, "segments": segments, "error": str(exc)}
    return {"complete": True, "split": split, "strategy": key, "params": params, "segments": segments,
            "note": "从本轮同一行情快照切分两个区间，使用同一固定参数，各自从初始现金开始，指标各自预热，持仓不跨界；不拼接收益。"
                    "保留各段样本门槛、费用与成交约束。未在开发区间自动选优；若已看过验证结果再调参，"
                    "该段不再是未见样本。本结果不证明时点数据无偏或历史全市场选股有效。"}
