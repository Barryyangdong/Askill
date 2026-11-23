import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {createElement} from 'react';
import {withRenderer, textOf} from './helpers/render.ts';
import {navTitle} from '../src/verticals/finance/lib/nav.ts';
import {reviewNavigation} from '../src/verticals/finance/lib/reviewNavigation.ts';

test('已收盘与历史盘面共用目录顺序，天梯和次日验证各有一个入口', async () => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/shortline-2026-10-09.json', import.meta.url), 'utf8'));
  const panels = Object.fromEntries(['emotion', 'facts', 'themes', 'firstboard', 'cycle', 'ladder']
    .map(key => [key, { state: 'done', result: fixture[key] }]));
  await withRenderer(async r => {
    const { ReviewBoard } = await r.load('/src/verticals/finance/shortline/ReviewBoard.tsx');
    const { AiPageProvider } = await r.load('/src/core/ai/pageContext.tsx');
    const { MemoryRouter } = await r.load('react-router-dom');
    const ids = ['market', 'emotion', 'relay', 'themes', 'risk', 'background'];
    for (const recentDay of [fixture.date, '2026-10-16']) {
      const html = r.html(() => createElement(MemoryRouter, {}, createElement(AiPageProvider, {}, createElement(ReviewBoard, {
        date: fixture.date, day: fixture.date, recentDay, panels, refreshNonce: 0, onThemes() {}, onVerify() {},
      }))), {});
      assert.deepEqual(Array.from(html.matchAll(/<a[^>]+href="#review-([^"]+)"[^>]*>/g), m => m[1]).slice(0, 6), ids);
      assert.deepEqual(Array.from(html.matchAll(/<section[^>]+id="review-([^"]+)"[^>]+aria-labelledby="review-heading-/g), m => m[1]), ids);
      const chapters = html.split(/<section[^>]+aria-labelledby="review-heading-[^"]+"[^>]*>/);
      assert.match(chapters[3], /id="review-ladder"/);
      assert.match(chapters[5], /写下次日验证条件/);
      assert.equal(html.match(/id="review-ladder"/g)?.length, 1);
    }
  });
});
function harness(path:string, dependencies:Record<string,any>) {
  let interval:any; let slots:any[]=[], i=0, effects:any[]=[], pending:any[]=[];
  const react = {
    useState(initial:any){const n=i++; if(!(n in slots))slots[n]=typeof initial==='function'?initial():initial; return [slots[n],(v:any)=>{slots[n]=typeof v==='function'?v(slots[n]):v;}];},
    useRef(value:any){const n=i++; return slots[n]??=( {current:value} );},
    useMemo(fn:any,deps:any[]){const n=i++;const prev=slots[n];if(!prev||deps.some((x,j)=>!Object.is(x,prev.deps[j])))slots[n]={deps,value:fn()};return slots[n].value;},
    useCallback(fn:any,deps:any[]){const n=i++;const prev=slots[n];if(!prev||deps.some((x,j)=>!Object.is(x,prev.deps[j])))slots[n]={deps,value:fn};return slots[n].value;},
    useEffect(fn:any,deps:any[]){const n=i++;const prev=effects[n];if(!prev||!deps||deps.some((x,j)=>!Object.is(x,prev.deps[j]))){pending.push(()=>{prev?.cleanup?.();effects[n]={deps,cleanup:fn()};});}},
  };
  const jsx={jsx:(type:any,props:any)=>({type,props:props??{}}),jsxs:(type:any,props:any)=>({type,props:props??{}}),Fragment:'fragment'};
  const text=readFileSync(new URL(path,import.meta.url),'utf8');
  const js=ts.transpileModule(text,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
  const exports:any={};
  const req=(name:string)=> name==='react'?react:name==='react/jsx-runtime'?jsx:dependencies[name]??new Proxy({}, {get:(_t,k)=>k==='__esModule'?true:()=>null});
  runInNewContext(js,{exports,require:req,AbortController,URLSearchParams,setTimeout:(fn:any,ms:number)=>{const timer={fn,ms,cleared:false};dependencies.__timers?.push(timer);return timer;},clearTimeout:(timer:any)=>{if(timer)timer.cleared=true;},setInterval:(fn:any)=>{interval=fn;return 1;},clearInterval(){},Event:class {},window:{dispatchEvent(){},addEventListener(){},removeEventListener(){}},Date,document:dependencies.__document??{getElementById(){return null;},hidden:false,addEventListener(){},removeEventListener(){}}});
  return {exports,remount(){slots=[];effects=[];},poll(){interval?.();},dispose(){effects.forEach(e=>e?.cleanup?.());},render(fn:any,...args:any[]){i=0;pending=[];const out=fn(...args);const work=pending;pending=[];work.forEach(f=>f());return out;}};
}
const tick=async()=>{for(let i=0;i<5;i++)await Promise.resolve();};

function nodes(x:any):any[]{if(!x)return [];if(Array.isArray(x))return x.flatMap(nodes);if(typeof x!=='object')return [];return [x,...nodes(x.props?.children),...nodes(x.props?.actions)];}
function words(x:any):string{if(x==null)return '';if(Array.isArray(x))return x.map(words).join(' ');if(typeof x==='object')return words(x.props?.children);return String(x);}

test('复盘页头只保留日期，页内统计和报告切换仍保留来源上下文',async()=>{
 let params=new URLSearchParams('symbol=600001&returnTo=%2Fworkbench%3Fsymbol%3D600001');
 let destination:any; let tab='history';
 const h=harness('../src/verticals/finance/pages/Shortline.tsx',{
  'react-router-dom':{useLocation:()=>({state:null}),useNavigate:()=>(to:any)=>{destination=to;},useParams:()=>({tab}),useSearchParams:()=>[params,(update:any)=>{params=update(params);}]},
  '@/shortline/api':{LOADING:{state:'loading'},badDayReason:()=>null,loadEmotion:async()=>({head:{day:'2026-11-16',context:{review_date:'2026-11-16',review_reason:'盘中查看上一交易日'}},defaultDay:'2026-11-16',emotion:{state:'done',result:null}})},
  '@/lib/nav':{navTitle}, '@/lib/reviewNavigation':{reviewNavigation},
 });
 const Workspace=nodes(h.render(h.exports.Shortline)).find(n=>typeof n.type==='function')!.type;
 h.render(Workspace);await tick();const tree=h.render(Workspace);
 const header=nodes(tree).find(n=>n.props?.title==='历史与统计');assert.ok(header);assert.equal(header.props.subtitle,'盘中查看上一交易日');assert.equal(header.props.description,undefined);
 const inputs=nodes(tree).filter(n=>n.type==='input'&&n.props.type==='date');assert.equal(inputs.length,1);assert.equal(inputs[0].props.value,'2026-11-16');
 assert.ok(!nodes(tree).some(n=>n.props?.label==='复盘工作区'));
 const stats=nodes(tree).find(n=>n.props?.label==='统计视图')!;
 assert.deepEqual(Array.from(stats.props.options,(t:any)=>t.key),['weekly','history','samples','structure']);
 stats.props.onChange('samples');assert.equal(destination.pathname,'/shortline/samples');assert.match(destination.search,/symbol=600001/);
 tab='weekreview';
 const ai=nodes(h.render(Workspace)).find(n=>n.props?.label==='报告类型')!;
 assert.equal(ai.props.value,'weekreview');
 assert.deepEqual(Array.from(ai.props.options,(t:any)=>t.key),['review','market-report','weekreview']);
 assert.ok(nodes(tree).some(n=>n.props?.date==='2026-11-16'));
 assert.ok(nodes(tree).some(n=>n.props?.to==='/watch/intraday?date=2026-11-16'));
 assert.doesNotMatch(words(tree),/查看事实 →|默认看|复盘日 2026-11-16/);
 inputs[0].props.onChange({target:{value:'2026-11-13'}});assert.equal(params.get('date'),'2026-11-13');assert.equal(params.get('symbol'),'600001');assert.equal(params.get('returnTo'),'/workbench?symbol=600001');h.dispose();
});
test('默认盘面在首屏即挂载，直接打开历史链接时先校验所选日期', async () => {
  await withRenderer(async r => {
    const { Shortline } = await r.load('/src/verticals/finance/pages/Shortline.tsx');
    const { AiPageProvider } = await r.load('/src/core/ai/pageContext.tsx');
    const { MemoryRouter, Routes, Route } = await r.load('react-router-dom');
    const firstPaint = (url: string) => textOf(r.html(() =>
      createElement(MemoryRouter, { initialEntries: [url] },
        createElement(AiPageProvider, {}, createElement(Routes, {},
          createElement(Route, { path: '/shortline/:tab?', element: createElement(Shortline) })))), {}));
    assert.match(firstPaint('/shortline'), /主要指数/);
    assert.doesNotMatch(firstPaint('/shortline?date=2026-11-12'), /主要指数/);
    assert.doesNotMatch(firstPaint('/shortline/market-report'), /正在确定复盘日…/);
  });
});

test('loaded training retains five functional sections and switches to actual blind-practice lesson',async()=>{
 const profile={id:'sample',summary:'合成学习资料',cases:[{id:'C1',date:'2026-11-16'}],methods:[{id:'M1',exampleIds:['C1']}],quotes:[{date:'2026-11-16',text:'合成原话'}],plans:[],attempts:[]};
 let params = new URLSearchParams('date=2026-11-16');
 const h=harness('../src/verticals/finance/pages/Distillation.tsx',{
  '@/lib/distillation':{choices:{unknown:'待判断'},mentorApi:{list:async()=>({mentors:[{id:'sample',name:'合成人物'}]}),profile:async()=>profile}},
  'react-router-dom':{useSearchParams:()=>[params,(fn:any)=>{params=fn(params);}]},
 });
 h.render(h.exports.Distillation);await tick();let page=h.render(h.exports.Distillation);
 assert.ok(nodes(page).some(n=>n.props?.title==='游资研判'));
 assert.ok(nodes(page).some(n=>n.props?.date==='2026-11-16'&&n.props?.id==='sample'));
 nodes(page).find(n=>n.props?.label==='游资研判视图')!.props.onChange('study');
 assert.equal(params.get('date'),'2026-11-16');page=h.render(h.exports.Distillation);
 const child=nodes(page).find(n=>n.props?.id==='sample'&&typeof n.type==='function')!;assert.ok(child);
 h.dispose();h.remount();h.render(child.type,child.props);await tick();let tree=h.render(child.type,child.props);
 const nav=nodes(tree).find(n=>n.type==='nav'&&n.props['aria-label']==='游资研习功能')!;
 const buttons=nodes(nav).filter(n=>n.type==='button');assert.deepEqual(buttons.map(words),['方法研习','历史盲练','人物原话','今日盘面','学习档案']);
 buttons.find(n=>words(n)==='历史盲练')!.props.onClick();tree=h.render(child.type,child.props);
 assert.ok(nodes(tree).some(n=>n.props?.lesson?.id==='C1'));h.dispose();
});
