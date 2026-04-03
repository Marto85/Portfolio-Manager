// src/components/AuthPage.jsx
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../App'
import { api } from '../utils/api'
import { BarChart2, Loader2, AlertCircle } from 'lucide-react'

export default function AuthPage() {
  const { login } = useAuth()
  const navigate  = useNavigate()
  const [mode,    setMode]  = useState('login')   // 'login' | 'register'
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState(null)
  const [form,    setForm]    = useState({ email: '', password: '', full_name: '' })

  const set = (k) => (e) => setForm(p => ({ ...p, [k]: e.target.value }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const data = mode === 'login'
        ? await api.login({ email: form.email, password: form.password })
        : await api.register(form)
      login(data)
      navigate('/')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center px-4">
      <div className="w-full max-w-md">

        {/* Logo */}
        <div className="flex items-center justify-center gap-3 mb-8">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center shadow-lg shadow-amber-500/20">
            <BarChart2 size={20} className="text-gray-900" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white leading-none">Portfolio AR</h1>
            <p className="text-xs text-gray-500">Gestión de carteras · Argentina</p>
          </div>
        </div>

        {/* Card */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8 shadow-2xl">
          <h2 className="text-lg font-semibold text-white mb-6">
            {mode === 'login' ? 'Iniciar sesión' : 'Crear cuenta'}
          </h2>

          {error && (
            <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-lg px-4 py-3 mb-5">
              <AlertCircle size={15} />
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'register' && (
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1.5">Nombre completo</label>
                <input
                  type="text" value={form.full_name} onChange={set('full_name')}
                  placeholder="Juan Pérez"
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-amber-500/60 transition-colors"
                />
              </div>
            )}
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1.5">Email</label>
              <input
                type="email" value={form.email} onChange={set('email')} required
                placeholder="usuario@gmail.com"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-amber-500/60 transition-colors"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1.5">Contraseña</label>
              <input
                type="password" value={form.password} onChange={set('password')} required
                placeholder="••••••••"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-amber-500/60 transition-colors"
              />
            </div>
            <button
              type="submit" disabled={loading}
              className="w-full bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-gray-900 font-bold rounded-xl py-3 text-sm transition-all flex items-center justify-center gap-2 mt-2"
            >
              {loading ? <Loader2 size={16} className="animate-spin" /> : null}
              {mode === 'login' ? 'Ingresar' : 'Registrarme'}
            </button>
          </form>

          <p className="text-center text-xs text-gray-500 mt-5">
            {mode === 'login' ? '¿No tenés cuenta?' : '¿Ya tenés cuenta?'}{' '}
            <button
              onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(null) }}
              className="text-amber-400 hover:text-amber-300 font-medium transition-colors"
            >
              {mode === 'login' ? 'Registrarse' : 'Iniciar sesión'}
            </button>
          </p>
        </div>

        <p className="text-center text-xs text-gray-600 mt-5">
          Solo fines informativos · No constituye asesoramiento financiero
        </p>
      </div>
    </div>
  )
}
