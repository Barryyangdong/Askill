"""复盘日可查的沪深 A 股证监会行业归属。"""
from datetime import date

from common import today_str
from sources._http import dump_json_bytes, record_raw
from sources.baostock_src import _rs_rows, bs_session
from sources.mappers import ev, out


def industry_members(day=None):
    target = date.fromisoformat(day or today_str()).isoformat()
    with bs_session() as bs:
        rows = _rs_rows(bs.query_stock_industry(date=target))
    raw = record_raw(dump_json_bytes(rows), "json", f"baostock://query_stock_industry/{target}", kind="extracted")
    groups = {}
    for row in rows:
        market, _, code = row.get("code", "").partition(".")
        published = row.get("updateDate", "")
        name = row.get("industry", "").strip()
        a_share = (market == "sh" and code.startswith("6")) or (market == "sz" and code.startswith(("0", "3")))
        if (not a_share or len(code) != 6 or not code.isdigit()
                or not published or published > target or not name):
            continue
        groups.setdefault(name, {})[code] = row.get("code_name", "")
    return {"day": target, "raw": raw, "groups": groups}


def industry_members_map(result, ctx):
    day = result["day"]
    groups = result["groups"]
    if not groups:
        return out([], status="failed", reason="当日没有可核实的行业分类。")
    evidence = [ev(ctx, "industry_member_count", len(members), "只", day, record_key=name,
                   raw_ref=result["raw"], as_of=day) for name, members in groups.items()]
    return out(evidence, extra={"date": day, "groups": [
        {"name": name, "stocks": [{"code": code, "name": label} for code, label in sorted(members.items())]}
        for name, members in sorted(groups.items())]})
