// src/utils/api.js
const BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000'

async function request(method, path, body, token) {
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })

  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.detail || `Error ${res.status}`)
  return data
}

export const api = {
  // Auth
  register: (body)          => request('POST', '/api/auth/register', body),
  login:    (body)          => request('POST', '/api/auth/login',    body),
  me:       (token)         => request('GET',  '/api/auth/me', null, token),

  // Portfolios
  getPortfolios:    (token)        => request('GET',    '/api/portfolios',      null, token),
  createPortfolio:  (body, token)  => request('POST',   '/api/portfolios',      body, token),
  updatePortfolio:  (id, body, t)  => request('PUT',    `/api/portfolios/${id}`, body, t),
  deletePortfolio:  (id, token)    => request('DELETE', `/api/portfolios/${id}`, null, token),

  // Transactions
  getTransactions:  (pid, token)   => request('GET',    `/api/portfolios/${pid}/transactions`, null, token),
  addTransaction:   (pid, body, t) => request('POST',   `/api/portfolios/${pid}/transactions`, body, t),
  deleteTransaction:(pid, tid, t)  => request('DELETE', `/api/portfolios/${pid}/transactions/${tid}`, null, t),

  // Positions
  getPositions: (pid, token) => request('GET', `/api/portfolios/${pid}/positions`, null, token),

  // Market
  getMep:   (token)    => request('GET', '/api/market/mep',           null, token),
  getPrice: (tk, token)=> request('GET', `/api/market/price/${tk}`,   null, token),
}
