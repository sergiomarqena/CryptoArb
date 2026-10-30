import asyncio
import os
import time
from datetime import datetime, timezone
from typing import Any

import httpx
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

APP_NAME = "MR MOST PROFITABLE Market Intelligence API"
BINANCE_SPOT = "https://api.binance.com"
BINANCE_FUTURES = "https://fapi.binance.com"
YAHOO_CHART = "https://query1.finance.yahoo.com/v8/finance/chart"
CACHE_TTL = int(os.getenv("MARKET_CACHE_TTL", "20"))
UNIVERSE_LIMIT = int(os.getenv("UNIVERSE_LIMIT", "100"))
REQUEST_TIMEOUT = float(os.getenv("REQUEST_TIMEOUT", "9"))

app = FastAPI(title=APP_NAME, version="1.0.0", description="Read-only public market monitoring API.")
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("CORS_ORIGINS", "*").split(","),
    allow_credentials=False,
    allow_methods=["GET", "OPTIONS"],
    allow_headers=["*"],
)

_cache: dict[str, tuple[float, Any]] = {}
_lock = asyncio.Lock()
_http: httpx.AsyncClient | None = None


@app.on_event("startup")
async def startup() -> None:
    global _http
    _http = httpx.AsyncClient(timeout=REQUEST_TIMEOUT, headers={"User-Agent": "MRMP-MarketMonitor/1.0"})


@app.on_event("shutdown")
async def shutdown() -> None:
    if _http:
        await _http.aclose()


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def get_json(url: str, params: dict | None = None) -> Any:
    if _http is None:
        raise RuntimeError("HTTP client is not ready")
    response = await _http.get(url, params=params)
    response.raise_for_status()
    return response.json()


async def cached(key: str, loader, ttl: int = CACHE_TTL):
    now = time.monotonic()
    existing = _cache.get(key)
    if existing and now - existing[0] < ttl:
        return existing[1], True
    async with _lock:
        existing = _cache.get(key)
        if existing and time.monotonic() - existing[0] < ttl:
            return existing[1], True
        value = await loader()
        _cache[key] = (time.monotonic(), value)
        return value, False


def as_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


async def crypto_markets() -> dict:
    async def load():
        spot_task = get_json(f"{BINANCE_SPOT}/api/v3/ticker/24hr")
        futures_task = get_json(f"{BINANCE_FUTURES}/fapi/v1/premiumIndex")
        spot, futures = await asyncio.gather(spot_task, futures_task)
        futures_map = {x.get("symbol"): x for x in futures if x.get("symbol", "").endswith("USDT")}
        rows = []
        for item in spot:
            symbol = item.get("symbol", "")
            if not symbol.endswith("USDT") or any(x in symbol for x in ("UPUSDT", "DOWNUSDT", "BULLUSDT", "BEARUSDT")):
                continue
            last = as_float(item.get("lastPrice"))
            quote_volume = as_float(item.get("quoteVolume"))
            if last <= 0 or quote_volume <= 0:
                continue
            future = futures_map.get(symbol, {})
            rows.append({
                "symbol": symbol,
                "base_asset": symbol[:-4],
                "quote_asset": "USDT",
                "last_price": last,
                "price_change_pct_24h": as_float(item.get("priceChangePercent")),
                "high_24h": as_float(item.get("highPrice")),
                "low_24h": as_float(item.get("lowPrice")),
                "base_volume_24h": as_float(item.get("volume")),
                "quote_volume_24h": quote_volume,
                "trade_count_24h": int(item.get("count") or 0),
                "weighted_avg_price_24h": as_float(item.get("weightedAvgPrice")),
                "funding_rate": as_float(future.get("lastFundingRate")) if future else None,
                "mark_price": as_float(future.get("markPrice")) if future else None,
                "next_funding_time": int(future.get("nextFundingTime") or 0) if future else None,
                "data_sources": ["Binance Spot 24h"] + (["Binance USD-M Futures premiumIndex"] if future else []),
            })
        rows.sort(key=lambda x: x["quote_volume_24h"], reverse=True)
        return rows[:UNIVERSE_LIMIT]

    data, hit = await cached("crypto_markets", load)
    return {"data": data, "source": "Binance public market-data endpoints", "cached": hit, "updated_at": utc_now()}


async def crypto_overview() -> dict:
    markets = (await crypto_markets())["data"]
    eligible = [m for m in markets if m["quote_volume_24h"] > 0]
    return {
        "market_count": len(eligible),
        "top_gainers": sorted(eligible, key=lambda x: x["price_change_pct_24h"], reverse=True)[:10],
        "top_losers": sorted(eligible, key=lambda x: x["price_change_pct_24h"])[:10],
        "highest_quote_volume": sorted(eligible, key=lambda x: x["quote_volume_24h"], reverse=True)[:10],
        "updated_at": utc_now(),
        "classification": "descriptive_market_statistics_not_signals",
    }


async def macro_snapshot() -> dict:
    instruments = {
        "XAUUSD": ("GC=F", "Gold futures reference", "Yahoo Finance chart"),
        "USOIL": ("CL=F", "WTI crude oil futures reference", "Yahoo Finance chart"),
        "DXY": ("DX-Y.NYB", "US Dollar Index reference", "Yahoo Finance chart"),
    }

    async def load_one(key: str, meta: tuple):
        ticker, label, source = meta
        try:
            payload = await get_json(f"{YAHOO_CHART}/{ticker}", {"range": "5d", "interval": "5m"})
            result = payload["chart"]["result"][0]
            quote = result["indicators"]["quote"][0]
            closes = [x for x in quote.get("close", []) if x is not None]
            timestamps = result.get("timestamp", [])
            price = closes[-1] if closes else None
            previous = closes[-2] if len(closes) > 1 else None
            change = ((price / previous) - 1) * 100 if price and previous else None
            return key, {
                "symbol": key, "provider_symbol": ticker, "label": label,
                "last": price, "change_pct_latest_interval": change,
                "currency": result.get("meta", {}).get("currency"),
                "exchange_timezone": result.get("meta", {}).get("exchangeTimezoneName"),
                "last_bar_epoch": timestamps[-1] if timestamps else None,
                "source": source, "status": "ok" if price is not None else "no_data",
            }
        except Exception as exc:
            return key, {"symbol": key, "provider_symbol": ticker, "label": label,
                         "source": source, "status": "unavailable", "error": str(exc)[:180]}

    values = await asyncio.gather(*(load_one(k, v) for k, v in instruments.items()))
    return {"instruments": dict(values), "updated_at": utc_now(),
            "note": "Public delayed/indicative vendor data. Futures references are not identical to every broker's spot CFD."}


@app.get("/")
async def root():
    return {"name": APP_NAME, "version": "1.0.0", "docs": "/docs", "health": "/health"}


@app.get("/health")
async def health():
    return {"status": "ok", "service": "api", "timestamp": utc_now()}


@app.get("/api/v1/status")
async def status():
    return {
        "application": "MR MOST PROFITABLE",
        "mode": "read_only_market_monitor",
        "live_public_feeds": ["Binance Spot 24h", "Binance USD-M Futures premiumIndex", "Yahoo Finance chart"],
        "execution": "disabled",
        "timestamp": utc_now(),
    }


@app.get("/api/v1/crypto/markets")
async def markets():
    try:
        return await crypto_markets()
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Crypto market provider unavailable: {str(exc)[:180]}")


@app.get("/api/v1/crypto/overview")
async def overview():
    try:
        return await crypto_overview()
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Crypto overview unavailable: {str(exc)[:180]}")


@app.get("/api/v1/macro")
async def macro():
    return await macro_snapshot()


@app.get("/api/v1/crypto/klines/{symbol}")
async def klines(symbol: str, interval: str = "1m", limit: int = 100):
    allowed_intervals = {"1m", "5m", "15m", "1h", "4h", "1d", "1w", "1M"}
    if interval not in allowed_intervals:
        raise HTTPException(status_code=400, detail="Unsupported interval")
    if not symbol.endswith("USDT") or not symbol.replace("USDT", "").isalnum():
        raise HTTPException(status_code=400, detail="Use a USDT spot symbol, e.g. BTCUSDT")
    limit = max(1, min(limit, 500))
    try:
        data = await get_json(f"{BINANCE_SPOT}/api/v3/klines", {"symbol": symbol.upper(), "interval": interval, "limit": limit})
        return {"symbol": symbol.upper(), "interval": interval, "source": "Binance Spot klines",
                "candles": [{"time": x[0], "open": as_float(x[1]), "high": as_float(x[2]),
                             "low": as_float(x[3]), "close": as_float(x[4]),
                             "volume": as_float(x[5]), "quote_volume": as_float(x[7]),
                             "trades": int(x[8])} for x in data], "updated_at": utc_now()}
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Kline provider unavailable: {str(exc)[:180]}")


@app.get("/api/v1/crypto/open-interest/{symbol}")
async def open_interest(symbol: str):
    symbol = symbol.upper()
    if not symbol.endswith("USDT") or not symbol.replace("USDT", "").isalnum():
        raise HTTPException(status_code=400, detail="Use a USDT perpetual symbol, e.g. BTCUSDT")
    try:
        payload = await get_json(f"{BINANCE_FUTURES}/fapi/v1/openInterest", {"symbol": symbol})
        return {"symbol": symbol, "open_interest_contracts": as_float(payload.get("openInterest")),
                "time": payload.get("time"), "source": "Binance USD-M Futures public endpoint",
                "updated_at": utc_now(), "note": "Open-interest snapshot; not a directional signal."}
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Open-interest provider unavailable: {str(exc)[:180]}")


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()
    try:
        while True:
            try:
                payload = await crypto_overview()
                await ws.send_json({"type": "crypto_overview", **payload})
            except Exception as exc:
                await ws.send_json({"type": "provider_error", "message": str(exc)[:160], "timestamp": utc_now()})
            await asyncio.sleep(CACHE_TTL)
    except WebSocketDisconnect:
        return
