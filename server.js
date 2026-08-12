'use strict'

const http = require('http')
const fs = require('fs')
const path = require('path')

const PORT = Number(process.env.PORT) || 3000
const ROOT_DIR = __dirname
const DATA_DIR = path.join(ROOT_DIR, 'data')
const DATA_FILE = path.join(DATA_DIR, 'players.json')

const DEFAULT_STORE = {
  nextId: 1,
  gameResults: [],
  leaderboard: [],
  recentPlayerIds: [],
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
}

function readStore() {
  if (!fs.existsSync(DATA_FILE)) {
    writeStore({ ...DEFAULT_STORE })
    return { ...DEFAULT_STORE }
  }

  const raw = fs.readFileSync(DATA_FILE, 'utf8')
  const parsed = JSON.parse(raw)
  return {
    nextId: parsed.nextId ?? 1,
    gameResults: Array.isArray(parsed.gameResults) ? parsed.gameResults : [],
    leaderboard: Array.isArray(parsed.leaderboard) ? parsed.leaderboard : [],
    recentPlayerIds: Array.isArray(parsed.recentPlayerIds) ? parsed.recentPlayerIds : [],
  }
}

function writeStore(store) {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  fs.writeFileSync(DATA_FILE, `${JSON.stringify(store, null, 2)}\n`, 'utf8')
}

function rebuildLeaderboard(gameResults) {
  return [...gameResults]
    .sort((a, b) => b.score - a.score || b.correctCount - a.correctCount || a.completedAt - b.completedAt)
    .slice(0, 3)
}

function addToRecentPlayerIds(recentPlayerIds, recordId) {
  return [recordId, ...recentPlayerIds.filter((id) => id !== recordId)].slice(0, 50)
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  })
  response.end(JSON.stringify(payload))
}

function sendError(response, statusCode, message) {
  sendJson(response, statusCode, { error: message })
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = ''
    request.on('data', (chunk) => {
      body += chunk
      if (body.length > 1_000_000) {
        reject(new Error('Request body too large'))
        request.destroy()
      }
    })
    request.on('end', () => {
      if (!body) {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(body))
      } catch (_) {
        reject(new Error('Invalid JSON body'))
      }
    })
    request.on('error', reject)
  })
}

function serveStatic(request, response) {
  const requestPath = decodeURIComponent(new URL(request.url, `http://${request.headers.host}`).pathname)
  const safePath = path.normalize(requestPath).replace(/^(\.\.[/\\])+/, '')
  let filePath = path.join(ROOT_DIR, safePath === path.sep ? 'index.html' : safePath)

  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, 'index.html')
  }

  if (!filePath.startsWith(ROOT_DIR) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    sendError(response, 404, 'Not found')
    return
  }

  const extension = path.extname(filePath).toLowerCase()
  response.writeHead(200, {
    'Content-Type': MIME_TYPES[extension] || 'application/octet-stream',
    'Cache-Control': extension === '.html' ? 'no-store' : 'public, max-age=3600',
  })
  fs.createReadStream(filePath).pipe(response)
}

async function handleApi(request, response, url) {
  const method = request.method || 'GET'

  if (url.pathname === '/api/records' && method === 'GET') {
    const store = readStore()
    const records = [...store.gameResults].sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0))
    sendJson(response, 200, { records })
    return
  }

  if (url.pathname === '/api/records' && method === 'POST') {
    const payload = await readJsonBody(request)
    const store = readStore()
    const record = {
      id: store.nextId,
      name: String(payload.name || '').trim(),
      mobile: String(payload.mobile || '').trim(),
      company: String(payload.company || '').trim(),
      topic: String(payload.topic || payload.topicLabel || 'Not recorded').trim() || 'Not recorded',
      topicLabel: String(payload.topicLabel || payload.topic || 'Not recorded').trim() || 'Not recorded',
      topicId: payload.topicId ?? null,
      score: Number(payload.score) || 0,
      correctCount: Number(payload.correctCount) || 0,
      answeredCount: Number(payload.answeredCount) || 0,
      completedAt: Number(payload.completedAt) || Date.now(),
    }

    if (!record.name || !record.mobile || !record.company) {
      sendError(response, 400, 'Name, mobile, and company are required.')
      return
    }

    store.gameResults.push(record)
    store.nextId += 1
    store.recentPlayerIds = addToRecentPlayerIds(store.recentPlayerIds, record.id)
    store.leaderboard = rebuildLeaderboard(store.gameResults)
    writeStore(store)

    sendJson(response, 201, { record, leaderboard: store.leaderboard })
    return
  }

  const recordMatch = url.pathname.match(/^\/api\/records\/(\d+)$/)
  if (recordMatch && method === 'PUT') {
    const recordId = Number(recordMatch[1])
    const payload = await readJsonBody(request)
    const store = readStore()
    const index = store.gameResults.findIndex((entry) => entry.id === recordId)

    if (index < 0) {
      sendError(response, 404, 'Record not found.')
      return
    }

    const updated = {
      ...store.gameResults[index],
      name: String(payload.name || '').trim(),
      mobile: String(payload.mobile || '').trim(),
      company: String(payload.company || '').trim(),
      topic: String(payload.topic || payload.topicLabel || 'Not recorded').trim() || 'Not recorded',
      topicLabel: String(payload.topicLabel || payload.topic || 'Not recorded').trim() || 'Not recorded',
      score: Number(payload.score),
      correctCount: Number(payload.correctCount),
      answeredCount: Number(payload.answeredCount),
      completedAt: Number(payload.completedAt),
    }

    if (!updated.name || !updated.mobile || !updated.company) {
      sendError(response, 400, 'Name, mobile, and company are required.')
      return
    }
    if (Number.isNaN(updated.score) || Number.isNaN(updated.correctCount) || Number.isNaN(updated.answeredCount) || Number.isNaN(updated.completedAt)) {
      sendError(response, 400, 'Score fields must be valid numbers.')
      return
    }
    if (updated.correctCount > updated.answeredCount) {
      sendError(response, 400, 'Correct answers cannot exceed total answered.')
      return
    }

    store.gameResults[index] = updated
    store.leaderboard = rebuildLeaderboard(store.gameResults)
    writeStore(store)
    sendJson(response, 200, { record: updated, leaderboard: store.leaderboard })
    return
  }

  if (recordMatch && method === 'DELETE') {
    const recordId = Number(recordMatch[1])
    const store = readStore()
    const nextResults = store.gameResults.filter((entry) => entry.id !== recordId)

    if (nextResults.length === store.gameResults.length) {
      sendError(response, 404, 'Record not found.')
      return
    }

    store.gameResults = nextResults
    store.recentPlayerIds = store.recentPlayerIds.filter((id) => id !== recordId)
    store.leaderboard = rebuildLeaderboard(store.gameResults)
    writeStore(store)
    sendJson(response, 200, { ok: true, leaderboard: store.leaderboard })
    return
  }

  if (url.pathname === '/api/leaderboard' && method === 'GET') {
    const store = readStore()
    sendJson(response, 200, { entries: store.leaderboard })
    return
  }

  if (url.pathname === '/api/leaderboard' && method === 'PUT') {
    const payload = await readJsonBody(request)
    const store = readStore()
    store.leaderboard = Array.isArray(payload.entries) ? payload.entries : []
    writeStore(store)
    sendJson(response, 200, { entries: store.leaderboard })
    return
  }

  if (url.pathname === '/api/recent' && method === 'GET') {
    const store = readStore()
    sendJson(response, 200, { entries: store.recentPlayerIds })
    return
  }

  if (url.pathname === '/api/recent' && method === 'DELETE') {
    const store = readStore()
    store.recentPlayerIds = []
    writeStore(store)
    sendJson(response, 200, { entries: [] })
    return
  }

  sendError(response, 404, 'API route not found.')
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`)

  try {
    if (url.pathname.startsWith('/api/')) {
      await handleApi(request, response, url)
      return
    }
    serveStatic(request, response)
  } catch (error) {
    sendError(response, 500, error instanceof Error ? error.message : 'Internal server error')
  }
})

server.listen(PORT, () => {
  console.log(`Cloudera Quiz Wheel running at http://localhost:${PORT}`)
  console.log(`Player data file: ${DATA_FILE}`)
})
