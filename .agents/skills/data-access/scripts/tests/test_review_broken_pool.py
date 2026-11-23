from sources import review_broken_pool as pool


def test_only_dated_post_close_quotes_supply_total_cap(monkeypatch):
    day = "2026-11-20"
    base = {"name": "样本", "board": "10cm", "sector": "行业", "close": 10.0,
            "ret": 2.0, "turnover": 3.0, "broken_times": 1, "first_seal": "101200"}
    rows = [dict(base, code=code) for code in ("000001", "000002", "000003")]
    monkeypatch.setattr(pool.S, "review_day", lambda date: date)
    monkeypatch.setattr(pool.S, "is_settled", lambda _: True)
    monkeypatch.setattr(pool.S, "pool", lambda kind, date: rows if (kind, date) == ("zb", day) else [])
    monkeypatch.setattr(pool.S, "prev_trade_date", lambda _: "2026-11-19")
    monkeypatch.setattr(pool.S, "zt_pool", lambda _: [{"code": "000001"}])
    monkeypatch.setattr(pool.S, "latest_settled_session", lambda: day)
    monkeypatch.setattr(pool, "_ths_fields", lambda _: {"000001": {"limit_up_suc_rate": 0.75}})
    monkeypatch.setattr(pool, "tencent_quotes", lambda _: {
        "000001": {"price": 10.0, "mcap_yi": 12.0, "float_mcap_yi": 6.0, "quote_time": "20261120161600"},
        "000002": {"price": 10.0, "mcap_yi": 12.0, "quote_time": "20261119161600"},
        "000003": {"price": 10.0, "mcap_yi": 12.0, "quote_time": "20261120145959"},
    })
    result = pool.broken_pool(day)
    assert [row["stage"] for row in result["rows"]] == ["chain", "first", "first"]
    assert [row["total_cap"] for row in result["rows"]] == [1_200_000_000, None, None]
    assert [row["year_seal_rate"] for row in result["rows"]] == [0.75, None, None]
