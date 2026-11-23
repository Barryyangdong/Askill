import json
import sys
from datetime import date, datetime, timedelta
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import fetch_trade_calendar as calendar


def test_archived_calendar_recovers_only_a_complete_source_window(tmp_path, monkeypatch):
    raw = tmp_path / "raw"
    raw.mkdir()
    today = date(2026, 11, 20)
    start = today - timedelta(days=2)
    rows = [{"calendar_date": (start + timedelta(days=i)).isoformat(), "is_trading_day": "1"} for i in range(3)]

    def unavailable(*args):
        raise RuntimeError("baostock 登录失败")

    def archive(time, data):
        file = raw / f"extracted_baostock_query_trade_dates_20261120T{time}_1_1234.json"
        file.write_text(json.dumps(data), encoding="utf-8")
        return file

    monkeypatch.setattr(calendar, "fetch_rows", unavailable)
    archive("130000", rows[:-1])
    archive("131000", [rows[0], rows[-1]])
    archive("132000", [*rows, rows[-1]])
    archive("133000", [*rows[:-1], {**rows[-1], "is_trading_day": "yes"}])
    with pytest.raises(RuntimeError, match="登录失败"):
        calendar.calendar_rows(start, today, tmp_path)
    source = archive("090000", rows)
    assert calendar.calendar_rows(start, today, tmp_path) == (rows, "raw/" + source.name, True)

    monkeypatch.setattr(sys, "argv", ["calendar", "--symbol", "300308", "--days", "2", "--out-dir", str(tmp_path)])
    outputs = []
    monkeypatch.setattr(calendar, "finish", lambda result, out: outputs.append(result))
    class Clock(datetime):
        hour_now = 9

        @classmethod
        def now(cls, tz=None):
            return datetime(2026, 11, 20, cls.hour_now, tzinfo=tz)
    monkeypatch.setattr(calendar, "datetime", Clock)
    for hour, phase, quote_day in [(9, "pre_open", "2026-11-19"), (10, "trading", "2026-11-20"), (16, "post_close", "2026-11-20")]:
        Clock.hour_now = hour
        calendar.main()
        result = outputs[-1]
        assert result["status"] == "ok" and result["extra"]["restored_calendar_rows"]
        assert result["extra"]["session_phase"] == phase
        assert result["extra"]["reference_quote_day"] == quote_day
        assert all(row["raw_ref"] == "raw/" + source.name for row in result["evidence"])
