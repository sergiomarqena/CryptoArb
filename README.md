# MR MOST PROFITABLE — Crypto Market Monitor

A read-only crypto and cross-market monitoring dashboard. It does not connect exchange accounts or place orders.

## Architecture

- **Frontend:** React + TypeScript + Vite
- **API:** FastAPI + HTTPX
- **Primary crypto market:** MEXC USD-M USDT-settled perpetual contracts
- **Candles and technical measurements:** MEXC contract candles; RSI(14), MACD(12,26,9), and 4H/1D/1W/30D price changes calculated from real 1H candles
- **Activity monitor:** MEXC 5-minute candles; current contract-volume multiple versus the preceding 21 five-minute candles
- **Chain fundamentals:** DefiLlama current and historical chain TVL
- **Macro references:** Yahoo Finance chart data for gold futures (GC=F), WTI crude futures (CL=F), and US Dollar Index (DX-Y.NYB)
- **Hosting:** Railway API/web services; GitHub Pages static preview
- **Caching:** in-process TTL caches for public provider data

## API endpoints

- `GET /health` — service health
- `GET /api/v1/status` — configured public feeds and operating mode
- `GET /api/v1/crypto/markets` — MEXC USDT perpetual contract universe with 24h price, turnover, funding, mark/index price, and available open-interest field
- `GET /api/v1/crypto/overview` — descriptive top gainers, losers, and turnover rankings
- `GET /api/v1/crypto/klines/{symbol}?interval=4h&limit=120` — historical MEXC Futures candles
- `GET /api/v1/crypto/screener/indicators?symbols=BTCUSDT,ETHUSDT` — RSI, MACD histogram, and historical price changes for up to 50 contracts
- `GET /api/v1/crypto/activity?limit=25` — observed 5m contract-price changes and volume expansion versus the preceding 21 candles
- `GET /api/v1/crypto/open-interest/{symbol}` — MEXC ticker snapshot with reported `holdVol`, funding, and fair price
- `GET /api/v1/flows/chains?timeframe=1D` — chain-level TVL data and daily/weekly historical changes
- `GET /api/v1/macro` — gold, WTI, and DXY market references
- `WS /ws` — periodic descriptive market overview updates

Interactive API docs: `/docs`.

## Data interpretation and limits

- RSI and MACD are calculated from actual hourly perpetual-contract candle closes. They are historical measurements, not predictions.
- The 4H/1D/1W/30D columns are price changes over corresponding hourly-candle lookbacks.
- The activity condition is an observed 5m price-move and volume-expansion comparison. It is not a prediction or a buy/sell instruction.
- `holdVol` is the value reported by MEXC for contract open-interest volume; units depend on contract specifications.
- DefiLlama chain TVL change is **not** the same as exchange deposits, withdrawals, or net token inflow/outflow. The chain monitor labels it as TVL change.
- DefiLlama historical chain TVL is daily. 4H historical TVL change is therefore displayed as unavailable, not estimated.
- MEXC Futures ticker does not supply a trade-count field in this response; the UI shows unavailable rather than inventing a count.
- Public feeds may be delayed, rate-limited, or unavailable. Unsupported fields remain unavailable.

## Deploy API to Railway

The API service builds `backend/Dockerfile` from the repository root. Railway supplies `PORT`; the container health-checks `/health`.

Suggested variables:
- `MARKET_CACHE_TTL=20`
- `UNIVERSE_LIMIT=2500`
- `ACTIVITY_UNIVERSE=25`
- `INDICATOR_CACHE_TTL=180`
- `FLOW_CACHE_TTL=900`
- `REQUEST_TIMEOUT=9`
- `CORS_ORIGINS=*` (replace with the exact frontend origin when stable)

The Railway web build uses the root asset base. GitHub Pages builds with `--mode pages` and the `/CryptoArb/` base path.

## Local development

```bash
cd backend
python -m venv .venv
# Windows: .venv\\Scripts\\activate
# macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

In another terminal:

```bash
cd frontend
npm install
# Optional: VITE_API_URL=http://127.0.0.1:8000
npm run dev
```

## Scope

This project is a read-only market-information terminal. It does not contain exchange account access, order placement, leverage controls, or automated trading. Market rankings, funding, open interest, and price/volume changes are descriptive data, not financial recommendations.