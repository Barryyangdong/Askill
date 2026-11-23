import pytest

from sources._http import DataNotAvailable
from sources.review_industry import parse_industry_close


def daily_page(day):
    page = f"<html><body><h1>{day} 主力资金流向</h1><p>数据日 {day}（收盘后统计） 页面生成于 {day} 23:00</p>"
    page += "<section><h2>行业资金流向（申万一级）</h2>"
    for group in range(2):
        page += "<h3>" + ["净流入前 8", "净流出前 8"][group] + "</h3>"
        amount = ["+6,480 万元", "-1.25 亿元"][group]
        for i in range(8):
            code = str(801000 + 10 * group + i)
            page += f"<div><a href='/b/{code}.SI'>行业{code}</a><span>5/6 只</span><span>{amount}</span><span>+1%</span></div>"
    return page + "</section></body></html>"


def test_reads_only_dated_closed_public_rankings():
    page = daily_page("2026-11-19")
    result = parse_industry_close(page, "2026-11-19")
    assert result["published_at"] == "2026-11-19 23:00"
    assert len(result["rows"]) == 16
    assert result["rows"][0]["net"] == 64_800_000
    assert result["rows"][8]["net"] == -125_000_000
    for invalid in (page.replace("2026-11-19", "2026-11-18"), page.replace("23:00", "13:00"),
                    page.replace("801011.SI", "801010.SI"), page.replace("1.25 亿元", "1.25 %")):
        with pytest.raises(DataNotAvailable):
            parse_industry_close(invalid, "2026-11-19")
