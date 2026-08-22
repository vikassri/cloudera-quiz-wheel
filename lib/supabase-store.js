'use strict'

const { createClient } = require('@supabase/supabase-js')

const LEADERBOARD_KEY = 'leaderboard'
const RECENT_KEY = 'recent_player_ids'

let supabaseClient = null

function resolveSupabaseKey() {
  const key =
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    ''

  if (!key) {
    throw new Error(
      'Missing Supabase secret key. Set SUPABASE_SECRET_KEY (sb_secret_...) or SUPABASE_SERVICE_ROLE_KEY (legacy JWT) in .env'
    )
  }

  if (key.startsWith('sb_publishable_')) {
    throw new Error(
      'Wrong Supabase key: publishable keys cannot write data. In Dashboard → Settings → API Keys, copy the Secret key (sb_secret_...) or legacy service_role key into .env'
    )
  }

  const isValidSecret =
    key.startsWith('sb_secret_') ||
    key.startsWith('eyJ') // legacy service_role JWT

  if (!isValidSecret) {
    throw new Error(
      'Unrecognized Supabase key format. Use sb_secret_... or the legacy service_role JWT from Dashboard → Settings → API Keys'
    )
  }

  return key
}

function getSupabase() {
  if (supabaseClient) return supabaseClient

  const url = process.env.SUPABASE_URL
  const secretKey = resolveSupabaseKey()

  if (!url) {
    throw new Error('Missing SUPABASE_URL in environment')
  }

  supabaseClient = createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  return supabaseClient
}

function rowToRecord(row) {
  return {
    id: row.id,
    name: row.name,
    mobile: row.mobile,
    company: row.company,
    topic: row.topic,
    topicLabel: row.topic_label,
    topicId: row.topic_id,
    score: row.score,
    correctCount: row.correct_count,
    answeredCount: row.answered_count,
    completedAt: row.completed_at,
  }
}

function recordToRow(record) {
  return {
    name: record.name,
    mobile: record.mobile,
    company: record.company,
    topic: record.topic || record.topicLabel || 'Not recorded',
    topic_label: record.topicLabel || record.topic || 'Not recorded',
    topic_id: record.topicId ?? null,
    score: record.score,
    correct_count: record.correctCount,
    answered_count: record.answeredCount,
    completed_at: record.completedAt,
  }
}

function rebuildLeaderboard(records) {
  return [...records]
    .sort((a, b) => b.score - a.score || b.correctCount - a.correctCount || a.completedAt - b.completedAt)
    .slice(0, 3)
}

function getRecordsByIds(allRecords, ids) {
  const recordMap = new Map(allRecords.map((record) => [record.id, record]))
  return ids.map((id) => recordMap.get(id)).filter(Boolean)
}

function addToRecentPlayerIds(recentIds, recordId) {
  return [recordId, ...recentIds.filter((id) => id !== recordId)].slice(0, 50)
}

async function getMetadata(key) {
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('app_metadata')
    .select('value')
    .eq('key', key)
    .maybeSingle()

  if (error) throw error
  return data?.value ?? null
}

async function setMetadata(key, value) {
  const supabase = getSupabase()
  const { error } = await supabase
    .from('app_metadata')
    .upsert({ key, value, updated_at: new Date().toISOString() })

  if (error) throw error
}

async function getAllRecords() {
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('game_results')
    .select('*')
    .order('completed_at', { ascending: false })

  if (error) throw error
  return (data || []).map(rowToRecord)
}

async function getRecordById(id) {
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('game_results')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (error) throw error
  return data ? rowToRecord(data) : null
}

async function createRecord(payload) {
  const record = {
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
    const error = new Error('Name, mobile, and company are required.')
    error.statusCode = 400
    throw error
  }

  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('game_results')
    .insert(recordToRow(record))
    .select('*')
    .single()

  if (error) throw error

  const saved = rowToRecord(data)
  const allRecords = await getAllRecords()
  const recentMeta = (await getMetadata(RECENT_KEY)) || { entries: [] }
  const recentPlayerIds = addToRecentPlayerIds(recentMeta.entries || [], saved.id)
  const leaderboard = rebuildLeaderboard(getRecordsByIds(allRecords, recentPlayerIds))

  await setMetadata(RECENT_KEY, { entries: recentPlayerIds })

  return { record: saved, leaderboard }
}

async function updateRecord(id, payload) {
  const existing = await getRecordById(id)
  if (!existing) {
    const error = new Error('Record not found.')
    error.statusCode = 404
    throw error
  }

  const updated = {
    ...existing,
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
    const error = new Error('Name, mobile, and company are required.')
    error.statusCode = 400
    throw error
  }
  if (
    Number.isNaN(updated.score) ||
    Number.isNaN(updated.correctCount) ||
    Number.isNaN(updated.answeredCount) ||
    Number.isNaN(updated.completedAt)
  ) {
    const error = new Error('Score fields must be valid numbers.')
    error.statusCode = 400
    throw error
  }
  if (updated.correctCount > updated.answeredCount) {
    const error = new Error('Correct answers cannot exceed total answered.')
    error.statusCode = 400
    throw error
  }

  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('game_results')
    .update(recordToRow(updated))
    .eq('id', id)
    .select('*')
    .single()

  if (error) throw error

  const saved = rowToRecord(data)
  const allRecords = await getAllRecords()
  const recentIds = await getRecentPlayerIds()
  const leaderboard = rebuildLeaderboard(getRecordsByIds(allRecords, recentIds))

  return { record: saved, leaderboard }
}

async function deleteRecord(id) {
  const existing = await getRecordById(id)
  if (!existing) {
    const error = new Error('Record not found.')
    error.statusCode = 404
    throw error
  }

  const supabase = getSupabase()
  const { error } = await supabase.from('game_results').delete().eq('id', id)
  if (error) throw error

  const allRecords = await getAllRecords()
  const recentMeta = (await getMetadata(RECENT_KEY)) || { entries: [] }
  const recentPlayerIds = (recentMeta.entries || []).filter((entryId) => entryId !== id)
  const leaderboard = rebuildLeaderboard(getRecordsByIds(allRecords, recentPlayerIds))

  await setMetadata(RECENT_KEY, { entries: recentPlayerIds })

  return { ok: true, leaderboard }
}

async function getLeaderboard() {
  const recentIds = await getRecentPlayerIds()
  if (!recentIds.length) return []

  const allRecords = await getAllRecords()
  return rebuildLeaderboard(getRecordsByIds(allRecords, recentIds))
}

async function setLeaderboard(entries) {
  const safeEntries = Array.isArray(entries) ? entries : []
  if (!safeEntries.length) {
    return clearRecentPlayerIds()
  }

  await setMetadata(LEADERBOARD_KEY, { entries: safeEntries })
  return safeEntries
}

async function getRecentPlayerIds() {
  const meta = await getMetadata(RECENT_KEY)
  return meta?.entries || []
}

async function clearRecentPlayerIds() {
  await setMetadata(RECENT_KEY, { entries: [] })
  return []
}

async function clearSession() {
  return clearRecentPlayerIds()
}

async function verifyConnection() {
  getSupabase()
  const { error: recordsError } = await getSupabase().from('game_results').select('id').limit(1)
  if (recordsError) {
    throw new Error(`game_results table: ${recordsError.message}`)
  }

  const { error: metaError } = await getSupabase().from('app_metadata').select('key').limit(1)
  if (metaError) {
    throw new Error(`app_metadata table: ${metaError.message}. Run supabase/schema.sql in the SQL Editor.`)
  }
}

module.exports = {
  getAllRecords,
  createRecord,
  updateRecord,
  deleteRecord,
  getLeaderboard,
  setLeaderboard,
  getRecentPlayerIds,
  clearRecentPlayerIds,
  clearSession,
  verifyConnection,
  rowToRecord,
  recordToRow,
}
