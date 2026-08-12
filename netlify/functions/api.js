'use strict'

const { handleApiRequest, normalizeApiPath } = require('../../lib/api-handlers')

const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
}

exports.handler = async (event) => {
  const pathname = normalizeApiPath(event.path)

  try {
    const result = await handleApiRequest({
      method: event.httpMethod,
      pathname,
      body: event.body,
    })

    return {
      statusCode: result.statusCode,
      headers: JSON_HEADERS,
      body: JSON.stringify(result.body),
    }
  } catch (error) {
    const statusCode = error.statusCode || 500
    if (statusCode >= 500) {
      console.error(`[api] ${pathname}:`, error.message)
    }

    return {
      statusCode,
      headers: JSON_HEADERS,
      body: JSON.stringify({
        error: error instanceof Error ? error.message : 'Internal server error',
      }),
    }
  }
}
