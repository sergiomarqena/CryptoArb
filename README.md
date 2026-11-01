# MR MOST PROFITABLE — Market Intelligence

A read-only crypto and cross-market monitoring dashboard. It does not connect exchange accounts, place orders, or generate buy/sell instructions.

## Architecture

- **Frontend:** React + TypeScript + Vite
- **API:** FastAPI + HTTPX
- **Crypto market data:** MEXC public Spot 24h ticker and Spot candlesticks
- **Technical measurements:** RSI(14), MACD(12,26,9), and historical 4H/1D/1W/30D changes calculated from real MEXC 1H Spot candles
- **Chain fundamentals:** DefiLlama current and historical chain TVL
- **Macro references:** Yahoo Finance chart data for gold futures (GC=F), WTI crude futures (CL=F), and US Dollar Index (DX-Y.NYB)
- **Hosting:** Railway API/web services; GitHub Pages static preview
- **Caching:** in-process TTL caches for public provider data

## API endpoints

- `GET /health` — service health
- `GET /api/v1/status` — configured public feeds and operating mode
- `GET /api/v1/crypto/markets` — USDT Spot market universe with actual 24h price and volume fields
- `GET /api/v1/crypto/overview` — descriptive top gainers, losers, and quote-volume statistics
- `GET /api/v1/crypto/klines/{symbol}?interval=4h&limit=120` — historical MEXC Spot candles
- `GET /api/v1/crypto/screener/indicators?symbols=BTCUSDT,ETHUSDT` — RSI, MACD histogram, and historical percentage changes for up to 50 symbols
- `GET /api/v1/flows/chains?timeframe=1D` — chain-level TVL data and daily/weekly historical changes (4H historical TVL change is not supplied by this provider)
- `GET /api/v1/macro` — gold, WTI, and DXY market references
- `WS /ws` — periodic descriptive market overview updates

Interactive API docs: `/docs`.

## Data interpretation

- RSI and MACD are calculated from actual hourly Spot candle closes. They are historical measurements, not predictions.
- The 4H/1D/1W/30D fields are price changes over corresponding hourly-candle lookbacks.
- DefiLlama chain TVL change is **not** the same as exchange deposits, withdrawals, or net token inflow/outflow.
- Historical chain TVL is daily. 4H TVL change is therefore displayed as unavailable, not estimated.
- MEXC Spot ticker trade-count fields can be absent; the UI shows an em dash instead of inventing a count.
- Public feeds may be delayed, rate-limited, or unavailable. Unsupported fields remain unavailable.

## Deploy API to Railway

The API service builds `backend/Dockerfile` from the repository root. Railway supplies `PORT`; the container health-checks `/health`.

Suggested variables:
- `MARKET_CACHE_TTL=20`
- `UNIVERSE_LIMIT=2500`
- `INDICATOR_CACHE_TTL=180`
- `FLOW_CACHE_TTL=900`
- `REQUEST_TIMEOUT=9`
- `CORS_ORIGINS=*` (replace with the exact frontend origin when stable)

The Railway web build uses the root asset base. GitHub Pages builds with `--mode pages` and the `/CryptoArb/` base path.

## Local development

```bash
cd backend
python -m venv .venv
# Windows: .venv\Scripts\activate
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

This project is a read-only market-information terminal. It does not contain exchange account access, order placement, leverage controls, or automated trading. Descriptive price/volume statistics and technical measurements should not be interpreted as financial recommendations.