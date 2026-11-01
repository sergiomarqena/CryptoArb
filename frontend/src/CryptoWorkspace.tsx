import { useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { createChart, CandlestickSeries, ColorType } from 'lightweight-charts';
import type { IChartApi, ISeriesApi, Time } from 'lightweight-charts';
import { Bell, BellOff, ChevronLeft, ChevronRight, LayoutGrid, Search, Radio, RefreshCw, Trash2 } from 'lucide-react';

const API = import.meta.env.VITE_API_URL || 'https://mr-most-profitable-api-production.up.railway.app';
type Market = {
  symbol:string; contract_symbol:string; base_asset:string; quote_asset:string;
  last_price:number; price_change_pct_24h:number; price_change_pct_7d:number|null; price_change_pct_30d:number|null;
  high_24h:number; low_24h:number; base_volume_24h:number; quote_volume_24h:number|null;
  trade_count_24h:number|null; open_interest_contracts:number|null; funding_rate:number|null;
  mark_price:number|null; index_price:number|null; data_sources:string[];
};
type Candle = {time:number;open:number;high:number;low:number;close:number;volume:number;quote_volume?:number};
type Indicator = {
  symbol:string;status:string;rsi_1h?:number|null;macd_histogram_1h?:number|null;
  change_4h_pct?:number|null;change_1d_pct?:number|null;change_1w_pct?:number|null;change_30d_pct?:number|null;
};
type Activity = {
  symbol:string;contract_symbol:string;last_price:number;price_change_pct_24h:number;quote_volume_24h:number;
  funding_rate:number|null;open_interest_contracts:number|null;last_5m_open:number;last_5m_close:number;
  change_last_5m_pct:number|null;change_from_previous_5m_close_pct:number|null;change_last_1h_pct:number|null;
  last_5m_contract_volume:number;last_5m_turnover:number|null;
  average_previous_21_5m_contract_volume:number|null;volume_multiple_vs_previous_21_candles:number|null;
  activity_status:string;source:string;updated_at:string;
};
type ActivityResponse = {data:Activity[];count:number;requested_universe:number;unavailable_count:number;source:string;updated_at:string;metric_definition:string};
type Flow = {chain:string;token_symbol?:string;tvl_usd:number;tvl_change_pct:number|null;status:string};
type FlowResponse = {data:Flow[];count:number;updated_at:string;metric_definition:string;granularity_note:string};
type PingEvent = {id:string;kind:'ADDED'|'REMOVED'|'ACTIVITY';symbol:string;detail:string;time:string};
type View = 'SCREENER'|'MULTI-CHART'|'INFLOW / OUTFLOW'|'LIVE PING';
type SortKey = keyof Market;
const fmt=(v:number|null|undefined,d=2)=>v==null?'—':v.toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d});
const money=(v:number|null|undefined)=>v==null?'—':'$'+fmt(v,v<1?6:v<100?4:2);
const pct=(v:number|null|undefined)=>v==null?'—':(v>0?'+':'')+fmt(v)+'%';
async function fetchJson<T>(path:string):Promise<T>{const r=await fetch(API+path,{cache:'no-store'});if(!r.ok)throw new Error('Provider request failed ('+r.status+')');return r.json();}
function Percent({value}:{value:number|null|undefined}){return <span className={value==null?'neutral':value>=0?'positive':'negative'}>{pct(value)}</span>;}
function NumberCell({value,decimals=2}:{value:number|null|undefined;decimals?:number}){return <span className={value==null?'neutral':value>=0?'positive':'negative'}>{fmt(value,decimals)}</span>;}
const hashView=():View=>{const p=window.location.hash.toLowerCase().split('/')[2]||'screener';if(p==='multi-chart')return 'MULTI-CHART';if(p==='inflow-outflow')return 'INFLOW / OUTFLOW';if(p==='live-ping')return 'LIVE PING';return 'SCREENER';};

export default function CryptoWorkspace({markets}:{markets:Market[]}){
 const [view,setView]=useState<View>(hashView);
 const [query,setQuery]=useState('');
 const [sortKey,setSortKey]=useState<SortKey>('quote_volume_24h');
 const [sortDir,setSortDir]=useState<'asc'|'desc'>('desc');
 const [page,setPage]=useState(1),[pageSize,setPageSize]=useState(50);
 const [indicators,setIndicators]=useState<Record<string,Indicator>>({});
 const [indicatorsLoading,setIndicatorsLoading]=useState(false);
 const [activity,setActivity]=useState<Activity[]>([]);
 const [activityLoading,setActivityLoading]=useState(false);
 const [activityError,setActivityError]=useState('');
 const [universeSize,setUniverseSize]=useState(25);
 const [minMove,setMinMove]=useState(0.30);
 const [minVolumeMultiple,setMinVolumeMultiple]=useState(2.0);
 const [pingEnabled,setPingEnabled]=useState(false);
 const [events,setEvents]=useState<PingEvent[]>([]);
 const [chartCount,setChartCount]=useState(4);
 const [chartSymbols,setChartSymbols]=useState<string[]>([]);
 const [flowPeriod,setFlowPeriod]=useState<'4H'|'1D'|'1W'>('1D');
 const [flowData,setFlowData]=useState<FlowResponse|null>(null);
 const [flowLoading,setFlowLoading]=useState(false),[flowError,setFlowError]=useState('');
 const previousSymbols=useRef<Set<string>|null>(null);
 const previouslyAlerted=useRef<Set<string>>(new Set());
 const symbolsRef=useRef<Market[]>([]);
 const pageSymbols=useMemo(()=>markets.filter(m=>m.symbol.toLowerCase().includes(query.trim().toLowerCase())).slice((page-1)*pageSize,page*pageSize).map(m=>m.symbol).join(','),[markets,query,page,pageSize]);

 useEffect(()=>{const sync=()=>setView(hashView());window.addEventListener('hashchange',sync);return()=>window.removeEventListener('hashchange',sync);},[]);
 const navigate=(v:View)=>{setView(v);window.location.hash='#/crypto/'+(v==='INFLOW / OUTFLOW'?'inflow-outflow':v.toLowerCase());};
 useEffect(()=>{try{
   const saved=localStorage.getItem('mrmp-ping-events');if(saved)setEvents(JSON.parse(saved));
   setPingEnabled(localStorage.getItem('mrmp-pings')==='true');
   const count=Number(localStorage.getItem('mrmp-chart-count'));if([1,2,3,4,6,8,9,12].includes(count))setChartCount(count);const savedCharts=localStorage.getItem('mrmp-chart-symbols');if(savedCharts){const parsed=JSON.parse(savedCharts);if(Array.isArray(parsed)&&parsed.every(x=>typeof x==='string'))setChartSymbols(parsed);}
 }catch{}},[]);
 useEffect(()=>{try{localStorage.setItem('mrmp-ping-events',JSON.stringify(events.slice(0,250)));localStorage.setItem('mrmp-pings',String(pingEnabled));localStorage.setItem('mrmp-chart-count',String(chartCount));localStorage.setItem('mrmp-chart-symbols',JSON.stringify(chartSymbols));}catch{}},[events,pingEnabled,chartCount,chartSymbols]);

 // Detect real MEXC universe additions/removals once a new snapshot is received.
 useEffect(()=>{
   if(!markets.length)return;
   const current=new Set(markets.map(m=>m.symbol));
   if(previousSymbols.current){
     const now=new Date().toISOString();
     const added=markets.filter(m=>!previousSymbols.current!.has(m.symbol)).map(m=>({id:Date.now()+m.symbol+'a',kind:'ADDED' as const,symbol:m.symbol,detail:'Entered the MEXC Futures market universe',time:now}));
     const removed=[...previousSymbols.current].filter(s=>!current.has(s)).map(s=>({id:Date.now()+s+'r',kind:'REMOVED' as const,symbol:s,detail:'No longer returned by the MEXC Futures ticker',time:now}));
     const changes=[...added,...removed];
     if(changes.length){setEvents(old=>[...changes,...old].slice(0,250));notify(changes,pingEnabled);}
   }
   previousSymbols.current=current;symbolsRef.current=markets;
 },[markets,pingEnabled]);

 // Pull current-page technical measurements from real 1H futures candles.
 useEffect(()=>{
   if(!pageSymbols){setIndicators({});return;}
   let live=true;setIndicatorsLoading(true);
   fetchJson<{data:Indicator[]}>('/api/v1/crypto/screener/indicators?symbols='+encodeURIComponent(pageSymbols))
     .then(result=>{if(live){const map:Record<string,Indicator>={};result.data.forEach(x=>map[x.symbol]=x);setIndicators(map);}})
     .catch(()=>{if(live)setIndicators({});})
     .finally(()=>{if(live)setIndicatorsLoading(false);});
   return()=>{live=false;};
 },[pageSymbols]);

 // Activity scan: top N contracts by 24H turnover, each checked against its preceding 21 five-minute candles.
 useEffect(()=>{
   let live=true;
   const load=async()=>{setActivityLoading(true);setActivityError('');try{const data=await fetchJson<ActivityResponse>('/api/v1/crypto/activity?limit='+universeSize);if(!live)return;setActivity(data.data||[]);}catch(e){if(live)setActivityError(e instanceof Error?e.message:'Activity provider unavailable');}finally{if(live)setActivityLoading(false);}};
   load();const timer=window.setInterval(load,30000);return()=>{live=false;clearInterval(timer);};
 },[universeSize]);

 const activeAlerts=useMemo(()=>activity.filter(x=>x.activity_status==='ok'&&x.change_last_5m_pct!=null&&Math.abs(x.change_last_5m_pct)>=minMove&&x.volume_multiple_vs_previous_21_candles!=null&&x.volume_multiple_vs_previous_21_candles>=minVolumeMultiple),[activity,minMove,minVolumeMultiple]);
 useEffect(()=>{
   const current=new Set(activeAlerts.map(x=>x.symbol));
   const fresh=activeAlerts.filter(x=>!previouslyAlerted.current.has(x.symbol));
   if(fresh.length){
     const now=new Date().toISOString();
     const changes=fresh.map(x=>({id:Date.now()+x.symbol+'activity',kind:'ACTIVITY' as const,symbol:x.symbol,detail:'5m move '+pct(x.change_last_5m_pct)+' · volume '+fmt(x.volume_multiple_vs_previous_21_candles)+'× previous 21-candle average',time:now}));
     setEvents(old=>[...changes,...old].slice(0,250));notify(changes,pingEnabled);
   }
   previouslyAlerted.current=current;
 },[activeAlerts,pingEnabled]);

 useEffect(()=>{
   if(view!=='INFLOW / OUTFLOW')return;
   let live=true;setFlowLoading(true);setFlowError('');
   fetchJson<FlowResponse>('/api/v1/flows/chains?timeframe='+flowPeriod).then(d=>{if(live)setFlowData(d);}).catch(e=>{if(live)setFlowError(e instanceof Error?e.message:'Chain provider unavailable');}).finally(()=>{if(live)setFlowLoading(false);});
   return()=>{live=false;};
 },[view,flowPeriod]);

 const filtered=useMemo(()=>markets.filter(m=>m.symbol.toLowerCase().includes(query.trim().toLowerCase())),[markets,query]);
 const sorted=useMemo(()=>[...filtered].sort((a,b)=>{
   const x=a[sortKey],y=b[sortKey];
   if(x==null&&y==null)return 0;if(x==null)return 1;if(y==null)return -1;
   return ((x as number)-(y as number))*(sortDir==='asc'?1:-1);
 }),[filtered,sortKey,sortDir]);
 const totalPages=Math.max(1,Math.ceil(sorted.length/pageSize)),safePage=Math.min(page,totalPages);
 const rows=sorted.slice((safePage-1)*pageSize,safePage*pageSize);
 const changeSort=(key:SortKey)=>{setPage(1);if(sortKey===key)setSortDir(d=>d==='asc'?'desc':'asc');else{setSortKey(key);setSortDir('asc');}};
 const requestNotifications=async()=>{if(!('Notification'in window)){alert('This browser does not support notifications.');return;}const permission=await Notification.requestPermission();setPingEnabled(permission==='granted');};
 const clearEvents=()=>setEvents([]);

 return <section className="crypto-workspace">
  <div className="subnav">{(['SCREENER','MULTI-CHART','INFLOW / OUTFLOW','LIVE PING'] as View[]).map(v=><button key={v} className={v===view?'selected':''} onClick={()=>navigate(v)}>{v}</button>)}</div>
  {view==='SCREENER'&&<section className="panel market-panel">
   <div className="panel-head"><div><div className="eyebrow">MEXC FUTURES SCREENER</div><h2>USDT perpetual contracts</h2><p className="muted-line">{markets.length.toLocaleString()} live contracts returned by MEXC</p></div><label className="search"><Search size={14}/><input value={query} onChange={e=>{setQuery(e.target.value);setPage(1);}} placeholder="Search contract…"/></label></div>
   <ActivityScanner activity={activity} alerts={activeAlerts} loading={activityLoading} error={activityError} universeSize={universeSize} setUniverseSize={setUniverseSize} minMove={minMove} setMinMove={setMinMove} minVolumeMultiple={minVolumeMultiple} setMinVolumeMultiple={setMinVolumeMultiple}/>
   <div className="screener-toolbar"><span>{sorted.length.toLocaleString()} matching contracts · sort the live market fields below</span><label>ROWS <select value={pageSize} onChange={e=>{setPageSize(Number(e.target.value));setPage(1);}}>{[25,50].map(x=><option key={x}>{x}</option>)}</select></label></div>
   <div className="table-wrap"><table className="screener-table"><thead><tr>{([
    {key:'base_asset',label:'CONTRACT'},{key:'last_price',label:'LAST PRICE'},{key:'price_change_pct_24h',label:'24H %'},
    {key:'price_change_pct_7d',label:'7D %'},{key:'price_change_pct_30d',label:'30D %'},{key:'high_24h',label:'24H HIGH'},
    {key:'low_24h',label:'24H LOW'},{key:'quote_volume_24h',label:'24H TURNOVER'},{key:'funding_rate',label:'FUNDING'},
    {key:'open_interest_contracts',label:'OPEN INTEREST'}
   ] as {key:SortKey;label:string}[]).map(c=><th key={c.key}><button className="sort-button" onClick={()=>changeSort(c.key)}>{c.label}<span>{sortKey===c.key?(sortDir==='asc'?'↑':'↓'):'↕'}</span></button></th>)}<th>RSI 1H</th><th>MACD HIST 1H</th><th>4H %</th><th>1D %</th><th>1W %</th><th>30D %</th></tr></thead>
   <tbody>{rows.map(m=>{const t=indicators[m.symbol];return <tr key={m.symbol}>
    <td className="asset-cell"><b>{m.base_asset}</b><small>{m.contract_symbol}</small></td><td>{money(m.last_price)}</td><td><Percent value={m.price_change_pct_24h}/></td><td><Percent value={m.price_change_pct_7d}/></td><td><Percent value={m.price_change_pct_30d}/></td><td>{money(m.high_24h)}</td><td>{money(m.low_24h)}</td><td>{money(m.quote_volume_24h)}</td><td><Percent value={m.funding_rate==null?null:m.funding_rate*100}/></td><td>{m.open_interest_contracts==null?'—':fmt(m.open_interest_contracts,0)}</td>
    <td>{t?.status==='ok'?fmt(t.rsi_1h):'—'}</td><td><NumberCell value={t?.macd_histogram_1h} decimals={m.last_price<1?8:4}/></td><td><Percent value={t?.change_4h_pct}/></td><td><Percent value={t?.change_1d_pct}/></td><td><Percent value={t?.change_1w_pct}/></td><td><Percent value={t?.change_30d_pct}/></td>
   </tr>;})}</tbody></table>{rows.length===0&&<div className="empty-state">No matching contracts in the current MEXC feed.</div>}</div>
   <div className="pagination"><span>Page {safePage} of {totalPages} · {rows.length?(safePage-1)*pageSize+1:0}–{Math.min(safePage*pageSize,sorted.length)} of {sorted.length} · {indicatorsLoading?'Loading technicals…':'Indicators are MEXC candle-derived'}</span><div><button disabled={safePage===1} onClick={()=>setPage(Math.max(1,safePage-1))}><ChevronLeft size={14}/> Previous</button>{Array.from({length:Math.min(5,totalPages)},(_,i)=>{const start=Math.max(1,Math.min(safePage-2,totalPages-4)),num=start+i;return num<=totalPages?<button key={num} className={num===safePage?'current':''} onClick={()=>setPage(num)}>{num}</button>:null;})}<button disabled={safePage===totalPages} onClick={()=>setPage(Math.min(totalPages,safePage+1))}>Next <ChevronRight size={14}/></button></div></div>
  </section>}
  {view==='MULTI-CHART'&&<MultiChart markets={markets} chartCount={chartCount} setChartCount={setChartCount} chartSymbols={chartSymbols} setChartSymbols={setChartSymbols}/>}
  {view==='INFLOW / OUTFLOW'&&<ChainFlows period={flowPeriod} setPeriod={setFlowPeriod} data={flowData} loading={flowLoading} error={flowError}/>}
  {view==='LIVE PING'&&<LivePing events={events} enabled={pingEnabled} requestNotifications={requestNotifications} setEnabled={setPingEnabled} clearEvents={clearEvents}/>}
 </section>;
}

function notify(list:PingEvent[],enabled:boolean){if(!enabled||!('Notification'in window)||Notification.permission!=='granted')return;list.slice(0,8).forEach(e=>new Notification(e.kind==='ACTIVITY'?'MEXC activity alert':'MEXC contract universe update',{body:e.symbol+' · '+e.detail}));}

function ActivityScanner({activity,alerts,loading,error,universeSize,setUniverseSize,minMove,setMinMove,minVolumeMultiple,setMinVolumeMultiple}:{activity:Activity[];alerts:Activity[];loading:boolean;error:string;universeSize:number;setUniverseSize:(n:number)=>void;minMove:number;setMinMove:(n:number)=>void;minVolumeMultiple:number;setMinVolumeMultiple:(n:number)=>void}){
 const [showAll,setShowAll]=useState(false);
 const displayed=showAll?activity:alerts.length?alerts:activity.slice(0,12);
 return <section className="activity-scanner">
  <div className="activity-head"><div><div className="eyebrow">LIVE ACTIVITY / ALERT ENGINE</div><h3>Volume expansion scanner</h3><p>Latest 5-minute candle versus the previous 21 five-minute candles · MEXC Futures</p></div><div className="activity-count"><b>{alerts.length}</b><small>ACTIVE FILTER MATCHES</small></div></div>
  <div className="activity-filters">
   <label>SCAN UNIVERSE <select value={universeSize} onChange={e=>setUniverseSize(Number(e.target.value))}>{[25,50,100].map(n=><option key={n}>{n}</option>)}</select><small>Highest 24H turnover</small></label>
   <label>MIN ABS 5M MOVE % <input type="number" min="0" max="20" step="0.05" value={minMove} onChange={e=>setMinMove(Math.max(0,Math.min(20,Number(e.target.value)||0)))}/></label>
   <label>MIN VOLUME MULTIPLE <input type="number" min="1" max="100" step="0.25" value={minVolumeMultiple} onChange={e=>setMinVolumeMultiple(Math.max(1,Math.min(100,Number(e.target.value)||1)))}/></label>
   <button className="activity-toggle" onClick={()=>setShowAll(x=>!x)}>{showAll?'Show alert matches':'Show all scanned'}</button>
  </div>
  {error&&<div className="notice">{error}</div>}
  <div className="activity-explain">Alert condition: absolute current 5M candle price change ≥ {fmt(minMove,2)}% AND current 5M contract volume ≥ {fmt(minVolumeMultiple,2)}× its previous-21-candle average. This is an observed activity condition, not a prediction or buy/sell instruction.</div>
  {loading&&<div className="scanner-status"><RefreshCw size={13} className="spin"/> Updating activity scan…</div>}
  {!loading&&activity.length===0&&<div className="empty-state">No activity rows returned. Provider errors or unavailable candles are not replaced with sample data.</div>}
  {activity.length>0&&<div className="table-wrap"><table className="activity-table"><thead><tr><th>CONTRACT</th><th>5M CHANGE</th><th>1H CHANGE</th><th>5M VOLUME</th><th>AVG 21×5M</th><th>VOLUME MULTIPLE</th><th>5M TURNOVER</th><th>FUNDING</th><th>STATE</th></tr></thead><tbody>{displayed.map(x=>{const isAlert=alerts.some(a=>a.symbol===x.symbol);return <tr key={x.symbol} className={isAlert?'activity-hit':''}><td><b>{x.symbol}</b><small>{x.contract_symbol}</small></td><td><Percent value={x.change_last_5m_pct}/></td><td><Percent value={x.change_last_1h_pct}/></td><td>{fmt(x.last_5m_contract_volume,0)}</td><td>{fmt(x.average_previous_21_5m_contract_volume,0)}</td><td><b className={isAlert?'positive':'activity-multiple'}>{fmt(x.volume_multiple_vs_previous_21_candles,2)}×</b></td><td>{money(x.last_5m_turnover)}</td><td><Percent value={x.funding_rate==null?null:x.funding_rate*100}/></td><td><span className={isAlert?'alert-state':'normal-state'}>{isAlert?'ALERT':'WATCH'}</span></td></tr>;})}</tbody></table></div>}
  <div className="scanner-foot">Source: MEXC USD-M perpetual 5M contract candles and ticker. Scan scope: {activity.length} successfully measured contracts out of {universeSize} requested. Auto-refresh every 30 seconds while this tab is open.</div>
 </section>;
}

function ChartTile({symbol}:{symbol:string}){
 const [interval,setInterval]=useState('4h'),[status,setStatus]=useState('Loading candles…'),elRef=useRef<HTMLDivElement|null>(null);
 useEffect(()=>{if(!elRef.current||!symbol)return;let dead=false;let chart:IChartApi|null=null;let series:ISeriesApi<'Candlestick'>|null=null;let resize:ResizeObserver|null=null;const el=elRef.current;
  chart=createChart(el,{width:Math.max(220,el.clientWidth),height:225,layout:{background:{type:ColorType.Solid,color:'#0e0b13'},textColor:'#b9adbf'},grid:{vertLines:{color:'#241d2a'},horzLines:{color:'#241d2a'}},rightPriceScale:{borderColor:'#34283a'},timeScale:{borderColor:'#34283a',timeVisible:true}});
  series=chart.addSeries(CandlestickSeries,{upColor:'#39d6a1',downColor:'#ec687b',borderUpColor:'#39d6a1',borderDownColor:'#ec687b',wickUpColor:'#39d6a1',wickDownColor:'#ec687b'});
  const load=async()=>{try{const r=await fetchJson<{candles:Candle[];source:string}>('/api/v1/crypto/klines/'+encodeURIComponent(symbol)+'?interval='+interval+'&limit=120');if(dead||!series)return;const candles=r.candles.filter(c=>c.open>0&&c.high>0&&c.low>0&&c.close>0).map(c=>({time:Math.floor(c.time/1000) as Time,open:c.open,high:c.high,low:c.low,close:c.close}));series.setData(candles);chart?.timeScale().fitContent();setStatus(r.source+' · '+candles.length+' candles');}catch(e){if(!dead)setStatus(e instanceof Error?e.message:'Candle feed unavailable');}};
  load();const timer=window.setInterval(load,60000);resize=new ResizeObserver(items=>items.forEach(i=>chart?.applyOptions({width:Math.max(220,Math.floor(i.contentRect.width))})));resize.observe(el);return()=>{dead=true;clearInterval(timer);resize?.disconnect();chart?.remove();};
 },[symbol,interval]);
 return <article className="chart-tile"><div className="chart-tile-head"><b>{symbol.replace('USDT',' / USDT')}</b><select value={interval} onChange={e=>setInterval(e.target.value)}><option value="4h">4H</option><option value="1d">1D</option><option value="1w">1W</option></select></div><div ref={elRef} className="chart-canvas"/><div className="chart-tile-foot">{status}</div></article>;
}
function MultiChart({markets,chartCount,setChartCount,chartSymbols,setChartSymbols}:{markets:Market[];chartCount:number;setChartCount:(n:number)=>void;chartSymbols:string[];setChartSymbols:Dispatch<SetStateAction<string[]>>}){
 const symbols=markets.map(m=>m.symbol),cols=chartCount===1?1:chartCount<=4?2:chartCount<=9?3:4;
 useEffect(()=>{if(markets.length)setChartSymbols(old=>old.length?old.map((s,i)=>symbols.includes(s)?s:(symbols[i]||symbols[0])):symbols.slice(0,12));},[markets.length]);
 return <section className="panel multi-panel"><div className="panel-head"><div><div className="eyebrow">MULTI-ASSET VIEWER</div><h2>Live MEXC Futures charts</h2><p className="muted-line">Real perpetual-contract candles · independent timeframe and symbol controls</p></div><span className="tag"><LayoutGrid size={12}/> {chartCount} CHARTS</span></div><div className="chart-counts">{[1,2,3,4,6,8,9,12].map(n=><button className={chartCount===n?'active':''} key={n} onClick={()=>setChartCount(n)}>{n}</button>)}</div><div className="multi-chart-grid" style={{gridTemplateColumns:'repeat('+cols+',minmax(0,1fr))'}}>{symbols.length===0?<div className="empty-state">No MEXC contract symbols available.</div>:Array.from({length:chartCount},(_,i)=><div key={i} className="chart-slot"><label><span>CHART {i+1}</span><select value={chartSymbols[i]||symbols[i%symbols.length]} onChange={e=>setChartSymbols(old=>{const n=[...old];n[i]=e.target.value;return n;})}>{symbols.map(s=><option key={s} value={s}>{s}</option>)}</select></label><ChartTile symbol={chartSymbols[i]||symbols[i%symbols.length]}/></div>)}</div></section>;
}
function ChainFlows({period,setPeriod,data,loading,error}:{period:'4H'|'1D'|'1W';setPeriod:(p:'4H'|'1D'|'1W')=>void;data:FlowResponse|null;loading:boolean;error:string}){
 return <section className="panel flow-panel"><div className="panel-head"><div><div className="eyebrow">CHAIN FUNDAMENTALS</div><h2>Inflow / Outflow — chain TVL monitor</h2><p className="muted-line">Network-level DeFi value locked · not exchange wallet flow data</p></div><div className="timeframe-tabs">{(['4H','1D','1W'] as const).map(x=><button key={x} className={period===x?'active':''} onClick={()=>setPeriod(x)}>{x}</button>)}</div></div><div className="flow-explain"><b>Metric distinction</b><span>{data?.metric_definition||'TVL change measures the change in reported DeFi value locked. It does not directly measure net deposits or withdrawals.'}</span></div>{period==='4H'&&<div className="notice">DefiLlama historical chain TVL is daily. The 4H percentage is marked unavailable rather than estimated.</div>}{error&&<div className="notice">{error}</div>}{loading?<div className="loading">Loading chain data…</div>:<><div className="flow-summary"><span>{data?.count||0} chains returned by DefiLlama</span><span>Updated {data?.updated_at?new Date(data.updated_at).toLocaleTimeString():'—'}</span></div><div className="table-wrap"><table className="flow-table"><thead><tr><th>CHAIN</th><th>NATIVE TOKEN</th><th>TVL (USD)</th><th>TVL CHANGE · {period}</th><th>STATUS</th></tr></thead><tbody>{(data?.data||[]).map(x=><tr key={x.chain}><td><b>{x.chain}</b></td><td>{x.token_symbol||'—'}</td><td>{money(x.tvl_usd)}</td><td><Percent value={x.tvl_change_pct}/></td><td><span className={x.status==='ok'?'data-ok':'data-muted'}>{x.status.split('_').join(' ')}</span></td></tr>)}</tbody></table></div><div className="flow-foot">{data?.granularity_note} Source: DefiLlama. TVL may change due to prices, deposits, withdrawals, and methodology updates; it is not a pure cash-flow metric.</div></>}</section>;
}
function LivePing({events,enabled,requestNotifications,setEnabled,clearEvents}:{events:PingEvent[];enabled:boolean;requestNotifications:()=>void;setEnabled:(v:boolean)=>void;clearEvents:()=>void}){
 return <section className="panel ping-panel"><div className="panel-head"><div><div className="eyebrow">LIVE EVENT MONITOR</div><h2>Live PING — market changes</h2><p className="muted-line">Records contracts entering/leaving the MEXC feed and configurable activity conditions being met.</p></div><span className="tag">{events.length} EVENTS</span></div><div className="ping-controls"><button className={enabled?'ping-enabled':'ping-disabled'} onClick={()=>enabled?setEnabled(false):requestNotifications()}>{enabled?<Bell size={14}/>:<BellOff size={14}/>} Browser pings {enabled?'ON':'OFF'}</button><button className="clear-button" onClick={clearEvents}><Trash2 size={13}/> Clear history</button></div><div className="notice">Pings are generated from changes in provider data and the activity thresholds configured in Screener. Browser notifications require permission and this page to remain open; this is not background push service.</div><div className="ping-list">{events.length===0?<div className="empty-state">No live events recorded yet. The first successful feed snapshot establishes the baseline.</div>:events.map(e=><div className="ping-row" key={e.id}><span className={e.kind==='ADDED'?'ping-add':e.kind==='REMOVED'?'ping-remove':'ping-activity'}>{e.kind}</span><b>{e.symbol}</b><time>{new Date(e.time).toLocaleString()}</time><small>{e.detail}</small></div>)}</div></section>;
}