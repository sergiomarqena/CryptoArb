from datetime import datetime, timezone
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
import asyncio

app = FastAPI(title="MR Most Profitable Quant API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
async def health():
    return {
        "status": "ok",
        "mode": "paper",
        "market_feeds": "not_connected",
        "virtual_wallet_usd": 500.00,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }

@app.get("/api/status")
async def status():
    return {
        "application": "MR MOST PROFITABLE",
        "phase": 1,
        "arbitrage_engine": "standby",
        "futures_engine": "standby",
        "execution_mode": "paper_only",
    }

@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()
    try:
        await ws.send_json({
            "type": "system",
            "message": "WebSocket connected. Live exchange adapters are not enabled in Phase 1.",
            "timestamp": datetime.now(timezone.utc).isoformat(),
        })
        while True:
            await asyncio.sleep(25)
            await ws.send_json({"type": "heartbeat", "timestamp": datetime.now(timezone.utc).isoformat()})
    except WebSocketDisconnect:
        return
