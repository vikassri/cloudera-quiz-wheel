'use strict'

const { createClient } = require('@supabase/supabase-js')

const LEADERBOARD_KEY = 'leaderboard'
const RECENT_KEY = 'recent_player_ids'

let supabaseClient = null

function getSupabase() {
  if (supabaseClient) return supabaseClient

  const url = process.env.SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !serviceRoleKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment')
  }

  supabaseClient = createClient(url, serviceRoleKey, {
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
  const leaderboard = rebuildLeaderboard(allRecords)
  const recentMeta = (await getMetadata(RECENT_KEY)) || { entries: [] }
  const recentPlayerIds = addToRecentPlayerIds(recentMeta.entries || [], saved.id)

  await Promise.all([
    setMetadata(LEADERBOARD_KEY, { entries: leaderboard }),
    setMetadata(RECENT_KEY, { entries: recentPlayerIds }),
  ])

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
  const leaderboard = rebuildLeaderboard(allRecords)
  await setMetadata(LEADERBOARD_KEY, { entries: leaderboard })

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
  const leaderboard = rebuildLeaderboard(allRecords)
  const recentMeta = (await getMetadata(RECENT_KEY)) || { entries: [] }
  const recentPlayerIds = (recentMeta.entries || []).filter((entryId) => entryId !== id)

  await Promise.all([
    setMetadata(LEADERBOARD_KEY, { entries: leaderboard }),
    setMetadata(RECENT_KEY, { entries: recentPlayerIds }),
  ])

  return { ok: true, leaderboard }
}

async function getLeaderboard() {
  const meta = await getMetadata(LEADERBOARD_KEY)
  return meta?.entries || []
}

async function setLeaderboard(entries) {
  const safeEntries = Array.isArray(entries) ? entries : []
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

module.exports = {
  getAllRecords,
  createRecord,
  updateRecord,
  deleteRecord,
  getLeaderboard,
  setLeaderboard,
  getRecentPlayerIds,
  clearRecentPlayerIds,
  rowToRecord,
  recordToRow,
}
