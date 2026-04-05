// src/components/Dashboard.jsx
import { useState, useEffect, useCallback } from "react";
import {
  BarChart2,
  Plus,
  RefreshCw,
  LogOut,
  TrendingUp,
  TrendingDown,
  DollarSign,
  Wallet,
  ChevronDown,
  Trash2,
  AlertCircle,
  Loader2,
  ArrowUpRight,
  ArrowDownRight,
  Briefcase,
  X,
  Receipt,
  Search,
  ChevronLeft,
  ChevronRight
} from "lucide-react";
import { useAuth } from "../App";
import { api } from "../utils/api";
import AddTransaction from "./AddTransaction";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:8000";

const ars = (v, decimals = 2) =>
  v == null
    ? "—"
    : `$ ${Number(v).toLocaleString("es-AR", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;

const usd = (v, decimals = 2) =>
  v == null
    ? "—"
    : `u$s ${Number(v).toLocaleString("es-AR", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;

const pct = (v) =>
  v == null ? "—" : `${v >= 0 ? "+" : ""}${Number(v).toFixed(2)}%`;

const qty = (v) =>
  v == null
    ? "—"
    : Number(v).toLocaleString("es-AR", { maximumFractionDigits: 4 });

const BADGE = {
  ACCION: "bg-sky-500/15 text-sky-400 border-sky-500/25",
  CEDEAR: "bg-purple-500/15 text-purple-400 border-purple-500/25",
  BONO: "bg-amber-500/15 text-amber-400 border-amber-500/25",
  FCI: "bg-emerald-500/15 text-emerald-400 border-emerald-500/25",
  OTRO: "bg-gray-500/15 text-gray-400 border-gray-500/25",
};

const ITEMS_PER_PAGE = 5;

function AssetBadge({ type }) {
  return (
    <span
      className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${BADGE[type] || BADGE.OTRO}`}
    >
      {type}
    </span>
  );
}

function Logo({ ticker }) {
  const [err, setErr] = useState(false);
  const base = ticker?.split(".")[0]?.split("-")[0]?.toUpperCase();
  if (err || !base) {
    return (
      <div className="w-8 h-8 rounded-lg bg-gray-700 flex items-center justify-center flex-shrink-0">
        <span className="text-[10px] font-bold text-gray-400">
          {(base || "?").slice(0, 2)}
        </span>
      </div>
    );
  }
  return (
    <img
      src={`${API_BASE}/api/logo/${base}`}
      alt={base}
      onError={() => setErr(true)}
      className="w-8 h-8 rounded-lg object-contain bg-gray-800 flex-shrink-0"
    />
  );
}

function PnlCell({ value, pct: p, size = "sm" }) {
  const positive = (value ?? 0) >= 0;
  const cls = positive ? "text-emerald-400" : "text-red-400";
  return (
    <div className={`text-right ${cls}`}>
      <p className={`font-mono font-semibold text-${size}`}>{ars(value)}</p>
      <p className="text-[10px] font-bold">{pct(p)}</p>
    </div>
  );
}

export default function Dashboard() {
  const { token, user, logout } = useAuth();

  const [portfolios, setPortfolios] = useState([]);
  const [activePid, setActivePid] = useState(null);
  const [positions, setPositions] = useState(null);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingPos, setLoadingPos] = useState(false);
  const [showAddTx, setShowAddTx] = useState(false);
  const [showNewPortfolio, setShowNewPortfolio] = useState(false);
  const [newPortfolioName, setNewPortfolioName] = useState("");
  const [error, setError] = useState(null);
  const [tab, setTab] = useState("positions");
  const [transactions, setTransactions] = useState([]);
  const [loadingTx, setLoadingTx] = useState(false);
  const [realized, setRealized] = useState(null);
  const [loadingRealized, setLoadingRealized] = useState(false);

  // ── Estados para Búsqueda y Paginación ──
  const [searchTx, setSearchTx] = useState("");
  const [pageTx, setPageTx] = useState(1);
  const [searchRes, setSearchRes] = useState("");
  const [pageRes, setPageRes] = useState(1);

  // Reiniciar la página a 1 si el usuario escribe en el buscador
  useEffect(() => setPageTx(1), [searchTx]);
  useEffect(() => setPageRes(1), [searchRes]);

  const loadPortfolios = useCallback(async () => {
    setLoadingList(true);
    try {
      const data = await api.getPortfolios(token);
      setPortfolios(data);
      if (!activePid && data.length > 0) setActivePid(data[0].id);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoadingList(false);
    }
  }, [token, activePid]);

  useEffect(() => {
    loadPortfolios();
  }, [loadPortfolios]);

  const loadPositions = useCallback(async () => {
    if (!activePid) return;
    setLoadingPos(true);
    setError(null);
    try {
      const data = await api.getPositions(activePid, token);
      setPositions(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoadingPos(false);
    }
  }, [activePid, token]);

  useEffect(() => {
    loadPositions();
  }, [loadPositions]);

  const loadTransactions = useCallback(async () => {
    if (!activePid || tab !== "transactions") return;
    setLoadingTx(true);
    try {
      const data = await api.getTransactions(activePid, token);
      setTransactions(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoadingTx(false);
    }
  }, [activePid, token, tab]);

  useEffect(() => {
    loadTransactions();
  }, [loadTransactions]);

  const loadRealized = useCallback(async () => {
    if (!activePid || tab !== "realized") return;
    setLoadingRealized(true);
    try {
      const data = await api.getRealizedPnl(activePid, token);
      setRealized(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoadingRealized(false);
    }
  }, [activePid, token, tab]);

  useEffect(() => {
    loadRealized();
  }, [loadRealized]);

  const createPortfolio = async (e) => {
    e.preventDefault();
    if (!newPortfolioName.trim()) return;
    try {
      await api.createPortfolio({ name: newPortfolioName.trim() }, token);
      setNewPortfolioName("");
      setShowNewPortfolio(false);
      loadPortfolios();
    } catch (e) {
      setError(e.message);
    }
  };

  const deleteTransaction = async (txId) => {
    if (!window.confirm("¿Eliminar esta transacción?")) return;
    try {
      await api.deleteTransaction(activePid, txId, token);
      loadTransactions();
      loadPositions();
      if (tab === "realized") loadRealized();
    } catch (e) {
      setError(e.message);
    }
  };

  const activePortfolio = portfolios.find((p) => p.id === activePid);
  const pos = positions?.positions ?? [];

  // ── Lógica de Filtrado y Paginación (Historial) ──
  const filteredTx = transactions.filter(t =>
    t.ticker.toLowerCase().includes(searchTx.toLowerCase())
  );
  const totalPagesTx = Math.ceil(filteredTx.length / ITEMS_PER_PAGE) || 1;
  const paginatedTx = filteredTx.slice((pageTx - 1) * ITEMS_PER_PAGE, pageTx * ITEMS_PER_PAGE);

  // ── Lógica de Filtrado y Paginación (Resultados) ──
  const resList = realized?.realized ?? [];
  const filteredRes = resList.filter(r =>
    r.ticker.toLowerCase().includes(searchRes.toLowerCase())
  );
  const totalPagesRes = Math.ceil(filteredRes.length / ITEMS_PER_PAGE) || 1;
  const paginatedRes = filteredRes.slice((pageRes - 1) * ITEMS_PER_PAGE, pageRes * ITEMS_PER_PAGE);

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      {/* Topbar */}
      <header className="sticky top-0 z-30 bg-gray-950/90 backdrop-blur-xl border-b border-gray-800/60">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center">
              <BarChart2 size={14} className="text-gray-900" />
            </div>
            <span className="font-bold text-white text-base">Portfolio AR</span>
          </div>

          <div className="flex items-center gap-2 flex-1 max-w-sm">
            <div className="relative flex-1">
              <select
                value={activePid || ""}
                onChange={(e) => setActivePid(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-sm text-white appearance-none pr-8 focus:outline-none focus:border-amber-500/60"
              >
                {portfolios.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <ChevronDown
                size={13}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
              />
            </div>
            <button
              onClick={() => setShowNewPortfolio((v) => !v)}
              className="p-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-xl text-gray-400 hover:text-white transition-all"
              title="Nuevo portfolio"
            >
              <Plus size={15} />
            </button>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500 hidden sm:block">
              {user?.full_name || user?.email}
            </span>
            <button
              onClick={logout}
              className="p-2 text-gray-500 hover:text-gray-300 transition-colors"
              title="Salir"
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>

        {showNewPortfolio && (
          <div className="border-t border-gray-800/60 bg-gray-900/80">
            <form
              onSubmit={createPortfolio}
              className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-3"
            >
              <input
                autoFocus
                value={newPortfolioName}
                onChange={(e) => setNewPortfolioName(e.target.value)}
                placeholder="Nombre del portfolio (ej: Principal, Jubilación…)"
                className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-amber-500/60"
              />
              <button
                type="submit"
                className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-gray-900 font-semibold rounded-lg text-sm"
              >
                Crear
              </button>
              <button
                type="button"
                onClick={() => setShowNewPortfolio(false)}
                className="text-gray-500 hover:text-gray-300"
              >
                <X size={16} />
              </button>
            </form>
          </div>
        )}
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6 space-y-5">
        {error && (
          <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-xl px-4 py-3">
            <AlertCircle size={15} />
            {error}
            <button
              onClick={() => setError(null)}
              className="ml-auto text-red-400/60 hover:text-red-400"
            >
              ✕
            </button>
          </div>
        )}

        {!loadingList && portfolios.length === 0 && (
          <div className="flex flex-col items-center justify-center py-24 gap-4">
            <div className="w-16 h-16 rounded-2xl bg-gray-800 border border-gray-700 flex items-center justify-center">
              <Briefcase size={28} className="text-gray-600" />
            </div>
            <p className="text-gray-400 text-center">
              No tenés portfolios todavía.
              <br />
              <button
                onClick={() => setShowNewPortfolio(true)}
                className="text-amber-400 hover:text-amber-300 font-medium"
              >
                Crear tu primer portfolio
              </button>
            </p>
          </div>
        )}

        {activePid && (
          <>
            {positions && (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <SummaryCard
                  label="Valor actual (ARS)"
                  value={ars(positions.total_value_ars)}
                  icon={<Wallet size={16} className="text-sky-400" />}
                  sub={`Invertido ${ars(positions.total_cost_ars)}`}
                />
                <SummaryCard
                  label="Ganancia / Pérdida ARS"
                  value={ars(positions.total_pnl_ars)}
                  icon={
                    positions.total_pnl_ars >= 0 ? (
                      <TrendingUp size={16} className="text-emerald-400" />
                    ) : (
                      <TrendingDown size={16} className="text-red-400" />
                    )
                  }
                  positive={positions.total_pnl_ars >= 0}
                  sub={pct(positions.total_pnl_pct)}
                />
                <SummaryCard
                  label="Valor actual (USD MEP)"
                  value={usd(positions.total_value_usd)}
                  icon={<DollarSign size={16} className="text-amber-400" />}
                  sub={`Invertido ${usd(positions.total_cost_usd)}`}
                />
                <SummaryCard
                  label="Ganancia / Pérdida USD"
                  value={usd(positions.total_pnl_usd)}
                  icon={
                    positions.total_pnl_usd >= 0 ? (
                      <ArrowUpRight size={16} className="text-emerald-400" />
                    ) : (
                      <ArrowDownRight size={16} className="text-red-400" />
                    )
                  }
                  positive={positions.total_pnl_usd >= 0}
                  sub={
                    positions.current_mep
                      ? `MEP: $${Number(positions.current_mep).toFixed(0)}`
                      : ""
                  }
                />
              </div>
            )}

            {/* Tabs */}
            <div className="flex items-center justify-between">
              <div className="flex gap-1 bg-gray-900 p-1 rounded-xl border border-gray-800">
                {[
                  ["positions", "Posiciones"],
                  ["transactions", "Historial"],
                  ["realized", "Resultados"],
                ].map(([k, l]) => (
                  <button
                    key={k}
                    onClick={() => setTab(k)}
                    className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all
                      ${tab === k ? "bg-gray-700 text-white" : "text-gray-400 hover:text-gray-200"}`}
                  >
                    {l}
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    loadPositions();
                    loadTransactions();
                    if (tab === "realized") loadRealized();
                  }}
                  className="p-2 text-gray-500 hover:text-gray-300 transition-colors"
                  title="Actualizar"
                >
                  <RefreshCw
                    size={16}
                    className={loadingPos || loadingTx || loadingRealized ? "animate-spin" : ""}
                  />
                </button>
                <button
                  onClick={() => setShowAddTx(true)}
                  className="flex items-center gap-2 px-4 py-2 bg-amber-500 hover:bg-amber-400 text-gray-900 font-semibold rounded-xl text-sm transition-all shadow-lg shadow-amber-500/20"
                >
                  <Plus size={16} /> Nueva operación
                </button>
              </div>
            </div>

            {/* ══ POSITIONS TAB ══ */}
            {tab === "positions" && (
              <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
                {loadingPos ? (
                  <div className="flex items-center justify-center py-20 gap-3 text-gray-500">
                    <Loader2 size={20} className="animate-spin" />
                    <span className="text-sm">Obteniendo precios…</span>
                  </div>
                ) : pos.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-20 gap-3 text-gray-500">
                    <BarChart2 size={36} className="opacity-20" />
                    <p className="text-sm">
                      Sin posiciones abiertas. Registrá una operación.
                    </p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead className="bg-gray-800/60 border-b border-gray-700/60">
                        <tr className="text-[11px] uppercase tracking-widest text-gray-500">
                          <th className="px-4 py-3 w-[20%]">Activo</th>
                          <th className="px-3 py-3 text-right">Nominales</th>
                          <th className="px-3 py-3 text-right">PPC (ARS)</th>
                          <th className="px-3 py-3 text-right">PPC (USD)</th>
                          <th className="px-3 py-3 text-right">Precio actual</th>
                          <th className="px-3 py-3 text-right">Valor ARS</th>
                          <th className="px-3 py-3 text-right text-amber-400/70">Valor USD</th>
                          <th className="px-3 py-3 text-right">Resultado ARS</th>
                          <th className="px-3 py-3 text-right text-amber-400/70">Resultado USD</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-800/60">
                        {pos.map((p) => (
                          <tr
                            key={p.ticker}
                            className="hover:bg-gray-800/30 transition-colors"
                          >
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-3">
                                <Logo ticker={p.ticker} />
                                <div>
                                  <p className="font-mono text-xs font-bold text-sky-400 leading-none mb-1">
                                    {p.ticker}
                                  </p>
                                  <AssetBadge type={p.asset_type} />
                                </div>
                              </div>
                            </td>
                            <td className="px-3 py-3 text-right font-mono text-sm text-gray-200">
                              {qty(p.quantity)}
                            </td>
                            <td className="px-3 py-3 text-right font-mono text-sm text-gray-300">
                              {ars(p.ppc_ars)}
                            </td>
                            <td className="px-3 py-3 text-right font-mono text-sm text-amber-400/80">
                              {p.ppc_usd ? usd(p.ppc_usd, 4) : "—"}
                            </td>
                            <td className="px-3 py-3 text-right font-mono text-sm text-white font-semibold">
                              {ars(p.current_price_ars)}
                            </td>
                            <td className="px-3 py-3 text-right font-mono text-sm text-gray-200">
                              {ars(p.current_value_ars)}
                            </td>
                            <td className="px-3 py-3 text-right font-mono text-sm text-amber-400">
                              {usd(p.current_value_usd)}
                            </td>
                            <td className="px-3 py-3">
                              <PnlCell value={p.pnl_ars} pct={p.pnl_pct} />
                            </td>
                            <td className="px-3 py-3">
                              {p.pnl_usd != null ? (
                                <div
                                  className={`text-right ${p.pnl_usd >= 0 ? "text-emerald-400" : "text-red-400"}`}
                                >
                                  <p className="font-mono text-sm font-semibold">
                                    {usd(p.pnl_usd)}
                                  </p>
                                  <p className="text-[10px] font-bold">
                                    {pct(p.pnl_pct_usd)}
                                  </p>
                                </div>
                              ) : (
                                <p className="text-right text-gray-600 text-xs">
                                  sin MEP
                                </p>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* ══ TRANSACTIONS TAB ══ */}
            {tab === "transactions" && (
              <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
                
                {/* Buscador Historial */}
                <div className="p-4 border-b border-gray-800/60 flex items-center gap-3">
                  <Search size={18} className="text-gray-500" />
                  <input
                    type="text"
                    placeholder="Buscar ticker (ej: GGAL)..."
                    value={searchTx}
                    onChange={(e) => setSearchTx(e.target.value)}
                    className="bg-transparent border-none text-sm text-white focus:outline-none w-full placeholder-gray-600"
                  />
                </div>

                {loadingTx ? (
                  <div className="flex items-center justify-center py-16">
                    <Loader2 size={20} className="animate-spin text-gray-500" />
                  </div>
                ) : paginatedTx.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-gray-500">
                    <p className="text-sm">
                      {searchTx !== ""
                        ? "No existen resultados para su búsqueda"
                        : "Sin operaciones registradas."}
                    </p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead className="bg-gray-800/60 border-b border-gray-700/60">
                        <tr className="text-[11px] uppercase tracking-widest text-gray-500">
                          <th className="px-4 py-3">Fecha</th>
                          <th className="px-3 py-3">Tipo</th>
                          <th className="px-3 py-3">Ticker</th>
                          <th className="px-3 py-3 text-right">Nominales</th>
                          <th className="px-3 py-3 text-right">Precio unit.</th>
                          <th className="px-3 py-3 text-right">Total ARS</th>
                          <th className="px-3 py-3 text-right">MEP</th>
                          <th className="px-3 py-3 text-right">Total USD</th>
                          <th className="px-3 py-3 text-right">Notas</th>
                          <th className="px-2 py-3"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-800/60">
                        {paginatedTx.map((t) => {
                          const totalArs = t.quantity * t.unit_price_ars;
                          const totalUsd = t.mep_rate
                            ? totalArs / t.mep_rate
                            : null;
                          const isBuy = t.transaction_type === "COMPRA";
                          return (
                            <tr
                              key={t.id}
                              className="hover:bg-gray-800/30 transition-colors text-sm"
                            >
                              <td className="px-4 py-3 font-mono text-xs text-gray-400">
                                {new Date(t.transaction_date).toLocaleDateString("es-AR")}
                              </td>
                              <td className="px-3 py-3">
                                <span
                                  className={`text-[10px] font-bold px-2 py-0.5 rounded border
                                  ${
                                    isBuy
                                      ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/25"
                                      : "bg-red-500/10 text-red-400 border-red-500/25"
                                  }`}
                                >
                                  {t.transaction_type}
                                </span>
                              </td>
                              <td className="px-3 py-3 font-mono text-xs font-bold text-sky-400">
                                {t.ticker}
                              </td>
                              <td className="px-3 py-3 text-right font-mono text-gray-300">
                                {qty(t.quantity)}
                              </td>
                              <td className="px-3 py-3 text-right font-mono text-gray-300">
                                {ars(t.unit_price_ars)}
                              </td>
                              <td className="px-3 py-3 text-right font-mono font-semibold text-white">
                                {ars(totalArs)}
                              </td>
                              <td className="px-3 py-3 text-right font-mono text-gray-400 text-xs">
                                {t.mep_rate
                                  ? `$${Number(t.mep_rate).toFixed(0)}`
                                  : "—"}
                              </td>
                              <td className="px-3 py-3 text-right font-mono text-amber-400 text-xs">
                                {usd(totalUsd)}
                              </td>
                              <td className="px-3 py-3 text-right text-xs text-gray-500 max-w-[120px] truncate">
                                {t.notes || "—"}
                              </td>
                              <td className="px-2 py-3">
                                <button
                                  onClick={() => deleteTransaction(t.id)}
                                  className="text-gray-600 hover:text-red-400 transition-colors p-1"
                                  title="Eliminar"
                                >
                                  <Trash2 size={14} />
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Controles de Paginación Historial */}
                {totalPagesTx > 1 && (
                  <div className="flex items-center justify-between px-4 py-3 border-t border-gray-800/60 bg-gray-900/50">
                    <button
                      onClick={() => setPageTx(p => Math.max(1, p - 1))}
                      disabled={pageTx === 1}
                      className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-gray-400 bg-gray-800 rounded-lg hover:text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      <ChevronLeft size={14} /> Anterior
                    </button>
                    <span className="text-xs text-gray-500 font-medium">
                      Página {pageTx} de {totalPagesTx}
                    </span>
                    <button
                      onClick={() => setPageTx(p => Math.min(totalPagesTx, p + 1))}
                      disabled={pageTx === totalPagesTx}
                      className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-gray-400 bg-gray-800 rounded-lg hover:text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      Siguiente <ChevronRight size={14} />
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* ══ REALIZED TAB ══ */}
            {tab === "realized" && (
              <div className="space-y-4">
                {/* Totals */}
                {realized && (
                  <div className="grid grid-cols-2 gap-4">
                    <SummaryCard
                      label="Resultado realizado ARS"
                      value={ars(realized.total_pnl_ars)}
                      icon={<Receipt size={16} className="text-sky-400" />}
                      positive={realized.total_pnl_ars >= 0}
                    />
                    <SummaryCard
                      label="Resultado realizado USD"
                      value={usd(realized.total_pnl_usd)}
                      icon={<Receipt size={16} className="text-amber-400" />}
                      positive={realized.total_pnl_usd >= 0}
                    />
                  </div>
                )}

                <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
                  
                  {/* Buscador Resultados */}
                  <div className="p-4 border-b border-gray-800/60 flex items-center gap-3">
                    <Search size={18} className="text-gray-500" />
                    <input
                      type="text"
                      placeholder="Buscar ticker (ej: GGAL)..."
                      value={searchRes}
                      onChange={(e) => setSearchRes(e.target.value)}
                      className="bg-transparent border-none text-sm text-white focus:outline-none w-full placeholder-gray-600"
                    />
                  </div>

                  {loadingRealized ? (
                    <div className="flex items-center justify-center py-20 gap-3 text-gray-500">
                      <Loader2 size={20} className="animate-spin" />
                      <span className="text-sm">Calculando resultados…</span>
                    </div>
                  ) : paginatedRes.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-20 gap-3 text-gray-500">
                      <Receipt size={36} className="opacity-20" />
                      <p className="text-sm">
                        {searchRes !== ""
                          ? "No existen resultados para su búsqueda"
                          : "Sin operaciones cerradas todavía."}
                      </p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse">
                        <thead className="bg-gray-800/60 border-b border-gray-700/60">
                          <tr className="text-[11px] uppercase tracking-widest text-gray-500">
                            <th className="px-4 py-3">Activo</th>
                            <th className="px-3 py-3 text-right">Cant.</th>
                            <th className="px-3 py-3">F. Compra</th>
                            <th className="px-3 py-3 text-right">P. Compra ARS</th>
                            <th className="px-3 py-3 text-right text-amber-400/70">P. Compra USD</th>
                            <th className="px-3 py-3">F. Venta</th>
                            <th className="px-3 py-3 text-right">P. Venta ARS</th>
                            <th className="px-3 py-3 text-right text-amber-400/70">P. Venta USD</th>
                            <th className="px-3 py-3 text-right">Total compra</th>
                            <th className="px-3 py-3 text-right">Total venta</th>
                            <th className="px-3 py-3 text-right">Resultado ARS</th>
                            <th className="px-3 py-3 text-right text-amber-400/70">Resultado USD</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-800/60">
                          {paginatedRes.map((r, i) => (
                            <tr
                              key={i}
                              className="hover:bg-gray-800/30 transition-colors text-sm"
                            >
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-2">
                                  <Logo ticker={r.ticker} />
                                  <div>
                                    <p className="font-mono text-xs font-bold text-sky-400">
                                      {r.ticker}
                                    </p>
                                    <AssetBadge type={r.asset_type} />
                                  </div>
                                </div>
                              </td>
                              <td className="px-3 py-3 text-right font-mono text-sm text-gray-300">
                                {qty(r.quantity)}
                              </td>
                              <td className="px-3 py-3 font-mono text-xs text-gray-400">
                                {new Date(r.buy_date).toLocaleDateString("es-AR")}
                                {r.buy_mep && (
                                  <div className="text-[10px] text-gray-600">
                                    MEP ${r.buy_mep}
                                  </div>
                                )}
                              </td>
                              <td className="px-3 py-3 text-right font-mono text-sm text-gray-300">
                                {ars(r.buy_price_ars)}
                              </td>
                              <td className="px-3 py-3 text-right font-mono text-sm text-amber-400/70">
                                {r.buy_price_usd
                                  ? usd(r.buy_price_usd, 4)
                                  : "—"}
                              </td>
                              <td className="px-3 py-3 font-mono text-xs text-gray-400">
                                {new Date(r.sell_date).toLocaleDateString("es-AR")}
                                {r.sell_mep && (
                                  <div className="text-[10px] text-gray-600">
                                    MEP ${r.sell_mep}
                                  </div>
                                )}
                              </td>
                              <td className="px-3 py-3 text-right font-mono text-sm text-gray-300">
                                {ars(r.sell_price_ars)}
                              </td>
                              <td className="px-3 py-3 text-right font-mono text-sm text-amber-400/70">
                                {r.sell_price_usd
                                  ? usd(r.sell_price_usd, 4)
                                  : "—"}
                              </td>
                              <td className="px-3 py-3 text-right font-mono text-xs text-gray-400">
                                {ars(r.total_buy_ars)}
                              </td>
                              <td className="px-3 py-3 text-right font-mono text-xs text-gray-400">
                                {ars(r.total_sell_ars)}
                              </td>
                              <td className="px-3 py-3">
                                <div
                                  className={`text-right ${r.pnl_ars >= 0 ? "text-emerald-400" : "text-red-400"}`}
                                >
                                  <p className="font-mono text-sm font-semibold">
                                    {ars(r.pnl_ars)}
                                  </p>
                                  <p className="text-[10px] font-bold">
                                    {pct(r.pnl_pct_ars)}
                                  </p>
                                </div>
                              </td>
                              <td className="px-3 py-3">
                                {r.pnl_usd != null ? (
                                  <div
                                    className={`text-right ${r.pnl_usd >= 0 ? "text-emerald-400" : "text-red-400"}`}
                                  >
                                    <p className="font-mono text-sm font-semibold">
                                      {usd(r.pnl_usd)}
                                    </p>
                                    <p className="text-[10px] font-bold">
                                      {pct(r.pnl_pct_usd)}
                                    </p>
                                  </div>
                                ) : (
                                  <p className="text-right text-gray-600 text-xs">
                                    sin MEP
                                  </p>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* Controles de Paginación Resultados */}
                  {totalPagesRes > 1 && (
                    <div className="flex items-center justify-between px-4 py-3 border-t border-gray-800/60 bg-gray-900/50">
                      <button
                        onClick={() => setPageRes(p => Math.max(1, p - 1))}
                        disabled={pageRes === 1}
                        className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-gray-400 bg-gray-800 rounded-lg hover:text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        <ChevronLeft size={14} /> Anterior
                      </button>
                      <span className="text-xs text-gray-500 font-medium">
                        Página {pageRes} de {totalPagesRes}
                      </span>
                      <button
                        onClick={() => setPageRes(p => Math.min(totalPagesRes, p + 1))}
                        disabled={pageRes === totalPagesRes}
                        className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-gray-400 bg-gray-800 rounded-lg hover:text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        Siguiente <ChevronRight size={14} />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </main>

      <footer className="border-t border-gray-800/40 mt-16 py-5 text-center">
        <p className="text-gray-600 text-xs">
          Datos via Yahoo Finance · Solo fines informativos · No constituye
          asesoramiento financiero
        </p>
      </footer>

      {showAddTx && (
        <AddTransaction
          portfolioId={activePid}
          token={token}
          onClose={() => setShowAddTx(false)}
          onSuccess={() => {
            loadPositions();
            loadTransactions();
            if (tab === "realized") loadRealized();
          }}
        />
      )}
    </div>
  );
}

function SummaryCard({ label, value, icon, sub, positive }) {
  const valueColor =
    positive === true
      ? "text-emerald-400"
      : positive === false
        ? "text-red-400"
        : "text-white";
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl px-5 py-4">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs text-gray-500 font-medium">{label}</p>
        <div className="p-1.5 bg-gray-800 rounded-lg">{icon}</div>
      </div>
      <p className={`font-mono font-bold text-lg ${valueColor}`}>{value}</p>
      {sub && <p className="text-xs text-gray-500 mt-0.5 font-mono">{sub}</p>}
    </div>
  );
}