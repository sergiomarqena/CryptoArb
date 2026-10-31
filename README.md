# NORDVEX — SCREENER PRO

Read-only crypto market intelligence using MEXC public Spot and Contract market-data APIs. No exchange credentials, order placement, or automated trading are used.

## Architecture

- **Frontend:** React + TypeScript + Vite
- **Charts:** TradingView Lightweight Charts
- **API:** FastAPI + HTTPX
- **Primary data:** MEXC Spot public REST API
- **Derivatives context:** MEXC Contract public REST API (kept separate from Spot)
- **Macro references:** Yahoo Finance chart data for gold futures (GC=F), WTI crude futures (CL=F), and US Dollar Index (DX-Y.NYB)
- **Hosting:** Railway API service; GitHub Pages remains the static frontend preview
- **Caching:** in-process TTL cache and bounded concurrent candle enrichment

## Current API

- `GET /health` — service health
- `GET /api/v1/status` — provider and read-only status
- `GET /api/v1/crypto/markets?timeframe=5M` — complete enabled MEXC USDT Spot symbol universe; candle metrics enriched for the highest-turnover configured subset
- `GET /api/v1/crypto/overview?timeframe=5M` — top gainers, losers, and quote-volume rankings
- `GET /api/v1/crypto/klines/{symbol}?interval=5M&market=spot&limit=200` — Spot or Contract OHLCV candles
- `GET /api/v1/crypto/orderbook/{symbol}?market=spot` — Spot or Contract order book
- `GET /api/v1/crypto/trades/{symbol}?market=spot` — public recent trades and sample-relative large-trade summary
- `GET /api/v1/crypto/open-interest/{symbol}?timeframe=5M` — current Contract holdVol and locally sampled OI change
- `GET /api/v1/crypto/detail/{symbol}?timeframe=5M` — combined coin detail payload
- `GET /api/v1/macro` — retained macro reference endpoint
- `WS /ws` — backend market snapshot updates (currently driven by REST polling)

Interactive API docs: `/docs`.

## Data integrity and known limitations

- Spot and Contract market data are separate. Spot rows do not inherit Contract funding or open-interest fields unless a matching USDT perpetual exists.
- Timeframe price change is derived from the latest candle open and close. Volume change compares the current candle with the previous equivalent candle.
- Relative volume is current candle volume divided by the mean of the preceding 20 candles.
- To protect public API rate limits, the full Spot USDT universe is listed but candle enrichment is currently bounded by `NORDVEX_CANDLE_UNIVERSE_LIMIT` (default 120). Unenriched rows explicitly report unavailable timeframe metrics.
- Contract `holdVol` is the exchange's reported open-interest/holding-volume field. OI percentage changes require locally collected snapshots and are unavailable until the selected lookback has elapsed. In-memory history resets on process restart.
- Large-trade flags are sample-relative heuristics from public trades, not verified whale identities or wallet attribution. Resting order-book liquidity is never treated as executed buying.
- Market cap, FDV, and token unlock fields remain null/UNKNOWN until a verified provider is configured. Missing data is never silently replaced with zero or NO.
- Directional distributions use a transparent, uncalibrated heuristic model. They are not calibrated probabilities or historical win rates.
- The current `/ws` endpoint streams backend snapshots generated from REST polling. It is not an upstream MEXC WebSocket connection yet; exchange-native WebSocket ingestion is a later implementation stage.
- Public providers can rate-limit, delay, or temporarily reject requests. Each response includes source/update metadata where available.

## Deploy API to Railway

The existing Railway monorepo configuration uses `backend/Dockerfile` and the `/health` health check. Keep the API service root directory at the repository root when using the root Dockerfile path, or use the service's existing root-directory configuration consistently.

Optional variables:

- `NORDVEX_CACHE_TTL=15`
- `NORDVEX_CANDLE_CONCURRENCY=6`
- `NORDVEX_CANDLE_UNIVERSE_LIMIT=120`
- `NORDVEX_WS_POLL_SECONDS=12`
- `REQUEST_TIMEOUT=12`
- `CORS_ORIGINS=*` (replace with the frontend origin when stable)

MEXC public market-data endpoints do not require private trading credentials.

## Local development

Backend:

```bash
cd backend
python -m venv .venv
# Windows: .venv\\Scripts\\activate
# macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

Frontend:

```bash
cd frontend
npm install
npm run dev
```

Set `VITE_API_URL` to the FastAPI origin if it differs from the configured Railway API.

## Roadmap

1. MEXC Spot + Contract REST integration and data-quality states
2. Full-universe candle enrichment with rate-limit-aware scheduling
3. Upstream MEXC WebSocket ingestion and reconnect/resync logic
4. Historical OI storage (PostgreSQL) and persistent market baselines
5. Advanced chart indicators, support/resistance, and order-book visualization
6. Token-unlock provider integration and market-cap enrichment
7. Historical backtesting and probability calibration
8. Railway staging verification and production deployment
