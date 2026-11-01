"""Read-only MEXC Spot + Contract market-data service for NORDVEX.

No private keys, account endpoints, or order execution are used here.
"""
import asyncio
import math
import os
import time
from datetime import datetime, timezone
from typing import Any

import httpx

SPOT = "https://api.mexc.com"
CONTRACT = "https://contract.mexc.com/api/v1/contract"
TIMEFRAMES = {
    "1M": ("1m", "Min1"),
    "5M": ("5m", "Min5"),
    "30M": ("30m", "Min30"),
    "1H": ("1h", "Min60"),
    "1D": ("1d", "Day1"),
}
CACHE_TTL = int(os.getenv("NORDVEX_CACHE_TTL", "15"))
CANDLE_CONCURRENCY = int(os.getenv("NORDVEX_CANDLE_CONCURRENCY", "6"))
CANDLE_UNIVERSE_LIMIT = int(os.getenv("NORDVEX_CANDLE_UNIVERSE_LIMIT", "120"))
WHALE_SCAN_LIMIT = int(os.getenv("NORDVEX_WHALE_SCAN_LIMIT", "20"))
REQUEST_TIMEOUT = float(os.getenv("REQUEST_TIMEOUT", "12"))

def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

def number(value: Any) -> float | None:
    try:
        if value is None or value == "":
            return None
        return float(value)
    except (TypeError, ValueError):
        return None

def pct_change(current: float | None, previous: float | None) -> float | None:
    if current is None or previous in (None, 0):
        return None
    return (current / previous - 1.0) * 100.0

def clamp(value: float, low: float = -1.0, high: float = 1.0) -> float:
    return max(low, min(high, value))

def score_market(row: dict) -> dict:
    """Transparent, uncalibrated directional heuristic; not a win-rate estimate."""
    momentum = row.get("price_change_pct")
    rvol = row.get("relative_volume")
    oi_change = row.get("oi_change_pct")
    funding = row.get("funding_rate")
    features: dict[str, float] = {}
    if momentum is not None:
        features["momentum"] = clamp(momentum / 1.5)
    direction = 1.0 if (momentum or 0) >= 0 else -1.0
    if rvol is not None:
        features["relative_volume"] = clamp((rvol - 1.0) / 2.0) * direction
    if oi_change is not None and momentum is not None:
        features["open_interest"] = clamp(oi_change / 2.0) * direction
    if funding is not None:
        # Crowded positive funding is a modest contrarian input; scale is configurable.
        features["funding"] = clamp(-(funding * 1000.0))
    weights = {"momentum": 0.40, "relative_volume": 0.20, "open_interest": 0.25, "funding": 0.15}
    available_weight = sum(weights[k] for k in features)
    if available_weight <= 0:
        return {
            "signal": "UNAVAILABLE", "signal_status": "insufficient_data",
            "bullish_probability": None, "bearish_probability": None, "neutral_probability": None,
            "confidence_pct": None, "signal_strength": None,
            "supporting_evidence": [], "conflicting_evidence": [],
            "probability_note": "No directional estimate: insufficient timeframe data.",
        }
    raw = sum(features[k] * weights[k] for k in features) / available_weight
    logits = [raw * 2.4, -raw * 2.4, 0.55]
    expv = [math.exp(v - max(logits)) for v in logits]
    total = sum(expv)
    probabilities = [v / total * 100.0 for v in expv]
    coverage = available_weight / sum(weights.values())
    confidence = coverage * min(1.0, 0.15 + abs(raw) * 1.65) * 100.0
    bull = round(probabilities[0], 2)
    bear = round(probabilities[1], 2)
    neutral = round(100.0 - bull - bear, 2)
    signal = "BULLISH" if bull >= 48 and bull > bear + 8 and confidence >= 20 else (
        "BEARISH" if bear >= 48 and bear > bull + 8 and confidence >= 20 else "NEUTRAL"
    )
    support = [k for k, v in features.items() if v > 0.12]
    conflict = [k for k, v in features.items() if v < -0.12]
    return {
        "signal": signal, "signal_status": "uncalibrated_heuristic",
        "bullish_probability": round(bull, 2), "bearish_probability": round(bear, 2),
        "neutral_probability": round(neutral, 2), "confidence_pct": round(confidence, 1),
        "signal_strength": round(abs(raw) * 100.0, 1),
        "supporting_evidence": support, "conflicting_evidence": conflict,
        "probability_note": "Uncalibrated heuristic distribution; not a calibrated probability or historical win rate.",
        "signal_timestamp": now_iso(), "model_version": "nordvex-transparent-v0.1",
        "feature_coverage_pct": round(coverage * 100.0, 1),
    }

class MexcMarketData:
    def __init__(self) -> None:
        self.client: httpx.AsyncClient | None = None
        self.cache: dict[str, tuple[float, Any]] = {}
        self.cache_lock = asyncio.Lock()
        self.semaphore = asyncio.Semaphore(max(1, CANDLE_CONCURRENCY))
        self.oi_history: dict[str, list[tuple[float, float]]] = {}
        self.last_provider_error: dict[str, str] = {}

    async def start(self) -> None:
        if self.client is None:
            self.client = httpx.AsyncClient(
                timeout=REQUEST_TIMEOUT,
                headers={"User-Agent": "NORDVEX-ScreenerPro/1.0", "Accept": "application/json"},
            )

    async def close(self) -> None:
        if self.client is not None:
            await self.client.aclose()
            self.client = None

    async def request(self, url: str, params: dict | None = None) -> Any:
        if self.client is None:
            await self.start()
        assert self.client is not None
        last_error = None
        for attempt in range(3):
            try:
                response = await self.client.get(url, params=params)
                if response.status_code in (429, 500, 502, 503, 504):
                    last_error = RuntimeError(
                        f"MEXC upstream HTTP {response.status_code} at {url.split('?')[0]}"
                    )
                    if attempt < 2:
                        await asyncio.sleep(0.8 * (attempt + 1))
                        continue
                    raise last_error
                response.raise_for_status()
                payload = response.json()
                break
            except (httpx.TimeoutException, httpx.TransportError) as exc:
                last_error = exc
                if attempt < 2:
                    await asyncio.sleep(0.8 * (attempt + 1))
                    continue
                raise RuntimeError(
                    f"MEXC connection failed at {url.split('?')[0]}: {str(exc)[:120]}"
                ) from exc
        else:
            raise RuntimeError(str(last_error or "MEXC request failed"))
        if isinstance(payload, dict) and payload.get("success") is False:
            raise RuntimeError(f"MEXC provider error: {payload.get('message') or payload.get('code')}")
        return payload

    async def cached(self, key: str, loader, ttl: int = CACHE_TTL):
        entry = self.cache.get(key)
        if entry and time.monotonic() - entry[0] < ttl:
            return entry[1], True
        async with self.cache_lock:
            entry = self.cache.get(key)
            if entry and time.monotonic() - entry[0] < ttl:
                return entry[1], True
            value = await loader()
            self.cache[key] = (time.monotonic(), value)
            return value, False

    async def spot_universe(self) -> tuple[list[dict], bool]:
        async def load():
            # Keep the broad ticker feed independent from exchangeInfo: MEXC may
            # rate-limit or change metadata responses while public tickers remain live.
            ticker_result, info_result = await asyncio.gather(
                self.request(f"{SPOT}/api/v3/ticker/24hr"),
                self.request(f"{SPOT}/api/v3/exchangeInfo"),
                return_exceptions=True,
            )

            def rows_from(payload: Any, key: str | None = None) -> list[dict]:
                if isinstance(payload, list):
                    return [x for x in payload if isinstance(x, dict)]
                if isinstance(payload, dict):
                    if key and isinstance(payload.get(key), list):
                        return [x for x in payload[key] if isinstance(x, dict)]
                    if isinstance(payload.get("data"), list):
                        return [x for x in payload["data"] if isinstance(x, dict)]
                    if payload.get("symbol"):
                        return [payload]
                return []

            info = info_result if isinstance(info_result, dict) else {}
            symbols = rows_from(info, "symbols")
            ticker_rows = rows_from(ticker_result, "data")
            ticker_map = {str(x.get("symbol", "")).upper(): x for x in ticker_rows if x.get("symbol")}

            def make_row(symbol: str, ticker: dict, item: dict | None = None):
                last = number(ticker.get("lastPrice", ticker.get("price")))
                volume = number(ticker.get("volume"))
                quote_volume = number(ticker.get("quoteVolume"))
                quote_volume_estimate = (
                    last * volume
                    if quote_volume is None and last is not None and volume is not None
                    else None
                )
                liquidity_sort_value = quote_volume if quote_volume is not None else quote_volume_estimate
                base_asset = (item or {}).get("baseAsset") or symbol[:-4]
                return {
                    "symbol": symbol,
                    "base_asset": base_asset,
                    "quote_asset": "USDT",
                    "price": last,
                    "change_24h_pct": (
                        number(ticker.get("priceChangePercent")) * 100.0
                        if number(ticker.get("priceChangePercent")) is not None else None
                    ),
                    "high_24h": number(ticker.get("highPrice")),
                    "low_24h": number(ticker.get("lowPrice")),
                    "base_volume_24h": volume,
                    "quote_volume_24h": quote_volume,
                    "quote_volume_estimate_usd": quote_volume_estimate,
                    "quote_volume_estimate_method": (
                        "last price × base volume; estimate only"
                        if quote_volume_estimate is not None else None
                    ),
                    "liquidity_sort_value": liquidity_sort_value,
                    "liquidity_value_source": (
                        "MEXC quoteVolume" if quote_volume is not None
                        else "calculated estimate" if quote_volume_estimate is not None
                        else "unavailable"
                    ),
                    "trade_count_24h": ticker.get("count"),
                    "spot_bid": number(ticker.get("bidPrice")),
                    "spot_ask": number(ticker.get("askPrice")),
                    "spot_source": (
                        "MEXC Spot /api/v3/ticker/24hr"
                        if ticker.get("lastPrice") is not None
                        else "MEXC Spot /api/v3/ticker/price"
                    ),
                }

            eligible = []
            for item in symbols:
                symbol = str(item.get("symbol") or "").upper()
                if not symbol.endswith("USDT") or symbol not in ticker_map:
                    continue
                if item.get("quoteAsset") not in (None, "USDT"):
                    continue
                status = item.get("status")
                if status not in (None, "", "ENABLED", "1", 1, "TRADING"):
                    continue
                if item.get("isSpotTradingAllowed") is False:
                    continue
                eligible.append(make_row(symbol, ticker_map[symbol], item))

            # If exchangeInfo metadata is missing or has changed, use the actual
            # public 24h ticker universe. This is still exchange-returned data.
            if not eligible:
                for ticker in ticker_rows:
                    symbol = str(ticker.get("symbol") or "").upper()
                    if symbol.endswith("USDT") and number(ticker.get("lastPrice")) is not None:
                        eligible.append(make_row(symbol, ticker))

            # Last-resort public endpoint: price ticker is lighter than the full
            # 24h statistics endpoint and does not require an API key.
            if not eligible:
                price_result = await self.request(f"{SPOT}/api/v3/ticker/price")
                price_rows = rows_from(price_result, "data")
                for ticker in price_rows:
                    symbol = str(ticker.get("symbol") or "").upper()
                    if symbol.endswith("USDT") and number(ticker.get("price")) is not None:
                        eligible.append(make_row(symbol, ticker))

            if not eligible:
                errors = []
                if isinstance(ticker_result, Exception):
                    errors.append(f"ticker/24hr: {str(ticker_result)[:120]}")
                if isinstance(info_result, Exception):
                    errors.append(f"exchangeInfo: {str(info_result)[:120]}")
                raise RuntimeError(
                    "MEXC returned no usable USDT spot symbols"
                    + (f" ({'; '.join(errors)})" if errors else "")
                )

            eligible.sort(key=lambda x: x.get("liquidity_sort_value") or 0, reverse=True)
            return eligible
        return await self.cached("spot_universe", load, 12)

    async def contract_universe(self) -> dict[str, dict]:
        async def load():
            details, tickers = await asyncio.gather(
                self.request(f"{CONTRACT}/detail"),
                self.request(f"{CONTRACT}/ticker"),
            )
            detail_rows = details.get("data", []) if isinstance(details, dict) else []
            ticker_rows = tickers.get("data", []) if isinstance(tickers, dict) else []
            detail_map = {x.get("symbol"): x for x in detail_rows if isinstance(x, dict)}
            result = {}
            for row in ticker_rows:
                if not isinstance(row, dict):
                    continue
                symbol = row.get("symbol", "")
                if not symbol.endswith("_USDT"):
                    continue
                detail = detail_map.get(symbol, {})
                result[symbol.replace("_", "")] = {
                    "contract_symbol": symbol,
                    "contract_available": bool(detail),
                    "contract_last_price": number(row.get("lastPrice")),
                    "contract_change_24h_pct": (number(row.get("riseFallRate")) * 100.0) if number(row.get("riseFallRate")) is not None else None,
                    "contract_volume_24h": number(row.get("volume24")),
                    "contract_amount_24h": number(row.get("amount24")),
                    "open_interest_contracts": number(row.get("holdVol")),
                    "funding_rate": number(row.get("fundingRate")),
                    "contract_bid": number(row.get("bid1")),
                    "contract_ask": number(row.get("ask1")),
                    "contract_timestamp": row.get("timestamp"),
                    "contract_source": "MEXC Contract /api/v1/contract/ticker",
                    "contract_size": number(detail.get("contractSize")),
                    "price_scale": detail.get("priceScale"),
                    "volume_scale": detail.get("volScale"),
                }
            return result
        data, _ = await self.cached("contract_universe", load, 12)
        return data

    async def candles(self, symbol: str, timeframe: str, market: str = "spot", limit: int = 120) -> dict:
        tf = timeframe.upper()
        if tf not in TIMEFRAMES:
            raise ValueError("Unsupported timeframe")
        spot_interval, contract_interval = TIMEFRAMES[tf]
        limit = max(30, min(int(limit), 500))
        key = f"candles:{market}:{symbol}:{tf}:{limit}"

        async def load():
            if market == "spot":
                raw = await self.request(f"{SPOT}/api/v3/klines", {
                    "symbol": symbol.upper(), "interval": spot_interval, "limit": limit
                })
                rows = [{
                    "time": int(x[0]), "open": number(x[1]), "high": number(x[2]),
                    "low": number(x[3]), "close": number(x[4]), "volume": number(x[5]),
                    "quote_volume": number(x[7]),
                } for x in raw]
                source = "MEXC Spot /api/v3/klines"
            elif market == "contract":
                contract_symbol = symbol.upper().replace("USDT", "_USDT")
                raw = await self.request(f"{CONTRACT}/kline/{contract_symbol}", {"interval": contract_interval})
                data = raw.get("data", {})
                times = data.get("time", [])
                rows = []
                for i, ts in enumerate(times[-limit:]):
                    idx = len(times) - len(times[-limit:]) + i
                    rows.append({
                        "time": int(ts) * 1000, "open": number(data.get("open", [])[idx]),
                        "high": number(data.get("high", [])[idx]), "low": number(data.get("low", [])[idx]),
                        "close": number(data.get("close", [])[idx]), "volume": number(data.get("vol", [])[idx]),
                        "quote_volume": number(data.get("amount", [])[idx]),
                    })
                source = "MEXC Contract /api/v1/contract/kline"
            else:
                raise ValueError("market must be spot or contract")
            return {"symbol": symbol.upper(), "market": market, "timeframe": tf,
                    "candles": rows, "source": source, "updated_at": now_iso()}
        data, cache_hit = await self.cached(key, load, 8)
        return {**data, "cached": cache_hit}

    def candle_metrics(self, rows: list[dict]) -> dict:
        valid = [x for x in rows if x.get("close") is not None]
        if len(valid) < 3:
            return {"price_change_pct": None, "volume_change_pct": None,
                    "relative_volume": None, "metric_status": "insufficient_candle_history"}
        current = valid[-1]
        previous = valid[-2]
        price_change = pct_change(current.get("close"), current.get("open"))
        volume_change = pct_change(current.get("volume"), previous.get("volume"))
        baseline_rows = valid[-21:-1]
        baseline = [x.get("volume") for x in baseline_rows if x.get("volume") is not None]
        rel_volume = (current.get("volume") / (sum(baseline) / len(baseline))) if baseline and sum(baseline) > 0 and current.get("volume") is not None else None
        return {
            "price_change_pct": price_change,
            "volume_change_pct": volume_change,
            "relative_volume": rel_volume,
            "metric_status": "ok" if rel_volume is not None else "partial_candle_history",
            "relative_volume_baseline": "mean of preceding 20 candles",
        }

    def oi_change(self, symbol: str, current: float | None, timeframe: str) -> float | None:
        if current is None:
            return None
        now = time.time()
        history = self.oi_history.setdefault(symbol, [])
        history.append((now, current))
        cutoff = now - 7 * 86400
        history[:] = [(ts, val) for ts, val in history if ts >= cutoff]
        minutes = {"1M": 60, "5M": 300, "30M": 1800, "1H": 3600, "1D": 86400}[timeframe]
        prior = next((val for ts, val in reversed(history[:-1]) if ts <= now - minutes), None)
        return pct_change(current, prior)

    async def markets(self, timeframe: str = "5M") -> dict:
        tf = timeframe.upper()
        if tf not in TIMEFRAMES:
            raise ValueError("Unsupported timeframe")
        spot_result, contract_result = await asyncio.gather(
            self.spot_universe(), self.contract_universe(), return_exceptions=True
        )
        if isinstance(spot_result, Exception):
            raise RuntimeError(f"Spot universe unavailable: {str(spot_result)[:180]}")
        spot_rows, spot_cache_hit = spot_result
        if isinstance(contract_result, Exception):
            # Spot market data remains usable when the separate derivatives API is unavailable.
            contracts = {}
            contract_feed_status = "unavailable"
            contract_feed_error = str(contract_result)[:180]
        else:
            contracts = contract_result
            contract_feed_status = "ok"
            contract_feed_error = None
        semaphore = self.semaphore

        async def enrich(row: dict, scan_whales: bool = False) -> dict:
            symbol = row["symbol"]
            contract = contracts.get(symbol)
            result = {
                **row,
                "open_interest_contracts": contract.get("open_interest_contracts") if contract else None,
                "oi_change_pct": None,
                "funding_rate": contract.get("funding_rate") if contract else None,
                "contract_market_available": bool(contract),
                "market_cap_usd": None,
                "fully_diluted_market_cap_usd": None,
                "token_unlock": "UNKNOWN",
                "whale_activity": "INSUFFICIENT_DATA",
                "signal": "NEUTRAL",
                "signal_status": "not_scored",
                "metric_source": "MEXC candle-derived metrics",
            }
            if contract:
                result.update({k: v for k, v in contract.items() if k != "contract_source"})
                result["oi_change_pct"] = self.oi_change(symbol, contract.get("open_interest_contracts"), tf)
            async with semaphore:
                try:
                    candle_data = await self.candles(symbol, tf, "spot", 35)
                    result.update(self.candle_metrics(candle_data["candles"]))
                    result["candle_updated_at"] = candle_data["updated_at"]
                    if scan_whales:
                        trade_data = await self.recent_trades(symbol, "spot", 500)
                        result["whale_buying"] = trade_data["whale_buying"]
                        result["whale_selling"] = trade_data["whale_selling"]
                        result["whale_sample_size"] = trade_data["sample_size"]
                        result["whale_large_trade_count"] = len(trade_data["large_trade_sample"])
                        result["whale_activity"] = (
                            "DETECTED" if "DETECTED" in (trade_data["whale_buying"], trade_data["whale_selling"])
                            else "NOT_DETECTED" if trade_data["whale_buying"] == "NOT_DETECTED" and trade_data["whale_selling"] == "NOT_DETECTED"
                            else "INSUFFICIENT_DATA"
                        )
                except Exception as exc:
                    result.update({"price_change_pct": None, "volume_change_pct": None,
                                   "relative_volume": None, "metric_status": "unavailable",
                                   "candle_error": str(exc)[:140]})
            result.update(score_market(result))
            return result

        # All enabled USDT spot pairs are listed. Candle-derived enrichments are
        # bounded to the highest-turnover universe to protect MEXC public limits.
        selected = spot_rows[:max(1, CANDLE_UNIVERSE_LIMIT)]
        enriched = await asyncio.gather(
            *(enrich(row, i < max(0, WHALE_SCAN_LIMIT)) for i, row in enumerate(selected)),
            return_exceptions=True
        )
        by_symbol = {}
        for item in enriched:
            if isinstance(item, dict):
                by_symbol[item["symbol"]] = item
        output = []
        for row in spot_rows:
            contract = contracts.get(row["symbol"])
            fallback = {
                **row, "price_change_pct": None, "volume_change_pct": None,
                "relative_volume": None, "metric_status": "not_enriched_rate_limit_budget",
                "open_interest_contracts": contract.get("open_interest_contracts") if contract else None,
                "oi_change_pct": None, "funding_rate": contract.get("funding_rate") if contract else None,
                "contract_market_available": bool(contract),
                "contract_last_price": contract.get("contract_last_price") if contract else None,
                "contract_change_24h_pct": contract.get("contract_change_24h_pct") if contract else None,
                "contract_volume_24h": contract.get("contract_volume_24h") if contract else None,
                "market_cap_usd": None, "fully_diluted_market_cap_usd": None,
                "token_unlock": "UNKNOWN", "whale_activity": "INSUFFICIENT_DATA",
                "whale_buying": "INSUFFICIENT_DATA", "whale_selling": "INSUFFICIENT_DATA",
                "whale_sample_size": None, "whale_large_trade_count": None,
            }
            fallback.update(score_market(fallback))
            output.append(by_symbol.get(row["symbol"], fallback))
        return {
            "data": output,
            "count": len(output),
            "spot_pairs_scanned": len(spot_rows),
            "candle_enriched_pairs": len(by_symbol),
            "timeframe": tf,
            "sources": ["MEXC Spot public API", "MEXC Contract public API"],
            "contract_feed_status": contract_feed_status,
            "contract_feed_error": contract_feed_error,
            "updated_at": now_iso(),
            "data_policy": "Unavailable values are null/UNKNOWN; spot and contract metrics remain separate.",
            "candle_scan_limit": CANDLE_UNIVERSE_LIMIT,
        }

    async def orderbook(self, symbol: str, market: str = "spot", limit: int = 100) -> dict:
        if market == "spot":
            payload = await self.request(f"{SPOT}/api/v3/depth", {"symbol": symbol.upper(), "limit": min(limit, 5000)})
            bids, asks = payload.get("bids", []), payload.get("asks", [])
            source = "MEXC Spot /api/v3/depth"
        elif market == "contract":
            contract_symbol = symbol.upper().replace("USDT", "_USDT")
            payload = await self.request(f"{CONTRACT}/depth/{contract_symbol}", {"limit": min(limit, 1000)})
            book = payload.get("data", payload) if isinstance(payload, dict) else {}
            bids, asks = book.get("bids", []), book.get("asks", [])
            source = "MEXC Contract /api/v1/contract/depth"
        else:
            raise ValueError("market must be spot or contract")
        bid_value = sum((number(x[0]) or 0) * (number(x[1]) or 0) for x in bids)
        ask_value = sum((number(x[0]) or 0) * (number(x[1]) or 0) for x in asks)
        total = bid_value + ask_value
        best_bid = number(bids[0][0]) if bids else None
        best_ask = number(asks[0][0]) if asks else None
        return {
            "symbol": symbol.upper(), "market": market, "bids": bids, "asks": asks,
            "bid_notional": bid_value, "ask_notional": ask_value,
            "bid_ask_ratio": bid_value / ask_value if ask_value > 0 else None,
            "imbalance_pct": ((bid_value - ask_value) / total * 100) if total > 0 else None,
            "spread": best_ask - best_bid if best_ask is not None and best_bid is not None else None,
            "spread_pct": ((best_ask - best_bid) / ((best_ask + best_bid) / 2) * 100)
                if best_ask is not None and best_bid is not None and best_ask + best_bid > 0 else None,
            "source": source, "updated_at": now_iso(),
            "warning": "Visible resting liquidity only; not proof of executed buying or selling.",
        }

    async def recent_trades(self, symbol: str, market: str = "spot", limit: int = 500) -> dict:
        if market == "spot":
            rows = await self.request(f"{SPOT}/api/v3/trades", {"symbol": symbol.upper(), "limit": min(limit, 1000)})
            trades = [{
                "price": number(x.get("price")), "quantity": number(x.get("qty")),
                "notional": number(x.get("quoteQty")),
                "side": "SELL_TAKER" if x.get("isBuyerMaker") else "BUY_TAKER",
                "timestamp": x.get("time"), "source_market": "spot",
            } for x in rows]
            source = "MEXC Spot /api/v3/trades"
        elif market == "contract":
            contract_symbol = symbol.upper().replace("USDT", "_USDT")
            payload = await self.request(f"{CONTRACT}/deals/{contract_symbol}", {"limit": min(limit, 100)})
            rows = payload.get("data", []) if isinstance(payload, dict) else []
            trades = [{
                "price": number(x.get("p")), "quantity": number(x.get("v")),
                "notional": (number(x.get("p")) or 0) * (number(x.get("v")) or 0),
                "side": "BUY" if x.get("T") == 1 else "SELL" if x.get("T") == 2 else "UNKNOWN",
                "open_position_flag": x.get("O"), "timestamp": x.get("t"), "source_market": "contract",
            } for x in rows]
            source = "MEXC Contract /api/v1/contract/deals"
        else:
            raise ValueError("market must be spot or contract")
        notionals = [x["notional"] for x in trades if x.get("notional") is not None]
        # Large-trade threshold is relative to the observed sample, not a wallet identity.
        threshold = sorted(notionals)[int((len(notionals) - 1) * 0.99)] if len(notionals) >= 20 else None
        large = [x for x in trades if threshold is not None and x.get("notional") is not None and x["notional"] >= threshold]
        buy_notional = sum(x["notional"] or 0 for x in large if x["side"] in ("BUY", "BUY_TAKER"))
        sell_notional = sum(x["notional"] or 0 for x in large if x["side"] in ("SELL", "SELL_TAKER"))
        return {
            "symbol": symbol.upper(), "market": market, "trades": trades,
            "sample_size": len(trades), "large_trade_threshold_notional": threshold,
            "large_trade_sample": large, "large_buy_notional": buy_notional,
            "large_sell_notional": sell_notional,
            "whale_buying": "INSUFFICIENT_DATA" if threshold is None or len(large) < 3 else "DETECTED" if buy_notional > sell_notional * 1.5 and buy_notional > 0 else "NOT_DETECTED",
            "whale_selling": "INSUFFICIENT_DATA" if threshold is None or len(large) < 3 else "DETECTED" if sell_notional > buy_notional * 1.5 and sell_notional > 0 else "NOT_DETECTED",
            "source": source, "updated_at": now_iso(),
            "caveat": "Large trades are a sample-relative heuristic, not verified whale identity or wallet attribution.",
        }

service = MexcMarketData()
