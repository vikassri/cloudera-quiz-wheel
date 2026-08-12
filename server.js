'use strict'

require('dotenv').config()

const http = require('http')
const fs = require('fs')
const path = require('path')
const store = require('./lib/supabase-store')

const PORT = Number(process.env.PORT) || 3000
const ROOT_DIR = __dirname

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
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
    const records = await store.getAllRecords()
    sendJson(response, 200, { records })
    return
  }

  if (url.pathname === '/api/records' && method === 'POST') {
    const payload = await readJsonBody(request)
    const result = await store.createRecord(payload)
    sendJson(response, 201, result)
    return
  }

  const recordMatch = url.pathname.match(/^\/api\/records\/(\d+)$/)
  if (recordMatch && method === 'PUT') {
    const recordId = Number(recordMatch[1])
    const payload = await readJsonBody(request)
    const result = await store.updateRecord(recordId, payload)
    sendJson(response, 200, result)
    return
  }

  if (recordMatch && method === 'DELETE') {
    const recordId = Number(recordMatch[1])
    const result = await store.deleteRecord(recordId)
    sendJson(response, 200, result)
    return
  }

  if (url.pathname === '/api/leaderboard' && method === 'GET') {
    const entries = await store.getLeaderboard()
    sendJson(response, 200, { entries })
    return
  }

  if (url.pathname === '/api/leaderboard' && method === 'PUT') {
    const payload = await readJsonBody(request)
    const entries = await store.setLeaderboard(payload.entries)
    sendJson(response, 200, { entries })
    return
  }

  if (url.pathname === '/api/recent' && method === 'GET') {
    const entries = await store.getRecentPlayerIds()
    sendJson(response, 200, { entries })
    return
  }

  if (url.pathname === '/api/recent' && method === 'DELETE') {
    const entries = await store.clearRecentPlayerIds()
    sendJson(response, 200, { entries })
    return
  }

  if (url.pathname === '/api/health' && method === 'GET') {
    await store.verifyConnection()
    sendJson(response, 200, { ok: true, storage: 'supabase' })
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
    const statusCode = error.statusCode || 500
    if (statusCode >= 500) {
      console.error(`[api] ${url.pathname}:`, error.message)
    }
    sendError(response, statusCode, error instanceof Error ? error.message : 'Internal server error')
  }
})

async function startServer() {
  try {
    await store.verifyConnection()
    console.log('Supabase connected')
  } catch (error) {
    console.error('Supabase setup failed:', error.message)
    console.error('Fix .env and run supabase/schema.sql, then restart.')
    process.exit(1)
  }

  server.listen(PORT, () => {
    console.log(`Cloudera Quiz Wheel running at http://localhost:${PORT}`)
    console.log('Player data: Supabase')
  })
}

startServer()
