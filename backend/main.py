import asyncio
import os
from datetime import datetime, timezone

import httpx
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from nordvex import service, TIMEFRAMES, score_market

APP_NAME = "NORDVEX — SCREENER PRO"
YAHOO_CHART = "https://query1.finance.yahoo.com/v8/finance/chart"
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
        spot_data, contracts, candles_data, spot_book, contract_book, spot_trades = await asyncio.gather(
            service.spot_universe(),
            service.contract_universe(),
            service.candles(symbol, timeframe, "spot", 200),
            service.orderbook(symbol, "spot", 100),
            service.orderbook(symbol, "contract", 100),
            service.recent_trades(symbol, "spot", 500),
            return_exceptions=True,
        )
        def data_or_none(value):
            return None if isinstance(value, Exception) else value
        market_row = None
        if not isinstance(spot_data, Exception) and not isinstance(contracts, Exception):
            spot_rows, _ = spot_data
            market_row = next((x.copy() for x in spot_rows if x["symbol"] == symbol), None)
            if market_row is not None:
                if not isinstance(candles_data, Exception):
                    market_row.update(service.candle_metrics(candles_data["candles"]))
                else:
                    market_row.update({"price_change_pct": None, "volume_change_pct": None,
                                       "relative_volume": None, "metric_status": "unavailable"})
                contract = contracts.get(symbol)
                market_row["contract_market_available"] = bool(contract)
                market_row["open_interest_contracts"] = contract.get("open_interest_contracts") if contract else None
                market_row["funding_rate"] = contract.get("funding_rate") if contract else None
                market_row["oi_change_pct"] = service.oi_change(symbol, market_row["open_interest_contracts"], timeframe.upper()) if contract else None
                if contract:
                    market_row.update({k: v for k, v in contract.items() if k != "contract_source"})
                market_row.update(score_market(market_row))
        whale = data_or_none(spot_trades)
        if whale is None:
            whale = {"whale_buying": "INSUFFICIENT_DATA", "whale_selling": "INSUFFICIENT_DATA",
                     "caveat": "Trade feed unavailable"}
        price_delta = market_row.get("price_change_pct") if market_row else None
        oi_delta = market_row.get("oi_change_pct") if market_row else None
        if price_delta is None or oi_delta is None:
            oi_interpretation = "INSUFFICIENT_DATA"
        elif price_delta > 0 and oi_delta > 0:
            oi_interpretation = "POSSIBLE_LONG_BUILDUP"
        elif price_delta < 0 and oi_delta > 0:
            oi_interpretation = "POSSIBLE_SHORT_BUILDUP"
        elif price_delta < 0 and oi_delta < 0:
            oi_interpretation = "POSSIBLE_LONG_UNWINDING"
        elif price_delta > 0 and oi_delta < 0:
            oi_interpretation = "POSSIBLE_SHORT_COVERING"
        else:
            oi_interpretation = "MIXED_OR_FLAT"
        return {
            "symbol": symbol,
            "market": market_row,
            "candles": data_or_none(candles_data),
            "spot_orderbook": data_or_none(spot_book),
            "contract_orderbook": data_or_none(contract_book),
            "trade_intelligence": whale,
            "oi_interpretation": oi_interpretation,
            "oi_interpretation_basis": "Calculated from same-timeframe Spot candle price change and locally sampled Contract OI change; interpretation only.",
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

async def macro_snapshot():
    instruments = {
        "XAUUSD": ("GC=F", "Gold futures reference"),
        "USOIL": ("CL=F", "WTI crude futures reference"),
        "DXY": ("DX-Y.NYB", "US Dollar Index reference"),
    }
    async def load_one(key, meta):
        ticker, label = meta
        try:
            payload = await service.request(
                f"{YAHOO_CHART}/{ticker}", {"range": "5d", "interval": "5m"}
            )
            result = payload["chart"]["result"][0]
            quote = result["indicators"]["quote"][0]
            closes = [v for v in quote.get("close", []) if v is not None]
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
                "source": "Yahoo Finance chart", "status": "ok" if price is not None else "no_data",
            }
        except Exception as exc:
            return key, {"symbol": key, "provider_symbol": ticker, "label": label,
                         "source": "Yahoo Finance chart", "status": "unavailable",
                         "error": str(exc)[:160]}
    values = await asyncio.gather(*(load_one(k, v) for k, v in instruments.items()))
    return {
        "instruments": dict(values), "updated_at": utc_now(),
        "note": "Public delayed/indicative macro references; futures are not identical to every broker CFD quote.",
    }

@app.get("/api/v1/macro")
async def macro():
    return await macro_snapshot()

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
