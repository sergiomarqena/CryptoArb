# MR MOST PROFITABLE — QUANT TERMINAL

A desktop-first hybrid crypto market-intelligence dashboard combining cross-exchange arbitrage research and futures analysis.

## Phase 1 status
- React + TypeScript dashboard
- FastAPI backend foundation
- $500 virtual wallet display
- Paper-trading-only interface
- Live exchange feeds are **not connected yet**
- All market figures in the preview UI are illustrative, not live prices

## Run locally

### Frontend
```bash
cd frontend
npm install
npm run dev
```

### Backend
```bash
cd backend
python -m venv .venv
# Windows: .venv\\Scripts\\activate
# macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

Frontend: http://localhost:5173  
Backend health: http://localhost:8000/health

## Safety
The initial build is paper-only. It does not request exchange credentials or place real orders. Do not interpret preview values or research scores as trading recommendations.

## Roadmap
1. Dashboard foundation
2. Verified public Binance and MEXC market feeds
3. Cost-aware arbitrage calculations
4. Explainable futures research signals
5. Persistent paper ledger and out-of-sample testing
