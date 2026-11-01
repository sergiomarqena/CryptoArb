import asyncio
import os
import time
from datetime import datetime, timezone
from typing import Any

import httpx
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

APP_NAME = "MR MOST PROFITABLE Market Intelligence API"
MEXC_SPOT = "https://api.mexc.com"
MEXC_CONTRACT = "https://contract.mexc.com/api/v1/contract"
BINANCE_FUTURES = "https://fapi.binance.com"
YAHOO_CHART = "https://query1.finance.yahoo.com/v8/finance/chart"
CACHE_TTL = int(os.getenv("MARKET_CACHE_TTL", "20"))
UNIVERSE_LIMIT = int(os.getenv("UNIVERSE_LIMIT", "2500"))
ACTIVITY_UNIVERSE = int(os.getenv("ACTIVITY_UNIVERSE", "100"))
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
        tickers = await get_json(f"{MEXC_CONTRACT}/ticker")
        details = await get_json(f"{MEXC_CONTRACT}/detail")
        if not isinstance(tickers, dict) or not tickers.get("success"):
            raise RuntimeError("MEXC Futures ticker returned an unexpected payload")
        detail_map = {x.get("symbol"): x for x in details.get("data", []) if x.get("symbol")}
        rows = []
        for item in tickers.get("data", []):
            contract_symbol = str(item.get("symbol") or "")
            if not contract_symbol.endswith("_USDT"):
                continue
            symbol = contract_symbol.replace("_", "")
            last = as_float(item.get("lastPrice"))
            if last <= 0:
                continue
            meta = detail_map.get(contract_symbol, {})
            rates = item.get("riseFallRates") or {}
            rows.append({
                "symbol": symbol,
                "contract_symbol": contract_symbol,
                "base_asset": meta.get("baseCoin") or contract_symbol[:-5],
                "quote_asset": "USDT",
                "last_price": last,
                "price_change_pct_24h": as_float(item.get("riseFallRate")) * 100,
                "price_change_pct_7d": as_float(rates.get("r7")) * 100 if rates.get("r7") is not None else None,
                "price_change_pct_30d": as_float(rates.get("r30")) * 100 if rates.get("r30") is not None else None,
                "high_24h": as_float(item.get("high24Price")),
                "low_24h": as_float(item.get("lower24Price")),
                "base_volume_24h": as_float(item.get("volume24")),
                "quote_volume_24h": as_float(item.get("amount24")),
                "trade_count_24h": None,
                "open_interest_contracts": as_float(item.get("holdVol")) if item.get("holdVol") is not None else None,
                "funding_rate": as_float(item.get("fundingRate")) if item.get("fundingRate") is not None else None,
                "mark_price": as_float(item.get("fairPrice")) if item.get("fairPrice") is not None else None,
                "index_price": as_float(item.get("indexPrice")) if item.get("indexPrice") is not None else None,
                "next_funding_time": None,
                "data_sources": ["MEXC USD-M perpetual contract ticker"],
            })
        rows.sort(key=lambda x: x["quote_volume_24h"] or 0, reverse=True)
        return rows[:UNIVERSE_LIMIT]

    data, hit = await cached("mexc_contract_markets", load, CACHE_TTL)
    return {"data": data, "source": "MEXC USD-M perpetual contract ticker", "cached": hit,
            "updated_at": utc_now(), "market_type": "USDT-settled perpetual contracts"}


async def crypto_overview() -> dict:
    markets = (await crypto_markets())["data"]
    eligible = [m for m in markets if m["quote_volume_24h"] is not None and m["quote_volume_24h"] > 0]
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
        "live_public_feeds": ["MEXC USD-M perpetual contracts", "MEXC contract candles", "Yahoo Finance chart", "DefiLlama historical chain TVL"],
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
    interval_map = {"1m":"Min1","5m":"Min5","15m":"Min15","30m":"Min30",
                    "1h":"Min60","4h":"Hour4","1d":"Day1","1w":"Week1"}
    if interval not in interval_map:
        raise HTTPException(status_code=400, detail="Unsupported MEXC contract candle interval")
    normalized = symbol.upper().replace("_", "")
    if not normalized.endswith("USDT") or not normalized[:-4].isalnum():
        raise HTTPException(status_code=400, detail="Use a USDT perpetual symbol, e.g. BTCUSDT")
    contract_symbol = normalized[:-4] + "_USDT"
    limit = max(1, min(limit, 1000))
    try:
        payload = await get_json(f"{MEXC_CONTRACT}/kline/{contract_symbol}",
                                 {"interval": interval_map[interval], "limit": limit})
        if not isinstance(payload, dict) or not payload.get("success"):
            raise RuntimeError("MEXC Futures candle provider returned an unsuccessful response")
        data = payload.get("data") or {}
        times = data.get("time") or []
        candles = []
        for i, epoch in enumerate(times):
            try:
                candles.append({
                    "time": int(epoch) * 1000,
                    "open": as_float(data["open"][i]), "high": as_float(data["high"][i]),
                    "low": as_float(data["low"][i]), "close": as_float(data["close"][i]),
                    "volume": as_float(data.get("vol", [None] * len(times))[i]),
                    "quote_volume": as_float(data.get("amount", [None] * len(times))[i]),
                })
            except (IndexError, KeyError, TypeError):
                continue
        return {"symbol": normalized, "contract_symbol": contract_symbol, "interval": interval,
                "source": "MEXC USD-M perpetual contract klines", "candles": candles, "updated_at": utc_now()}
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"MEXC Futures candle provider unavailable: {str(exc)[:180]}")


@app.get("/api/v1/crypto/activity")
async def crypto_activity(limit: int = 100):
    limit = max(10, min(limit, 200))
    async def load():
        tickers = (await crypto_markets())["data"]
        selected = tickers[:limit]
        semaphore = asyncio.Semaphore(3)
        async def one(market: dict):
            symbol, contract_symbol = market["symbol"], market["contract_symbol"]
            async with semaphore:
                try:
                    payload = await get_json(f"{MEXC_CONTRACT}/kline/{contract_symbol}",
                                             {"interval":"Min5","limit":22})
                    data = payload.get("data") or {}
                    closes, opens = data.get("close") or [], data.get("open") or []
                    volumes, amounts = data.get("vol") or [], data.get("amount") or []
                    if not payload.get("success") or len(closes)<3 or len(volumes)<3:
                        return {"symbol":symbol,"activity_status":"insufficient_history"}
                    current_volume = as_float(volumes[-1])
                    previous_volumes = [as_float(v) for v in volumes[:-1] if as_float(v)>=0]
                    average_volume = sum(previous_volumes)/len(previous_volumes) if previous_volumes else None
                    multiple = current_volume/average_volume if average_volume and average_volume>0 else None
                    previous_close,last_close = as_float(closes[-2]),as_float(closes[-1])
                    open_price = as_float(opens[-1])
                    candle_change = ((last_close/open_price)-1)*100 if open_price else None
                    change_vs_prev = ((last_close/previous_close)-1)*100 if previous_close else None
                    one_hour_change = ((last_close/as_float(closes[-13]))-1)*100 if len(closes)>=13 and as_float(closes[-13]) else None
                    return {
                        "symbol":symbol,"contract_symbol":contract_symbol,"last_price":market["last_price"],
                        "price_change_pct_24h":market["price_change_pct_24h"],
                        "quote_volume_24h":market["quote_volume_24h"],
                        "funding_rate":market["funding_rate"],
                        "open_interest_contracts":market["open_interest_contracts"],
                        "last_5m_open":open_price,"last_5m_close":last_close,
                        "change_last_5m_pct":candle_change,"change_from_previous_5m_close_pct":change_vs_prev,
                        "change_last_1h_pct":one_hour_change,
                        "last_5m_contract_volume":current_volume,
                        "last_5m_turnover":as_float(amounts[-1]) if amounts else None,
                        "average_previous_21_5m_contract_volume":average_volume,
                        "volume_multiple_vs_previous_21_candles":multiple,
                        "activity_status":"ok","source":"MEXC USD-M perpetual 5m candles + contract ticker",
                        "updated_at":utc_now()
                    }
                except Exception as exc:
                    return {"symbol":symbol,"contract_symbol":contract_symbol,
                            "activity_status":"unavailable","error":str(exc)[:140]}
        return await asyncio.gather(*(one(x) for x in selected))
    try:
        rows, hit = await cached(f"crypto_activity_{limit}", load, 30)
        good = [x for x in rows if x.get("activity_status")=="ok"]
        good.sort(key=lambda x:x.get("volume_multiple_vs_previous_21_candles") or 0,reverse=True)
        return {"data":good,"count":len(good),"requested_universe":len(rows),
                "unavailable_count":len(rows)-len(good),
                "source":"MEXC USD-M perpetual contract ticker and 5m candles","cached":hit,
                "updated_at":utc_now(),
                "metric_definition":"Volume multiple compares the latest 5-minute contract volume with the mean of the preceding 21 five-minute candles. It is observed activity, not a prediction."}
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Futures activity scan unavailable: {str(exc)[:180]}")


_indicator_cache: dict[str, tuple[float, dict]] = {}
INDICATOR_CACHE_TTL = int(os.getenv("INDICATOR_CACHE_TTL", "180"))


def ema(values: list[float], period: int) -> list[float]:
    if not values:
        return []
    alpha = 2 / (period + 1)
    current = values[0]
    output = [current]
    for value in values[1:]:
        current = value * alpha + current * (1 - alpha)
        output.append(current)
    return output


def rsi_wilder(values: list[float], period: int = 14) -> float | None:
    if len(values) <= period:
        return None
    changes = [values[i] - values[i - 1] for i in range(1, len(values))]
    gains = [max(change, 0.0) for change in changes]
    losses = [max(-change, 0.0) for change in changes]
    avg_gain = sum(gains[:period]) / period
    avg_loss = sum(losses[:period]) / period
    for i in range(period, len(gains)):
        avg_gain = ((avg_gain * (period - 1)) + gains[i]) / period
        avg_loss = ((avg_loss * (period - 1)) + losses[i]) / period
    if avg_loss == 0:
        return 100.0 if avg_gain > 0 else 50.0
    relative_strength = avg_gain / avg_loss
    return 100 - (100 / (1 + relative_strength))


async def one_symbol_indicators(symbol: str, semaphore: asyncio.Semaphore) -> dict:
    now = time.monotonic()
    cached_row = _indicator_cache.get(symbol)
    if cached_row and now - cached_row[0] < INDICATOR_CACHE_TTL:
        return cached_row[1]
    async with semaphore:
        try:
            contract_symbol = symbol[:-4] + "_USDT"
            payload = await get_json(f"{MEXC_CONTRACT}/kline/{contract_symbol}",
                                      {"interval": "Min60", "limit": 750})
            if not payload.get("success"):
                raise RuntimeError("MEXC contract candle request failed")
            candles = payload.get("data") or {}
            closes = [as_float(value, -1.0) for value in candles.get("close", [])]
            closes = [value for value in closes if value > 0]
            if len(closes) < 180:
                row = {"symbol": symbol, "status": "insufficient_history", "source": "MEXC perpetual contract 1H klines"}
                _indicator_cache[symbol] = (time.monotonic(), row)
                return row
            fast = ema(closes, 12)
            slow = ema(closes, 26)
            macd_line = [a - b for a, b in zip(fast, slow)]
            signal_line = ema(macd_line, 9)
            histogram = macd_line[-1] - signal_line[-1]
            def period_change(period: int):
                if len(closes) <= period:
                    return None
                prior = closes[-(period + 1)]
                return ((closes[-1] / prior) - 1) * 100 if prior else None
            row = {
                "symbol": symbol,
                "status": "ok",
                "rsi_1h": round(rsi_wilder(closes, 14), 2) if rsi_wilder(closes, 14) is not None else None,
                "macd_line_1h": macd_line[-1],
                "macd_signal_1h": signal_line[-1],
                "macd_histogram_1h": histogram,
                "change_4h_pct": round(period_change(4), 4) if period_change(4) is not None else None,
                "change_1d_pct": round(period_change(24), 4) if period_change(24) is not None else None,
                "change_1w_pct": round(period_change(168), 4) if period_change(168) is not None else None,
                "change_30d_pct": round(period_change(720), 4) if period_change(720) is not None else None,
                "source": "MEXC perpetual contract 1H klines",
                "updated_at": utc_now(),
                "note": "RSI(14) and MACD(12,26,9) calculated from hourly closes; percentage changes use the matching hourly lookback.",
            }
            _indicator_cache[symbol] = (time.monotonic(), row)
            return row
        except Exception as exc:
            return {"symbol": symbol, "status": "unavailable", "source": "MEXC perpetual contract 1H klines", "error": str(exc)[:160]}


@app.get("/api/v1/crypto/screener/indicators")
async def screener_indicators(symbols: str):
    requested = list(dict.fromkeys(x.strip().upper() for x in symbols.split(",") if x.strip()))
    if not requested or len(requested) > 50:
        raise HTTPException(status_code=400, detail="Provide between 1 and 50 comma-separated USDT spot symbols")
    if any(not symbol.endswith("USDT") or not symbol.replace("USDT", "").isalnum() for symbol in requested):
        raise HTTPException(status_code=400, detail="Only valid USDT spot symbols are accepted")
    semaphore = asyncio.Semaphore(8)
    rows = await asyncio.gather(*(one_symbol_indicators(symbol, semaphore) for symbol in requested))
    return {
        "data": rows,
        "count": len(rows),
        "source": "MEXC perpetual contract 1H klines",
        "updated_at": utc_now(),
        "calculation_note": "Descriptive calculations only. RSI(14), MACD(12,26,9), and historical percentage changes are not predictions or trade recommendations.",
    }


@app.get("/api/v1/crypto/open-interest/{symbol}")
async def open_interest(symbol: str):
    normalized = symbol.upper().replace("_", "")
    if not normalized.endswith("USDT") or not normalized[:-4].isalnum():
        raise HTTPException(status_code=400, detail="Use a USDT perpetual symbol, e.g. BTCUSDT")
    contract_symbol = normalized[:-4] + "_USDT"
    try:
        payload = await get_json(f"{MEXC_CONTRACT}/ticker")
        match = next((x for x in payload.get("data",[]) if x.get("symbol")==contract_symbol),None)
        if not match:
            raise HTTPException(status_code=404,detail="Contract not found in MEXC ticker")
        return {"symbol":normalized,
                "open_interest_contracts":as_float(match.get("holdVol")) if match.get("holdVol") is not None else None,
                "funding_rate":as_float(match.get("fundingRate")) if match.get("fundingRate") is not None else None,
                "mark_price":as_float(match.get("fairPrice")) if match.get("fairPrice") is not None else None,
                "time":match.get("timestamp"),"source":"MEXC USD-M perpetual contract ticker",
                "updated_at":utc_now(),
                "note":"holdVol is reported contract open-interest volume; units depend on contract specifications."}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502,detail=f"MEXC Futures market snapshot unavailable: {str(exc)[:180]}")


DEFILLAMA = "https://api.llama.fi"
FLOW_CACHE_TTL = int(os.getenv("FLOW_CACHE_TTL", "900"))


@app.get("/api/v1/flows/chains")
async def chain_flows(timeframe: str = "1D"):
    """Descriptive chain TVL changes; TVL delta is not equivalent to net token inflow."""
    timeframe = timeframe.upper()
    if timeframe not in {"4H", "1D", "1W"}:
        raise HTTPException(status_code=400, detail="timeframe must be 4H, 1D, or 1W")

    async def load():
        chains = await get_json(f"{DEFILLAMA}/v2/chains")
        now = int(time.time())
        results = []

        # Historical chain TVL is daily data. Do not fabricate a 4H value.
        if timeframe == "4H":
            for c in chains:
                tvl = as_float(c.get("tvl"), -1)
                if tvl < 0:
                    continue
                results.append({
                    "chain": c.get("name"),
                    "token_symbol": c.get("tokenSymbol"),
                    "chain_id": c.get("chainId"),
                    "tvl_usd": tvl,
                    "tvl_change_pct": None,
                    "timeframe": timeframe,
                    "status": "insufficient_granularity",
                    "source": "DefiLlama current chain TVL; historical updates are daily",
                })
            results.sort(key=lambda x: (x["chain"] or "").lower())
            return results

        lookback = 86400 if timeframe == "1D" else 7 * 86400
        cutoff = now - lookback
        sem = asyncio.Semaphore(8)

        async def one(c):
            name = c.get("name")
            if not name:
                return None
            async with sem:
                try:
                    history = await get_json(f"{DEFILLAMA}/v2/historicalChainTvl/{name}")
                    valid = [x for x in history if x.get("tvl") is not None and int(x.get("date", 0)) <= now]
                    if not valid:
                        return {
                            "chain": name, "token_symbol": c.get("tokenSymbol"),
                            "chain_id": c.get("chainId"), "tvl_usd": as_float(c.get("tvl")),
                            "tvl_change_pct": None, "timeframe": timeframe,
                            "status": "no_history", "source": "DefiLlama historical chain TVL",
                        }
                    latest = valid[-1]
                    prior = next((x for x in reversed(valid[:-1]) if int(x.get("date", 0)) <= cutoff), None)
                    if prior is None:
                        return {
                            "chain": name, "token_symbol": c.get("tokenSymbol"),
                            "chain_id": c.get("chainId"), "tvl_usd": as_float(latest.get("tvl")),
                            "tvl_change_pct": None, "timeframe": timeframe,
                            "status": "insufficient_history", "source": "DefiLlama historical chain TVL",
                        }
                    old = as_float(prior.get("tvl"))
                    new = as_float(latest.get("tvl"))
                    change = ((new / old) - 1) * 100 if old > 0 else None
                    return {
                        "chain": name, "token_symbol": c.get("tokenSymbol"),
                        "chain_id": c.get("chainId"), "tvl_usd": new,
                        "tvl_change_pct": change, "timeframe": timeframe,
                        "status": "ok" if change is not None else "zero_baseline",
                        "source": "DefiLlama historical chain TVL",
                        "latest_sample_epoch": latest.get("date"),
                        "baseline_sample_epoch": prior.get("date"),
                    }
                except Exception:
                    return {
                        "chain": name, "token_symbol": c.get("tokenSymbol"),
                        "chain_id": c.get("chainId"), "tvl_usd": as_float(c.get("tvl")),
                        "tvl_change_pct": None, "timeframe": timeframe,
                        "status": "unavailable", "source": "DefiLlama historical chain TVL",
                    }

        rows = await asyncio.gather(*(one(c) for c in chains))
        rows = [x for x in rows if x is not None]
        rows.sort(key=lambda x: (x["chain"] or "").lower())
        return rows

    try:
        data, hit = await cached(f"chain_flows_{timeframe}", load, FLOW_CACHE_TTL)
        return {
            "timeframe": timeframe,
            "data": data,
            "count": len(data),
            "source": "DefiLlama",
            "cached": hit,
            "updated_at": utc_now(),
            "metric_definition": (
                "TVL change is a change in reported DeFi total value locked. "
                "It is not a direct measurement of exchange deposits, withdrawals, or net token flows."
            ),
            "granularity_note": "DefiLlama historical chain TVL is daily; 4H historical TVL change is not available from this source.",
        }
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Chain TVL provider unavailable: {str(exc)[:180]}")


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