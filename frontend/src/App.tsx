import { useCallback, useEffect, useMemo, useState } from 'react';
import CryptoWorkspace from './CryptoWorkspace';
import { Activity, ArrowDownRight, ArrowUpRight, Clock3, Database, Globe2, RefreshCw, Radio, Search, ShieldCheck, Wifi, WifiOff } from 'lucide-react';

const API = import.meta.env.VITE_API_URL || 'https://mr-most-profitable-api-production.up.railway.app';
type Market = { symbol:string; contract_symbol:string; base_asset:string; quote_asset:string; last_price:number; price_change_pct_24h:number; price_change_pct_7d:number|null; price_change_pct_30d:number|null; high_24h:number; low_24h:number; base_volume_24h:number; quote_volume_24h:number|null; trade_count_24h:number|null; open_interest_contracts:number|null; funding_rate:number|null; mark_price:number|null; index_price:number|null; data_sources:string[] };
type MacroItem = { symbol:string; label:string; last:number|null; change_pct_latest_interval:number|null; currency:string|null; exchange_timezone:string|null; last_bar_epoch:number|null; source:string; status:string; error?:string };
type Overview = { market_count:number; top_gainers:Market[]; top_losers:Market[]; highest_quote_volume:Market[]; updated_at:string };
type Macro = { instruments:Record<string,MacroItem>; updated_at:string; note:string };
type Kline = { time:number; open:number; high:number; low:number; close:number; volume:number };
const n=(v:number|undefined|null,d=2)=>v==null?'—':v.toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d});
const money=(v:number|undefined|null)=>v==null?'—':'$'+n(v,v<1?5:2);
const pct=(v:number|undefined|null)=>v==null?'—':(v>0?'+':'')+n(v,2)+'%';
const stamp=(v?:string)=>v?new Date(v).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',second:'2-digit'}):'—';
async function get<T,>(path:string):Promise<T>{const r=await fetch(API+path,{cache:'no-store'});if(!r.ok)throw new Error('API '+r.status+' · '+path);return r.json();}
function Change({value}:{value:number|null|undefined}){return <span className={value==null?'neutral':value>=0?'positive':'negative'}>{value!=null&& (value>=0?<ArrowUpRight size={13}/>:<ArrowDownRight size={13}/>)}{pct(value)}</span>}
function Sparkline({items}:{items:Kline[]}){if(items.length<2)return <div className="spark-empty">Waiting for candle data…</div>;const vals=items.map(x=>x.close),lo=Math.min(...vals),hi=Math.max(...vals),range=hi-lo||1;const points=vals.map((v,i)=>`${i/(vals.length-1)*100},${38-(v-lo)/range*32}`).join(' ');return <svg className="sparkline" viewBox="0 0 100 42" preserveAspectRatio="none"><polyline points={points} fill="none" stroke="#d66bc5" strokeWidth="1.4" vectorEffect="non-scaling-stroke"/></svg>}
function App(){
 const [tab,setTab]=useState(()=>{const v=(window.location.hash.split('/')[1]||'overview').toUpperCase();return ['OVERVIEW','CRYPTO','MACRO','DATA'].includes(v)?v:'OVERVIEW';});
 useEffect(()=>{const sync=()=>{const v=(window.location.hash.split('/')[1]||'overview').toUpperCase();setTab(['OVERVIEW','CRYPTO','MACRO','DATA'].includes(v)?v:'OVERVIEW');};window.addEventListener('hashchange',sync);if(!window.location.hash)window.location.hash='#/overview';return()=>window.removeEventListener('hashchange',sync);},[]);
 const navigateTab=(v:string)=>{setTab(v);window.location.hash=v==='CRYPTO'?'#/crypto/screener':'#/'+v.toLowerCase();};
 const [markets,setMarkets]=useState<Market[]>([]);
 const [overview,setOverview]=useState<Overview|null>(null);
 const [macro,setMacro]=useState<Macro|null>(null);
 const [candles,setCandles]=useState<Kline[]>([]);
 const [selected,setSelected]=useState('BTCUSDT');
 const [query,setQuery]=useState('');
 const [loading,setLoading]=useState(true);
 const [refreshing,setRefreshing]=useState(false);
 const [error,setError]=useState('');
 const [updated,setUpdated]=useState('');
 const [source,setSource]=useState('—');
 const [oi,setOi]=useState<number|null>(null);
 const [oiError,setOiError]=useState('');
 const [clock,setClock]=useState(new Date());
 const refresh=useCallback(async()=>{
   setRefreshing(true);
   try{
     const [m,o,x]=await Promise.all([get<{data:Market[];source:string;updated_at:string}>('/api/v1/crypto/markets'),get<Overview>('/api/v1/crypto/overview'),get<Macro>('/api/v1/macro')]);
     setMarkets(m.data);setOverview(o);setMacro(x);setUpdated(m.updated_at);setSource(m.source);setError('');
   }catch(e){setError(e instanceof Error?e.message:'Unable to reach market API');}
   finally{setLoading(false);setRefreshing(false);}
 },[]);
 const loadDetail=useCallback(async(symbol:string)=>{
   try{const c=await get<{candles:Kline[]}>('/api/v1/crypto/klines/'+symbol+'?interval=5m&limit=72');setCandles(c.candles);}
   catch{setCandles([]);}
   try{const v=await get<{open_interest_contracts:number}>('/api/v1/crypto/open-interest/'+symbol);setOi(v.open_interest_contracts);setOiError('');}
   catch{setOi(null);setOiError('Open interest unavailable');}
 },[]);
 useEffect(()=>{refresh();const t=setInterval(refresh,30000);const c=setInterval(()=>setClock(new Date()),1000);return()=>{clearInterval(t);clearInterval(c)}},[refresh]);
 useEffect(()=>{loadDetail(selected)},[selected,loadDetail]);
 const filtered=useMemo(()=>markets.filter(m=>m.symbol.toLowerCase().includes(query.toLowerCase())),[markets,query]);
 const chosen=markets.find(m=>m.symbol===selected);
 const topVolume=overview?.highest_quote_volume?.slice(0,8)??[];
 return <div className="app-shell">
  <header className="topbar"><a className="brand" href="#"><span className="brand-icon">M</span><span><b>MR MOST PROFITABLE</b><small>MARKET INTELLIGENCE TERMINAL</small></span></a><nav>{['OVERVIEW','CRYPTO','MACRO','DATA'].map(x=><button key={x} className={tab===x?'active':''} onClick={()=>navigateTab(x)}>{x}</button>)}</nav><div className="top-meta"><span className={error?'connection down':'connection'}><i/>{error?'DEGRADED':'API CONNECTED'}</span><span className="clock">{clock.toLocaleTimeString('en-GB')}</span><button className="refresh" onClick={refresh} disabled={refreshing}><RefreshCw size={15} className={refreshing?'spin':''}/></button></div></header>
  <div className="ticker"><span>LIVE PUBLIC DATA</span>{markets.slice(0,7).map(m=><span key={m.symbol}>{m.base_asset} <b>{money(m.last_price)}</b> <Change value={m.price_change_pct_24h}/></span>)}<span className="ticker-end">30s REFRESH</span></div>
  <main className="content">
   <section className="page-heading"><div><div className="eyebrow">COMMAND CENTER / {tab}</div><h1>Market <em>intelligence</em></h1><p>Read-only market monitoring · factual data, no trade signals or order execution</p></div><div className="updated"><span className="live-dot"/> PUBLIC FEEDS <b>{stamp(updated)}</b></div></section>
   {error&&<div className="alert"><WifiOff size={16}/><span>Live API issue: {error}. Showing last successfully loaded data, if available.</span></div>}
   {loading&&!markets.length?<div className="loading"><RefreshCw className="spin"/> Connecting to live market feeds…</div>:<>
    {tab==='OVERVIEW'&&<>
     <section className="metric-grid">
      <article className="metric"><label><Activity size={14}/> TRACKED PERPETUAL CONTRACTS</label><strong>{overview?.market_count??markets.length}</strong><small>USDT perpetuals · MEXC Futures</small></article>
      <article className="metric"><label><ArrowUpRight size={14}/> TOP 24H GAINER</label><strong className="positive">{overview?.top_gainers?.[0]?.base_asset??'—'}</strong><small>{pct(overview?.top_gainers?.[0]?.price_change_pct_24h)} · descriptive only</small></article>
      <article className="metric"><label><ArrowDownRight size={14}/> TOP 24H DECLINER</label><strong className="negative">{overview?.top_losers?.[0]?.base_asset??'—'}</strong><small>{pct(overview?.top_losers?.[0]?.price_change_pct_24h)} · descriptive only</small></article>
      <article className="metric"><label><Database size={14}/> DATA PROVIDER</label><strong className="provider">MEXC</strong><small>Spot + USD-M Futures context</small></article>
     </section>
     <section className="two-col">
      <article className="panel focus-panel"><div className="panel-head"><div><div className="eyebrow">ASSET MONITOR</div><h2>{chosen?.base_asset??selected.replace('USDT','')} <span>/ USDT</span></h2></div><select value={selected} onChange={e=>setSelected(e.target.value)}>{markets.slice(0,100).map(m=><option key={m.symbol} value={m.symbol}>{m.symbol}</option>)}</select></div><div className="focus-price">{money(chosen?.last_price)} <Change value={chosen?.price_change_pct_24h}/></div><div className="chart-area"><Sparkline items={candles}/></div><div className="detail-grid"><div><small>24H HIGH</small><b>{money(chosen?.high_24h)}</b></div><div><small>24H LOW</small><b>{money(chosen?.low_24h)}</b></div><div><small>24H QUOTE VOLUME</small><b>{chosen?money(chosen.quote_volume_24h):'—'}</b></div><div><small>TRADES (24H)</small><b>{chosen?.trade_count_24h?.toLocaleString()??'—'}</b></div></div><div className="oi-row"><span>Futures open-interest snapshot</span><b>{oi==null?(oiError||'Loading…'):n(oi,3)+' contracts'}</b></div><small className="disclaimer">Spot candles and futures open interest are separate datasets; OI is not a directional signal.</small></article>
      <article className="panel"><div className="panel-head"><div><div className="eyebrow">MARKET LEADERSHIP</div><h2>Highest traded value</h2></div><span className="tag">24H</span></div><div className="leader-list">{topVolume.map((m,i)=><button key={m.symbol} className="leader-row" onClick={()=>setSelected(m.symbol)}><span className="rank">{String(i+1).padStart(2,'0')}</span><b>{m.base_asset}</b><span>{money(m.quote_volume_24h)}</span><Change value={m.price_change_pct_24h}/></button>)}</div></article>
     </section>
     <section className="two-col lists">
      <article className="panel"><div className="panel-head"><div><div className="eyebrow">PRICE PERFORMANCE</div><h2>Top 24h gainers</h2></div><span className="tag">SPOT</span></div><MarketTable rows={overview?.top_gainers??[]}/></article>
      <article className="panel"><div className="panel-head"><div><div className="eyebrow">PRICE PERFORMANCE</div><h2>Top 24h decliners</h2></div><span className="tag">SPOT</span></div><MarketTable rows={overview?.top_losers??[]}/></article>
     </section>
     <article className="panel market-panel"><div className="panel-head"><div><div className="eyebrow">MARKET UNIVERSE</div><h2>USDT perpetual contracts</h2></div><label className="search"><Search size={14}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search symbol…"/></label></div><div className="table-wrap"><table><thead><tr><th>ASSET</th><th>LAST PRICE</th><th>24H CHANGE</th><th>24H HIGH</th><th>24H LOW</th><th>QUOTE VOLUME</th><th>TRADES</th></tr></thead><tbody>{filtered.slice(0,30).map(m=><tr key={m.symbol} onClick={()=>setSelected(m.symbol)}><td><b>{m.base_asset}</b><small>{m.symbol}</small></td><td>{money(m.last_price)}</td><td><Change value={m.price_change_pct_24h}/></td><td>{money(m.high_24h)}</td><td>{money(m.low_24h)}</td><td>{money(m.quote_volume_24h)}</td><td>{m.trade_count_24h?.toLocaleString()??'—'}</td></tr>)}</tbody></table></div><div className="table-foot">Showing {Math.min(filtered.length,30)} of {filtered.length} matching pairs · Select a row to inspect the asset above.</div></article>
    </>}
    {tab==='CRYPTO'&&<CryptoWorkspace markets={markets}/> }
    {(tab==='OVERVIEW'||tab==='MACRO')&&<section className="panel macro-panel"><div className="panel-head"><div><div className="eyebrow">CROSS-ASSET REFERENCE</div><h2>Macro watch</h2></div><span className="tag">VENDOR DATA</span></div><div className="macro-grid">{['XAUUSD','USOIL','DXY'].map(k=>{const x=macro?.instruments?.[k];return <div className="macro-card" key={k}><div><span>{k}</span><i className={x?.status==='ok'?'ok-dot':'bad-dot'}/></div><strong>{x?.last==null?'Unavailable':n(x.last,x.last<10?3:2)}</strong><small>{x?.label??'Loading reference…'}</small><em>{x?.status==='ok'?'Latest 5m interval: '+pct(x.change_pct_latest_interval):x?.status??'Loading'}</em><footer>{x?.source??'Yahoo Finance chart'}</footer></div>})}</div><p className="macro-note">{macro?.note??'Gold and WTI are futures references; they may differ from broker spot/CFD quotes. DXY is an index reference.'}</p></section>}
    {tab==='DATA'&&<section className="panel data-panel"><div className="eyebrow">SYSTEM TRANSPARENCY</div><h2>Feed status & limitations</h2><div className="data-line"><span><Wifi size={15}/> API health</span><b>{error?'DEGRADED':'CONNECTED'}</b></div><div className="data-line"><span><Database size={15}/> Crypto spot</span><b>MEXC USD-M perpetual ticker</b></div><div className="data-line"><span><Activity size={15}/> Futures context</span><b>Separate futures OI endpoint (not part of Spot universe)</b></div><div className="data-line"><span><Globe2 size={15}/> Macro references</span><b>Yahoo Finance chart · GC=F / CL=F / DX-Y.NYB</b></div><div className="data-line"><span><Clock3 size={15}/> Last API update</span><b>{updated?new Date(updated).toLocaleString():'—'}</b></div><p className="macro-note">This is a read-only monitoring terminal. Public provider data can be delayed, rate-limited or unavailable. Gold/WTI futures are reference instruments, not a universal spot/CFD order book. No AI-generated buy/sell calls, orders or account connections.</p></section>}
   </>}
   <footer className="app-footer"><span><ShieldCheck size={14}/> READ-ONLY MARKET INTELLIGENCE</span><span><Radio size={14}/> {source}</span><span>Auto refresh: 30 seconds</span></footer>
  </main>
 </div>
}
function MarketTable({rows}:{rows:Market[]}){return <div className="compact-table">{rows.slice(0,8).map(m=><div className="compact-row" key={m.symbol}><b>{m.base_asset}</b><span>{money(m.last_price)}</span><Change value={m.price_change_pct_24h}/></div>)}</div>}
export default App;