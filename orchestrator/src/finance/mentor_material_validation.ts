import type { MentorCase } from "./mentors.ts";

/** Explicit, single-condition propositions that can be checked against disclosed next-session actions. */
function proposition(statement: string) {
  if (/不一定|未必|不是|不代表|不等于|不能说明|不意味着|无法|并且|或者|而且|同时|除非|[？?]/.test(statement)) return null;
  const action = /(?:次日|下一交易日|第二天)[，,\s]*(?:我)?(?:就)?(不再|不会|不|会|仍会|仍然会)?(?:新开仓|开新仓|买入新标的)[。！!\s]*$/.exec(statement);
  if (!action) return null;
  // Require the complete antecedent; a second, unparsed qualification must not silently disappear.
  const condition = statement.slice(0, action.index).trim();
  const breadth = /^(?:如果|若|当)?(?:收盘时?|当日)?下跌家数(超过|大于|达到|至少)(?:当日)?上涨家数(?:的)?(\d+(?:\.\d+)?|[一二两三四五六七八九十])倍(?:时)?[，,\s]*$/.exec(condition);
  const exposure = /^(?:如果|若|当)?(?:已有|收盘时?|收盘后)?仓位(超过|高于|达到|至少)(\d+(?:\.\d+)?|[一二两三四五六七八九十])(%|％|成)(?:时)?[，,\s]*$/.exec(condition);
  const rule = breadth ?? exposure;
  if (!rule) return null;
  const cn: Record<string, number> = { 一:1, 二:2, 两:2, 三:3, 四:4, 五:5, 六:6, 七:7, 八:8, 九:9, 十:10 };
  const n = (cn[rule[2]] ?? Number(rule[2])) * (exposure?.[3] === "成" ? 10 : 1);
  const strict = /超过|大于|高于/.test(rule[1]);
  const expected = action[1]?.startsWith("不") ? "no_open" : "open";
  const eligible = (item: MentorCase) => {
    if (!breadth) return strict ? item.positionPct > n : item.positionPct >= n;
    const up = item.scene?.metrics.find(m => m.key === "up")?.value;
    const down = item.scene?.metrics.find(m => m.key === "dn")?.value;
    if (up === undefined || down === undefined || up <= 0) return false;
    return strict ? down > up * n : down >= up * n;
  };
  return { expected, eligible };
}

export function materialActionCheck(statement: string, cases: MentorCase[], beforeDay: string) {
  const rule = proposition(statement);
  if (!rule) return null;
  const sample = cases.filter(item => item.nextDate < beforeDay && rule.eligible(item));
  const known = sample.filter(item => item.reveal.action !== "unknown");
  const agree = known.filter(item => item.reveal.action === rule.expected);
  const differ = known.filter(item => item.reveal.action !== rule.expected);
  return { total:sample.length, known:known.length, supportingCaseIds:agree.map(item=>item.id), counterCaseIds:differ.map(item=>item.id) };
}
