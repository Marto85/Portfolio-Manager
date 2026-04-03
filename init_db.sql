-- ═══════════════════════════════════════════════════════════════════════════
-- Portfolio AR — Database Schema
-- Run: psql -U postgres -d portfolio_ar -f init_db.sql
-- ═══════════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── Users ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email         VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name     VARCHAR(255),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Portfolios ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS portfolios (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name        VARCHAR(255) NOT NULL,
    description TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_portfolios_user ON portfolios(user_id);

-- ── Transactions ──────────────────────────────────────────────────────────────
-- asset_type: ACCION | CEDEAR | BONO | FCI
-- transaction_type: COMPRA | VENTA
CREATE TABLE IF NOT EXISTS transactions (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    portfolio_id     UUID NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
    ticker           VARCHAR(30) NOT NULL,
    asset_type       VARCHAR(20) NOT NULL DEFAULT 'ACCION'
                         CHECK (asset_type IN ('ACCION','CEDEAR','BONO','FCI','OTRO')),
    transaction_type VARCHAR(10) NOT NULL
                         CHECK (transaction_type IN ('COMPRA','VENTA')),
    transaction_date DATE NOT NULL,
    quantity         NUMERIC(18,6) NOT NULL CHECK (quantity > 0),
    unit_price_ars   NUMERIC(18,4) NOT NULL CHECK (unit_price_ars > 0),
    mep_rate         NUMERIC(12,4),          -- Dólar MEP vigente al momento
    notes            TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tx_portfolio  ON transactions(portfolio_id);
CREATE INDEX IF NOT EXISTS idx_tx_ticker     ON transactions(ticker);
CREATE INDEX IF NOT EXISTS idx_tx_date       ON transactions(transaction_date);

-- ── v_positions (view) ────────────────────────────────────────────────────────
-- Shows net open position per (portfolio, ticker).
-- PPC uses weighted average cost over all buys (broker-standard for Argentina).
-- Sells reduce quantity; PPC is recalculated only on the Python side for full
-- accuracy; the view provides a quick SQL approximation for reporting.
CREATE OR REPLACE VIEW v_positions AS
WITH ranked AS (
    SELECT
        portfolio_id,
        ticker,
        asset_type,
        transaction_type,
        transaction_date,
        quantity,
        unit_price_ars,
        mep_rate
    FROM transactions
)
SELECT
    portfolio_id,
    ticker,
    MAX(asset_type) AS asset_type,

    -- Net quantity (positive = long position)
    SUM(
        CASE transaction_type
            WHEN 'COMPRA' THEN  quantity
            WHEN 'VENTA'  THEN -quantity
        END
    ) AS net_quantity,

    -- PPC ARS: weighted average of purchase prices
    SUM(CASE WHEN transaction_type = 'COMPRA' THEN quantity * unit_price_ars ELSE 0 END)
    / NULLIF(SUM(CASE WHEN transaction_type = 'COMPRA' THEN quantity ELSE 0 END), 0)
        AS ppc_ars,

    -- Average MEP rate at purchase (for USD cost basis)
    SUM(CASE WHEN transaction_type = 'COMPRA' AND mep_rate > 0 THEN quantity * mep_rate ELSE 0 END)
    / NULLIF(SUM(CASE WHEN transaction_type = 'COMPRA' AND mep_rate > 0 THEN quantity ELSE 0 END), 0)
        AS avg_mep_buy,

    -- Cost basis in ARS
    SUM(CASE WHEN transaction_type = 'COMPRA' THEN quantity * unit_price_ars ELSE 0 END)
        AS total_cost_ars,

    COUNT(*) FILTER (WHERE transaction_type = 'COMPRA') AS buy_count,
    COUNT(*) FILTER (WHERE transaction_type = 'VENTA')  AS sell_count,
    MAX(transaction_date) AS last_operation_date

FROM ranked
GROUP BY portfolio_id, ticker
HAVING SUM(
    CASE transaction_type
        WHEN 'COMPRA' THEN  quantity
        WHEN 'VENTA'  THEN -quantity
    END
) > 0.000001;

-- ── Audit helper: portfolio totals ────────────────────────────────────────────
CREATE OR REPLACE VIEW v_portfolio_summary AS
SELECT
    p.id            AS portfolio_id,
    p.name          AS portfolio_name,
    p.user_id,
    COUNT(DISTINCT vp.ticker) AS open_positions,
    SUM(vp.total_cost_ars)    AS total_invested_ars
FROM portfolios p
LEFT JOIN v_positions vp ON vp.portfolio_id = p.id
GROUP BY p.id, p.name, p.user_id;
