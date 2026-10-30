import { useEffect, useMemo, useState } from 'react';
import { Activity, Bell, ChartNoAxesCombined, CircleDot, Database, Globe2, Radio, Search, Settings2, ShieldCheck, Wallet, RotateCcw } from 'lucide-react';

type Market = { symbol: string; price: number; change: number; color: string };
const seed: Market[] = [
  { symbol: 'BTC/USDT', price: 67842.10, change: 1.82, color: 'gold' },
  { symbol: 'ETH/USDT', price: 3524.80, change: 0.94, color: 'violet' },
  { symbol: 'SOL/USDT', price: 182.64, change: -0.72, color: 'cyan' },
  { symbol: 'BNB/USDT', price: 598.22, change: 0.41, color: 'gold' },
  { symbol: 'XRP/USDT', price: 0.6241, change: -1.12, color: 'cyan' },
  { symbol: 'DOGE/USDT', price: 0.1642, change: 2.31, color: 'gold' },
  { symbol: 'AVAX/USDT', price: 36.82, change: 0.18, color: 'violet' },
  { symbol: 'LINK/USDT', price: 17.44, change: -0.33, color: 'cyan' },
];
const money = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtPrice = (n: number) => n < 1 ? n.toFixed(4) : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function Spark({ points }: { points: number[] }) {
  const path = points.map((v, i) => `${i === 0 ? 'M' : 'L'}${(i / Math.max(points.length - 1, 1)) * 600} ${140 - v * 115}`).join(' ');
  return <svg viewBox="0 0 600 150" preserveAspectRatio="none" className="spark"><defs><linearGradient id="fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#dc43c5" stopOpacity=".32"/><stop offset="100%" stopColor="#dc43c5" stopOpacity="0"/></linearGradient></defs><path d={`${path} L600 150 L0 150Z`} fill="url(#fill)"/><path d={path} fill="none" stroke="#df55ca" strokeWidth="2.5"/></svg>;
}
function App() {
  const [time, setTime] = useState(new Date());
  const [tab, setTab] = useState('OVERVIEW');
  const [markets, setMarkets] = useState(seed);
  const [history, setHistory] = useState<number[]>(Array.from({ length: 28 }, (_, i) => .38 + i * .008 + Math.sin(i * .8) * .035));
  const [wallet, setWallet] = useState(500);
  const [buy, setBuy] = useState('100');
  const [sell, setSell] = useState('102');
  const [fee, setFee] = useState('0.1');
  const [logs, setLogs] = useState([
    ['21:24:08', 'SYSTEM', 'Dashboard initialized', 'ok'],
    ['21:24:07', 'PAPER', 'Virtual wallet loaded: $500.00', 'ok'],
    ['21:24:06', 'DEMO', 'Synthetic price stream started', 'warn'],
    ['21:24:05', 'LAB', 'Fee calculator ready', 'ok'],
  ]);
  useEffect(() => {
    const timer = setInterval(() => {
      setTime(new Date());
      setMarkets(old => old.map(m => {
        const drift = (Math.random() - .49) * .0018;
        return { ...m, price: Math.max(m.price * (1 + drift), .0001), change: Math.max(-9.99, Math.min(9.99, m.change + drift * 100)) };
      }));
      setHistory(old => [...old.slice(-39), Math.max(.08, Math.min(.94, old[old.length - 1] + (Math.random() - .49) * .09))]);
    }, 2200);
    return () => clearInterval(timer);
  }, []);
  const calculation = useMemo(() => {
    const b = Number(buy), s = Number(sell), f = Number(fee);
    if (!(b > 0) || !(s > 0) || !(f >= 0) || !Number.isFinite(b + s + f)) return null;
    const gross = s - b;
    const fees = (b + s) * f / 100;
    return { gross, fees, net: gross - fees, pct: ((gross - fees) / b) * 100 };
  }, [buy, sell, fee]);
  const reset = () => {
    setWallet(500); setBuy('100'); setSell('102'); setFee('0.1');
    setLogs(old => [['21:24:09', 'PAPER', 'Demo wallet and calculator reset', 'ok'], ...old].slice(0, 8));
  };
  return <div className="shell">
    <header className="top"><div className="brand"><div className="brandmark">M</div><div><b>MR MOST PROFITABLE</b><small>QUANT TERMINAL <span>V1.1 SIMULATOR</span></small></div></div><nav>{['OVERVIEW','SPREAD LAB','ANALYTICS'].map(x=><button className={tab===x?'active':''} onClick={()=>setTab(x)} key={x}>{x}</button>)}</nav><div className="topright"><span className="status"><i/> SIMULATION</span><span className="clock">{time.toLocaleTimeString('en-GB')}</span><Bell size={16}/><Settings2 size={17}/></div></header>
    <div className="ticker"><span>DATA MODE <b className="amber">SYNTHETIC DEMO</b></span>{markets.slice(0,3).map(m=><span key={m.symbol}>{m.symbol} <b>${fmtPrice(m.price)}</b> <em className={m.change<0?'negative':'positive'}>{m.change>0?'+':''}{m.change.toFixed(2)}%</em></span>)}<span>EXCHANGE APIS <b className="amber">DISABLED</b></span></div>
    <main>
      <div className="heading"><div><div className="eyebrow">COMMAND CENTER / {tab}</div><h1>Market intelligence <span>terminal</span></h1><p>Interactive learning simulator · all prices and calculations are illustrative</p></div><div className="headright"><span className="pill"><CircleDot size={10}/> NO LIVE MARKET CONNECTION</span><button className="iconbtn" onClick={reset} title="Reset simulator"><RotateCcw size={16}/></button></div></div>
      <section className="stats">
        <div className="stat highlight"><div className="statlabel"><Wallet/> VIRTUAL WALLET</div><div className="big">{money(wallet)}</div><div className="sub">DEMO BALANCE · NOT REAL FUNDS</div><div className="linebar"><i/></div></div>
        <div className="stat"><div className="statlabel">SIMULATED P&L <span className="muted">01</span></div><div className="big">$0.00</div><div className="sub">NO POSITIONS OR ORDERS</div></div>
        <div className="stat"><div className="statlabel">OPEN POSITIONS <span className="muted">02</span></div><div className="big">00</div><div className="sub">ORDER ENTRY DISABLED</div></div>
        <div className="stat"><div className="statlabel">DEMO ASSETS <span className="muted">03</span></div><div className="big">08</div><div className="sub">SYNTHETIC PRICE STREAM</div></div>
      </section>
      <section className="gridmain">
        <div className="panel chartpanel"><div className="panelhead"><div><div className="eyebrow">SYNTHETIC MARKET / BTC-USDT</div><h2>Bitcoin <span className="muted">· illustrative reference</span></h2></div><span className="pill amberpill">DEMO STREAM</span></div><div className="price">${fmtPrice(markets[0].price)} <em>{markets[0].change>0?'+':''}{markets[0].change.toFixed(2)}%</em></div><div className="chart"><div className="chartgrid"><span>+4%</span><span>+3%</span><span>+2%</span><span>+1%</span><span>0%</span></div><Spark points={history}/><div className="chartnote">Generated sample path · not exchange candles</div></div><div className="timeframes">{['1M','5M','15M','1H','4H','1D'].map((x,i)=><button className={i===2?'selected':''} key={x}>{x}</button>)}</div></div>
        <div className="panel opportunity"><div className="panelhead"><div><div className="eyebrow">LEARNING MODULE</div><h2>Fee & spread calculator</h2></div><Activity size={18}/></div><div className="calc"><label>Hypothetical entry price ($)<input type="number" min="0" value={buy} onChange={e=>setBuy(e.target.value)}/></label><label>Hypothetical exit price ($)<input type="number" min="0" value={sell} onChange={e=>setSell(e.target.value)}/></label><label>Example fee rate (%)<input type="number" min="0" step="0.01" value={fee} onChange={e=>setFee(e.target.value)}/></label>{calculation ? <div className="calcresults"><div><span>Gross difference</span><b>{money(calculation.gross)}</b></div><div><span>Illustrative fees</span><b>{money(calculation.fees)}</b></div><div className="net"><span>After example fees</span><b className={calculation.net>=0?'positive':'negative'}>{money(calculation.net)} ({calculation.pct.toFixed(2)}%)</b></div></div> : <p className="calcerror">Enter valid positive prices and a non-negative fee.</p>}<small>Educational arithmetic only. Excludes slippage, taxes and other costs; not a trade signal.</small></div></div>
      </section>
      <section className="lower">
        <div className="panel"><div className="panelhead"><div><div className="eyebrow">SYNTHETIC ASSET UNIVERSE</div><h2>Demo market list <span className="muted">· generated locally</span></h2></div><span className="count">08 ASSETS</span></div><div className="marketlist">{markets.map(m=><div className="marketrow" key={m.symbol}><span className="coin">{m.symbol[0]}</span><b>{m.symbol}</b><span className="mprice">${fmtPrice(m.price)}</span><span className={m.change>=0?'positive':'negative'}>{m.change>0?'+':''}{m.change.toFixed(2)}%</span><span className="signal watch">DEMO</span><div className="score"><i style={{width:Math.min(100,Math.abs(m.change)*10+35)+'%'}}/></div></div>)}</div></div>
        <div className="panel map"><div className="panelhead"><div><div className="eyebrow">MARKET TOPOLOGY</div><h2>Signal constellation</h2></div><Globe2 size={18}/></div><div className="constellation animated-network"><svg className="network-wires" viewBox="0 0 600 260" preserveAspectRatio="none" aria-hidden="true"><g className="wire-base"><path d="M55 62 L155 35 L250 80 L345 42 L470 75 L550 35 M55 62 L110 165 L250 80 L300 205 L470 75 L510 175 M110 165 L205 225 L300 205 L390 150 L510 175 L550 35 M155 35 L205 225 M250 80 L390 150 M345 42 L390 150 M470 75 L550 35 M55 62 L205 225"/></g><g className="wire-flow"><path d="M55 62 L155 35 L250 80 L345 42 L470 75 L550 35 M55 62 L110 165 L250 80 L300 205 L470 75 L510 175 M110 165 L205 225 L300 205 L390 150 L510 175 L550 35 M155 35 L205 225 M250 80 L390 150 M345 42 L390 150 M470 75 L550 35 M55 62 L205 225"/></g></svg>{markets.concat([{...markets[0],symbol:'ADA/USDT'},{...markets[1],symbol:'DOT/USDT'},{...markets[2],symbol:'MATIC/USDT'}]).map((m,i)=>{const coords=[[9,24],[26,14],[42,31],[58,16],[78,29],[92,14],[18,64],[34,87],[50,79],[65,58],[85,67]];const p=coords[i];return <div key={m.symbol} className={'coin-node '+['gold','violet','cyan'][i%3]} style={{left:p[0]+'%',top:p[1]+'%',animationDelay:(i*.23)+'s'}}><i/><b>{m.symbol.split('/')[0]}</b></div>})}<div className="core"><Activity size={25}/><b>08</b><small>DEMO ASSETS</small></div><div className="network-scan"/></div><div className="maplegend"><span><i className="green"/> POSITIVE</span><span><i className="red"/> NEGATIVE</span><span><i className="pink"/> SIMULATED</span></div></div>
      </section>
      <section className="bottom"><div className="panel equity"><div className="panelhead"><div><div className="eyebrow">PAPER ACCOUNT</div><h2>Wallet history</h2></div><span className="count">START $500</span></div><div className="equityempty"><ChartNoAxesCombined size={24}/><b>No simulated transactions</b><small>Order placement is intentionally disabled.</small></div></div><div className="panel"><div className="panelhead"><div><div className="eyebrow">SYSTEM ACTIVITY</div><h2>Execution log</h2></div><span className="live"><i/> LOCAL</span></div><div className="logs">{logs.map((l,i)=><div className="logrow" key={i}><time>{l[0]}</time><b>{l[1]}</b><span>{l[2]}</span><i className={l[3]}/></div>)}</div></div></section>
      <footer><span><ShieldCheck size={13}/> EDUCATIONAL SIMULATOR · NO LIVE ORDERS</span><span><Database size={13}/> LOCAL GENERATED DATA · NO API KEYS</span><span>MRMP QUANT TERMINAL © 2026</span></footer>
    </main>
  </div>;
}
export default App;
