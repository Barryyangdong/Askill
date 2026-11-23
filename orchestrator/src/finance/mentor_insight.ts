import { ServiceError, type ServiceContext } from "../service.ts";
import type { MentorCase, MentorPack } from "./mentors.ts";
import { archiveMeasurements, compareMentorCases, type ArchiveMarketDay } from "./mentor_case_comparison.ts";
import { sharedArchiveMarketDay } from "./mentor_archive_market.ts";
import { emptyFrame, marketFrame, previousFrames, selectedCloseDate, type MarketFrame } from "./mentor_insight_market.ts";
import { tradeWindow } from "./shortline/history.ts";
import type { Direction } from "./shortline/verify_metrics.ts";

export interface InsightEvidence {
  id:string; kind:"market"|"behavior"|"quote"|"case"; title:string; text:string;
  source:string; date:string; url?:string; caseId?:string;
}
export interface InsightClaim { title:string; text:string; evidenceIds:string[] }
export interface InsightCondition { metric:string; direction:Direction; reason:string }
export interface MentorInsight {
  mentorId:string; mentorName:string; version:string; date:string; asOf:string;
  status:"ready"|"partial"|"unavailable"; headline:string; summary:string;
  observations:InsightClaim[]; counterpoints:InsightClaim[]; evidence:InsightEvidence[];
  reasoning?:InsightClaim;
  conditions:InsightCondition[]; gaps:string[]; hintedCaseIds:string[];
}
type Previous = { date:string; frame:MarketFrame };
const percent = (n:number) => n.toFixed(2)+"%";
const beforeClose = (timestamp:string,date:string) => timestamp.slice(0,10)<date ||
  (timestamp.slice(0,10)===date && timestamp.length>10 && timestamp.slice(11,16)<="15:00");

function nearbyModern(frame:MarketFrame,previous:Previous[]) {
  if (frame.feedback===null || frame.promotion===null || frame.broken===null) return;
  const hits = [];
  for (const d of previous) {
    const old = d.frame;
    if (old.feedback===null || old.promotion===null || old.broken===null) continue;
    const diffs = [Math.abs(frame.feedback-old.feedback)/2, Math.abs(frame.promotion-old.promotion)/0.15,
      Math.abs(frame.broken-old.broken)/0.15];
    if (Math.max(...diffs)<=1) hits.push({day:d, distance:diffs.reduce((a,b)=>a+b,0)});
  }
  return hits.sort((a,b)=>a.distance-b.distance || b.day.date.localeCompare(a.day.date))[0]?.day;
}

/** Deterministic, point-in-time evidence bundle; chat is grounded separately in this same bundle. */
export function buildMentorInsight(pack:MentorPack,date:string,frame:MarketFrame,previous:Previous[]=[], now=new Date(),shared?:ArchiveMarketDay):MentorInsight {
  const archive = pack.cases.find(c=>c.date===date && c.scene) ?? (shared?.date===date ? shared : undefined);
  const eligible = pack.cases.filter(c=>c.nextDate<=date && c.date<date);
  const allActionsKnownBy = pack.cases.map(c=>c.nextDate).sort().at(-1);
  const archiveMode = !!archive?.scene;
  const closeMs = Date.parse(date+"T15:00:00+08:00"), lastMs = Date.parse(date+"T23:59:59.999+08:00");
  const sameDaySnapshots = frame.fetchedAt.map(s=>Date.parse(s)).filter(t=>t>=closeMs && t<=lastMs && t<=now.getTime());
  const endMs = archiveMode ? closeMs : Math.max(closeMs,...sameDaySnapshots);
  const insight:MentorInsight = {mentorId:pack.id,mentorName:pack.name,version:pack.version,date,asOf:new Date(endMs).toISOString(),
    status:"unavailable",headline:"这一天的短线结构尚待核实",summary:"",observations:[],counterpoints:[],conditions:[],evidence:[],
    gaps:[...frame.gaps],hintedCaseIds:[]};
  const record = (key:string,e:Omit<InsightEvidence,"id">) => {
    const id = pack.id+"/"+key;
    if (!insight.evidence.some(v=>v.id===id)) insight.evidence.push({id,...e});
    if (e.caseId && !insight.hintedCaseIds.includes(e.caseId)) insight.hintedCaseIds.push(e.caseId);
    return id;
  };
  const market = (key:string,title:string,text:string,source:string,day=date) =>
    record("market/"+day+"/"+key,{kind:"market",date:day,title,text,source});
  const addCase = (item:MentorCase,details:string) => record("case/"+item.id, {kind:"case",title:item.date+" 收盘案例",date:item.date,
    text:[details,`${item.nextDate} 的成交记录：${item.reveal.summary}`].filter(Boolean).join("。"),
    source:item.reveal.sources.join("；"),url:item.reveal.sourcePosts?.[0]?.url,caseId:item.id});

  const facts = archiveMode ? archiveMeasurements(archive) : null;
  const breadth = facts ? facts.breadth : frame.breadth;
  const feedback = facts ? facts.premium : frame.feedback;
  const feedbackLabel = facts ? "昨日近涨停组平均涨幅" : "昨日涨停股今日涨幅中位数";
  const population = facts ? "历史涨跌幅样本" : "沪深京收盘样本";
  const factsIds:string[] = [];
  if (breadth!==null) factsIds.push(market("breadth","市场广度",`${population}中上涨占涨跌家数的 ${percent(breadth)}，分母剔除平盘。`,
    archiveMode ? archive.scene!.metrics.find(m=>m.key==="up")!.source : frame.sources.cn_market_breadth_history));
  if (feedback!==null) factsIds.push(market("feedback",feedbackLabel,feedbackLabel+" "+percent(feedback),
    archiveMode ? archive.scene!.metrics.find(m=>m.key==="premium")!.source : frame.sources.cn_shortline_daily));
  const marketBasis = factsIds.length>0;
  const broad = breadth===null ? null : breadth>=50;
  const kept = feedback===null ? null : feedback>0;
  const marketState = breadth===null ? "" : breadth>50 ? "上涨股多于下跌股"
    : breadth===50 ? "涨跌家数持平" : "下跌股多于上涨股";
  const group = facts ? "昨日近涨停股" : "昨日涨停股";
  const groupState = feedback===null ? "" : group+(feedback>0 ? "整体继续上涨" : feedback===0 ? "整体涨幅为零" : "整体回落");
  if (marketBasis) insight.headline = [marketState,groupState].filter(Boolean).join("，");
  insight.summary = marketBasis ? [
    breadth===null ? "全市场涨跌家数暂缺" : `在有涨跌的股票里，今天上涨的占 ${percent(breadth)}`,
    feedback===null ? `${group}今天的表现暂缺` : facts ? `${group}今天平均涨跌幅为 ${percent(feedback)}`
      : `${group}今天涨跌幅的中位数为 ${percent(feedback)}`,
  ].join("。")+"。" : "当前没有足够的同日数据可判断市场广度和昨日强势股的表现。";
  if (marketBasis) insight.observations.push({title:"盘面里的两组股票",text:[
    breadth===null ? "市场广度缺失" : `上涨占涨跌家数 ${percent(breadth)}`,
    feedback===null ? "强势股反馈缺失" : `${feedbackLabel} ${percent(feedback)}`].join("；")+"。",evidenceIds:[...factsIds]});

  // This statistic was built from the entire archive. Historical replays cannot cite it early.
  if (pack.behavior && allActionsKnownBy && date>=allActionsKnownBy) {
    const b = pack.behavior;
    const id = record("behavior/"+pack.version,{kind:"behavior",date:allActionsKnownBy,title:b.title,
      text:[b.scope,...b.metrics.map(m=>m.label+" "+m.value+"；"+m.comparison),b.interpretation].join("\n"),source:b.source});
    const preference = b.metrics.find(m=>m.label.includes("近涨停")) ?? b.metrics[0];
    insight.observations.push({title:"公开成交里的选股倾向",text:preference
      ? preference.label+" "+preference.value+"（"+preference.comparison+"）。" : b.scope,evidenceIds:[id,...factsIds.slice(-1)]});
  }
  // For the reviewed profile the linkage is from each editorial hypothesis to a dated original quote.
  // New profiles have their own methods and do not inherit this person's market priorities.
  const knownMethods = pack.methods.filter(m=>beforeClose(m.quoteDate,date));
  const preferred = feedback!==null ? "follow" : "plan";
  const method = knownMethods.find(m=>m.id===preferred) ?? knownMethods[0];
  const quote = method ? pack.quotes.find(q=>q.date===method.quoteDate)
    : [...pack.quotes].filter(q=>beforeClose(q.date,date)).sort((a,b)=>b.date.localeCompare(a.date))[0];
  if (quote) {
    const id = record("quote/"+quote.date,{kind:"quote",date:quote.date,title:method?.title??"人物原话",text:quote.text,source:quote.source,url:quote.url});
    insight.observations.push({title:method?.title??"同期人物表达",text:method?.principle??quote.text,evidenceIds:[id]});
    if (pack.id==="tuixue" && method?.id==="follow" && feedback!==null) {
      const interpretation = feedback<0
        ? "上一交易日领涨的这批股票今天整体走弱。即使有个股逆势上涨，也要看到同题材的其他股票跟上，才有理由说这个题材在回暖。"
        : feedback===0
          ? "昨天领涨的这批股票今天整体原地踏步，题材有没有延续，需要再看同题材个股有没有一起走强。"
          : "昨天领涨的这批股票今天整体仍在涨。接下来要看上涨是否扩散到同题材的其他股票，才能区分少数强股和整个题材的走强。";
      insight.reasoning = {title:"按他的复盘方法，先看题材里有多少股票跟上",
        text:"他复盘山鼎设计时，分别说了自己已经买入、次新股整体表现，以及第二天还要观察什么。"+interpretation+
          "到下一个交易日，核对同题材上涨的股票是否变多，并继续跟踪今天统计的这批股票。仅凭全市场涨跌家数，推不出他本人会怎么做。",
        evidenceIds:[id,...factsIds]};
    }
  }
  for (const available of knownMethods) {
    if (available===method) continue;
    const original=pack.quotes.find(item=>item.date===available.quoteDate);
    if (original) record("quote/"+original.date,{kind:"quote",date:original.date,title:available.title,
      text:original.text,source:original.source,url:original.url});
  }

  // 蒸馏：把这个人更多"早于复盘日"且与盘面主题相关的原话补进证据，
  // 让 AI 有足够的本人发言可引用，说话才贴本人而不是泛泛复述方法卡标题。
  if (pack.id === "tuixue") {
    const seenQuotes = new Set(insight.evidence.filter(e => e.kind === "quote").map(e => e.date));
    const topicality = (text: string) =>
      (/题材|合力|次新|板块|主线|龙头|跟随|轮动|接力/.test(text) ? 3 : 0) +
      (/涨停|强势|溢价|连板|打板|封板|炸板|一字/.test(text) ? 3 : 0) +
      (/涨跌|家数|普涨|普跌|广度|指数|大盘|情绪|赚钱/.test(text) ? 2 : 0) +
      (/仓位|空仓|重仓|满仓|轻仓|加仓|减仓|持有|买入|卖出/.test(text) ? 2 : 0) +
      (/计划|临场|冲动|纪律|反思|节奏|心态|犹豫/.test(text) ? 1 : 0);
    const extra = pack.quotes
      .filter(q => beforeClose(q.date, date) && !seenQuotes.has(q.date))
      .map(q => ({ q, score: topicality(q.text) }))
      .filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score || b.q.date.localeCompare(a.q.date))
      .slice(0, 14);
    let quoteSeq = 0;
    for (const { q } of extra) {
      record("quote-extra/" + (quoteSeq++), {kind:"quote",date:q.date,title:"本人发言",text:q.text,source:q.source,url:q.url});
    }
  }

  if (archiveMode) {
    const hits = compareMentorCases(archive,eligible);
    const first = hits[0];
    const opposite = first && hits.find(h=>h.item.reveal.action!==first.item.reveal.action);
    if (first) {
      const id = addCase(first.item,first.common.join("；"));
      insight.observations.push({title:"同口径的历史盘面",text:first.common.join("；")+"。",evidenceIds:[id,...factsIds]});
    } else if (eligible.length) insight.gaps.push("此前可回放的案例中，未找到市场广度、昨日近涨停溢价和上证当日涨幅均接近的一天。");
    if (opposite) {
      const id = addCase(opposite.item,opposite.common.join("；"));
      insight.counterpoints.push({title:"接近的盘面出现了另一种动作",text:opposite.item.nextDate+" 的成交："+opposite.item.reveal.summary,evidenceIds:[id]});
    }
    insight.gaps.push(...archive.scene!.missing.map(g=>g.label+"："+g.reason));
    if (eligible.length) insight.gaps.push("交割单按实际成交日事后重建。原帖披露时间未逐笔核实，历史动作仅作回放对照。");
  } else {
    // 蒸馏：把今日盘面按 archive 口径近似，回看退学在类似盘面下当时怎么做的，
    // 让"往期能力"进入今日研判，而不是只对照近 35 天本地定稿。
    if (pack.id === "tuixue" && frame.breadth !== null && pack.cases.length) {
      const todayBreadth = frame.breadth;
      const similar: { c: MentorCase; f: { breadth: number; premium: number }; distance: number }[] = [];
      for (const c of pack.cases) {
        if (c.nextDate > date || c.reveal.action === "unknown" || !c.scene) continue;
        const f = archiveMeasurements(c);
        if (f.breadth === null || f.premium === null) continue;
        const dB = Math.abs(todayBreadth - f.breadth) / 15;
        const dP = frame.feedback === null ? 0 : Math.abs(frame.feedback - f.premium) / 3;
        if (Math.max(dB, dP) > 1) continue;
        similar.push({ c, f: { breadth: f.breadth, premium: f.premium }, distance: (dB + dP) / 2 });
      }
      similar.sort((a, b) => a.distance - b.distance || b.c.date.localeCompare(a.c.date));
      if (similar.length) {
        const opened = similar.filter(h => h.c.reveal.action === "open").length;
        const top = similar[0];
        const id = record("behavior/similar-history/" + date, {
          kind: "behavior", date, title: "退学在类似盘面下的历史动作",
          text: `${similar.length} 个历史收盘日与今日广度、昨日强势股反馈接近，其中 ${opened} 天次日新开仓、${similar.length - opened} 天未开仓。最近似的是 ${top.c.date}（广度 ${top.f.breadth.toFixed(1)}%、昨日近涨停组平均 ${top.f.premium.toFixed(2)}%），${top.c.nextDate} ${top.c.reveal.summary}`,
          source: "人物资料包 · 2017 年交割单与收盘行情",
        });
        insight.observations.push({
          title: "退学遇到类似盘面时怎么做",
          text: `${similar.length} 个类似历史日里 ${opened} 天次日开仓。最近似 ${top.c.date}：广度 ${top.f.breadth.toFixed(1)}%、昨日近涨停组平均 ${top.f.premium.toFixed(2)}%，${top.c.nextDate} ${top.c.reveal.summary}`,
          evidenceIds: [id, ...factsIds],
        });
      } else {
        // 今日盘面比历史收录的极端日更极端，找不到广度与昨日强势股反馈都接近的交易日。
        // 退而求其次：取广度最接近的前三个历史日，把"今日比历史更极端"这个事实本身讲出来。
        const nearest: { c: MentorCase; breadth: number; premium: number }[] = [];
        for (const c of pack.cases) {
          if (c.nextDate > date || c.reveal.action === "unknown" || !c.scene) continue;
          const f = archiveMeasurements(c);
          if (f.breadth === null || f.premium === null) continue;
          nearest.push({ c, breadth: f.breadth, premium: f.premium });
        }
        nearest.sort((a, b) => Math.abs(todayBreadth - a.breadth) - Math.abs(todayBreadth - b.breadth) || b.c.date.localeCompare(a.c.date));
        const top3 = nearest.slice(0, 3);
        if (top3.length) {
          const opened = top3.filter(x => x.c.reveal.action === "open").length;
          const top = top3[0];
          const id = record("behavior/similar-history/" + date, {
            kind: "behavior", date, title: "退学在最接近的历史盘面下的动作",
            text: `今日广度 ${todayBreadth.toFixed(1)}% 比历史收录的极端日更极端，未找到广度与昨日强势股反馈都接近的交易日。最接近的 ${top3.length} 个历史日里 ${opened} 天次日新开仓；最近是 ${top.c.date}（广度 ${top.breadth.toFixed(1)}%、昨日近涨停组平均 ${top.premium.toFixed(2)}%），${top.c.nextDate} ${top.c.reveal.summary}`,
            source: "人物资料包 · 2017 年交割单与收盘行情",
          });
          insight.observations.push({
            title: "退学遇到类似盘面时怎么做",
            text: `今日广度 ${todayBreadth.toFixed(1)}% 比收录历史更极端；最接近的 ${top3.length} 日里 ${opened} 天开仓，最近 ${top.c.date}（广度 ${top.breadth.toFixed(1)}%）${top.c.nextDate} ${top.c.reveal.summary}`,
            evidenceIds: [id, ...factsIds],
          });
        }
      }
    }
    if (frame.promotion!==null || frame.broken!==null || frame.height!==null) {
      const text = [frame.promotion===null ? "" : "首板晋级率 "+percent(frame.promotion*100),
        frame.broken===null ? "" : "炸板率 "+percent(frame.broken*100),frame.height===null ? "" : "最高 "+frame.height+" 板"].filter(Boolean).join("，");
      const id=market("ladder","接力梯队与封板质量",text,frame.sources.cn_shortline_daily);
      insight.observations.push({title:"接力有没有跟上",text,evidenceIds:[id]});
    }
    if (frame.theme) {
      const id=market("themes","收盘涨停题材",frame.theme,frame.sources.cn_shortline_themes);
      insight.observations.push({title:"当日题材分布",text:frame.theme+"。同一标的可有多个标签。",evidenceIds:[id]});
    }
    if (frame.turnover!==null) market("amount","沪深京成交额",(frame.turnover/1e8).toFixed(2)+" 亿元",frame.sources.cn_market_breadth_history);
    if (frame.dragon) market("dragon","已公布的龙虎榜",frame.dragon,frame.sources.cn_review_dragon);
    for (const item of frame.reviewEvidence) market(item.key,item.title,item.text,item.source,item.date);
    insight.gaps.push(...frame.reviewGaps);
    const similar = nearbyModern(frame,previous.filter(p=>p.date<date));
    if (similar) {
      const old = similar.frame;
      const text = `昨日涨停股反馈中位数 ${percent(old.feedback!)}，首板晋级率 ${percent(old.promotion!*100)}，炸板率 ${percent(old.broken!*100)}。`;
      const id=market("prior-close","同口径历史盘面",text,old.sources.cn_shortline_daily,similar.date);
      insight.observations.push({title:"近期收盘对照",text:`${similar.date} 的三项接力读数接近。 ${text}`,evidenceIds:[id,...factsIds]});
    } else if (marketBasis) insight.gaps.push("近 35 个自然日的本地定稿中，未找到三项接力读数均接近的交易日。");
    if (feedback!==null) insight.conditions.push({metric:"money_effect_median",direction:kept ? "down":"up",reason:kept
      ? "若昨日涨停组反馈中位数下行，重新检验强势股延续性。" : "若昨日涨停组反馈中位数回升，复核强势股反馈偏弱的判断。"});
    if (frame.broken!==null) insight.conditions.push({metric:"broken_rate",direction:"down",reason:"若炸板率下降，观察封板分歧是否同步缓和。"});
  }
  const counterMethod = breadth!==null && breadth<25 ? knownMethods.find(m=>m.id==="plan") ?? method : method;
  if (!insight.counterpoints.length && counterMethod) {
    const example = eligible.find(c=>c.id===counterMethod.counter.caseId);
    if (example) {
      const id=addCase(example,counterMethod.counter.note);
      insight.counterpoints.push({title:"人物方法的反例",text:counterMethod.counter.note,evidenceIds:[id]});
    }
  }
  if (pack.id==="tuixue" && breadth!==null && breadth<25 && knownMethods.some(m=>m.id==="plan")) {
    const comparable = eligible.filter(c=>{
      const share = archiveMeasurements(c).breadth;
      return share!==null && share<25 && c.reveal.action!=="unknown";
    });
    if (comparable.length>=3) {
      const opened = comparable.filter(c=>c.reveal.action==="open").length;
      const text = `在此前 ${comparable.length} 个能核实次日动作的弱广度样本中，${opened} 天仍开了新仓，${comparable.length-opened} 天没有新开仓。`;
      const evidenceDay = comparable.map(c=>c.nextDate).sort().at(-1)!;
      const id = record("behavior/weak-breadth/"+evidenceDay,{kind:"behavior",date:evidenceDay,title:"市场广度偏弱时的公开成交",
        text:text+" 历史筛选采用当时样本下跌家数超过上涨家数三倍的收盘日。",
        source:"人物资料包 · 逐日上涨/下跌样本与次日交割单，剔除动作未知记录"});
      insight.counterpoints.unshift({title:"普跌不能单独解释这位人物的选择",text,evidenceIds:[id,...factsIds.slice(0,1)]});
    }
  }
  if (!insight.counterpoints.length && broad!==null && kept!==null && broad!==kept) {
    insight.counterpoints.push({title:"两个口径给出了不同方向",text:"上涨家数衡量全市场广度，昨日强势股反馈衡量特定样本；两个方向的差异需要分别跟踪。",evidenceIds:factsIds});
  }
  const hasMentorBasis = insight.evidence.some(e=>e.kind==="behavior" || e.kind==="quote" || e.kind==="case");
  if (!hasMentorBasis)
    insight.gaps.push("截至所选日尚无可核验的人物材料，当前仅展示盘面事实。");
  if (!archiveMode && pack.cases.some(c=>c.scene?.metrics.some(m=>m.key==="premium")))
    insight.gaps.push("人物历史案例用近涨停组平均涨幅，近期复盘用昨日涨停组中位数；二者分开呈现。");
  // A close can be complete even when no older case matches. The notes explain these separately.
  const incomplete = breadth===null || feedback===null || !hasMentorBasis || frame.gaps.length>0 ||
    (!archiveMode && (frame.promotion===null || frame.broken===null || frame.theme===null));
  insight.status = !marketBasis ? "unavailable" : incomplete ? "partial":"ready";
  return insight;
}

export async function mentorInsight(ctx:ServiceContext,pack:MentorPack,requested?:string,signal=AbortSignal.timeout(60_000),refresh=false) {
  const date=await selectedCloseDate(ctx,requested,signal);
  if (pack.cases.some(c=>c.date===date && c.scene)) return buildMentorInsight(pack,date,emptyFrame());
  const archive = sharedArchiveMarketDay(ctx.repoRoot,date);
  if (archive) return buildMentorInsight(pack,date,emptyFrame(),[],undefined,archive);
  const frame=await marketFrame(ctx,date,signal,refresh);
  if (!Object.keys(frame.sources).length && requested) {
    const calendar=await tradeWindow(ctx,date,2,signal);
    if (!calendar.targetPresent) throw new ServiceError("bad_query","这一天没有可核验的交易日或收盘档案。");
  }
  return buildMentorInsight(pack,date,frame,previousFrames(ctx,date));
}
