from sources.review_dragon import combine_dragon


def disclosure(trade_id, reason, buy=100, sell=40):
    return {
        "SECUCODE": "600001.SH", "TRADE_ID": trade_id, "SECURITY_NAME_ABBR": "样本",
        "EXPLANATION": reason, "BILLBOARD_DEAL_AMT": buy + sell,
        "BILLBOARD_BUY_AMT": buy, "BILLBOARD_SELL_AMT": sell, "BILLBOARD_NET_AMT": buy - sell,
    }


def seat(name, code, trade_id, buy, sell, net):
    return {
        "SECUCODE": "600001.SH", "TRADE_ID": trade_id, "OPERATEDEPT_NAME": name,
        "OPERATEDEPT_CODE": code, "BUY": buy, "SELL": sell, "NET": net,
    }


def test_single_day_wins_and_buy_sell_seat_union_keeps_distinct_institutions():
    one = disclosure(100, "日涨幅偏离值达到7%的前5只证券")
    many = disclosure(200, "连续三个交易日内，涨幅偏离值累计达到20%的证券", 1000, 900)
    first = seat("机构专用", "0", "100", 60, 30, 30)
    second = seat("机构专用", "0", "100", 40, 100, -60)
    hot = seat("中国银河证券股份有限公司大连黄河路证券营业部", "1", "100", 41, None, 41)
    buy = [first, second, hot, seat("普通营业部", "2", "100", 5, 2, 3), seat("其他营业部", "3", "100", 2, 1, 1)]
    sell = [first, second, hot, seat("普通营业部", "4", "100", 3, 4, -1), seat("其他营业部", "5", "100", 1, 2, -1)]
    rows = combine_dragon([one, many], buy, sell)
    assert len(rows) == 1
    row = rows[0]
    assert row["span"] == 1 and row["total"]["turnover"] == 140
    assert [x["net"] for x in row["institution"]["seats"]] == [30, -60]
    assert row["institution"]["net"] == -30
    assert row["hot"]["net"] == 41 and row["hot"]["seats"][0]["sell"] == 0


def test_incomplete_seats_are_unknown_and_three_day_disclosure_is_marked():
    row = combine_dragon([disclosure(10, "连续3个交易日累计涨幅")], [], [])[0]
    assert row["span"] == 3
    assert row["hot"]["net"] is None and row["institution"]["net"] is None
    assert row["seat_complete"] is False
