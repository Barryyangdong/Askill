/** A small, fully checked grammar. Unrecognized conditions block the draft. */
export function parseModeDraft(input:string):{query:Record<string,string>;description:string}|{error:string}{
 if(input.length>500)return {error:'条件过长，请拆成一个明确的观察规则。'};
 let text=input.replace(/\s+/g,'').replace(/％/g,'%');
 const query:Record<string,string>={};
 const universes:Record<string,string>={'我的自选':'watch','自选':'watch','沪深300':'hs300','中证A500':'a500','中证500':'zz500','中证1000':'zz1000','中证2000':'zz2000','上证50':'sz50','科创50':'kc50','创业板指':'cyb'};
 for(const [label,id] of Object.entries(universes))if(text.includes(label)){if(query.universe&&query.universe!==id)return {error:'一个规则只能使用一个观察范围。'};query.universe=id;text=text.replaceAll(label,'');}
 if(!query.universe)return {error:'请写明自选或公开指数范围，例如“自选”或“沪深300”。'};
 for(const [expression,key] of [[/(?:排除ST|非ST)/gi,'exclude_st'],[/(?:排除停牌|非停牌)/g,'exclude_halted']] as const){if(expression.test(text)){query[key]='1';text=text.replace(expression,'');}}
 const metrics:Record<string,string>={'涨跌幅':'change_pct','量比':'volume_ratio','换手率':'turnover','成交额':'amount','总市值':'market_cap','市盈率':'pe_ttm','市净率':'pb'};
 let error='';
 text=text.replace(/(涨跌幅|量比|换手率|成交额|总市值|市盈率|市净率)(大于等于|小于等于|不少于|不超过|至少|至多|>=|<=|≥|≤)(-?\d+(?:\.\d+)?)(亿元|万元|亿|万|元|%|倍)?/g,(_,label:string,op:string,raw:string,unit:string)=>{
   const metric=metrics[label]!;let value=Number(raw);
   if(['amount','market_cap'].includes(metric)){
     if(!['亿元','万元','亿','万','元'].includes(unit)){error=`${label}需要明确金额单位，例如“1亿”。`;return '';}
     value/=unit==='元'?1e8:['万','万元'].includes(unit)?1e4:1;
   }else if(['change_pct','turnover'].includes(metric)){
     if(unit&&unit!=='%')error=`${label}单位应为%。`;
   }else if(unit&&unit!=='倍')error=`${label}单位应为倍。`;
   const suffix=['大于等于','不少于','至少','>=','≥'].includes(op)?'min':'max';
   const key=`${metric}_${suffix}`;
   if(query[key]!==undefined)error=`${label}重复设置同一边界，请合并。`;
   if(!Number.isFinite(value)||Math.abs(value)>1e9)error='数值超出支持范围。';
   query[key]=String(value);return '';
 });
 text=text.replace(/[，,；;、。且和与]/g,'');
 if(text)return {error:`尚不能准确解释“${text.slice(0,70)}”。请用明确的指标和 ≥ / ≤ 条件；未识别部分不会被忽略。`};
 if(error)return {error};
 for(const metric of Object.values(metrics))if(query[`${metric}_min`]!==undefined&&query[`${metric}_max`]!==undefined&&Number(query[`${metric}_min`])>Number(query[`${metric}_max`]))return {error:'下限不能高于上限。'};
 if(Object.keys(query).length===1)return {error:'请至少添加一个筛选条件。'};
 return {query,description:input.trim()};
}
