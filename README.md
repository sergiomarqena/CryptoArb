# MR MOST PROFITABLE — Market Intelligence

A read-only multi-market monitoring platform. No exchange credentials, order placement, or automated trading.

## Architecture

- **Frontend:** React + TypeScript + Vite
- **API:** FastAPI + HTTPX
- **Live crypto source:** Binance public Spot 24h ticker, klines, USD-M Futures premium index and open-interest snapshot endpoints
- **Macro references:** Yahoo Finance chart data for gold futures (GC=F), WTI crude futures (CL=F), and US Dollar Index (DX-Y.NYB)
- **Hosting:** Railway API service; GitHub Pages remains the static frontend preview
- **Caching:** in-process TTL cache to reduce public API calls

## API endpoints

- `GET /health` — service health
- `GET /api/v1/status` — connected providers and operating mode
- `GET /api/v1/crypto/markets` — USDT spot universe with 24h price/volume and available futures funding context
- `GET /api/v1/crypto/overview` — descriptive top gainers, losers and quote-volume rankings
- `GET /api/v1/crypto/klines/{symbol}?interval=1m&limit=100` — historical candles
- `GET /api/v1/crypto/open-interest/{symbol}` — futures open-interest snapshot
- `GET /api/v1/macro` — gold, WTI and DXY market references
- `WS /ws` — periodic market overview updates

Interactive API docs: `/docs`.

## Deploy API to Railway

Create a Railway service from this repository and set its **Root Directory** to `/backend`. Railway will build `backend/Dockerfile`, expose the generated `PORT`, and health-check `/health`.

Optional variables:
- `MARKET_CACHE_TTL=20`
- `UNIVERSE_LIMIT=100`
- `REQUEST_TIMEOUT=9`
- `CORS_ORIGINS=*` (replace with the frontend origin when you have a stable custom domain)

## Local development

```bash
cd backend
python -m venv .venv
# Windows: .venv\\Scripts\\activate
# macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

## Data integrity

Every response identifies its provider and update time. Public endpoints can be rate-limited or temporarily unavailable. Yahoo Finance futures references are not guaranteed to match a broker's CFD quote or session. Macro values may be delayed/indicative. Do not treat market rankings, funding, open interest or price movements as trading instructions.

## Roadmap

1. Public live market ingestion and API health — foundation
2. Frontend API integration and market interval/ranking screens
3. Historical storage and relative-volume baselines
4. News/event source ingestion with citations and explainable summaries
5. Portfolio analytics and a TradingView chart workspace
