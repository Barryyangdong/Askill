"""公开收盘日页中申万一级行业资金净额的两端榜单。"""
import re
from datetime import datetime

from lxml import html

from sources._http import DataNotAvailable, http_get
from sources.mappers import out, rows_fields
from sources.shortline import review_day


def parse_industry_close(text: str, day: str) -> dict:
    doc = html.fromstring(text)
    heading = doc.xpath("normalize-space(//h1)")
    body = " ".join(doc.xpath("//body//text()[not(ancestor::script) and not(ancestor::style)]"))
    generated = re.search(r"页面生成于\s*(\d{4}-\d{2}-\d{2} \d{2}:\d{2})", body)
    if (heading != f"{day} 主力资金流向" or not re.search(rf"数据日\s*{re.escape(day)}\s*（收盘后统计）", body)
            or not generated or datetime.fromisoformat(generated[1]) < datetime.fromisoformat(day + " 15:00")):
        raise DataNotAvailable(f"{day} 的申万一级收盘统计未核验")
    sections = doc.xpath("//h2[normalize-space(.)='行业资金流向（申万一级）']")
    if len(sections) != 1:
        raise DataNotAvailable("当日收盘页未提供行业资金表")
    rows = []
    group = ""
    counts = {}
    codes = set()
    for node in sections[0].itersiblings():
        if node.tag == "h2":
            break
        if node.tag == "h3":
            group = node.text_content().strip()
            if group not in ("净流入前 8", "净流出前 8") or group in counts:
                break
            counts[group] = 0
        links = node.xpath("./a[@href]")
        if not group or not links:
            continue
        cells = node.xpath("./span")
        code = re.search(r"/b/(\d{6})\.SI$", links[0].get("href") or "")
        if not code or len(cells) != 3:
            continue
        amount = re.fullmatch(r"([+-]?[\d,]+(?:\.\d+)?)\s*(亿元|万元|元)", cells[1].text_content().strip())
        name = links[0].text_content().strip()
        if not name or not amount or code[1] in codes:
            continue
        net = float(amount[1].replace(",", "")) * {"元": 1, "万元": 10_000, "亿元": 100_000_000}[amount[2]]
        rows.append({"code": code[1], "name": name, "net": net})
        counts[group] += 1
        codes.add(code[1])
    if counts != {"净流入前 8": 8, "净流出前 8": 8}:
        raise DataNotAvailable("当日公开行业榜单不完整")
    return {"date": day, "rows": rows, "published_at": generated[1]}


def industry_close(date=None):
    day = review_day(date)
    url = f"https://www.yyqyx.com/moneyflow/{day}"
    response = http_get(url, timeout=10, encoding="utf-8", ext="html")
    response.raise_for_status()
    return {**parse_industry_close(response.text, day), "source_url": url}


def industry_close_map(result: dict, ctx: dict) -> dict:
    day = result["date"]
    evidence = rows_fields(ctx, result["rows"], [("net", "board_net_sw_close", "元")],
                           period_of=lambda row: day, key_of=lambda row: "sw|" + row["code"],
                           note_of=lambda row: row["name"])
    return out(evidence, extra={"source_close_date": day, "date": day, "source_url": result["source_url"],
                                "published_at": result["published_at"], "scope": "申万一级，净额最高与最低各8个行业"})
