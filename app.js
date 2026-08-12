;(function () {
  'use strict'

  const GAME_DURATION_SEC = 60
  const POINTS_PER_CORRECT = 100
  const SPIN_DURATION_MS = 4500
  const FEEDBACK_DELAY_MS = 900
  const API_BASE = '/api'
  const QUESTIONS_URL = 'questions.json'
  const ADMIN_USERNAME = 'admin'
  const ADMIN_PASSWORD_FULL = 'Password1'
  const ADMIN_PASSWORD_READONLY = 'admin'

  let topics = []
  let topicColorMap = {}
  const screens = {
    login: document.getElementById('screen-login'),
    wheel: document.getElementById('screen-wheel'),
    quiz: document.getElementById('screen-quiz'),
    results: document.getElementById('screen-results'),
    admin: document.getElementById('screen-admin'),
  }

  const canvas = document.getElementById('wheelCanvas')
  const ctx = canvas.getContext('2d')
  const spinBtn = document.getElementById('spinBtn')
  const wheelStatus = document.getElementById('wheelStatus')
  const topicBadge = document.getElementById('topicBadge')
  const topicDot = document.getElementById('topicDot')
  const timerValue = document.getElementById('timerValue')
  const timerProgress = document.getElementById('timerProgress')
  const scoreValue = document.getElementById('scoreValue')
  const questionNumber = document.getElementById('questionNumber')
  const questionText = document.getElementById('questionText')
  const optionsGrid = document.getElementById('optionsGrid')
  const feedbackBar = document.getElementById('feedbackBar')
  const loginForm = document.getElementById('loginForm')
  const loginError = document.getElementById('loginError')
  const playAgainBtn = document.getElementById('playAgainBtn')
  const resetWinnersBtn = document.getElementById('resetWinnersBtn')
  const viewRecordsLink = document.getElementById('viewRecordsLink')
  const recordsCount = document.getElementById('recordsCount')
  const adminBackBtn = document.getElementById('adminBackBtn')
  const adminSummary = document.getElementById('adminSummary')
  const adminError = document.getElementById('adminError')
  const adminRecordsBody = document.getElementById('adminRecordsBody')
  const adminRecordsTable = document.getElementById('adminRecordsTable')
  const adminEmpty = document.getElementById('adminEmpty')
  const adminStats = document.getElementById('adminStats')
  const statTotalPlayers = document.getElementById('statTotalPlayers')
  const statTopScore = document.getElementById('statTopScore')
  const statAvgScore = document.getElementById('statAvgScore')
  const statAvgAccuracy = document.getElementById('statAvgAccuracy')
  const adminTableCount = document.getElementById('adminTableCount')
  const adminTableTitle = document.getElementById('adminTableTitle')
  const adminTabAll = document.getElementById('adminTabAll')
  const adminTabRecent = document.getElementById('adminTabRecent')
  const adminTabAnalytics = document.getElementById('adminTabAnalytics')
  const adminRecordsView = document.getElementById('adminRecordsView')
  const adminAnalyticsPanel = document.getElementById('adminAnalyticsPanel')
  const downloadCsvBtn = document.getElementById('downloadCsvBtn')
  const resetRecentBtn = document.getElementById('resetRecentBtn')
  const adminAuthModal = document.getElementById('adminAuthModal')
  const adminAuthForm = document.getElementById('adminAuthForm')
  const adminAuthError = document.getElementById('adminAuthError')
  const adminAuthCancelBtn = document.getElementById('adminAuthCancelBtn')
  const adminAuthBackdrop = document.getElementById('adminAuthBackdrop')
  const adminAccessBadge = document.getElementById('adminAccessBadge')
  const adminActionsHeader = document.getElementById('adminActionsHeader')

  function normalizeQuestion(rawQuestion, topicLabel, questionIndex) {
    const text = (rawQuestion.question || rawQuestion.text || '').trim()
    const options = Array.isArray(rawQuestion.options) ? rawQuestion.options.map((option) => String(option)) : []

    if (!text || options.length < 2) {
      throw new Error(`Invalid question in topic "${topicLabel}" at index ${questionIndex}`)
    }

    let correct = typeof rawQuestion.correct === 'number' ? rawQuestion.correct : -1
    if (typeof rawQuestion.answer === 'string') {
      correct = options.indexOf(rawQuestion.answer)
    }

    if (correct < 0 || correct >= options.length) {
      throw new Error(`Missing or invalid answer for "${text}" in topic "${topicLabel}"`)
    }

    return { text, options, correct }
  }

  function normalizeQuestionBank(rawTopics) {
    if (!Array.isArray(rawTopics) || !rawTopics.length) {
      throw new Error('Question bank must include at least one topic.')
    }

    return rawTopics.map((topic, topicIndex) => {
      const label = (topic.label || topic.name || '').trim()
      if (!label) {
        throw new Error(`Topic at index ${topicIndex} is missing a label.`)
      }

      const questions = Array.isArray(topic.questions) ? topic.questions : []
      if (!questions.length) {
        throw new Error(`Topic "${label}" has no questions.`)
      }

      return {
        id: topic.id || label.toLowerCase().replace(/\s+/g, '-'),
        label,
        color: topic.color || '#64748b',
        questions: questions.map((question, questionIndex) => normalizeQuestion(question, label, questionIndex)),
      }
    })
  }

  async function loadQuestionBank() {
    const response = await fetch(QUESTIONS_URL, { cache: 'no-store' })
    if (!response.ok) {
      throw new Error(`Unable to load ${QUESTIONS_URL} (${response.status})`)
    }

    const payload = await response.json()
    return normalizeQuestionBank(payload.topics || payload)
  }

  function setQuestionLoadState({ isLoading = false, error = '' } = {}) {
    loginForm.querySelectorAll('input, button').forEach((element) => {
      element.disabled = isLoading || Boolean(error)
    })
    viewRecordsLink.disabled = isLoading || Boolean(error)

    if (isLoading) {
      loginError.textContent = 'Loading questions...'
      return
    }

    loginError.textContent = error
  }

  function applyQuestionBank(questionBank) {
    topics = questionBank
    topicColorMap = Object.fromEntries(topics.map((topic) => [topic.label, topic.color]))
  }

  const TIMER_RADIUS = 26
  const TIMER_CIRCUMFERENCE = 2 * Math.PI * TIMER_RADIUS

  let wheelRotation = 0
  let isSpinning = false
  let selectedTopic = null
  let questionQueue = []
  let currentQuestionIndex = 0
  let score = 0
  let correctCount = 0
  let answeredCount = 0
  let streak = 0
  let maxStreak = 0
  let timeRemaining = GAME_DURATION_SEC
  let timerInterval = null
  let isAnswering = false
  let player = null
  let editingRecordId = null
  let adminActiveTab = 'all'
  let cachedAdminRecords = []
  let adminAccessLevel = null

  function formatDateTime(timestamp) {
    if (!timestamp) return '—'
    return new Date(timestamp).toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    })
  }

  function formatAccuracy(correctCount, answeredCount) {
    if (!answeredCount) return '0%'
    return `${Math.round((correctCount / answeredCount) * 100)}%`
  }

  async function apiRequest(path, options = {}) {
    const response = await fetch(`${API_BASE}${path}`, {
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      ...options,
    })

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}))
      throw new Error(payload.error || `Request failed (${response.status})`)
    }

    if (response.status === 204) return null
    return response.json()
  }

  async function getAllGameResults() {
    try {
      const payload = await apiRequest('/records')
      return payload.records || []
    } catch (_) {
      return []
    }
  }

  async function updateGameResult(record) {
    await apiRequest(`/records/${record.id}`, {
      method: 'PUT',
      body: JSON.stringify(record),
    })
  }

  async function deleteGameResult(id) {
    await apiRequest(`/records/${id}`, { method: 'DELETE' })
  }

  async function refreshRecordsCount() {
    const results = await getAllGameResults()
    recordsCount.textContent = String(results.length)
    return results
  }

  async function getLeaderboard() {
    try {
      const payload = await apiRequest('/leaderboard')
      return payload.entries || []
    } catch (_) {
      return []
    }
  }

  async function saveScore() {
    const topicLabel = selectedTopic?.label || player?.topic || 'Not recorded'
    const result = {
      name: player.name,
      mobile: player.mobile,
      company: player.company,
      topic: topicLabel,
      topicLabel,
      topicId: selectedTopic?.id || player?.topicId || null,
      score,
      correctCount,
      answeredCount,
      completedAt: Date.now(),
    }
    const payload = await apiRequest('/records', {
      method: 'POST',
      body: JSON.stringify(result),
    })
    refreshRecordsCount()
    return payload.leaderboard || []
  }

  async function getRecentPlayerIds() {
    try {
      const payload = await apiRequest('/recent')
      return payload.entries || []
    } catch (_) {
      return []
    }
  }

  async function clearRecentPlayers() {
    await apiRequest('/recent', { method: 'DELETE' })
  }

  async function removeFromRecentPlayers(_recordId) {
    // Recent list is updated by the server when records are deleted.
  }

  async function getRecentPlayerRecords(allRecords) {
    const recentIds = await getRecentPlayerIds()
    const recordMap = new Map(allRecords.map((record) => [record.id, record]))
    return recentIds.map((id) => recordMap.get(id)).filter(Boolean)
  }

  function csvEscape(value) {
    const text = String(value ?? '')
    if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`
    return text
  }

  function canAdminWrite() {
    return adminAccessLevel === 'full'
  }

  function applyAdminAccessUi() {
    const isReadOnly = adminAccessLevel === 'readonly'
    adminAccessBadge.classList.toggle('hidden', !isReadOnly)
    adminActionsHeader?.classList.toggle('hidden', isReadOnly)
    downloadCsvBtn.classList.toggle('hidden', !canAdminWrite() || adminActiveTab !== 'all')
    resetRecentBtn.classList.toggle('hidden', !canAdminWrite() || adminActiveTab !== 'recent')
  }

  function resolveAdminAccessLevel(username, password) {
    if (username !== ADMIN_USERNAME) return null
    if (password === ADMIN_PASSWORD_FULL) return 'full'
    if (password === ADMIN_PASSWORD_READONLY) return 'readonly'
    return null
  }

  function downloadRecordsCsv(records) {
    if (!canAdminWrite()) return
    if (!records.length) {
      window.alert('No player records to download.')
      return
    }

    const headers = ['Name', 'Mobile', 'Company', 'Topic', 'Score', 'Correct', 'Answered', 'Accuracy', 'Completed']
    const rows = [...records]
      .sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0))
      .map((record) => {
        const topicLabel = getRecordTopic(record)
        const accuracy = record.answeredCount
          ? `${Math.round((record.correctCount / record.answeredCount) * 100)}%`
          : '0%'
        return [
          record.name,
          record.mobile,
          record.company,
          topicLabel,
          record.score,
          record.correctCount,
          record.answeredCount,
          accuracy,
          formatDateTime(record.completedAt),
        ]
      })

    const csv = [headers, ...rows]
      .map((row) => row.map(csvEscape).join(','))
      .join('\n')

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `cloudera-quiz-players-${new Date().toISOString().slice(0, 10)}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  function setAdminTab(tabName) {
    adminActiveTab = tabName
    adminTabAll.classList.toggle('active', tabName === 'all')
    adminTabRecent.classList.toggle('active', tabName === 'recent')
    adminTabAnalytics.classList.toggle('active', tabName === 'analytics')
    adminTabAll.setAttribute('aria-selected', tabName === 'all' ? 'true' : 'false')
    adminTabRecent.setAttribute('aria-selected', tabName === 'recent' ? 'true' : 'false')
    adminTabAnalytics.setAttribute('aria-selected', tabName === 'analytics' ? 'true' : 'false')
    downloadCsvBtn.classList.toggle('hidden', tabName !== 'all' || !canAdminWrite())
    resetRecentBtn.classList.toggle('hidden', tabName !== 'recent' || !canAdminWrite())
    adminTableTitle.textContent = tabName === 'all'
      ? 'All Players'
      : tabName === 'recent'
        ? 'Recent Players'
        : 'Event Analytics'
    editingRecordId = null
    renderAdminPanel(cachedAdminRecords)
  }

  function computeAnalytics(records) {
    if (!records.length) return null

    const totalAnswered = records.reduce((sum, record) => sum + (record.answeredCount || 0), 0)
    const totalCorrect = records.reduce((sum, record) => sum + (record.correctCount || 0), 0)
    const totalScore = records.reduce((sum, record) => sum + (record.score || 0), 0)
    const companies = new Map()
    const topicStats = new Map()
    let topScore = 0
    let topScorer = null
    let highestAccuracy = 0
    let highestAccuracyPlayer = null

    records.forEach((record) => {
      const company = (record.company || 'Unknown').trim() || 'Unknown'
      const topic = getRecordTopic(record)
      const accuracy = record.answeredCount > 0
        ? Math.round((record.correctCount / record.answeredCount) * 100)
        : 0

      if ((record.score || 0) > topScore) {
        topScore = record.score || 0
        topScorer = record
      }

      if (record.answeredCount > 0 && accuracy >= highestAccuracy) {
        highestAccuracy = accuracy
        highestAccuracyPlayer = record
      }

      if (!companies.has(company)) {
        companies.set(company, {
          players: 0,
          totalScore: 0,
          totalAnswered: 0,
          totalCorrect: 0,
        })
      }

      const companyStats = companies.get(company)
      companyStats.players += 1
      companyStats.totalScore += record.score || 0
      companyStats.totalAnswered += record.answeredCount || 0
      companyStats.totalCorrect += record.correctCount || 0

      if (!topicStats.has(topic)) {
        topicStats.set(topic, {
          plays: 0,
          totalAnswered: 0,
          totalCorrect: 0,
          totalScore: 0,
        })
      }

      const topicEntry = topicStats.get(topic)
      topicEntry.plays += 1
      topicEntry.totalAnswered += record.answeredCount || 0
      topicEntry.totalCorrect += record.correctCount || 0
      topicEntry.totalScore += record.score || 0
    })

    const companyRows = [...companies.entries()]
      .map(([name, stats]) => ({
        name,
        players: stats.players,
        avgScore: Math.round(stats.totalScore / stats.players),
        avgCorrect: Math.round((stats.totalCorrect / stats.players) * 10) / 10,
        avgAccuracy: stats.totalAnswered > 0
          ? Math.round((stats.totalCorrect / stats.totalAnswered) * 100)
          : 0,
        totalCorrect: stats.totalCorrect,
      }))
      .sort((a, b) => b.players - a.players || b.avgScore - a.avgScore)

    const topicRows = [...topicStats.entries()]
      .map(([name, stats]) => ({
        name,
        color: getTopicColor(name),
        plays: stats.plays,
        totalCorrect: stats.totalCorrect,
        avgCorrect: Math.round((stats.totalCorrect / stats.plays) * 10) / 10,
        avgAccuracy: stats.totalAnswered > 0
          ? Math.round((stats.totalCorrect / stats.totalAnswered) * 100)
          : 0,
        avgScore: Math.round(stats.totalScore / stats.plays),
      }))
      .sort((a, b) => b.plays - a.plays || b.totalCorrect - a.totalCorrect)

    const mostPopularTopic = topicRows[0] || null
    const topCompany = companyRows[0] || null
    const bestScoreCompany = [...companyRows].sort((a, b) => b.avgScore - a.avgScore || b.players - a.players)[0] || null
    const bestAccuracyTopic = [...topicRows]
      .filter((topic) => topic.plays > 0)
      .sort((a, b) => b.avgAccuracy - a.avgAccuracy || b.plays - a.plays)[0] || null

    const scoreBands = [
      { label: '0-499', count: 0 },
      { label: '500-999', count: 0 },
      { label: '1000-1499', count: 0 },
      { label: '1500+', count: 0 },
    ]
    const accuracyBands = [
      { label: '0-49%', count: 0 },
      { label: '50-79%', count: 0 },
      { label: '80-100%', count: 0 },
    ]

    records.forEach((record) => {
      const score = record.score || 0
      if (score < 500) scoreBands[0].count += 1
      else if (score < 1000) scoreBands[1].count += 1
      else if (score < 1500) scoreBands[2].count += 1
      else scoreBands[3].count += 1

      const accuracy = record.answeredCount > 0
        ? Math.round((record.correctCount / record.answeredCount) * 100)
        : 0
      if (accuracy < 50) accuracyBands[0].count += 1
      else if (accuracy < 80) accuracyBands[1].count += 1
      else accuracyBands[2].count += 1
    })

    const topPerformers = [...records]
      .sort((a, b) => b.score - a.score || b.correctCount - a.correctCount || a.completedAt - b.completedAt)
      .slice(0, 5)
      .map((record) => ({
        name: record.name,
        company: record.company,
        topic: getRecordTopic(record),
        score: record.score || 0,
        correctCount: record.correctCount || 0,
        accuracy: record.answeredCount > 0
          ? Math.round((record.correctCount / record.answeredCount) * 100)
          : 0,
      }))

    return {
      overview: {
        totalPlayers: records.length,
        avgCorrect: Math.round((totalCorrect / records.length) * 10) / 10,
        avgScore: Math.round(totalScore / records.length),
        avgAccuracy: totalAnswered > 0 ? Math.round((totalCorrect / totalAnswered) * 100) : 0,
        totalCorrect,
        totalAnswered,
        topScore,
        uniqueCompanies: companies.size,
        uniqueTopics: topicStats.size,
      },
      highlights: {
        topScorer: topScorer
          ? { name: topScorer.name, company: topScorer.company, score: topScorer.score || 0 }
          : null,
        highestAccuracyPlayer: highestAccuracyPlayer
          ? {
            name: highestAccuracyPlayer.name,
            company: highestAccuracyPlayer.company,
            accuracy: highestAccuracy,
            correctCount: highestAccuracyPlayer.correctCount || 0,
          }
          : null,
        mostPopularTopic: mostPopularTopic
          ? { name: mostPopularTopic.name, plays: mostPopularTopic.plays }
          : null,
        topCompany: topCompany
          ? { name: topCompany.name, players: topCompany.players }
          : null,
        bestScoreCompany: bestScoreCompany
          ? { name: bestScoreCompany.name, avgScore: bestScoreCompany.avgScore }
          : null,
        bestAccuracyTopic: bestAccuracyTopic
          ? { name: bestAccuracyTopic.name, avgAccuracy: bestAccuracyTopic.avgAccuracy }
          : null,
      },
      scoreBands,
      accuracyBands,
      topPerformers,
      companies: companyRows,
      topics: topicRows,
    }
  }

  function renderAnalyticsBar(value, maxValue) {
    const width = maxValue > 0 ? Math.max(8, Math.round((value / maxValue) * 100)) : 0
    return `<div class="analytics-bar" aria-hidden="true"><span style="width:${width}%"></span></div>`
  }

  function renderAdminAnalytics(records) {
    const analytics = computeAnalytics(records)
    adminAnalyticsPanel.innerHTML = ''

    if (!analytics) {
      adminAnalyticsPanel.innerHTML = `
        <div class="analytics-empty">
          <p>No analytics yet.</p>
          <span>Complete a quiz to see company and topic insights.</span>
        </div>
      `
      return
    }

    const maxCompanyPlayers = analytics.companies[0]?.players || 1
    const maxTopicPlays = analytics.topics[0]?.plays || 1
    const maxScoreBand = Math.max(...analytics.scoreBands.map((band) => band.count), 1)
    const maxAccuracyBand = Math.max(...analytics.accuracyBands.map((band) => band.count), 1)

    const overviewCards = [
      { label: 'Total players', value: analytics.overview.totalPlayers },
      { label: 'Avg correct / game', value: analytics.overview.avgCorrect },
      { label: 'Total correct', value: analytics.overview.totalCorrect },
      { label: 'Total answered', value: analytics.overview.totalAnswered },
      { label: 'Avg score', value: analytics.overview.avgScore },
      { label: 'Top score', value: analytics.overview.topScore },
      { label: 'Avg accuracy', value: `${analytics.overview.avgAccuracy}%` },
      { label: 'Companies', value: analytics.overview.uniqueCompanies },
      { label: 'Topics played', value: analytics.overview.uniqueTopics },
    ]

    const highlightCards = [
      analytics.highlights.topScorer
        ? {
          label: 'Top scorer',
          value: analytics.highlights.topScorer.name,
          detail: `${analytics.highlights.topScorer.score} pts · ${escapeHTML(analytics.highlights.topScorer.company)}`,
        }
        : null,
      analytics.highlights.highestAccuracyPlayer
        ? {
          label: 'Best accuracy',
          value: `${analytics.highlights.highestAccuracyPlayer.accuracy}%`,
          detail: `${escapeHTML(analytics.highlights.highestAccuracyPlayer.name)} · ${analytics.highlights.highestAccuracyPlayer.correctCount} correct`,
        }
        : null,
      analytics.highlights.mostPopularTopic
        ? {
          label: 'Most played topic',
          value: analytics.highlights.mostPopularTopic.name,
          detail: `${analytics.highlights.mostPopularTopic.plays} games`,
        }
        : null,
      analytics.highlights.topCompany
        ? {
          label: 'Largest company',
          value: analytics.highlights.topCompany.name,
          detail: `${analytics.highlights.topCompany.players} players`,
        }
        : null,
      analytics.highlights.bestScoreCompany
        ? {
          label: 'Highest avg score',
          value: analytics.highlights.bestScoreCompany.name,
          detail: `${analytics.highlights.bestScoreCompany.avgScore} avg score`,
        }
        : null,
      analytics.highlights.bestAccuracyTopic
        ? {
          label: 'Strongest topic',
          value: analytics.highlights.bestAccuracyTopic.name,
          detail: `${analytics.highlights.bestAccuracyTopic.avgAccuracy}% avg accuracy`,
        }
        : null,
    ].filter(Boolean)

    adminAnalyticsPanel.innerHTML = `
      <div class="analytics-overview">
        ${overviewCards.map((card) => `
          <div class="analytics-kpi">
            <span class="analytics-kpi-label">${card.label}</span>
            <strong class="analytics-kpi-value">${card.value}</strong>
          </div>
        `).join('')}
      </div>

      <section class="analytics-card" aria-labelledby="analyticsHighlightsTitle">
        <div class="analytics-card-header">
          <h4 id="analyticsHighlightsTitle">Event highlights</h4>
          <p>Quick read on who and what stood out during the event.</p>
        </div>
        <div class="analytics-highlights">
          ${highlightCards.map((card) => `
            <div class="analytics-highlight">
              <span class="analytics-highlight-label">${card.label}</span>
              <strong class="analytics-highlight-value">${escapeHTML(String(card.value))}</strong>
              <span class="analytics-highlight-detail">${card.detail}</span>
            </div>
          `).join('')}
        </div>
      </section>

      <div class="analytics-grid analytics-grid-3">
        <section class="analytics-card" aria-labelledby="analyticsScoreBandsTitle">
          <div class="analytics-card-header">
            <h4 id="analyticsScoreBandsTitle">Score distribution</h4>
            <p>How players spread across score ranges.</p>
          </div>
          <div class="analytics-band-list">
            ${analytics.scoreBands.map((band) => `
              <div class="analytics-band-row">
                <span class="analytics-band-label">${band.label}</span>
                <div class="analytics-band-track">
                  ${renderAnalyticsBar(band.count, maxScoreBand)}
                </div>
                <strong class="analytics-band-value">${band.count}</strong>
              </div>
            `).join('')}
          </div>
        </section>

        <section class="analytics-card" aria-labelledby="analyticsAccuracyBandsTitle">
          <div class="analytics-card-header">
            <h4 id="analyticsAccuracyBandsTitle">Accuracy distribution</h4>
            <p>Share of players by accuracy band.</p>
          </div>
          <div class="analytics-band-list">
            ${analytics.accuracyBands.map((band) => `
              <div class="analytics-band-row">
                <span class="analytics-band-label">${band.label}</span>
                <div class="analytics-band-track">
                  ${renderAnalyticsBar(band.count, maxAccuracyBand)}
                </div>
                <strong class="analytics-band-value">${band.count}</strong>
              </div>
            `).join('')}
          </div>
        </section>

        <section class="analytics-card" aria-labelledby="analyticsTopPerformersTitle">
          <div class="analytics-card-header">
            <h4 id="analyticsTopPerformersTitle">Top performers</h4>
            <p>Highest scoring players in the event.</p>
          </div>
          <div class="analytics-table-wrap">
            <table class="analytics-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Name</th>
                  <th>Company</th>
                  <th>Topic</th>
                  <th>Score</th>
                  <th>Correct</th>
                  <th>Accuracy</th>
                </tr>
              </thead>
              <tbody>
                ${analytics.topPerformers.map((player, index) => `
                  <tr>
                    <td>${index + 1}</td>
                    <td class="analytics-name">${escapeHTML(player.name)}</td>
                    <td>${escapeHTML(player.company)}</td>
                    <td>${escapeHTML(player.topic)}</td>
                    <td>${player.score}</td>
                    <td>${player.correctCount}</td>
                    <td>${player.accuracy}%</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <div class="analytics-grid">
        <section class="analytics-card" aria-labelledby="analyticsCompaniesTitle">
          <div class="analytics-card-header">
            <h4 id="analyticsCompaniesTitle">Players by company</h4>
            <p>Which organizations are showing up most at the booth.</p>
          </div>
          <div class="analytics-table-wrap">
            <table class="analytics-table">
              <thead>
                <tr>
                  <th>Company</th>
                  <th>Players</th>
                  <th>Avg score</th>
                  <th>Avg correct</th>
                  <th>Total correct</th>
                  <th>Avg accuracy</th>
                </tr>
              </thead>
              <tbody>
                ${analytics.companies.map((company) => `
                  <tr>
                    <td class="analytics-name">${escapeHTML(company.name)}</td>
                    <td>
                      <div class="analytics-metric-cell">
                        <strong>${company.players}</strong>
                        ${renderAnalyticsBar(company.players, maxCompanyPlayers)}
                      </div>
                    </td>
                    <td>${company.avgScore}</td>
                    <td>${company.avgCorrect}</td>
                    <td>${company.totalCorrect}</td>
                    <td>${company.avgAccuracy}%</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </section>

        <section class="analytics-card" aria-labelledby="analyticsTopicsTitle">
          <div class="analytics-card-header">
            <h4 id="analyticsTopicsTitle">Topic performance</h4>
            <p>Most played topics and how players perform in each.</p>
          </div>
          <div class="analytics-table-wrap">
            <table class="analytics-table">
              <thead>
                <tr>
                  <th>Topic</th>
                  <th>Times played</th>
                  <th>Total correct</th>
                  <th>Avg correct</th>
                  <th>Avg accuracy</th>
                  <th>Avg score</th>
                </tr>
              </thead>
              <tbody>
                ${analytics.topics.map((topic) => `
                  <tr>
                    <td class="analytics-name">
                      <span class="analytics-topic-dot" style="background:${topic.color}"></span>
                      ${escapeHTML(topic.name)}
                    </td>
                    <td>
                      <div class="analytics-metric-cell">
                        <strong>${topic.plays}</strong>
                        ${renderAnalyticsBar(topic.plays, maxTopicPlays)}
                      </div>
                    </td>
                    <td>${topic.totalCorrect}</td>
                    <td>${topic.avgCorrect}</td>
                    <td>${topic.avgAccuracy}%</td>
                    <td>${topic.avgScore}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    `
  }

  async function renderAdminPanel(records) {
    cachedAdminRecords = records

    adminSummary.textContent = records.length
      ? `${records.length} player${records.length === 1 ? '' : 's'} registered in this event session`
      : 'All player scores and details will appear in the table below.'

    renderAdminStats(records)

    const isAnalytics = adminActiveTab === 'analytics'
    adminRecordsView.classList.toggle('hidden', isAnalytics)
    adminAnalyticsPanel.classList.toggle('hidden', !isAnalytics)
    adminTableCount.classList.toggle('hidden', isAnalytics)

    if (isAnalytics) {
      renderAdminAnalytics(records)
      return
    }

    await renderAdminRecords(records)
  }

  function escapeHTML(value) {
    return value.replace(/[&<>'"]/g, (char) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;',
    }[char]))
  }

  function renderLeaderboard(entries) {
    const list = document.getElementById('leaderboardList')
    list.innerHTML = ''
    const medals = ['🥇', '🥈', '🥉']
    for (let index = 0; index < 3; index += 1) {
      const entry = entries[index]
      const item = document.createElement('li')
      const isCurrentPlayer = entry && player && entry.name === player.name && entry.mobile === player.mobile
      item.className = `leaderboard-entry place-${index + 1}${isCurrentPlayer ? ' current-player' : ''}`
      item.innerHTML = entry
        ? `<span class="place">${medals[index]}</span><span class="winner"><strong>${escapeHTML(entry.name)}</strong><small>${escapeHTML(entry.company)}</small></span><strong class="winner-score">${entry.score}</strong>`
        : `<span class="place">${index + 1}</span><span class="winner empty-winner">Open spot</span><strong class="winner-score">—</strong>`
      list.appendChild(item)
    }
  }

  function getInitials(name) {
    return name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0].toUpperCase())
      .join('') || '?'
  }

  function getTopicColor(topicLabel) {
    if (!topicLabel || topicLabel === '—' || topicLabel === 'Not recorded') return '#64748b'
    return topicColorMap[topicLabel] || '#64748b'
  }

  function getRecordTopic(record) {
    const label = (record.topic || record.topicLabel || '').trim()
    if (!label || label === '—') return 'Not recorded'
    return label
  }

  function getTopicPillStyle(color, isMissing) {
    if (isMissing) {
      return 'background:#334155;border-color:#94a3b8;color:#e2e8f0'
    }
    return `background:${color};border-color:${color};color:#ffffff`
  }

  function getAccuracyClass(accuracy) {
    if (accuracy >= 80) return 'high'
    if (accuracy >= 50) return 'mid'
    return 'low'
  }

  function getRankBadge(index, score, topScore) {
    if (index === 0 && score === topScore && score > 0) {
      return '<span class="rank-badge rank-gold" aria-label="First place">🥇</span>'
    }
    if (index === 1 && score > 0) {
      return '<span class="rank-badge rank-silver" aria-label="Second place">🥈</span>'
    }
    if (index === 2 && score > 0) {
      return '<span class="rank-badge rank-bronze" aria-label="Third place">🥉</span>'
    }
    return `<span class="rank-badge rank-plain">${index + 1}</span>`
  }

  function renderAdminStats(records) {
    if (!records.length) {
      adminStats.classList.add('hidden')
      return
    }

    const totalScore = records.reduce((sum, record) => sum + record.score, 0)
    const totalAccuracy = records.reduce((sum, record) => {
      if (!record.answeredCount) return sum
      return sum + (record.correctCount / record.answeredCount) * 100
    }, 0)
    const topScore = Math.max(...records.map((record) => record.score))

    statTotalPlayers.textContent = String(records.length)
    statTopScore.textContent = String(topScore)
    statAvgScore.textContent = String(Math.round(totalScore / records.length))
    statAvgAccuracy.textContent = `${Math.round(totalAccuracy / records.length)}%`
    adminStats.classList.remove('hidden')
  }

  function getTopicOptions(selectedLabel) {
    const options = topics
      .map((topic) => `<option value="${escapeHTML(topic.label)}"${topic.label === selectedLabel ? ' selected' : ''}>${escapeHTML(topic.label)}</option>`)
      .join('')
    const isKnown = topics.some((topic) => topic.label === selectedLabel)
    const customOption = !isKnown && selectedLabel && selectedLabel !== 'Not recorded'
      ? `<option value="${escapeHTML(selectedLabel)}" selected>${escapeHTML(selectedLabel)}</option>`
      : ''
    return `<option value="Not recorded"${selectedLabel === 'Not recorded' ? ' selected' : ''}>Not recorded</option>${customOption}${options}`
  }

  async function renderAdminRecords(records) {
    adminRecordsBody.innerHTML = ''
    const isReadOnly = !canAdminWrite()
    adminActionsHeader?.classList.toggle('hidden', isReadOnly)

    let visibleRecords = records
    if (adminActiveTab === 'recent') {
      visibleRecords = await getRecentPlayerRecords(records)
    } else {
      visibleRecords = [...records].sort((a, b) => b.score - a.score || b.completedAt - a.completedAt)
    }

    const countLabel = adminActiveTab === 'recent'
      ? `${visibleRecords.length} recent player${visibleRecords.length === 1 ? '' : 's'}`
      : `${records.length} record${records.length === 1 ? '' : 's'}`
    adminTableCount.textContent = countLabel

    const hasRecords = visibleRecords.length > 0
    adminRecordsTable.classList.toggle('hidden', !hasRecords)
    adminEmpty.classList.toggle('hidden', hasRecords)

    if (!hasRecords) {
      adminEmpty.querySelector('p').textContent = adminActiveTab === 'recent'
        ? 'No recent players yet.'
        : 'No player records yet.'
      adminEmpty.querySelector('span').textContent = adminActiveTab === 'recent'
        ? 'Players will appear here after they finish a quiz.'
        : 'Complete a quiz to populate the leaderboard.'
      return
    }

    visibleRecords.forEach((record, index) => {
      if (!isReadOnly && editingRecordId === record.id) {
        const topicLabel = getRecordTopic(record)
        const editRow = document.createElement('tr')
        editRow.className = 'records-edit-row'
        editRow.innerHTML = `
          <td colspan="10">
            <form class="records-edit-form" data-record-id="${record.id}">
              <div class="records-edit-title">Edit record — ${escapeHTML(record.name)}</div>
              <div class="records-edit-grid">
                <label>Name<input name="name" type="text" maxlength="60" value="${escapeHTML(record.name)}" required></label>
                <label>Mobile<input name="mobile" type="tel" maxlength="20" value="${escapeHTML(record.mobile)}" required></label>
                <label>Company<input name="company" type="text" maxlength="80" value="${escapeHTML(record.company)}" required></label>
                <label>Topic<select name="topic" required>${getTopicOptions(topicLabel)}</select></label>
                <label>Score<input name="score" type="number" min="0" step="1" value="${record.score}" required></label>
                <label>Correct<input name="correctCount" type="number" min="0" step="1" value="${record.correctCount}" required></label>
                <label>Answered<input name="answeredCount" type="number" min="0" step="1" value="${record.answeredCount}" required></label>
                <label>Completed<input name="completedAt" type="datetime-local" value="${toDatetimeLocalValue(record.completedAt)}" required></label>
              </div>
              <div class="records-edit-actions">
                <button class="tbl-btn tbl-btn-save" type="submit">Save</button>
                <button class="tbl-btn tbl-btn-cancel admin-cancel-edit" type="button">Cancel</button>
              </div>
            </form>
          </td>
        `
        editRow.querySelector('.records-edit-form').addEventListener('submit', handleSaveEdit)
        editRow.querySelector('.admin-cancel-edit').addEventListener('click', () => {
          editingRecordId = null
          renderAdminPanel(records)
        })
        adminRecordsBody.appendChild(editRow)
        return
      }

      const accuracyValue = record.answeredCount
        ? Math.round((record.correctCount / record.answeredCount) * 100)
        : 0
      const topicLabel = getRecordTopic(record)
      const row = document.createElement('tr')
      const actionsCell = isReadOnly
        ? ''
        : `<td class="records-actions">
          <button class="tbl-btn tbl-btn-edit" type="button">Edit</button>
          <button class="tbl-btn tbl-btn-delete" type="button">Delete</button>
        </td>`
      row.innerHTML = `
        <td>${index + 1}</td>
        <td>${escapeHTML(record.name)}</td>
        <td>${escapeHTML(record.mobile)}</td>
        <td>${escapeHTML(record.company)}</td>
        <td>${escapeHTML(topicLabel)}</td>
        <td>${record.score}</td>
        <td>${record.correctCount}/${record.answeredCount}</td>
        <td>${accuracyValue}%</td>
        <td>${formatDateTime(record.completedAt)}</td>
        ${actionsCell}
      `
      if (!isReadOnly) {
        row.querySelector('.tbl-btn-edit').addEventListener('click', () => {
          editingRecordId = record.id
          renderAdminPanel(records)
        })
        row.querySelector('.tbl-btn-delete').addEventListener('click', () => handleDeleteRecord(record))
      }
      adminRecordsBody.appendChild(row)
    })
  }

  function toDatetimeLocalValue(timestamp) {
    const date = new Date(timestamp)
    const pad = (value) => String(value).padStart(2, '0')
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
  }

  function openAdminAuthModal() {
    adminAuthError.textContent = ''
    adminAuthForm.reset()
    adminAuthModal.classList.remove('hidden')
    adminAuthForm.querySelector('#adminUsername').focus()
  }

  function closeAdminAuthModal() {
    adminAuthModal.classList.add('hidden')
    adminAuthError.textContent = ''
    adminAuthForm.reset()
  }

  async function openAdminScreen() {
    if (!adminAccessLevel) {
      openAdminAuthModal()
      return
    }

    adminError.textContent = ''
    editingRecordId = null
    applyAdminAccessUi()
    setAdminTab('all')
    showScreen('admin')
    try {
      const records = await refreshRecordsCount()
      await renderAdminPanel(records)
    } catch (_) {
      adminError.textContent = 'Unable to load player records.'
      await renderAdminPanel([])
    }
  }

  function handleAdminAuthSubmit(event) {
    event.preventDefault()
    adminAuthError.textContent = ''
    const form = new FormData(adminAuthForm)
    const username = form.get('username').trim()
    const password = form.get('password')

    const accessLevel = resolveAdminAccessLevel(username, password)
    if (!accessLevel) {
      adminAuthError.textContent = 'Invalid username or password.'
      return
    }

    adminAccessLevel = accessLevel
    closeAdminAuthModal()
    openAdminScreen()
  }

  async function handleSaveEdit(event) {
    if (!canAdminWrite()) return
    event.preventDefault()
    adminError.textContent = ''
    const form = event.currentTarget
    const recordId = Number(form.dataset.recordId)
    const formData = new FormData(form)
    const name = formData.get('name').trim()
    const mobile = formData.get('mobile').trim()
    const company = formData.get('company').trim()
    const topic = formData.get('topic').trim()
    const scoreValue = Number(formData.get('score'))
    const correctValue = Number(formData.get('correctCount'))
    const answeredValue = Number(formData.get('answeredCount'))
    const completedAt = new Date(formData.get('completedAt')).getTime()

    if (!name || !mobile || !company || Number.isNaN(scoreValue) || Number.isNaN(correctValue) || Number.isNaN(answeredValue) || Number.isNaN(completedAt)) {
      adminError.textContent = 'Please fill in all fields with valid values.'
      return
    }
    if (correctValue > answeredValue) {
      adminError.textContent = 'Correct answers cannot exceed total answered.'
      return
    }

    try {
      await updateGameResult({
        id: recordId,
        name,
        mobile,
        company,
        topic: topic || 'Not recorded',
        topicLabel: topic || 'Not recorded',
        score: scoreValue,
        correctCount: correctValue,
        answeredCount: answeredValue,
        completedAt,
      })
      editingRecordId = null
      const records = await refreshRecordsCount()
      await renderAdminPanel(records)
    } catch (_) {
      adminError.textContent = 'Unable to save changes. Please try again.'
    }
  }

  async function handleDeleteRecord(record) {
    if (!canAdminWrite()) return
    const confirmed = window.confirm(`Delete record for ${record.name}? This cannot be undone.`)
    if (!confirmed) return
    adminError.textContent = ''
    try {
      await deleteGameResult(record.id)
      await removeFromRecentPlayers(record.id)
      if (editingRecordId === record.id) editingRecordId = null
      const records = await refreshRecordsCount()
      await renderAdminPanel(records)
    } catch (_) {
      adminError.textContent = 'Unable to delete this record. Please try again.'
    }
  }

  async function handleResetRecent() {
    if (!canAdminWrite()) return
    const confirmed = window.confirm('Clear the recent players list? Saved records will remain in All Players.')
    if (!confirmed) return
    adminError.textContent = ''
    try {
      await clearRecentPlayers()
      await renderAdminPanel(cachedAdminRecords)
    } catch (_) {
      adminError.textContent = 'Unable to reset recent players. Please try again.'
    }
  }

  function showScreen(name) {
    Object.values(screens).forEach((el) => el?.classList.remove('active'))
    screens[name]?.classList.add('active')
  }

  function resizeCanvas() {
    const size = canvas.parentElement.clientWidth
    canvas.width = size * window.devicePixelRatio
    canvas.height = size * window.devicePixelRatio
    ctx.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0)
    drawWheel(wheelRotation)
  }

  function drawWheel(rotationDeg) {
    const size = canvas.width / window.devicePixelRatio
    const center = size / 2
    const radius = center - 8
    const sliceAngle = (2 * Math.PI) / topics.length

    ctx.clearRect(0, 0, size, size)
    ctx.save()
    ctx.translate(center, center)
    ctx.rotate((rotationDeg * Math.PI) / 180)

    topics.forEach((topic, i) => {
      const start = i * sliceAngle - Math.PI / 2
      const end = start + sliceAngle

      ctx.beginPath()
      ctx.moveTo(0, 0)
      ctx.arc(0, 0, radius, start, end)
      ctx.closePath()
      ctx.fillStyle = topic.color
      ctx.fill()
      ctx.strokeStyle = 'rgba(255,255,255,0.25)'
      ctx.lineWidth = 2
      ctx.stroke()

      ctx.save()
      ctx.rotate(start + sliceAngle / 2)
      ctx.textAlign = 'right'
      ctx.fillStyle = '#ffffff'
      ctx.font = `bold ${Math.max(11, size / 32)}px Segoe UI, sans-serif`
      ctx.shadowColor = 'rgba(0,0,0,0.5)'
      ctx.shadowBlur = 4
      const label = topic.label.length > 14 ? topic.label.slice(0, 12) + '…' : topic.label
      ctx.fillText(label, radius - 18, 5)
      ctx.restore()
    })

    ctx.restore()

    ctx.beginPath()
    ctx.arc(center, center, radius * 0.18, 0, 2 * Math.PI)
    ctx.fillStyle = '#1a1a2e'
    ctx.fill()
    ctx.strokeStyle = '#fbbf24'
    ctx.lineWidth = 3
    ctx.stroke()
  }

  function getTopicAtPointer(rotationDeg) {
    const sliceDeg = 360 / topics.length
    const normalized = ((rotationDeg % 360) + 360) % 360
    const pointerLocal = ((270 - normalized) % 360 + 360) % 360
    const offsetFromTop = (pointerLocal - 270 + 360) % 360
    const index = Math.floor(offsetFromTop / sliceDeg) % topics.length
    return topics[index]
  }

  function spinWheel() {
    if (isSpinning) return
    isSpinning = true
    spinBtn.disabled = true
    wheelStatus.textContent = 'Spinning…'

    const extraSpins = 5 + Math.floor(Math.random() * 4)
    const randomOffset = Math.random() * 360
    const targetRotation = wheelRotation + extraSpins * 360 + randomOffset
    const startRotation = wheelRotation
    const startTime = performance.now()

    function animate(now) {
      const elapsed = now - startTime
      const progress = Math.min(elapsed / SPIN_DURATION_MS, 1)
      const eased = 1 - Math.pow(1 - progress, 4)
      wheelRotation = startRotation + (targetRotation - startRotation) * eased
      drawWheel(wheelRotation)

      if (progress < 1) {
        requestAnimationFrame(animate)
      } else {
        wheelRotation = targetRotation % 360
        selectedTopic = getTopicAtPointer(wheelRotation)
        wheelStatus.innerHTML = `Topic selected: <strong>${selectedTopic.label}</strong>`
        isSpinning = false

        setTimeout(() => startQuiz(), 1200)
      }
    }

    requestAnimationFrame(animate)
  }

  function shuffleArray(arr) {
    const copy = [...arr]
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[copy[i], copy[j]] = [copy[j], copy[i]]
    }
    return copy
  }

  function startQuiz() {
    questionQueue = shuffleArray(selectedTopic.questions)
    currentQuestionIndex = 0
    score = 0
    correctCount = 0
    answeredCount = 0
    streak = 0
    maxStreak = 0
    timeRemaining = GAME_DURATION_SEC
    isAnswering = false

    if (player && selectedTopic) {
      player.topic = selectedTopic.label
      player.topicId = selectedTopic.id
    }

    topicDot.style.background = selectedTopic.color
    topicBadge.querySelector('.topic-label').textContent = selectedTopic.label
    scoreValue.textContent = '0'
    timerProgress.style.strokeDasharray = `${TIMER_CIRCUMFERENCE}`
    timerProgress.style.strokeDashoffset = '0'
    updateTimerDisplay()

    showScreen('quiz')
    renderQuestion()
    startTimer()
  }

  function startTimer() {
    clearInterval(timerInterval)
    timerInterval = setInterval(() => {
      timeRemaining -= 1
      updateTimerDisplay()

      if (timeRemaining <= 0) {
        endGame()
      }
    }, 1000)
  }

  function updateTimerDisplay() {
    timerValue.textContent = timeRemaining
    const progress = timeRemaining / GAME_DURATION_SEC
    timerProgress.style.strokeDashoffset = String(TIMER_CIRCUMFERENCE * (1 - progress))

    if (timeRemaining <= 10) {
      timerProgress.style.stroke = '#ef4444'
      timerValue.style.color = '#ef4444'
    } else {
      timerProgress.style.stroke = '#ff5500'
      timerValue.style.color = ''
    }
  }

  function shuffleQuestionOptions(options, correctIndex) {
    const order = options.map((_, index) => index)
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[order[i], order[j]] = [order[j], order[i]]
    }
    return {
      options: order.map((index) => options[index]),
      correct: order.indexOf(correctIndex),
    }
  }

  let currentDisplayCorrect = 0

  function renderQuestion() {
    if (currentQuestionIndex >= questionQueue.length) {
      endGame()
      return
    }

    const q = questionQueue[currentQuestionIndex]
    questionNumber.textContent = `Question ${answeredCount + 1}`
    questionText.textContent = q.text
    feedbackBar.textContent = ''
    feedbackBar.className = 'feedback-bar neutral'
    optionsGrid.innerHTML = ''
    isAnswering = false

    const shuffled = shuffleQuestionOptions(q.options, q.correct)
    currentDisplayCorrect = shuffled.correct

    const letters = ['A', 'B', 'C', 'D']
    shuffled.options.forEach((option, idx) => {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'option-btn'
      btn.setAttribute('aria-label', `Option ${letters[idx]}: ${option}`)
      btn.innerHTML = `<span class="option-letter">${letters[idx]}</span><span>${option}</span>`
      btn.addEventListener('click', () => handleAnswer(idx, btn))
      optionsGrid.appendChild(btn)
    })
  }

  function handleAnswer(selectedIndex, clickedBtn) {
    if (isAnswering || timeRemaining <= 0) return
    isAnswering = true

    const q = questionQueue[currentQuestionIndex]
    const isCorrect = selectedIndex === currentDisplayCorrect
    const allBtns = optionsGrid.querySelectorAll('.option-btn')
    allBtns.forEach((btn) => (btn.disabled = true))

    if (isCorrect) {
      clickedBtn.classList.add('correct')
      streak += 1
      maxStreak = Math.max(maxStreak, streak)
      correctCount += 1
      const streakBonus = streak >= 3 ? 50 : 0
      score += POINTS_PER_CORRECT + streakBonus
      scoreValue.textContent = String(score)
      feedbackBar.className = 'feedback-bar correct'
      feedbackBar.innerHTML =
        streak >= 3
          ? `Correct! +${POINTS_PER_CORRECT + streakBonus} pts <span class="streak-badge">${streak} streak!</span>`
          : `Correct! +${POINTS_PER_CORRECT} pts`
    } else {
      clickedBtn.classList.add('incorrect')
      allBtns[currentDisplayCorrect].classList.add('correct')
      streak = 0
      feedbackBar.className = 'feedback-bar incorrect'
      feedbackBar.textContent = 'Not quite — see the correct answer above'
    }

    answeredCount += 1
    currentQuestionIndex += 1

    setTimeout(() => {
      if (timeRemaining > 0) {
        renderQuestion()
      }
    }, FEEDBACK_DELAY_MS)
  }

  function endGame() {
    clearInterval(timerInterval)
    timerInterval = null

    const accuracy = answeredCount > 0 ? Math.round((correctCount / answeredCount) * 100) : 0
    document.getElementById('resultsIcon').textContent = accuracy >= 80 ? '🏆' : accuracy >= 50 ? '⭐' : '💪'
    document.getElementById('resultsTitle').textContent =
      accuracy >= 80 ? 'Cloudera Champion!' : accuracy >= 50 ? 'Solid Knowledge!' : 'Keep Learning!'
    document.getElementById('resultsTopic').textContent = `Topic: ${selectedTopic.label}`
    document.getElementById('finalScore').textContent = String(score)
    document.getElementById('finalCorrect').textContent = `${correctCount}/${answeredCount}`
    document.getElementById('finalAccuracy').textContent = `${accuracy}%`

    const rankEl = document.getElementById('rankMessage')
    if (accuracy >= 90) {
      rankEl.textContent = 'Outstanding! You know CDP inside and out.'
    } else if (accuracy >= 70) {
      rankEl.textContent = 'Great job! Strong grasp of Cloudera technologies.'
    } else if (accuracy >= 50) {
      rankEl.textContent = 'Good effort! Explore more CDP docs to level up.'
    } else {
      rankEl.textContent = 'Thanks for playing! Visit the Cloudera booth to learn more.'
    }

    saveScore()
      .then(renderLeaderboard)
      .catch((error) => {
        console.error('Failed to save score:', error)
        renderLeaderboard([])
        rankEl.textContent = 'Score could not be saved. Check server logs and Supabase config.'
      })
    showScreen('results')
  }

  function resetGame() {
    selectedTopic = null
    wheelRotation = 0
    isSpinning = false
    spinBtn.disabled = false
    wheelStatus.textContent = 'Spin the wheel to pick your topic!'
    drawWheel(0)
    player = null
    loginForm.reset()
    loginError.textContent = ''
    showScreen('login')
  }

  loginForm.addEventListener('submit', (event) => {
    event.preventDefault()
    const form = new FormData(loginForm)
    const name = form.get('name').trim()
    const mobile = form.get('mobile').trim()
    const company = form.get('company').trim()

    if (!name || !mobile || !company) {
      loginError.textContent = 'Please complete all fields to continue.'
      return
    }
    if (mobile.replace(/[^0-9]/g, '').length < 7) {
      loginError.textContent = 'Please enter a valid mobile number.'
      return
    }

    player = { name, mobile, company }
    loginError.textContent = ''
    showScreen('wheel')
    resizeCanvas()
  })

  spinBtn.addEventListener('click', spinWheel)
  playAgainBtn.addEventListener('click', resetGame)
  viewRecordsLink.addEventListener('click', openAdminAuthModal)
  adminAuthForm.addEventListener('submit', handleAdminAuthSubmit)
  adminAuthCancelBtn.addEventListener('click', closeAdminAuthModal)
  adminAuthBackdrop.addEventListener('click', closeAdminAuthModal)
  adminBackBtn.addEventListener('click', () => {
    editingRecordId = null
    adminError.textContent = ''
    adminAccessLevel = null
    showScreen('login')
  })
  adminTabAll.addEventListener('click', () => setAdminTab('all'))
  adminTabRecent.addEventListener('click', () => setAdminTab('recent'))
  adminTabAnalytics.addEventListener('click', () => setAdminTab('analytics'))
  downloadCsvBtn.addEventListener('click', () => downloadRecordsCsv(cachedAdminRecords))
  resetRecentBtn.addEventListener('click', handleResetRecent)
  resetWinnersBtn.addEventListener('click', async () => {
    const confirmed = window.confirm('Reset the current winners list? Saved player scores will remain in the data file.')
    if (!confirmed) return
    try {
      await apiRequest('/leaderboard', {
        method: 'PUT',
        body: JSON.stringify({ entries: [] }),
      })
      renderLeaderboard([])
    } catch (_) {
      window.alert('Unable to reset the winners list. Please try again.')
    }
  })

  window.addEventListener('resize', () => {
    if (screens.wheel.classList.contains('active')) {
      resizeCanvas()
    }
  })

  timerProgress.style.strokeDasharray = `${TIMER_CIRCUMFERENCE}`
  timerProgress.style.strokeDashoffset = '0'

  async function bootstrapApp() {
    setQuestionLoadState({ isLoading: true })
    try {
      applyQuestionBank(await loadQuestionBank())
      setQuestionLoadState()
      await refreshRecordsCount()
    } catch (error) {
      setQuestionLoadState({
        error: error instanceof Error
          ? `${error.message}. Run "npm start", configure Supabase in .env, and verify questions.json exists.`
          : 'Unable to load questions.',
      })
    }
  }

  bootstrapApp()
})()
