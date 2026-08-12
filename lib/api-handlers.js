'use strict'

const store = require('./supabase-store')

function parseJsonBody(body) {
  if (!body) return {}
  try {
    return JSON.parse(body)
  } catch (_) {
    const error = new Error('Invalid JSON body')
    error.statusCode = 400
    throw error
  }
}

function normalizeApiPath(pathname) {
  if (!pathname) return '/api'
  if (pathname.startsWith('/api/') || pathname === '/api') return pathname
  if (pathname.startsWith('/.netlify/functions/api')) {
    const suffix = pathname.slice('/.netlify/functions/api'.length)
    return suffix ? `/api${suffix}` : '/api'
  }
  return pathname
}

async function handleApiRequest({ method = 'GET', pathname = '/api', body = '' } = {}) {
  const apiPath = normalizeApiPath(pathname)
  const httpMethod = method.toUpperCase()

  if (apiPath === '/api/records' && httpMethod === 'GET') {
    const records = await store.getAllRecords()
    return { statusCode: 200, body: { records } }
  }

  if (apiPath === '/api/records' && httpMethod === 'POST') {
    const payload = parseJsonBody(body)
    const result = await store.createRecord(payload)
    return { statusCode: 201, body: result }
  }

  const recordMatch = apiPath.match(/^\/api\/records\/(\d+)$/)
  if (recordMatch && httpMethod === 'PUT') {
    const recordId = Number(recordMatch[1])
    const payload = parseJsonBody(body)
    const result = await store.updateRecord(recordId, payload)
    return { statusCode: 200, body: result }
  }

  if (recordMatch && httpMethod === 'DELETE') {
    const recordId = Number(recordMatch[1])
    const result = await store.deleteRecord(recordId)
    return { statusCode: 200, body: result }
  }

  if (apiPath === '/api/leaderboard' && httpMethod === 'GET') {
    const entries = await store.getLeaderboard()
    return { statusCode: 200, body: { entries } }
  }

  if (apiPath === '/api/leaderboard' && httpMethod === 'PUT') {
    const payload = parseJsonBody(body)
    const entries = await store.setLeaderboard(payload.entries)
    return { statusCode: 200, body: { entries } }
  }

  if (apiPath === '/api/recent' && httpMethod === 'GET') {
    const entries = await store.getRecentPlayerIds()
    return { statusCode: 200, body: { entries } }
  }

  if (apiPath === '/api/recent' && httpMethod === 'DELETE') {
    const entries = await store.clearRecentPlayerIds()
    return { statusCode: 200, body: { entries } }
  }

  if (apiPath === '/api/health' && httpMethod === 'GET') {
    await store.verifyConnection()
    return { statusCode: 200, body: { ok: true, storage: 'supabase' } }
  }

  const error = new Error('API route not found.')
  error.statusCode = 404
  throw error
}

module.exports = {
  handleApiRequest,
  normalizeApiPath,
}
