// src/components/AddTransaction.jsx
import { useState, useEffect } from 'react'
import { X, Loader2, AlertCircle, TrendingUp, TrendingDown } from 'lucide-react'
import { api } from '../utils/api'

const ASSET_TYPES = ['ACCION', 'CEDEAR', 'BONO', 'FCI', 'OTRO']

const today = () => new Date().toISOString().split('T')[0]

export default function AddTransaction({ portfolioId, token, onClose, onSuccess }) {
  const [form, setForm] = useState({
    ticker:           '',
    asset_type:       'ACCION',
    transaction_type: 'COMPRA',
    transaction_date: today(),
    quantity:         '',
    unit_price_ars:   '',
    mep_rate:         '',
    notes:            '',
  })
  const [loading,     setLoading]     = useState(false)
  const [error,       setError]       = useState(null)
  const [fetchingMep, setFetchingMep] = useState(false)
  const [mepAuto,     setMepAuto]     = useState(null)

  // Auto-fetch MEP on mount
  useEffect(() => {
    setFetchingMep(true)
    api.getMep(token)
      .then(d => {
        setMepAuto(d.mep)
        setForm(p => ({ ...p, mep_rate: d.mep.toFixed(2) }))
      })
      .catch(() => {})
      .finally(() => setFetchingMep(false))
  }, [token])

  const set = (k) => (e) => {
    const v = e.target ? e.target.value : e
    setForm(p => ({ ...p, [k]: v }))
  }

  // Derived: total ARS
  const totalArs  = (parseFloat(form.quantity) || 0) * (parseFloat(form.unit_price_ars) || 0)
  const mep       = parseFloat(form.mep_rate) || null
  const totalUsd  = mep ? totalArs / mep : null

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await api.addTransaction(portfolioId, {
        ticker:           form.ticker.trim().toUpperCase(),
        asset_type:       form.asset_type,
        transaction_type: form.transaction_type,
        transaction_date: form.transaction_date,
        quantity:         parseFloat(form.quantity),
        unit_price_ars:   parseFloat(form.unit_price_ars),
        mep_rate:         form.mep_rate ? parseFloat(form.mep_rate) : null,
        notes:            form.notes || null,
      }, token)
      onSuccess?.()
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const isBuy = form.transaction_type === 'COMPRA'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-lg shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-lg ${isBuy ? 'bg-emerald-500/10' : 'bg-red-500/10'}`}>
              {isBuy
                ? <TrendingUp size={18} className="text-emerald-400" />
                : <TrendingDown size={18} className="text-red-400" />}
            </div>
            <h2 className="text-white font-semibold">Nueva Operación</h2>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 transition-colors">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">

          {/* BUY / SELL toggle */}
          <div className="flex rounded-xl overflow-hidden border border-gray-700 text-sm font-semibold">
            {['COMPRA','VENTA'].map(t => (
              <button
                key={t} type="button"
                onClick={() => setForm(p => ({...p, transaction_type: t}))}
                className={`flex-1 py-2.5 transition-all
                  ${form.transaction_type === t
                    ? t === 'COMPRA'
                      ? 'bg-emerald-500/20 text-emerald-400 border-b-2 border-emerald-400'
                      : 'bg-red-500/20 text-red-400 border-b-2 border-red-400'
                    : 'text-gray-400 hover:text-gray-200 bg-gray-800'}`}
              >
                {t === 'COMPRA' ? '▲ Compra' : '▼ Venta'}
              </button>
            ))}
          </div>

          {/* Row: Ticker + Asset type */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1.5 font-medium">Ticker</label>
              <input
                required value={form.ticker} onChange={set('ticker')}
                placeholder="GGAL, AAPL, AL30..."
                className="input-base uppercase"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1.5 font-medium">Tipo de activo</label>
              <select value={form.asset_type} onChange={set('asset_type')} className="input-base">
                {ASSET_TYPES.map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
          </div>

          {/* Row: Date */}
          <div>
            <label className="block text-xs text-gray-400 mb-1.5 font-medium">Fecha de operación</label>
            <input
              type="date" required value={form.transaction_date}
              onChange={set('transaction_date')}
              className="input-base"
            />
          </div>

          {/* Row: Quantity + Price */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1.5 font-medium">Nominales / Cantidad</label>
              <input
                type="number" required min="0.000001" step="any"
                value={form.quantity} onChange={set('quantity')}
                placeholder="100"
                className="input-base"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1.5 font-medium">Precio unitario (ARS)</label>
              <input
                type="number" required min="0.0001" step="any"
                value={form.unit_price_ars} onChange={set('unit_price_ars')}
                placeholder="5000.00"
                className="input-base"
              />
            </div>
          </div>

          {/* MEP rate */}
          <div>
            <label className="block text-xs text-gray-400 mb-1.5 font-medium">
              Dólar MEP al momento
              {fetchingMep && <span className="ml-2 text-amber-400 text-[10px]">obteniendo…</span>}
              {mepAuto && !fetchingMep && <span className="ml-2 text-emerald-400/60 text-[10px]">auto: ${mepAuto.toFixed(2)}</span>}
            </label>
            <input
              type="number" min="1" step="any"
              value={form.mep_rate} onChange={set('mep_rate')}
              placeholder="1250.00"
              className="input-base"
            />
            <p className="text-[10px] text-gray-600 mt-1">Se usa para calcular el resultado en dólares. Autocompletado desde dolarapi.com.</p>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs text-gray-400 mb-1.5 font-medium">Notas (opcional)</label>
            <input
              type="text" value={form.notes} onChange={set('notes')}
              placeholder="Ej: Rebalanceo Q1"
              className="input-base"
            />
          </div>

          {/* Summary */}
          {totalArs > 0 && (
            <div className="bg-gray-800/60 rounded-xl px-4 py-3 text-sm flex justify-between items-center border border-gray-700/60">
              <div>
                <p className="text-gray-400 text-xs">Total operación</p>
                <p className="text-white font-bold font-mono">
                  $ {totalArs.toLocaleString('es-AR', {minimumFractionDigits:2, maximumFractionDigits:2})}
                </p>
              </div>
              {totalUsd && (
                <div className="text-right">
                  <p className="text-gray-400 text-xs">en USD MEP</p>
                  <p className="text-amber-400 font-bold font-mono">
                    u$s {totalUsd.toLocaleString('es-AR', {minimumFractionDigits:2, maximumFractionDigits:2})}
                  </p>
                </div>
              )}
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-lg px-3 py-2.5">
              <AlertCircle size={14} />
              {error}
            </div>
          )}

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 py-2.5 rounded-xl border border-gray-700 text-gray-400 hover:text-gray-200 text-sm transition-colors">
              Cancelar
            </button>
            <button type="submit" disabled={loading}
              className={`flex-1 py-2.5 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2 disabled:opacity-50
                ${isBuy
                  ? 'bg-emerald-500 hover:bg-emerald-400 text-gray-900'
                  : 'bg-red-500 hover:bg-red-400 text-white'}`}
            >
              {loading && <Loader2 size={15} className="animate-spin" />}
              Registrar {form.transaction_type === 'COMPRA' ? 'Compra' : 'Venta'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
