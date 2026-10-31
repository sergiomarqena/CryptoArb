import asyncio
import os
from datetime import datetime, timezone

import httpx
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from nordvex import service, TIMEFRAMES

APP_NAME = "NORDVEX — SCREENER PRO"
app = FastAPI(
    title=APP_NAME,
    version="2.0.0",
    description="Read-only MEXC Spot and Contract market intelligence. No trading execution.",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("CORS_ORIGINS", "*").split(","),
    allow_credentials=False,
    allow_methods=["GET", "OPTIONS"],
    allow_headers=["*"],
)

@app.on_event("startup")
async def startup():
    await service.start()

@app.on_event("shutdown")
async def shutdown():
    await service.close()

def utc_now():
    return datetime.now(timezone.utc).isoformat()

@app.get("/")
async def root():
    return {"name": APP_NAME, "version": "2.0.0", "docs": "/docs", "health": "/health"}

@app.get("/health")
async def health():
    return {"status": "ok", "service": "nordvex-api", "timestamp": utc_now()}

@app.get("/api/v1/status")
async def status():
    return {
        "application": APP_NAME,
        "mode": "read_only_market_monitor",
        "spot_provider": "MEXC Spot public API",
        "contract_provider": "MEXC Contract public API",
        "execution": "disabled",
        "private_credentials_required": False,
        "timestamp": utc_now(),
    }

@app.get("/api/v1/crypto/markets")
async def markets(timeframe: str = "5M"):
    try:
        return await service.markets(timeframe)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"MEXC market data unavailable: {str(exc)[:200]}")

@app.get("/api/v1/crypto/overview")
async def overview(timeframe: str = "5M"):
    try:
        payload = await service.markets(timeframe)
        rows = payload["data"]
        valid = [x for x in rows if x.get("price") is not None]
        return {
            "market_count": len(valid),
            "spot_pairs_scanned": payload["spot_pairs_scanned"],
            "candle_enriched_pairs": payload["candle_enriched_pairs"],
            "top_gainers": sorted([x for x in valid if x.get("price_change_pct") is not None],
                                  key=lambda x: x["price_change_pct"], reverse=True)[:10],
            "top_losers": sorted([x for x in valid if x.get("price_change_pct") is not None],
                                 key=lambda x: x["price_change_pct"])[:10],
            "highest_quote_volume": sorted(valid, key=lambda x: x.get("quote_volume_24h") or 0,
                                           reverse=True)[:10],
            "updated_at": payload["updated_at"],
            "source": "MEXC public Spot and Contract APIs",
        }
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"MEXC overview unavailable: {str(exc)[:200]}")

@app.get("/api/v1/crypto/klines/{symbol}")
async def klines(symbol: str, interval: str = "5M", market: str = "spot", limit: int = 120):
    try:
        return await service.candles(symbol, interval, market, limit)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"MEXC candle data unavailable: {str(exc)[:180]}")

@app.get("/api/v1/crypto/orderbook/{symbol}")
async def orderbook(symbol: str, market: str = "spot", limit: int = 100):
    try:
        return await service.orderbook(symbol, market, limit)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"MEXC order book unavailable: {str(exc)[:180]}")

@app.get("/api/v1/crypto/trades/{symbol}")
async def trades(symbol: str, market: str = "spot", limit: int = 500):
    try:
        return await service.recent_trades(symbol, market, limit)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"MEXC trade data unavailable: {str(exc)[:180]}")

@app.get("/api/v1/crypto/open-interest/{symbol}")
async def open_interest(symbol: str, timeframe: str = "5M"):
    try:
        contracts = await service.contract_universe()
        row = contracts.get(symbol.upper())
        if not row:
            raise HTTPException(status_code=404, detail="No matching MEXC USDT perpetual contract")
        change = service.oi_change(symbol.upper(), row.get("open_interest_contracts"), timeframe.upper())
        return {
            "symbol": symbol.upper(),
            "open_interest_contracts": row.get("open_interest_contracts"),
            "oi_change_pct": change,
            "funding_rate": row.get("funding_rate"),
            "timestamp": row.get("contract_timestamp"),
            "source": "MEXC Contract ticker (holdVol)",
            "updated_at": utc_now(),
            "status": "ok" if row.get("open_interest_contracts") is not None else "unavailable",
            "note": "OI change is based on locally collected snapshots and remains unavailable until the selected lookback is populated.",
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"MEXC contract data unavailable: {str(exc)[:180]}")

@app.get("/api/v1/crypto/detail/{symbol}")
async def coin_detail(symbol: str, timeframe: str = "5M"):
    symbol = symbol.upper()
    try:
        markets_data, candles_data, spot_book, contract_book, spot_trades = await asyncio.gather(
            service.markets(timeframe),
            service.candles(symbol, timeframe, "spot", 200),
            service.orderbook(symbol, "spot", 100),
            service.orderbook(symbol, "contract", 100),
            service.recent_trades(symbol, "spot", 500),
            return_exceptions=True,
        )
        market_row = None
        if not isinstance(markets_data, Exception):
            market_row = next((x for x in markets_data["data"] if x["symbol"] == symbol), None)
        def data_or_none(value):
            return None if isinstance(value, Exception) else value
        whale = data_or_none(spot_trades)
        if whale is None:
            whale = {"whale_buying": "INSUFFICIENT_DATA", "whale_selling": "INSUFFICIENT_DATA",
                     "caveat": "Trade feed unavailable"}
        return {
            "symbol": symbol,
            "market": market_row,
            "candles": data_or_none(candles_data),
            "spot_orderbook": data_or_none(spot_book),
            "contract_orderbook": data_or_none(contract_book),
            "trade_intelligence": whale,
            "whale_buying": whale.get("whale_buying", "INSUFFICIENT_DATA"),
            "whale_selling": whale.get("whale_selling", "INSUFFICIENT_DATA"),
            "whale_buying_zone": None,
            "whale_zone_status": "NO WHALE BUYING ZONE IDENTIFIED",
            "market_cap_status": "UNKNOWN — no verified market-cap provider configured",
            "token_unlock_status": "UNKNOWN — no verified unlock provider configured",
            "updated_at": utc_now(),
        }
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Coin detail unavailable: {str(exc)[:180]}")

@app.get("/api/v1/macro")
async def macro():
    # Kept as an explicit unavailable status until a stable, verifiable macro feed
    # is configured in this MEXC-focused release.
    return {
        "instruments": {},
        "updated_at": utc_now(),
        "status": "not_configured",
        "note": "Macro reference feeds are not part of the MEXC crypto data provider.",
    }

@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()
    try:
        while True:
            try:
                payload = await service.markets("5M")
                await ws.send_json({
                    "type": "market_snapshot",
                    "count": payload.get("count"),
                    "spot_pairs_scanned": payload.get("spot_pairs_scanned"),
                    "candle_enriched_pairs": payload.get("candle_enriched_pairs"),
                    "updated_at": payload.get("updated_at"),
                    "data": payload.get("data", [])[:100],
                })
            except Exception as exc:
                await ws.send_json({"type": "provider_error", "message": str(exc)[:160],
                                    "timestamp": utc_now()})
            await asyncio.sleep(int(os.getenv("NORDVEX_WS_POLL_SECONDS", "12")))
    except WebSocketDisconnect:
        return
