'use strict'

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') })

const fs = require('fs')
const path = require('path')
const store = require('../lib/supabase-store')

const PLAYERS_FILE = path.join(__dirname, '..', 'data', 'players.json')

async function migrate() {
  if (!fs.existsSync(PLAYERS_FILE)) {
    console.error(`No file found at ${PLAYERS_FILE}`)
    process.exit(1)
  }

  const payload = JSON.parse(fs.readFileSync(PLAYERS_FILE, 'utf8'))
  const records = Array.isArray(payload.gameResults) ? payload.gameResults : []

  if (!records.length) {
    console.log('No records to migrate.')
    return
  }

  console.log(`Migrating ${records.length} record(s) to Supabase...`)

  for (const record of records) {
    await store.createRecord(record)
    console.log(`  ✓ ${record.name} (${record.score} pts)`)
  }

  const leaderboard = Array.isArray(payload.leaderboard) ? payload.leaderboard : []
  if (leaderboard.length) {
    await store.setLeaderboard(leaderboard)
    console.log(`  ✓ Restored leaderboard snapshot (${leaderboard.length} entries)`)
  }

  console.log('Migration complete.')
}

migrate().catch((error) => {
  console.error(error.message || error)
  process.exit(1)
})
