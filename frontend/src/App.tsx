import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createChart, CandlestickSeries, type IChartApi, type UTCTimestamp } from 'lightweight-charts';
import { Activity, ArrowDownRight, ArrowUpRight, BarChart3, ChevronDown, CircleHelp, Database, Filter, Globe2, Layers3, RefreshCw, Search, ShieldAlert, Signal, Waves, X } from 'lucide-react';

const API = (import.meta as any).env?.VITE_API_URL || 'https://mr-most-profitable-api-production.up.railway.app';
type Market = {
  symbol:string; base_asset:string; price:number|null; change_24h_pct:number|null;
  price_change_pct:number|null; volume_change_pct:number|null; relative_volume:number|null;
  quote_volume_24h:number|null; base_volume_24h:number|null; high_24h:number|null; low_24h:number|null;
  open_interest_contracts:number|null; oi_change_pct:number|null; funding_rate:number|null;
  contract_market_available:boolean; market_cap_usd:number|null; fully_diluted_market_cap_usd:number|null;
  liquidity_sort_value:number|null; quote_volume_estimate_usd:number|null;
  bullish_probability:number|null; bearish_probability:number|null; neutral_probability:number|null;
  confidence_pct:number|null; supporting_evidence?:string[]; conflicting_evidence?:string[]; probability_note?:string;
  token_unlock:'YES'|'NO'|'UNKNOWN'; whale_activity:string; signal:string; metric_status:string;
};
type Candle = {time:number;open:number;high:number;low:number;close:number;volume:number|null};
type Detail = {symbol:string;market:Market|null;candles:{candles:Candle[];source:string}|null;
  spot_orderbook:any;contract_orderbook:any;trade_intelligence:any;whale_buying:string;whale_selling:string;
  whale_zone_status:string;oi_interpretation:string;market_cap_status:string;token_unlock_status:string;updated_at:string};
const money=(v:number|null|undefined)=>v==null?'—':v>=1000?'$'+v.toLocaleString('en-US',{maximumFractionDigits:2}):'$'+v.toPrecision(5);
const compact=(v:number|null|undefined)=>v==null?'—':Intl.NumberFormat('en-US',{notation:'compact',maximumFractionDigits:2}).format(v);
const pct=(v:number|null|undefined)=>v==null?'—':(v>0?'+':'')+v.toFixed(2)+'%';
const num=(v:number|null|undefined,d=2)=>v==null?'—':v.toLocaleString('en-US',{maximumFractionDigits:d});
const stamp=(v?:string)=>v?new Date(v).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',second:'2-digit'}):'—';
async function get<T,>(path:string):Promise<T>{const r=await fetch(API+path,{cache:'no-store'});if(!r.ok)throw new Error('API '+r.status);return r.json();}
function Delta({value}:{value:number|null|undefined}){return <span className={value==null?'muted':value>=0?'up':'down'}>{value==null?'—':<>{value>=0?<ArrowUpRight size={13}/>:<ArrowDownRight size={13}/>} {pct(value)}</>}</span>}
function StatusDot({ok}:{ok:boolean}){return <i className={ok?'dot-live':'dot-warn'}/>}

function ChartPanel({symbol,timeframe}:{symbol:string;timeframe:string}){
  const host=useRef<HTMLDivElement>(null); const chart=useRef<IChartApi|null>(null);
  const [candles,setCandles]=useState<Candle[]>([]); const [status,setStatus]=useState('Loading candles…');
  useEffect(()=>{let alive=true;const load=()=>get<{candles:Candle[];source:string}>(`/api/v1/crypto/klines/${symbol}?interval=${timeframe}&market=spot&limit=240`)
    .then(x=>{if(alive){setCandles(x.candles||[]);setStatus(x.source||'MEXC Spot candles')}})
    .catch(()=>{if(alive){setCandles([]);setStatus('Candle feed unavailable')}});load();const timer=setInterval(load,10000);return()=>{alive=false;clearInterval(timer)}},[symbol,timeframe]);
  useEffect(()=>{
    if(!host.current||!candles.length)return;
    const el=host.current;
    const c=createChart(el,{width:el.clientWidth,height:310,layout:{background:{color:'#080e18'},textColor:'#8b9bb0'},
      grid:{vertLines:{color:'#111d2b'},horzLines:{color:'#111d2b'}},rightPriceScale:{borderColor:'#26364a'},
      timeScale:{borderColor:'#26364a',timeVisible:true,secondsVisible:false},crosshair:{vertLine:{color:'#42617e'},horzLine:{color:'#42617e'}}});
    chart.current=c;
    const series=c.addSeries(CandlestickSeries,{upColor:'#19d7a3',downColor:'#f05b78',borderVisible:false,
      wickUpColor:'#19d7a3',wickDownColor:'#f05b78'});
    series.setData(candles.filter(x=>x.open!=null&&x.high!=null&&x.low!=null&&x.close!=null).map(x=>({
      time:Math.floor(x.time/1000) as UTCTimestamp,open:x.open,high:x.high,low:x.low,close:x.close
    })));
    c.timeScale().fitContent();
    const observer=new ResizeObserver(entries=>{for(const e of entries)c.applyOptions({width:e.contentRect.width})});
    observer.observe(el);
    return()=>{observer.disconnect();c.remove();chart.current=null};
  },[candles]);
  return <div className="chart-box"><div className="chart-meta"><span><StatusDot ok={candles.length>0}/>{status}</span><span>{candles.length} bars</span></div><div ref={host} className="chart-host">{!candles.length&&<div className="chart-empty">{status}</div>}</div></div>;
}

function CoinModal({symbol,onClose}:{symbol:string;onClose:()=>void}){
  const [timeframe,setTimeframe]=useState('5M'); const [detail,setDetail]=useState<Detail|null>(null); const [loading,setLoading]=useState(true); const [error,setError]=useState('');
  const load=useCallback(async()=>{setLoading(true);setError('');try{const d=await get<Detail>(`/api/v1/crypto/detail/${symbol}?timeframe=${timeframe}`);setDetail(d)}catch(e){setError(e instanceof Error?e.message:'Detail unavailable')}finally{setLoading(false)}},[symbol,timeframe]);
  useEffect(()=>{load();const timer=setInterval(load,10000);return()=>clearInterval(timer)},[load]);
  const book=detail?.spot_orderbook; const trades=detail?.trade_intelligence;
  return <div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}>
    <section className="coin-modal">
      <header className="modal-head"><div><div className="eyebrow">ASSET INTELLIGENCE / MEXC SPOT</div><h2>{symbol.replace('USDT','')} <small>/ USDT</small></h2><span className="muted tiny">Read-only market analysis · updated {stamp(detail?.updated_at)}</span></div><button className="icon-btn" onClick={onClose}><X/></button></header>
      <div className="timeframe-row">{['1M','5M','30M','1H','1D'].map(t=><button key={t} className={timeframe===t?'active':''} onClick={()=>setTimeframe(t)}>{t}</button>)}</div>
      {error&&<div className="alert"><ShieldAlert size={16}/>{error}</div>}
      {loading&&!detail?<div className="loading">Fetching live MEXC data…</div>:<>
        <div className="detail-top"><div className="panel chart-panel"><div className="panel-title"><span>PRICE ACTION</span><span className="live-label"><StatusDot ok={!!detail?.candles?.candles?.length}/> MEXC DATA</span></div><ChartPanel symbol={symbol} timeframe={timeframe}/></div>
        <div className="panel intel-panel"><div className="panel-title"><span>WHALE INTELLIGENCE</span><Waves size={16}/></div>
          <div className="whale-state"><span>WHALE BUYING</span><b className={detail?.whale_buying==='DETECTED'?'up':'muted'}>{detail?.whale_buying||'INSUFFICIENT DATA'}</b></div>
          <div className="whale-state"><span>WHALE SELLING</span><b className={detail?.whale_selling==='DETECTED'?'down':'muted'}>{detail?.whale_selling||'INSUFFICIENT DATA'}</b></div>
          <div className="whale-activity-note">{detail?.whale_buying==='DETECTED'?'LARGE TRADE BUYING PRESSURE DETECTED — NO WALLET IDENTITY INFERRED':'NO CONFIRMED WHALE BUYING ACTIVITY'}</div>
          <div className="zone-note">{detail?.whale_zone_status||'NO WHALE BUYING ZONE IDENTIFIED'}</div>
          <p className="tiny muted">{trades?.caveat||'Large trade classification is a sample-relative heuristic, not wallet attribution.'}</p>
        </div></div>
        <div className="panel model-panel"><div className="panel-title"><span>NORDVEX DIRECTIONAL MODEL</span><span className="tiny muted">{detail?.market?.confidence_pct==null?'NO ESTIMATE':'CONFIDENCE '+detail.market.confidence_pct.toFixed(1)+'%'}</span></div>
          {detail?.market?.bullish_probability==null?<div className="empty-state">INSUFFICIENT DATA FOR A DIRECTIONAL ESTIMATE</div>:<><div className="probability-bars"><div><span>BULLISH</span><b className="up">{detail.market.bullish_probability.toFixed(2)}%</b><i><em className="bull-prob" style={{width:detail.market.bullish_probability+'%'}}/></i></div><div><span>BEARISH</span><b className="down">{detail.market.bearish_probability?.toFixed(2)}%</b><i><em className="bear-prob" style={{width:(detail.market.bearish_probability||0)+'%'}}/></i></div><div><span>NEUTRAL</span><b>{detail.market.neutral_probability?.toFixed(2)}%</b><i><em className="neutral-prob" style={{width:(detail.market.neutral_probability||0)+'%'}}/></i></div></div><div className="evidence-row"><span>Supporting: {(detail.market.supporting_evidence||[]).join(', ')||'—'}</span><span>Conflicting: {(detail.market.conflicting_evidence||[]).join(', ')||'—'}</span></div></>}
          <p className="tiny muted">{detail?.market?.probability_note||'Uncalibrated heuristic only; not a historical win rate.'}</p>
        </div>
        <div className="detail-grid">
          <div className="panel"><div className="panel-title">SPOT ORDER BOOK <span className="tiny muted">MEXC</span></div><div className="book-stats"><span>Bid / Ask ratio</span><b>{num(book?.bid_ask_ratio,3)}</b><span>Imbalance</span><b>{pct(book?.imbalance_pct)}</b><span>Spread</span><b>{money(book?.spread)}</b><span>Spread %</span><b>{pct(book?.spread_pct)}</b></div><div className="depth-lists"><div><b className="up">BIDS</b>{(book?.bids||[]).slice(0,6).map((x:any,i:number)=><span key={i}><i>{money(Number(x[0]))}</i><b>{num(Number(x[1]),4)}</b></span>)}</div><div><b className="down">ASKS</b>{(book?.asks||[]).slice(0,6).map((x:any,i:number)=><span key={i}><i>{money(Number(x[0]))}</i><b>{num(Number(x[1]),4)}</b></span>)}</div></div><p className="tiny muted">Resting liquidity can be cancelled; it is not executed buying.</p></div>
          <div className="panel"><div className="panel-title">DERIVATIVES CONTEXT <span className="tiny muted">CONTRACT ONLY</span></div><div className="book-stats"><span>Open interest</span><b>{compact(detail?.market?.open_interest_contracts)}</b><span>OI change</span><b><Delta value={detail?.market?.oi_change_pct}/></b><span>Funding rate</span><b>{detail?.market?.funding_rate==null?'—':(detail.market.funding_rate*100).toFixed(4)+'%'}</b><span>Contract status</span><b>{detail?.market?.contract_market_available?'AVAILABLE':'UNAVAILABLE'}</b><span>Price / OI interpretation</span><b>{detail?.oi_interpretation||'INSUFFICIENT DATA'}</b></div><p className="tiny muted">OI change requires a collected historical snapshot for the selected timeframe. Funding is the exchange-reported contract rate.</p></div>
          <div className="panel"><div className="panel-title">LARGE TRADE SAMPLE <span className="tiny muted">SPOT</span></div><div className="book-stats"><span>Sample size</span><b>{trades?.sample_size??'—'}</b><span>Large trade threshold</span><b>{money(trades?.large_trade_threshold_notional)}</b><span>Large buy notional</span><b className="up">{money(trades?.large_buy_notional)}</b><span>Large sell notional</span><b className="down">{money(trades?.large_sell_notional)}</b></div><p className="tiny muted">Top 1% of sampled trade notionals, when sample size permits. No wallet identity inferred.</p></div>
          <div className="panel"><div className="panel-title">SUPPLY & VALUATION</div><div className="book-stats"><span>Market cap</span><b>UNKNOWN</b><span>FDV</span><b>UNKNOWN</b><span>Token unlock</span><b>UNKNOWN</b></div><p className="tiny muted">{detail?.market_cap_status}. {detail?.token_unlock_status}.</p></div>
        </div>
      </>}
    </section>
  </div>;
}

function App(){
  const [rows,setRows]=useState<Market[]>([]);const [timeframe,setTimeframe]=useState('5M');
  const [loading,setLoading]=useState(true);const [refreshing,setRefreshing]=useState(false);const [error,setError]=useState('');
  const [updated,setUpdated]=useState('');const [scanCount,setScanCount]=useState(0);const [enriched,setEnriched]=useState(0);
  const [query,setQuery]=useState('');const [quick,setQuick]=useState('ALL');const [selected,setSelected]=useState('');
  const [minChange,setMinChange]=useState('');const [maxChange,setMaxChange]=useState('');const [minVolume,setMinVolume]=useState('');const [maxVolume,setMaxVolume]=useState('');const [minRvol,setMinRvol]=useState('');
  const [minFunding,setMinFunding]=useState('');const [maxFunding,setMaxFunding]=useState('');const [minMcap,setMinMcap]=useState('');const [maxMcap,setMaxMcap]=useState('');const [minLiquidity,setMinLiquidity]=useState('');
  const [oiFilter,setOiFilter]=useState('ANY');const [signalFilter,setSignalFilter]=useState('ANY');const [unlockFilter,setUnlockFilter]=useState('ANY');
  const [sortKey,setSortKey]=useState<keyof Market>('liquidity_sort_value');const [sortDirection,setSortDirection]=useState<'desc'|'asc'>('desc');
  const refresh=useCallback(async()=>{setRefreshing(true);try{const x=await get<any>(`/api/v1/crypto/markets?timeframe=${timeframe}`);setRows(x.data||[]);setScanCount(x.spot_pairs_scanned||0);setEnriched(x.candle_enriched_pairs||0);setUpdated(x.updated_at||'');setError('')}catch(e){setError(e instanceof Error?e.message:'MEXC API unavailable')}finally{setLoading(false);setRefreshing(false)}},[timeframe]);
  useEffect(()=>{refresh();const t=setInterval(refresh,30000);return()=>clearInterval(t)},[refresh]);
  const filtered=useMemo(()=>{let x=rows.filter(r=>r.symbol.toLowerCase().includes(query.toLowerCase())||r.base_asset?.toLowerCase().includes(query.toLowerCase()));
    if(minChange!=='' )x=x.filter(r=>r.price_change_pct!=null&&r.price_change_pct>=Number(minChange));
    if(maxChange!=='' )x=x.filter(r=>r.price_change_pct!=null&&r.price_change_pct<=Number(maxChange));
    if(minVolume!=='' )x=x.filter(r=>r.volume_change_pct!=null&&r.volume_change_pct>=Number(minVolume));
    if(maxVolume!=='' )x=x.filter(r=>r.volume_change_pct!=null&&r.volume_change_pct<=Number(maxVolume));
    if(minRvol!=='' )x=x.filter(r=>r.relative_volume!=null&&r.relative_volume>=Number(minRvol));
    if(minFunding!=='' )x=x.filter(r=>r.funding_rate!=null&&r.funding_rate*100>=Number(minFunding));
    if(maxFunding!=='' )x=x.filter(r=>r.funding_rate!=null&&r.funding_rate*100<=Number(maxFunding));
    if(minMcap!=='' )x=x.filter(r=>r.market_cap_usd!=null&&r.market_cap_usd>=Number(minMcap));
    if(maxMcap!=='' )x=x.filter(r=>r.market_cap_usd!=null&&r.market_cap_usd<=Number(maxMcap));
    if(minLiquidity!=='' )x=x.filter(r=>r.liquidity_sort_value!=null&&r.liquidity_sort_value>=Number(minLiquidity));
    if(oiFilter==='UP')x=x.filter(r=>r.oi_change_pct!=null&&r.oi_change_pct>0);if(oiFilter==='DOWN')x=x.filter(r=>r.oi_change_pct!=null&&r.oi_change_pct<0);
    if(signalFilter!=='ANY')x=x.filter(r=>r.signal===signalFilter);if(unlockFilter!=='ANY')x=x.filter(r=>r.token_unlock===unlockFilter);
    if(quick==='GAINERS')x=x.filter(r=>r.price_change_pct!=null).sort((a,b)=>(b.price_change_pct||0)-(a.price_change_pct||0));
    if(quick==='LOSERS')x=x.filter(r=>r.price_change_pct!=null).sort((a,b)=>(a.price_change_pct||0)-(b.price_change_pct||0));
    if(quick==='VOLUME')x=x.filter(r=>(r.volume_change_pct||0)>50);
    if(quick==='RVOL')x=x.filter(r=>(r.relative_volume||0)>=2);
    if(quick==='OI_UP')x=x.filter(r=>r.oi_change_pct!=null&&r.oi_change_pct>0);
    if(quick==='OI_DOWN')x=x.filter(r=>r.oi_change_pct!=null&&r.oi_change_pct<0);
    if(quick==='WHALE')x=x.filter(r=>r.whale_activity==='DETECTED');
    if(quick==='BREAKOUT')x=x.filter(r=>r.relative_volume!=null&&r.relative_volume>=2&&r.price_change_pct!=null&&r.price_change_pct>0);
    if(quick==='REVERSAL')x=x.filter(r=>r.relative_volume!=null&&r.relative_volume>=1.5&&r.price_change_pct!=null&&r.price_change_pct<0);
    if(quick==='ALL')x.sort((a,b)=>{const av=a[sortKey] as any,bv=b[sortKey] as any;if(av==null)return 1;if(bv==null)return -1;const cmp=typeof av==='string'?av.localeCompare(bv):Number(av)-Number(bv);return sortDirection==='asc'?cmp:-cmp});
    return x;
  },[rows,query,minChange,maxChange,minVolume,maxVolume,minRvol,minFunding,maxFunding,minMcap,maxMcap,minLiquidity,oiFilter,signalFilter,unlockFilter,quick,sortKey,sortDirection]);
  const gainers=rows.filter(r=>r.price_change_pct!=null&&r.price_change_pct>0).length;const losers=rows.filter(r=>r.price_change_pct!=null&&r.price_change_pct<0).length;const breadthTotal=Math.max(1,gainers+losers);
  const sortBy=(key:keyof Market)=>{if(sortKey===key)setSortDirection(d=>d==='desc'?'asc':'desc');else{setSortKey(key);setSortDirection('desc')}};
  const bullishWidth=Math.round(gainers/breadthTotal*100);const bearishWidth=100-bullishWidth;
  return <div className="app-shell">
    <header className="topbar"><a className="brand"><span className="brandmark">N</span><span><b>NORDVEX</b><small>SCREENER PRO <i>MARKET INTELLIGENCE</i></small></span></a><nav><span className="nav-active">SCREENER</span><span>MARKET MAP</span><span>INTELLIGENCE</span></nav><div className="top-right"><span><StatusDot ok={!error}/>{error?'PROVIDER ISSUE':'MEXC PUBLIC FEED'}</span><button className="icon-btn" onClick={refresh} disabled={refreshing}><RefreshCw size={15} className={refreshing?'spin':''}/></button></div></header>
    <div className="ticker-strip"><span className="live-dot"/> MEXC / USDT UNIVERSE <b>{scanCount.toLocaleString()} PAIRS</b><span>·</span><span>TIMEFRAME <b>{timeframe}</b></span><span>·</span><span>LAST SNAPSHOT <b>{stamp(updated)}</b></span><span>·</span><span>READ ONLY / NO EXECUTION</span></div>
    <main className="content">
      <section className="page-heading"><div><div className="eyebrow">INSTITUTIONAL MARKET MONITOR / 01</div><h1>Live Crypto <em>Screener</em></h1><p>Real exchange data. Explainable metrics. Explicit data-quality states.</p></div><div className="feed-status"><StatusDot ok={!error}/><span>{error?'DATA DEGRADED':'FEED STATUS'}</span><small>{refreshing?'UPDATING':loading?'CONNECTING':'REST SNAPSHOT · 30S'}</small></div></section>
      {error&&<div className="alert"><ShieldAlert size={16}/><span>MEXC feed error: {error}. Existing rows are retained and their timestamp remains visible.</span></div>}
      <section className="metric-grid"><div className="metric"><label><Globe2/> SPOT USDT PAIRS</label><strong>{scanCount||'—'}</strong><small>Enabled MEXC Spot symbols</small></div><div className="metric"><label><Database/> CANDLE ENRICHED</label><strong>{enriched||'—'}</strong><small>Historical metrics available</small></div><div className="metric"><label><ArrowUpRight/> BULLISH BREADTH</label><strong className="up">{rows.length?bullishWidth+'%':'—'}</strong><small>{gainers} positive / {breadthTotal} directional pairs</small></div><div className="metric"><label><ArrowDownRight/> BEARISH BREADTH</label><strong className="down">{rows.length?bearishWidth+'%':'—'}</strong><small>{losers} negative / {breadthTotal} directional pairs</small></div></section>
      <section className="panel breadth-panel"><div className="panel-title"><span>MARKET BREADTH / SPOT CANDLE DIRECTION</span><span className="tiny muted">NOT A WIN PROBABILITY</span></div><div className="breadth-bubbles"><div className="bubble-wrap bull-wrap"><div className="bubble bull-bubble" style={{width:Math.max(58,Math.min(150,58+gainers/Math.max(rows.length,1)*92)),height:Math.max(58,Math.min(150,58+gainers/Math.max(rows.length,1)*92))}}><b>{gainers}</b><small>BULLISH</small></div></div><div className="breadth-track"><div className="bull-track" style={{width:bullishWidth+'%'}}/><div className="bear-track" style={{width:bearishWidth+'%'}}/></div><div className="bubble-wrap bear-wrap"><div className="bubble bear-bubble" style={{width:Math.max(58,Math.min(150,58+losers/Math.max(rows.length,1)*92)),height:Math.max(58,Math.min(150,58+losers/Math.max(rows.length,1)*92))}}><b>{losers}</b><small>BEARISH</small></div></div></div><div className="breadth-foot"><span>Positive timeframe candles: {bullishWidth}%</span><span>Negative timeframe candles: {bearishWidth}%</span></div></section>
      <section className="panel screener-panel">
        <div className="panel-title"><div><span>MARKET SCANNER</span><small>{filtered.length.toLocaleString()} / {rows.length.toLocaleString()} assets</small></div><div className="timeframes">{['1M','5M','30M','1H','1D'].map(t=><button key={t} className={timeframe===t?'active':''} onClick={()=>setTimeframe(t)}>{t}</button>)}</div></div>
        <div className="quick-filters">{[['ALL','All pairs'],['GAINERS','Top gainers'],['LOSERS','Top losers'],['VOLUME','Volume explosions'],['RVOL','Unusual RVOL'],['OI_UP','OI increasing'],['OI_DOWN','OI decreasing'],['WHALE','Whale activity'],['BREAKOUT','Breakout watch'],['REVERSAL','Reversal watch']].map(([id,label])=><button key={id} className={quick===id?'selected':''} onClick={()=>setQuick(id)}>{label}</button>)}</div>
        <details className="advanced-filters"><summary><Filter size={14}/> ADVANCED FILTERS <ChevronDown size={13}/></summary><div className="filter-grid">
          <label>Min price change %<input value={minChange} onChange={e=>setMinChange(e.target.value)} placeholder="—" type="number"/></label><label>Max price change %<input value={maxChange} onChange={e=>setMaxChange(e.target.value)} placeholder="—" type="number"/></label>
          <label>Min volume change %<input value={minVolume} onChange={e=>setMinVolume(e.target.value)} placeholder="—" type="number"/></label><label>Max volume change %<input value={maxVolume} onChange={e=>setMaxVolume(e.target.value)} placeholder="—" type="number"/></label>
          <label>Min relative volume<input value={minRvol} onChange={e=>setMinRvol(e.target.value)} placeholder="e.g. 2.0" type="number" step=".1"/></label>
          <label>Min funding %<input value={minFunding} onChange={e=>setMinFunding(e.target.value)} placeholder="—" type="number" step=".0001"/></label><label>Max funding %<input value={maxFunding} onChange={e=>setMaxFunding(e.target.value)} placeholder="—" type="number" step=".0001"/></label>
          <label>Min market cap USD<input value={minMcap} onChange={e=>setMinMcap(e.target.value)} placeholder="—" type="number"/></label><label>Max market cap USD<input value={maxMcap} onChange={e=>setMaxMcap(e.target.value)} placeholder="—" type="number"/></label><label>Min liquidity USD<input value={minLiquidity} onChange={e=>setMinLiquidity(e.target.value)} placeholder="—" type="number"/></label>
          <label>OI direction<select value={oiFilter} onChange={e=>setOiFilter(e.target.value)}><option value="ANY">Any / unavailable</option><option value="UP">Increasing</option><option value="DOWN">Decreasing</option></select></label><label>Signal<select value={signalFilter} onChange={e=>setSignalFilter(e.target.value)}><option value="ANY">Any</option><option value="BULLISH">Bullish</option><option value="BEARISH">Bearish</option><option value="NEUTRAL">Neutral</option><option value="UNAVAILABLE">Unavailable</option></select></label><label>Token unlock<select value={unlockFilter} onChange={e=>setUnlockFilter(e.target.value)}><option value="ANY">Any</option><option value="YES">Yes</option><option value="NO">No</option><option value="UNKNOWN">Unknown</option></select></label>
        </div></details>
        <div className="table-tools"><div className="search-box"><Search size={15}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search symbol…"/></div><span className="tiny muted">Click a row for full asset intelligence</span></div>
        <div className="table-scroll"><table><thead><tr><th>ASSET</th><th onClick={()=>sortBy('price')}>PRICE ↕</th><th onClick={()=>sortBy('price_change_pct')}>PRICE Δ ↕</th><th onClick={()=>sortBy('volume_change_pct')}>VOLUME Δ ↕</th><th onClick={()=>sortBy('relative_volume')}>REL VOL ↕</th><th onClick={()=>sortBy('open_interest_contracts')}>FUTURES OI ↕</th><th onClick={()=>sortBy('oi_change_pct')}>OI Δ ↕</th><th onClick={()=>sortBy('funding_rate')}>FUNDING ↕</th><th onClick={()=>sortBy('market_cap_usd')}>MCAP ↕</th><th onClick={()=>sortBy('token_unlock')}>UNLOCK ↕</th><th onClick={()=>sortBy('signal')}>SIGNAL ↕</th></tr></thead><tbody>
          {filtered.slice(0,500).map(r=><tr key={r.symbol} onClick={()=>setSelected(r.symbol)}><td><b>{r.base_asset}</b><small>{r.symbol}</small></td><td>{money(r.price)}</td><td><Delta value={r.price_change_pct}/></td><td><Delta value={r.volume_change_pct}/></td><td>{r.relative_volume==null?'—':r.relative_volume.toFixed(2)+'x'}</td><td>{r.contract_market_available?compact(r.open_interest_contracts):'—'}</td><td><Delta value={r.oi_change_pct}/></td><td>{r.funding_rate==null?'—':(r.funding_rate*100).toFixed(4)+'%'}</td><td>{compact(r.market_cap_usd)}</td><td><span className="unknown-tag">{r.token_unlock||'UNKNOWN'}</span></td><td><span className="signal-tag">{r.signal||'UNAVAILABLE'}</span></td></tr>)}
        </tbody></table>{loading&&!rows.length&&<div className="loading">Connecting to MEXC public market data…</div>}{!loading&&!filtered.length&&<div className="empty-state">No assets match the current filters.</div>}</div>
        <div className="table-foot">Rows sorted by MEXC quote-volume/liquidity value (reported where available, otherwise a clearly identified estimate). Candle metrics are only populated for the configured enriched universe ({enriched} pairs). Missing values are intentionally blank.</div>
      </section>
      <footer className="app-footer"><span><StatusDot ok={!error}/> MEXC PUBLIC MARKET DATA · READ ONLY</span><span>SNAPSHOT {stamp(updated)} · AUTO REFRESH 30S · API CACHE 15S</span><span>NO ORDER EXECUTION / NO PRIVATE KEYS</span></footer>
    </main>
    {selected&&<CoinModal symbol={selected} onClose={()=>setSelected('')}/>}
  </div>;
}
export default App;
