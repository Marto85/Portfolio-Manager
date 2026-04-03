"""
Portfolio AR — Backend API
FastAPI + PostgreSQL (psycopg2) + yfinance
"""

from fastapi import FastAPI, HTTPException, Depends, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, date, timedelta
from collections import defaultdict
import os, math, time, re

import psycopg2
from psycopg2.extras import RealDictCursor
from passlib.context import CryptContext
from jose import JWTError, jwt
import yfinance as yf
import requests

from dotenv import load_dotenv
load_dotenv()

# ── Config ────────────────────────────────────────────────────────────────────
DATABASE_URL              = os.getenv("DATABASE_URL", "")
SECRET_KEY                = os.getenv("SECRET_KEY", "change-me-please")
ALGORITHM                 = "HS256"
ACCESS_TOKEN_EXPIRE_HOURS = 24

app = FastAPI(title="Portfolio AR API", version="1.0.0")
ALLOWED_ORIGINS = os.getenv(
    "ALLOWED_ORIGINS",
    "http://localhost:5173,http://localhost:3000"
).split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=True,
)

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
bearer      = HTTPBearer()

# ── DB ────────────────────────────────────────────────────────────────────────
def get_db():
    conn = psycopg2.connect(DATABASE_URL, cursor_factory=RealDictCursor)
    try:
        yield conn
    finally:
        conn.close()

# ── Auth helpers ──────────────────────────────────────────────────────────────
def hash_pw(pw: str) -> str:
    return pwd_context.hash(pw)

def verify_pw(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)

def create_token(user_id: str) -> str:
    exp = datetime.utcnow() + timedelta(hours=ACCESS_TOKEN_EXPIRE_HOURS)
    return jwt.encode({"sub": user_id, "exp": exp}, SECRET_KEY, algorithm=ALGORITHM)

def current_user(
    creds: HTTPAuthorizationCredentials = Depends(bearer),
    db = Depends(get_db)
):
    try:
        payload = jwt.decode(creds.credentials, SECRET_KEY, algorithms=[ALGORITHM])
        uid = payload.get("sub")
        if not uid:
            raise HTTPException(401, "Token inválido")
    except JWTError:
        raise HTTPException(401, "Token inválido o expirado")
    with db.cursor() as cur:
        cur.execute("SELECT id, email, full_name FROM users WHERE id = %s", (uid,))
        user = cur.fetchone()
    if not user:
        raise HTTPException(401, "Usuario no encontrado")
    return dict(user)

# ── Schemas ───────────────────────────────────────────────────────────────────
class RegisterIn(BaseModel):
    email:     str
    password:  str
    full_name: Optional[str] = None

class LoginIn(BaseModel):
    email:    str
    password: str

class PortfolioIn(BaseModel):
    name:        str
    description: Optional[str] = None

class TransactionIn(BaseModel):
    ticker:           str
    asset_type:       str = "ACCION"   # ACCION | CEDEAR | BONO | FCI
    transaction_type: str              # COMPRA | VENTA
    transaction_date: date
    quantity:         float
    unit_price_ars:   float
    mep_rate:         Optional[float] = None
    notes:            Optional[str]   = None

# ── Market data cache ─────────────────────────────────────────────────────────
_price_cache: dict = {}
_mep_cache:   dict = {}
PRICE_TTL = 300    # 5 min
MEP_TTL   = 1800   # 30 min

def _cached_price(ticker: str) -> Optional[float]:
    e = _price_cache.get(ticker)
    return e["v"] if (e and time.time() - e["ts"] < PRICE_TTL) else None

def _set_price(ticker: str, v: float):
    _price_cache[ticker] = {"v": v, "ts": time.time()}

def fetch_price(ticker: str) -> Optional[float]:
    c = _cached_price(ticker)
    if c: return c
    try:
        # Tickers with explicit exchange suffix → use as-is
        # Otherwise try .BA first (BYMA), then naked (for CEDEARs on other exchanges)
        candidates = [ticker] if ("." in ticker) else [ticker + ".BA", ticker]
        for sym in candidates:
            hist = yf.Ticker(sym).history(period="2d")
            if not hist.empty:
                price = float(hist["Close"].iloc[-1])
                _set_price(ticker, price)
                return price
    except Exception as e:
        print(f"⚠ fetch_price({ticker}): {e}")
    return None

def fetch_mep() -> Optional[float]:
    e = _mep_cache.get("v")
    if e and time.time() - e["ts"] < MEP_TTL:
        return e["v"]

    # 1) dolarapi.com  (bolsa = MEP)
    try:
        r = requests.get("https://dolarapi.com/v1/dolares/bolsa", timeout=5)
        if r.ok:
            data = r.json()
            rate = data.get("venta") or data.get("compra")
            if rate:
                _mep_cache["v"] = {"v": float(rate), "ts": time.time()}
                return float(rate)
    except: pass

    # 2) AL30 bond ratio  AL30.BA (ARS) / AL30D.BA (USD)
    try:
        ars = yf.Ticker("AL30.BA").history(period="2d")
        usd = yf.Ticker("AL30D.BA").history(period="2d")
        if not ars.empty and not usd.empty:
            rate = float(ars["Close"].iloc[-1]) / float(usd["Close"].iloc[-1])
            if 50 < rate < 5000:   # sanity check
                _mep_cache["v"] = {"v": rate, "ts": time.time()}
                return rate
    except: pass

    # 3) Bluelytics fallback (blue, not strictly MEP but close)
    try:
        r = requests.get("https://api.bluelytics.com.ar/v2/latest", timeout=5)
        if r.ok:
            rate = r.json().get("blue", {}).get("value_sell")
            if rate:
                _mep_cache["v"] = {"v": float(rate), "ts": time.time()}
                return float(rate)
    except: pass

    return None

# ── PPC calculation (Python — canonical, used for positions endpoint) ──────────
def calculate_position(txs: list) -> dict:
    """
    Weighted average cost (promedio ponderado móvil).
    - BUY:  new_ppc = (held_qty × ppc + new_qty × price) / (held_qty + new_qty)
    - SELL: ppc stays the same, only quantity decreases.
    This matches IOL / PPI / BYMA broker convention.
    """
    qty       = 0.0
    ppc_ars   = 0.0
    ppc_usd   = 0.0   # None if no mep_rate ever provided
    has_usd   = False

    for t in sorted(txs, key=lambda x: (str(x["transaction_date"]), str(x["created_at"]))):
        q     = float(t["quantity"])
        price = float(t["unit_price_ars"])
        mep   = float(t["mep_rate"]) if t.get("mep_rate") else None

        if t["transaction_type"] == "COMPRA":
            new_qty = qty + q
            if new_qty > 0:
                ppc_ars = (qty * ppc_ars + q * price) / new_qty
                if mep and mep > 0:
                    price_usd = price / mep
                    ppc_usd   = (qty * ppc_usd + q * price_usd) / new_qty
                    has_usd   = True
            qty = new_qty

        elif t["transaction_type"] == "VENTA":
            qty = max(0.0, qty - q)
            if qty < 0.000001:
                qty = ppc_ars = ppc_usd = 0.0
                has_usd = False

    if qty < 0.000001:
        return {"quantity": 0.0, "ppc_ars": 0.0, "ppc_usd": None,
                "cost_ars": 0.0, "cost_usd": None}
    return {
        "quantity": round(qty,       6),
        "ppc_ars":  round(ppc_ars,   4),
        "ppc_usd":  round(ppc_usd,   6) if has_usd else None,
        "cost_ars": round(qty * ppc_ars, 2),
        "cost_usd": round(qty * ppc_usd, 2) if has_usd else None,
    }

def _serialize(obj):
    """Make psycopg2 RealDictRow JSON-serializable."""
    if isinstance(obj, dict):
        return {k: _serialize(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_serialize(i) for i in obj]
    if hasattr(obj, "isoformat"):
        return obj.isoformat()
    return obj

# ════════════════════════════════════════════════════════════════════════════
# AUTH routes
# ════════════════════════════════════════════════════════════════════════════
@app.post("/api/auth/register")
def register(body: RegisterIn, db=Depends(get_db)):
    with db.cursor() as cur:
        cur.execute("SELECT id FROM users WHERE email = %s", (body.email.lower(),))
        if cur.fetchone():
            raise HTTPException(400, "Email ya registrado")
        cur.execute(
            "INSERT INTO users (email, password_hash, full_name) VALUES (%s,%s,%s) RETURNING id, email, full_name",
            (body.email.lower(), hash_pw(body.password), body.full_name)
        )
        user = dict(cur.fetchone())
        db.commit()
    return {"token": create_token(str(user["id"])), "user": user}

@app.post("/api/auth/login")
def login(body: LoginIn, db=Depends(get_db)):
    with db.cursor() as cur:
        cur.execute("SELECT * FROM users WHERE email = %s", (body.email.lower(),))
        user = cur.fetchone()
    if not user or not verify_pw(body.password, user["password_hash"]):
        raise HTTPException(401, "Credenciales incorrectas")
    u = {"id": str(user["id"]), "email": user["email"], "full_name": user["full_name"]}
    return {"token": create_token(str(user["id"])), "user": u}

@app.get("/api/auth/me")
def me(u=Depends(current_user)):
    return u

# ════════════════════════════════════════════════════════════════════════════
# PORTFOLIO routes
# ════════════════════════════════════════════════════════════════════════════
def _own_portfolio(portfolio_id: str, user_id: str, db) -> dict:
    with db.cursor() as cur:
        cur.execute("SELECT * FROM portfolios WHERE id=%s AND user_id=%s", (portfolio_id, user_id))
        p = cur.fetchone()
    if not p:
        raise HTTPException(404, "Portfolio no encontrado")
    return dict(p)

@app.get("/api/portfolios")
def list_portfolios(u=Depends(current_user), db=Depends(get_db)):
    with db.cursor() as cur:
        cur.execute(
            """SELECT p.*, COUNT(DISTINCT t.ticker) AS tickers_count
               FROM portfolios p
               LEFT JOIN transactions t ON t.portfolio_id = p.id
               WHERE p.user_id = %s
               GROUP BY p.id ORDER BY p.created_at""",
            (u["id"],)
        )
        return _serialize(cur.fetchall())

@app.post("/api/portfolios", status_code=201)
def create_portfolio(body: PortfolioIn, u=Depends(current_user), db=Depends(get_db)):
    with db.cursor() as cur:
        cur.execute(
            "INSERT INTO portfolios (user_id,name,description) VALUES (%s,%s,%s) RETURNING *",
            (u["id"], body.name, body.description)
        )
        p = dict(cur.fetchone())
        db.commit()
    return _serialize(p)

@app.put("/api/portfolios/{pid}")
def update_portfolio(pid: str, body: PortfolioIn, u=Depends(current_user), db=Depends(get_db)):
    _own_portfolio(pid, u["id"], db)
    with db.cursor() as cur:
        cur.execute(
            "UPDATE portfolios SET name=%s, description=%s WHERE id=%s RETURNING *",
            (body.name, body.description, pid)
        )
        p = dict(cur.fetchone())
        db.commit()
    return _serialize(p)

@app.delete("/api/portfolios/{pid}")
def delete_portfolio(pid: str, u=Depends(current_user), db=Depends(get_db)):
    _own_portfolio(pid, u["id"], db)
    with db.cursor() as cur:
        cur.execute("DELETE FROM portfolios WHERE id=%s", (pid,))
        db.commit()
    return {"ok": True}

# ════════════════════════════════════════════════════════════════════════════
# TRANSACTION routes
# ════════════════════════════════════════════════════════════════════════════
@app.get("/api/portfolios/{pid}/transactions")
def list_transactions(pid: str, u=Depends(current_user), db=Depends(get_db)):
    _own_portfolio(pid, u["id"], db)
    with db.cursor() as cur:
        cur.execute(
            "SELECT * FROM transactions WHERE portfolio_id=%s ORDER BY transaction_date DESC, created_at DESC",
            (pid,)
        )
        return _serialize(cur.fetchall())

@app.post("/api/portfolios/{pid}/transactions", status_code=201)
def add_transaction(pid: str, body: TransactionIn, u=Depends(current_user), db=Depends(get_db)):
    _own_portfolio(pid, u["id"], db)
    ticker = body.ticker.strip().upper()

    # ── Validate VENTA: check enough quantity ──
    if body.transaction_type == "VENTA":
        with db.cursor() as cur:
            cur.execute(
                "SELECT transaction_type, quantity FROM transactions WHERE portfolio_id=%s AND ticker=%s",
                (pid, ticker)
            )
            rows = [dict(r) for r in cur.fetchall()]
        net = sum(float(r["quantity"]) * (1 if r["transaction_type"]=="COMPRA" else -1) for r in rows)
        if body.quantity > net + 0.000001:
            raise HTTPException(400, f"Cantidad insuficiente. Tenés {net:.4f} nominales de {ticker}")

    # ── Auto-fetch MEP if not provided ──
    mep = body.mep_rate
    if mep is None:
        mep = fetch_mep()

    with db.cursor() as cur:
        cur.execute(
            """INSERT INTO transactions
               (portfolio_id,ticker,asset_type,transaction_type,transaction_date,
                quantity,unit_price_ars,mep_rate,notes)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING *""",
            (pid, ticker, body.asset_type, body.transaction_type, body.transaction_date,
             body.quantity, body.unit_price_ars, mep, body.notes)
        )
        tx = dict(cur.fetchone())
        db.commit()
    return _serialize(tx)

@app.delete("/api/portfolios/{pid}/transactions/{tx_id}")
def delete_transaction(pid: str, tx_id: str, u=Depends(current_user), db=Depends(get_db)):
    _own_portfolio(pid, u["id"], db)
    with db.cursor() as cur:
        cur.execute(
            "DELETE FROM transactions WHERE id=%s AND portfolio_id=%s RETURNING id",
            (tx_id, pid)
        )
        if not cur.fetchone():
            raise HTTPException(404, "Transacción no encontrada")
        db.commit()
    return {"ok": True}

# ════════════════════════════════════════════════════════════════════════════
# POSITIONS endpoint (core business logic)
# ════════════════════════════════════════════════════════════════════════════
@app.get("/api/portfolios/{pid}/positions")
def get_positions(pid: str, u=Depends(current_user), db=Depends(get_db)):
    _own_portfolio(pid, u["id"], db)
    with db.cursor() as cur:
        cur.execute(
            "SELECT * FROM transactions WHERE portfolio_id=%s ORDER BY transaction_date ASC, created_at ASC",
            (pid,)
        )
        all_tx = [dict(r) for r in cur.fetchall()]

    current_mep = fetch_mep()

    # Group by ticker
    by_ticker: dict = defaultdict(list)
    for tx in all_tx:
        by_ticker[tx["ticker"]].append(tx)

    positions = []
    for ticker, txs in by_ticker.items():
        pos = calculate_position(txs)
        if pos["quantity"] < 0.000001:
            continue

        current_price = fetch_price(ticker)
        asset_type    = txs[0]["asset_type"]

        value_ars = (current_price * pos["quantity"]) if current_price else None
        value_usd = (value_ars / current_mep) if (value_ars and current_mep) else None

        # P&L in ARS
        pnl_ars = (value_ars - pos["cost_ars"]) if value_ars is not None else None
        pnl_pct = (pnl_ars / pos["cost_ars"] * 100) if (pnl_ars is not None and pos["cost_ars"] > 0) else None

        # P&L in USD (moneda dura)
        pnl_usd     = None
        pnl_pct_usd = None
        if value_usd is not None and pos.get("cost_usd"):
            pnl_usd     = value_usd - pos["cost_usd"]
            pnl_pct_usd = (pnl_usd / pos["cost_usd"] * 100) if pos["cost_usd"] > 0 else None

        positions.append({
            "ticker":            ticker,
            "asset_type":        asset_type,
            "quantity":          pos["quantity"],
            "ppc_ars":           pos["ppc_ars"],
            "ppc_usd":           pos["ppc_usd"],
            "current_price_ars": current_price,
            "current_value_ars": value_ars,
            "current_value_usd": value_usd,
            "cost_ars":          pos["cost_ars"],
            "cost_usd":          pos["cost_usd"],
            "pnl_ars":           pnl_ars,
            "pnl_pct":           pnl_pct,
            "pnl_usd":           pnl_usd,
            "pnl_pct_usd":       pnl_pct_usd,
        })

    # Portfolio-level totals
    total_cost_ars  = sum(p["cost_ars"]          for p in positions)
    total_value_ars = sum(p["current_value_ars"] or 0 for p in positions)
    total_cost_usd  = sum(p["cost_usd"]          or 0 for p in positions)
    total_value_usd = sum(p["current_value_usd"] or 0 for p in positions)
    total_pnl_ars   = total_value_ars - total_cost_ars
    total_pnl_pct   = (total_pnl_ars / total_cost_ars * 100) if total_cost_ars > 0 else 0

    return {
        "positions":       positions,
        "current_mep":     current_mep,
        "total_cost_ars":  total_cost_ars,
        "total_value_ars": total_value_ars,
        "total_pnl_ars":   total_pnl_ars,
        "total_pnl_pct":   total_pnl_pct,
        "total_cost_usd":  total_cost_usd,
        "total_value_usd": total_value_usd,
        "total_pnl_usd":   total_value_usd - total_cost_usd,
    }

# ════════════════════════════════════════════════════════════════════════════
# MARKET routes
# ════════════════════════════════════════════════════════════════════════════
@app.get("/api/market/mep")
def get_mep():
    rate = fetch_mep()
    if not rate:
        raise HTTPException(503, "No se pudo obtener tipo de cambio MEP")
    return {"mep": rate, "source": "dolarapi/bonds"}

@app.get("/api/market/price/{ticker}")
def get_price(ticker: str):
    price = fetch_price(ticker.upper())
    if not price:
        raise HTTPException(404, f"Sin precio disponible para {ticker.upper()}")
    return {"ticker": ticker.upper(), "price_ars": price}
