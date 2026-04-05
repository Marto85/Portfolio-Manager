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
    asset_type:       str = "ACCION"
    transaction_type: str
    transaction_date: date
    quantity:         float
    unit_price_ars:   float
    mep_rate:         Optional[float] = None
    notes:            Optional[str]   = None

# ── Market data cache ─────────────────────────────────────────────────────────
_price_cache: dict = {}
_mep_cache:   dict = {}
PRICE_TTL = 300
MEP_TTL   = 1800

def _cached_price(ticker: str) -> Optional[float]:
    e = _price_cache.get(ticker)
    return e["v"] if (e and time.time() - e["ts"] < PRICE_TTL) else None

def _set_price(ticker: str, v: float):
    _price_cache[ticker] = {"v": v, "ts": time.time()}

# ── fetch_price con debug exhaustivo ─────────────────────────────────────────
def fetch_price(ticker: str) -> Optional[float]:
    """
    Intenta obtener el precio de cierre más reciente para un ticker.
    Imprime logs detallados en cada paso para facilitar el debug.
    """
    print(f"\n{'='*60}")
    print(f"[PRICE] Solicitando precio para: '{ticker}'")

    # 1. Cache check
    cached = _cached_price(ticker)
    if cached:
        print(f"[PRICE] ✅ Cache hit → {cached}")
        return cached
    print(f"[PRICE] Cache miss, consultando yfinance...")

    # 2. Determinar candidatos de símbolo
    # Si ya tiene punto (ej: "BMA.BA") lo usamos directo.
    # Si no, probamos: ticker+".BA" primero (BYMA), luego ticker solo (CEDEARs en NYSE/NASDAQ)
    if "." in ticker:
        candidates = [ticker]
        print(f"[PRICE] Ticker con '.' detectado → candidatos: {candidates}")
    else:
        candidates = [ticker + ".BA", ticker]
        print(f"[PRICE] Sin '.' → candidatos en orden: {candidates}")

    # 3. Probar cada candidato
    for sym in candidates:
        print(f"\n[PRICE] --- Probando símbolo: '{sym}' ---")
        try:
            t_obj = yf.Ticker(sym)

            # 3a. Info básica (puede fallar sin errores con dict vacío)
            try:
                info = t_obj.info
                print(f"[PRICE] info keys disponibles: {list(info.keys())[:10]}...")
                print(f"[PRICE] info['regularMarketPrice'] = {info.get('regularMarketPrice')}")
                print(f"[PRICE] info['currentPrice']       = {info.get('currentPrice')}")
                print(f"[PRICE] info['previousClose']      = {info.get('previousClose')}")
                print(f"[PRICE] info['currency']           = {info.get('currency')}")
                print(f"[PRICE] info['exchange']           = {info.get('exchange')}")
                print(f"[PRICE] info['shortName']          = {info.get('shortName')}")
            except Exception as ie:
                print(f"[PRICE] ⚠ No se pudo obtener info: {ie}")

            # 3b. Intentar con distintos periods para history
            for period in ["5d", "1mo"]:
                print(f"\n[PRICE] Probando history(period='{period}') para '{sym}'...")
                try:
                    hist = t_obj.history(period=period)
                    print(f"[PRICE] Filas retornadas: {len(hist)}")
                    if not hist.empty:
                        print(f"[PRICE] Columnas: {list(hist.columns)}")
                        print(f"[PRICE] Rango de fechas: {hist.index[0]} → {hist.index[-1]}")
                        print(f"[PRICE] Últimas 3 filas:\n{hist[['Open','High','Low','Close','Volume']].tail(3)}")
                        price = float(hist["Close"].iloc[-1])
                        print(f"[PRICE] ✅ Precio extraído: {price} (Close de {hist.index[-1].date()})")
                        _set_price(ticker, price)
                        return price
                    else:
                        print(f"[PRICE] ❌ DataFrame vacío para period='{period}'")
                except Exception as he:
                    print(f"[PRICE] ❌ Error en history(period='{period}'): {type(he).__name__}: {he}")

            # 3c. Intentar con download como alternativa
            print(f"\n[PRICE] Probando yf.download como fallback para '{sym}'...")
            try:
                import pandas as pd
                df = yf.download(sym, period="5d", progress=False, auto_adjust=True)
                print(f"[PRICE] download() filas: {len(df)}")
                if not df.empty:
                    price = float(df["Close"].iloc[-1])
                    print(f"[PRICE] ✅ Precio via download: {price}")
                    _set_price(ticker, price)
                    return price
                else:
                    print(f"[PRICE] ❌ download() también vacío")
            except Exception as de:
                print(f"[PRICE] ❌ Error en download(): {type(de).__name__}: {de}")

        except Exception as e:
            print(f"[PRICE] ❌ Error inesperado con '{sym}': {type(e).__name__}: {e}")

    print(f"[PRICE] ❌ Sin precio disponible para '{ticker}' tras todos los intentos")
    print(f"{'='*60}\n")
    return None


def fetch_mep() -> Optional[float]:
    e = _mep_cache.get("v")
    if e and time.time() - e["ts"] < MEP_TTL:
        return e["v"]

    print("[MEP] Obteniendo tipo de cambio MEP...")

    # 1) dolarapi.com
    try:
        r = requests.get("https://dolarapi.com/v1/dolares/bolsa", timeout=5)
        if r.ok:
            data = r.json()
            rate = data.get("venta") or data.get("compra")
            if rate:
                print(f"[MEP] ✅ dolarapi.com → {rate}")
                _mep_cache["v"] = {"v": float(rate), "ts": time.time()}
                return float(rate)
    except Exception as e:
        print(f"[MEP] ⚠ dolarapi.com falló: {e}")

    # 2) AL30 bond ratio
    try:
        ars = yf.Ticker("AL30.BA").history(period="5d")
        usd = yf.Ticker("AL30D.BA").history(period="5d")
        if not ars.empty and not usd.empty:
            rate = float(ars["Close"].iloc[-1]) / float(usd["Close"].iloc[-1])
            if 50 < rate < 5000:
                print(f"[MEP] ✅ AL30 ratio → {rate}")
                _mep_cache["v"] = {"v": rate, "ts": time.time()}
                return rate
    except Exception as e:
        print(f"[MEP] ⚠ AL30 ratio falló: {e}")

    # 3) Bluelytics fallback
    try:
        r = requests.get("https://api.bluelytics.com.ar/v2/latest", timeout=5)
        if r.ok:
            rate = r.json().get("blue", {}).get("value_sell")
            if rate:
                print(f"[MEP] ✅ bluelytics fallback → {rate}")
                _mep_cache["v"] = {"v": float(rate), "ts": time.time()}
                return float(rate)
    except Exception as e:
        print(f"[MEP] ⚠ bluelytics falló: {e}")

    print("[MEP] ❌ No se pudo obtener MEP por ninguna fuente")
    return None


# ── PPC calculation ───────────────────────────────────────────────────────────
def calculate_position(txs: list) -> dict:
    qty       = 0.0
    ppc_ars   = 0.0
    ppc_usd   = 0.0
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
# POSITIONS endpoint
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

    print(f"\n[POSITIONS] Portfolio {pid} — {len(all_tx)} transacciones encontradas")

    current_mep = fetch_mep()
    print(f"[POSITIONS] MEP actual: {current_mep}")

    by_ticker: dict = defaultdict(list)
    for tx in all_tx:
        by_ticker[tx["ticker"]].append(tx)

    print(f"[POSITIONS] Tickers únicos: {list(by_ticker.keys())}")

    positions = []
    for ticker, txs in by_ticker.items():
        pos = calculate_position(txs)
        print(f"\n[POSITIONS] {ticker} → qty={pos['quantity']} ppc_ars={pos['ppc_ars']}")

        if pos["quantity"] < 0.000001:
            print(f"[POSITIONS] {ticker} → posición cerrada, se omite")
            continue

        current_price = fetch_price(ticker)
        print(f"[POSITIONS] {ticker} → precio actual: {current_price}")

        asset_type = txs[0]["asset_type"]

        value_ars = (current_price * pos["quantity"]) if current_price else None
        value_usd = (value_ars / current_mep) if (value_ars and current_mep) else None

        pnl_ars = (value_ars - pos["cost_ars"]) if value_ars is not None else None
        pnl_pct = (pnl_ars / pos["cost_ars"] * 100) if (pnl_ars is not None and pos["cost_ars"] > 0) else None

        pnl_usd     = None
        pnl_pct_usd = None
        if value_usd is not None and pos.get("cost_usd"):
            pnl_usd     = value_usd - pos["cost_usd"]
            pnl_pct_usd = (pnl_usd / pos["cost_usd"] * 100) if pos["cost_usd"] > 0 else None

        print(f"[POSITIONS] {ticker} → value_ars={value_ars} pnl_ars={pnl_ars}")

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

    total_cost_ars  = sum(p["cost_ars"]          for p in positions)
    total_value_ars = sum(p["current_value_ars"] or 0 for p in positions)
    total_cost_usd  = sum(p["cost_usd"]          or 0 for p in positions)
    total_value_usd = sum(p["current_value_usd"] or 0 for p in positions)
    total_pnl_ars   = total_value_ars - total_cost_ars
    total_pnl_pct   = (total_pnl_ars / total_cost_ars * 100) if total_cost_ars > 0 else 0

    print(f"\n[POSITIONS] TOTALES → cost={total_cost_ars} value={total_value_ars} pnl={total_pnl_ars}")

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
# REALIZED P&L endpoint (FIFO)
# ════════════════════════════════════════════════════════════════════════════
@app.get("/api/portfolios/{pid}/realized")
def get_realized(pid: str, u=Depends(current_user), db=Depends(get_db)):
    _own_portfolio(pid, u["id"], db)
    with db.cursor() as cur:
        cur.execute(
            "SELECT * FROM transactions WHERE portfolio_id=%s ORDER BY transaction_date ASC, created_at ASC",
            (pid,)
        )
        all_tx = [dict(r) for r in cur.fetchall()]

    by_ticker: dict = defaultdict(list)
    for tx in all_tx:
        by_ticker[tx["ticker"]].append(tx)

    realized = []

    for ticker, txs in by_ticker.items():
        buy_queue = []  # FIFO: [{"qty", "price_ars", "mep", "date", "asset_type"}]

        for tx in txs:
            q     = float(tx["quantity"])
            price = float(tx["unit_price_ars"])
            mep   = float(tx["mep_rate"]) if tx.get("mep_rate") else None
            d     = tx["transaction_date"]
            atype = tx["asset_type"]

            if tx["transaction_type"] == "COMPRA":
                buy_queue.append({
                    "qty": q, "price_ars": price,
                    "mep": mep, "date": d, "asset_type": atype
                })

            elif tx["transaction_type"] == "VENTA":
                sell_remaining = q
                sell_price     = price
                sell_mep       = mep
                sell_date      = d

                while sell_remaining > 0.000001 and buy_queue:
                    buy     = buy_queue[0]
                    matched = min(buy["qty"], sell_remaining)

                    total_buy_ars  = buy["price_ars"] * matched
                    total_sell_ars = sell_price * matched
                    pnl_ars        = total_sell_ars - total_buy_ars

                    buy_price_usd = sell_price_usd = total_buy_usd = total_sell_usd = pnl_usd = None

                    if buy["mep"] and buy["mep"] > 0:
                        buy_price_usd = buy["price_ars"] / buy["mep"]
                        total_buy_usd = buy_price_usd * matched

                    if sell_mep and sell_mep > 0:
                        sell_price_usd = sell_price / sell_mep
                        total_sell_usd = sell_price_usd * matched

                    if total_buy_usd is not None and total_sell_usd is not None:
                        pnl_usd = total_sell_usd - total_buy_usd

                    realized.append({
                        "ticker":         ticker,
                        "asset_type":     buy["asset_type"],
                        "quantity":       round(matched, 6),
                        "buy_date":       str(buy["date"]),
                        "sell_date":      str(sell_date),
                        "buy_price_ars":  round(buy["price_ars"], 4),
                        "sell_price_ars": round(sell_price, 4),
                        "buy_price_usd":  round(buy_price_usd, 4)  if buy_price_usd  else None,
                        "sell_price_usd": round(sell_price_usd, 4) if sell_price_usd else None,
                        "buy_mep":        round(buy["mep"], 2)      if buy["mep"]     else None,
                        "sell_mep":       round(sell_mep, 2)        if sell_mep       else None,
                        "total_buy_ars":  round(total_buy_ars, 2),
                        "total_sell_ars": round(total_sell_ars, 2),
                        "total_buy_usd":  round(total_buy_usd, 2)  if total_buy_usd  else None,
                        "total_sell_usd": round(total_sell_usd, 2) if total_sell_usd else None,
                        "pnl_ars":        round(pnl_ars, 2),
                        "pnl_usd":        round(pnl_usd, 2) if pnl_usd is not None else None,
                        "pnl_pct_ars":    round(pnl_ars / total_buy_ars * 100, 2) if total_buy_ars > 0 else None,
                        "pnl_pct_usd":    round(pnl_usd / total_buy_usd * 100, 2)
                                          if (pnl_usd is not None and total_buy_usd and total_buy_usd > 0)
                                          else None,
                    })

                    buy["qty"]     -= matched
                    sell_remaining -= matched
                    if buy["qty"] < 0.000001:
                        buy_queue.pop(0)

    realized.sort(key=lambda x: x["sell_date"], reverse=True)
    total_pnl_ars = sum(r["pnl_ars"] for r in realized)
    total_pnl_usd = sum(r["pnl_usd"] or 0 for r in realized)

    return _serialize({
        "realized":      realized,
        "total_pnl_ars": round(total_pnl_ars, 2),
        "total_pnl_usd": round(total_pnl_usd, 2),
    })


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
    """
    Endpoint de debug: llamalo directamente para ver los logs del servidor
    y entender qué pasa con cada ticker.
    Ej: GET /api/market/price/GGAL
        GET /api/market/price/GGAL.BA
        GET /api/market/price/BMA.BA
    """
    clean = ticker.upper().strip()
    print(f"\n[API] GET /api/market/price/{clean}")
    price = fetch_price(clean)
    if not price:
        raise HTTPException(404, f"Sin precio disponible para {clean}")
    return {
        "ticker":    clean,
        "price_ars": price,
        "cached":    _cached_price(clean) is not None,
    }


@app.get("/api/market/debug/{ticker}")
def debug_ticker(ticker: str):
    """
    Endpoint de debug extendido: retorna toda la info que yfinance
    devuelve para un ticker, sin filtrar. Útil para entender qué
    símbolos funcionan y cuáles no.
    """
    clean = ticker.upper().strip()
    result = {"ticker_solicitado": clean, "intentos": []}

    candidates = [clean] if "." in clean else [clean + ".BA", clean]

    for sym in candidates:
        attempt = {"simbolo": sym, "history_5d": None, "history_1mo": None, "info_sample": None, "error": None}
        try:
            t_obj = yf.Ticker(sym)

            # Info
            try:
                info = t_obj.info
                attempt["info_sample"] = {
                    "shortName":          info.get("shortName"),
                    "currency":           info.get("currency"),
                    "exchange":           info.get("exchange"),
                    "regularMarketPrice": info.get("regularMarketPrice"),
                    "previousClose":      info.get("previousClose"),
                    "currentPrice":       info.get("currentPrice"),
                    "quoteType":          info.get("quoteType"),
                }
            except Exception as ie:
                attempt["info_sample"] = f"ERROR: {ie}"

            # History 5d
            try:
                h5 = t_obj.history(period="5d")
                attempt["history_5d"] = {
                    "filas":        len(h5),
                    "vacio":        h5.empty,
                    "ultimo_close": float(h5["Close"].iloc[-1]) if not h5.empty else None,
                    "ultima_fecha": str(h5.index[-1]) if not h5.empty else None,
                }
            except Exception as he:
                attempt["history_5d"] = f"ERROR: {he}"

            # History 1mo
            try:
                h1m = t_obj.history(period="1mo")
                attempt["history_1mo"] = {
                    "filas":        len(h1m),
                    "vacio":        h1m.empty,
                    "ultimo_close": float(h1m["Close"].iloc[-1]) if not h1m.empty else None,
                }
            except Exception as he:
                attempt["history_1mo"] = f"ERROR: {he}"

        except Exception as e:
            attempt["error"] = f"{type(e).__name__}: {e}"

        result["intentos"].append(attempt)

    return result