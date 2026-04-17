/* =============================================
   ARSENAL FC PWA — app.js
   API: football-data.org (gratis, 10 calls/min)
   Reddit: publieke JSON feed (geen key nodig)
   ============================================= */

// football-data.org IDs
const ARSENAL_ID  = 57;    // Arsenal team ID
const PL_ID       = 2021;  // Premier League competition ID
const UCL_ID      = 2001;  // Champions League
const FAC_ID      = 2055;  // FA Cup
const ELC_ID      = 2016;  // EFL Cup
const SEASON      = 2024;

const FDORG_BASE  = 'https://api.football-data.org/v4';

// ---------- STATE ----------
const state = {
  apiKey: null,
  matches: [],        // all Arsenal matches this season
  standings: [],      // PL standings
  scorers: [],        // PL top scorers
  lineup: null,       // lineup for next/live match (not available in free tier)
  news: [],
  lastFetch: null,
  currentTab: 'home',
  fixtureFilter: 'upcoming',
  newsFilter: 'all',
  refreshing: false,
};

// =====================================================
// INIT
// =====================================================
document.addEventListener('DOMContentLoaded', () => {
  state.apiKey = localStorage.getItem('arsenal_fdorg_key');
  if (!state.apiKey) {
    showSetup();
  } else {
    showApp();
    loadAll();
  }
  bindEvents();
});

function bindEvents() {
  document.getElementById('save-key-btn').addEventListener('click', saveKey);
  document.getElementById('api-key-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') saveKey();
  });

  document.getElementById('refresh-btn').addEventListener('click', () => {
    if (!state.refreshing) loadAll(true);
  });
  document.getElementById('settings-btn').addEventListener('click', () => {
    if (confirm('Wil je je API key wijzigen?')) {
      localStorage.removeItem('arsenal_fdorg_key');
      state.apiKey = null;
      showSetup();
    }
  });

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  document.querySelectorAll('[data-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      // Identify which filter group this belongs to
      const group = btn.closest('section')?.id || btn.closest('.filter-row')?.dataset.group;
      btn.closest('.filter-row').querySelectorAll('[data-filter]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.fixtureFilter = btn.dataset.filter;
      renderFixtures();
    });
  });

  document.querySelectorAll('[data-source]').forEach(btn => {
    btn.addEventListener('click', () => {
      btn.closest('.filter-row').querySelectorAll('[data-source]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.newsFilter = btn.dataset.source;
      renderNews();
    });
  });
}

// =====================================================
// SETUP / KEY
// =====================================================
function saveKey() {
  const key = document.getElementById('api-key-input').value.trim();
  if (!key || key.length < 20) {
    alert('Voer een geldige API key in (minimaal 20 tekens).');
    return;
  }
  localStorage.setItem('arsenal_fdorg_key', key);
  state.apiKey = key;
  showApp();
  loadAll();
}

function showSetup() {
  document.getElementById('setup-screen').classList.remove('hidden');
  document.getElementById('app').classList.add('hidden');
}
function showApp() {
  document.getElementById('setup-screen').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
}

// =====================================================
// TAB SWITCHING
// =====================================================
function switchTab(tab) {
  state.currentTab = tab;
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.id === `tab-${tab}`));
}

// =====================================================
// FETCH HELPERS
// =====================================================
async function fdFetch(path) {
  const url = `${FDORG_BASE}${path}`;
  const res = await fetch(url, {
    headers: {
      'X-Auth-Token': state.apiKey,
    }
  });
  if (res.status === 429) throw new Error('Rate limit — wacht even en probeer opnieuw (max 10/min)');
  if (res.status === 403) throw new Error('Ongeldige API key of geen toegang tot dit endpoint');
  if (!res.ok) throw new Error(`API fout: ${res.status}`);
  return res.json();
}

async function redditFetch(subreddit = 'Gunners', sort = 'hot', limit = 25) {
  const url = `https://www.reddit.com/r/${subreddit}/${sort}.json?limit=${limit}&raw_json=1`;
  const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
  if (!res.ok) throw new Error('Reddit niet bereikbaar');
  const data = await res.json();
  return data.data.children.map(c => c.data);
}

async function fetchRSS(rssUrl) {
  // Use a public CORS proxy for RSS feeds
  const proxy = `https://api.allorigins.win/get?url=${encodeURIComponent(rssUrl)}`;
  try {
    const res = await fetch(proxy);
    const data = await res.json();
    if (!data.contents) return [];

    // Parse XML
    const parser = new DOMParser();
    const xml = parser.parseFromString(data.contents, 'text/xml');
    const items = Array.from(xml.querySelectorAll('item')).slice(0, 15);
    return items.map(item => ({
      title: item.querySelector('title')?.textContent || '',
      link: item.querySelector('link')?.textContent || '',
      pubDate: item.querySelector('pubDate')?.textContent || new Date().toISOString(),
      description: (item.querySelector('description')?.textContent || '').replace(/<[^>]+>/g, '').slice(0, 200),
      thumbnail: item.querySelector('enclosure')?.getAttribute('url') ||
                 item.querySelector('media\\:thumbnail, thumbnail')?.getAttribute('url') || null,
      source: 'arsenal',
    }));
  } catch {
    return [];
  }
}

// =====================================================
// LOAD ALL DATA
// =====================================================
async function loadAll(forceRefresh = false) {
  if (state.refreshing) return;
  state.refreshing = true;

  const btn = document.getElementById('refresh-btn');
  btn.classList.add('spinning');

  setHTML('home-content', loadingHTML('Wedstrijddata laden…'));
  setHTML('lineup-content', loadingHTML('Opstelling laden…'));
  setHTML('fixtures-content', loadingHTML('Fixtures laden…'));
  setHTML('stats-content', loadingHTML('Statistieken laden…'));
  setHTML('news-content', loadingHTML('Nieuws laden…'));

  // football-data.org free tier: 10 calls/minute — run sequentially with small delays
  // to avoid rate-limiting. We need: matches, standings, scorers, news
  const results = await Promise.allSettled([
    fetchMatches(),
    delay(600).then(() => fetchStandings()),
    delay(1200).then(() => fetchScorers()),
    fetchNews(),
  ]);

  results.forEach((r, i) => {
    if (r.status === 'rejected') {
      console.warn(`Fetch ${i} mislukt:`, r.reason?.message || r.reason);
    }
  });

  state.lastFetch = new Date();
  document.getElementById('last-updated').textContent = `Bijgewerkt: ${timeAgo(state.lastFetch)}`;

  renderAll();
  btn.classList.remove('spinning');
  state.refreshing = false;
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// =====================================================
// DATA FETCHERS
// =====================================================
async function fetchMatches() {
  // Get all Arsenal matches this season (past + upcoming)
  const data = await fdFetch(`/teams/${ARSENAL_ID}/matches?season=${SEASON}&limit=50`);
  state.matches = (data.matches || []).map(m => ({
    ...m,
    isLive: ['IN_PLAY', 'PAUSED', 'HALFTIME'].includes(m.status),
    isFinished: ['FINISHED'].includes(m.status),
    isUpcoming: ['SCHEDULED', 'TIMED'].includes(m.status),
  }));
}

async function fetchStandings() {
  const data = await fdFetch(`/competitions/${PL_ID}/standings?season=${SEASON}`);
  // Get the overall table
  const overall = data.standings?.find(s => s.type === 'TOTAL');
  state.standings = overall?.table || [];
}

async function fetchScorers() {
  const data = await fdFetch(`/competitions/${PL_ID}/scorers?season=${SEASON}&limit=20`);
  state.scorers = data.scorers || [];
}

async function fetchNews() {
  const [redditResult, arsenalResult] = await Promise.allSettled([
    redditFetch('Gunners', 'hot', 30),
    fetchRSS('https://www.arsenal.com/rss/news'),
  ]);

  const reddit = (redditResult.status === 'fulfilled' ? redditResult.value : [])
    .filter(p => !p.stickied && p.score > 5)
    .map(p => ({
      source: 'reddit',
      title: p.title,
      link: `https://reddit.com${p.permalink}`,
      pubDate: new Date(p.created_utc * 1000).toISOString(),
      score: p.score,
      thumbnail: p.thumbnail && p.thumbnail.startsWith('http') && !p.thumbnail.includes('self') ? p.thumbnail : null,
      numComments: p.num_comments,
      flair: p.link_flair_text || '',
      description: '',
    }));

  const arsenal = arsenalResult.status === 'fulfilled' ? arsenalResult.value : [];

  // Interleave: reddit + arsenal sorted by date
  state.news = [...reddit, ...arsenal].sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
}

// =====================================================
// RENDERERS
// =====================================================
function renderAll() {
  renderHome();
  renderLineup();
  renderFixtures();
  renderStats();
  renderNews();
}

// ---- HOME ----
function renderHome() {
  let html = '';
  const now = new Date();

  const liveMatch = state.matches.find(m => m.isLive);
  const nextMatch = state.matches
    .filter(m => m.isUpcoming)
    .sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate))[0];
  const lastMatch = state.matches
    .filter(m => m.isFinished)
    .sort((a, b) => new Date(b.utcDate) - new Date(a.utcDate))[0];

  if (liveMatch) {
    html += `<div class="section-label">🔴 Live</div>`;
    html += matchCardHTML(liveMatch);
  }

  if (nextMatch) {
    html += `<div class="section-label">Volgende wedstrijd</div>`;
    html += matchCardHTML(nextMatch);
  }

  if (lastMatch && !liveMatch) {
    html += `<div class="section-label">Laatste resultaat</div>`;
    html += matchCardHTML(lastMatch);
  }

  if (state.standings.length > 0) {
    html += `<div class="section-label">Premier League stand</div>`;
    html += standingsMiniHTML();
  }

  // Recent form from last 5 finished matches
  const recentForm = state.matches
    .filter(m => m.isFinished)
    .sort((a, b) => new Date(b.utcDate) - new Date(a.utcDate))
    .slice(0, 5);
  if (recentForm.length > 0) {
    html += `<div class="section-label">Laatste 5 wedstrijden</div>`;
    html += formFromMatches(recentForm);
  }

  if (!html) {
    html = errorHTML('Kon geen data laden. Controleer je API key en probeer opnieuw.');
  }

  setHTML('home-content', html);
}

function getArsenalResult(m) {
  const isHome = m.homeTeam.id === ARSENAL_ID;
  const arsScore = isHome ? m.score.fullTime.home : m.score.fullTime.away;
  const oppScore = isHome ? m.score.fullTime.away : m.score.fullTime.home;
  if (arsScore === null || oppScore === null) return null;
  if (arsScore > oppScore) return 'W';
  if (arsScore < oppScore) return 'L';
  return 'D';
}

function matchCardHTML(m) {
  const isHome = m.homeTeam.id === ARSENAL_ID;
  const home = m.homeTeam;
  const away = m.awayTeam;
  const date = new Date(m.utcDate);
  const status = m.status;

  const isLive = m.isLive;
  const isFinished = m.isFinished;

  let resultClass = '';
  if (isFinished) {
    const r = getArsenalResult(m);
    if (r === 'W') resultClass = 'win';
    else if (r === 'L') resultClass = 'loss';
    else resultClass = 'draw';
  }

  const homeScore = m.score?.fullTime?.home ?? (isLive ? m.score?.halfTime?.home ?? '–' : '–');
  const awayScore = m.score?.fullTime?.away ?? (isLive ? m.score?.halfTime?.away ?? '–' : '–');

  const scoreEl = (isLive || isFinished)
    ? `<div class="score-main ${resultClass}">${homeScore} - ${awayScore}</div>
       ${isLive ? `<div class="score-time"><span class="live-badge">LIVE</span></div>` : ''}
       ${isFinished ? `<div class="score-time">Afgelopen</div>` : ''}`
    : `<div class="score-vs">vs</div>
       <div class="score-date">${formatDate(date)}<br>${formatTime(date)}</div>`;

  const comp = m.competition?.name || 'Wedstrijd';
  const round = m.matchday ? `Speelronde ${m.matchday}` : (m.stage?.replace(/_/g,' ') || '');

  return `<div class="match-card">
    <div class="match-card-header">
      <span class="comp">${comp}${round ? ` &middot; ${round}` : ''}</span>
      ${isLive ? '<span class="live-badge">LIVE</span>' : ''}
    </div>
    <div class="match-body">
      <div class="match-teams">
        <div class="team-side">
          <div class="team-logo-placeholder">${home.name === 'Arsenal FC' ? '🔴' : '⚽'}</div>
          <div class="team-name">${home.name}</div>
        </div>
        <div class="score-block">${scoreEl}</div>
        <div class="team-side right">
          <div class="team-logo-placeholder">⚽</div>
          <div class="team-name">${away.name}</div>
        </div>
      </div>
    </div>
    <div class="match-footer">
      <span>📍 ${m.venue || 'Onbekend'}</span>
      <span>${m.referees?.[0]?.name || ''}</span>
    </div>
  </div>`;
}

function standingsMiniHTML() {
  if (!state.standings.length) return '';
  const arsIdx = state.standings.findIndex(t => t.team.id === ARSENAL_ID);
  if (arsIdx === -1) return '';
  const start = Math.max(0, arsIdx - 3);
  const end = Math.min(state.standings.length - 1, arsIdx + 3);
  const slice = state.standings.slice(start, end + 1);

  let html = `<div class="standings-mini">
    <div class="standings-mini-header">Pos &nbsp;&nbsp; Club &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; Ptn</div>`;
  slice.forEach(t => {
    const isArs = t.team.id === ARSENAL_ID;
    const top4 = t.position <= 4;
    html += `<div class="standings-mini-row ${isArs ? 'arsenal' : ''}">
      <span class="std-pos ${top4 ? 'top4' : ''}">${t.position}</span>
      <span class="std-name">${isArs ? `<strong>${t.team.name}</strong>` : t.team.name}</span>
      <span class="std-pts">${t.points}</span>
      <span class="std-detail">${t.won}W ${t.draw}G ${t.lost}V</span>
    </div>`;
  });
  html += `</div>`;
  return html;
}

function formFromMatches(matches) {
  let html = `<div class="form-row">`;
  matches.forEach(m => {
    const r = getArsenalResult(m);
    const cls = r === 'W' ? 'W' : r === 'L' ? 'L' : 'D';
    html += `<div class="form-badge ${cls}" title="${m.homeTeam.name} vs ${m.awayTeam.name}">${r || '?'}</div>`;
  });
  html += `</div>`;
  return html;
}

// ---- LINEUP ----
function renderLineup() {
  // football-data.org free tier does NOT include lineups
  // Show next match info and explain
  const nextMatch = state.matches
    .filter(m => m.isUpcoming)
    .sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate))[0];

  const liveMatch = state.matches.find(m => m.isLive);
  const target = liveMatch || nextMatch;

  let html = '';
  if (target) {
    const date = new Date(target.utcDate);
    html += `<div class="no-lineup">
      <div class="big-icon">📋</div>
      <p><strong>${target.homeTeam.name} vs ${target.awayTeam.name}</strong><br>
      ${target.isLive ? '🔴 Nu live!' : formatDate(date) + ' om ' + formatTime(date)}</p>
      <p style="margin-top:16px;font-size:13px;color:var(--text2)">
        Opstellingen zijn niet beschikbaar in de gratis tier van football-data.org.<br><br>
        Bekijk opstellingen live op:<br>
        <a href="https://www.bbc.com/sport/football/arsenal" target="_blank" rel="noopener" style="color:var(--red-light)">BBC Sport</a> &nbsp;·&nbsp;
        <a href="https://www.skysports.com/arsenal" target="_blank" rel="noopener" style="color:var(--red-light)">Sky Sports</a> &nbsp;·&nbsp;
        <a href="https://www.arsenal.com" target="_blank" rel="noopener" style="color:var(--red-light)">Arsenal.com</a>
      </p>
    </div>`;
  } else {
    html = `<div class="no-lineup">
      <div class="big-icon">📋</div>
      <p>Geen komende wedstrijd gevonden.</p>
    </div>`;
  }

  setHTML('lineup-content', html);
}

// ---- FIXTURES ----
function renderFixtures() {
  const now = new Date();
  let data;

  if (state.fixtureFilter === 'upcoming') {
    data = state.matches
      .filter(m => m.isUpcoming || m.isLive)
      .sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate))
      .slice(0, 20);
  } else {
    data = state.matches
      .filter(m => m.isFinished)
      .sort((a, b) => new Date(b.utcDate) - new Date(a.utcDate))
      .slice(0, 30);
  }

  if (!data.length) {
    setHTML('fixtures-content', `<div class="loading-card"><p>Geen wedstrijden gevonden.</p></div>`);
    return;
  }

  let html = '';
  let lastMonth = '';
  data.forEach(m => {
    const date = new Date(m.utcDate);
    const month = date.toLocaleDateString('nl-NL', { month: 'long', year: 'numeric' });
    if (month !== lastMonth) {
      html += `<div class="section-label">${month}</div>`;
      lastMonth = month;
    }

    const isHome = m.homeTeam.id === ARSENAL_ID;
    const opponent = isHome ? m.awayTeam.name : m.homeTeam.name;
    const homeAway = isHome ? 'Thuis' : 'Uit';
    const isFinished = m.isFinished;
    const isLive = m.isLive;

    let scoreHTML = '';
    let scoreClass = '';

    if (isLive) {
      scoreHTML = `<span class="live-badge" style="font-size:11px">LIVE</span>`;
    } else if (isFinished) {
      const r = getArsenalResult(m);
      scoreClass = r === 'W' ? 'win' : r === 'L' ? 'loss' : 'draw';
      const h = m.score.fullTime.home;
      const a = m.score.fullTime.away;
      scoreHTML = `${h} - ${a}`;
    } else {
      scoreHTML = formatTime(date);
    }

    const comp = m.competition?.name || '';

    html += `<div class="fixture-row">
      <div class="fixture-date">
        <div class="day">${date.getDate()}</div>
        <div class="month">${date.toLocaleDateString('nl-NL', { month: 'short' })}</div>
      </div>
      <div class="fixture-main">
        <div class="fixture-teams">Arsenal vs ${opponent}</div>
        <div class="fixture-meta">${homeAway} &middot; ${comp}</div>
      </div>
      ${(isFinished || isLive)
        ? `<div class="fixture-score ${scoreClass}">${scoreHTML}</div>`
        : `<div class="fixture-time">${scoreHTML}</div>`}
    </div>`;
  });

  setHTML('fixtures-content', html);
}

// ---- STATS ----
function renderStats() {
  const finished = state.matches.filter(m => m.isFinished);
  const wins   = finished.filter(m => getArsenalResult(m) === 'W').length;
  const draws  = finished.filter(m => getArsenalResult(m) === 'D').length;
  const losses = finished.filter(m => getArsenalResult(m) === 'L').length;
  const played = finished.length;

  let goalsFor = 0, goalsAgainst = 0;
  finished.forEach(m => {
    const isHome = m.homeTeam.id === ARSENAL_ID;
    goalsFor     += (isHome ? m.score.fullTime.home : m.score.fullTime.away) || 0;
    goalsAgainst += (isHome ? m.score.fullTime.away : m.score.fullTime.home) || 0;
  });
  const cleanSheets = finished.filter(m => {
    const isHome = m.homeTeam.id === ARSENAL_ID;
    return (isHome ? m.score.fullTime.away : m.score.fullTime.home) === 0;
  }).length;

  let html = `<div class="section-label">Seizoen 2024/25 — Alle competities</div>`;

  // Recent form
  const recentForm = finished.sort((a, b) => new Date(b.utcDate) - new Date(a.utcDate)).slice(0, 10);
  if (recentForm.length) html += formFromMatches(recentForm.slice(0, 10));

  html += `<div class="stats-grid">
    <div class="stat-card"><div class="stat-val">${played}</div><div class="stat-label">Gespeeld</div></div>
    <div class="stat-card"><div class="stat-val">${wins}</div><div class="stat-label">Gewonnen</div></div>
    <div class="stat-card"><div class="stat-val">${draws}</div><div class="stat-label">Gelijk</div></div>
    <div class="stat-card"><div class="stat-val red">${losses}</div><div class="stat-label">Verloren</div></div>
    <div class="stat-card"><div class="stat-val">${goalsFor}</div><div class="stat-label">Goals voor</div></div>
    <div class="stat-card"><div class="stat-val red">${goalsAgainst}</div><div class="stat-label">Goals tegen</div></div>
    <div class="stat-card"><div class="stat-val">${cleanSheets}</div><div class="stat-label">Clean sheets</div></div>
    <div class="stat-card"><div class="stat-val">${played > 0 ? (goalsFor / played).toFixed(1) : '0'}</div><div class="stat-label">Goals/duel</div></div>
  </div>`;

  const winPct = played > 0 ? Math.round((wins / played) * 100) : 0;
  const csPct  = played > 0 ? Math.round((cleanSheets / played) * 100) : 0;
  html += `<div class="section-label">Percentages</div>`;
  html += barRow('Win percentage', `${winPct}%`, winPct);
  html += barRow('Clean sheet rate', `${csPct}%`, csPct);

  // PL Top scorers
  if (state.scorers.length > 0) {
    html += `<div class="section-label">Topscorers Premier League</div>`;
    html += `<div class="card"><div style="padding:8px 14px" class="top-scorers-list">`;
    state.scorers.slice(0, 10).forEach((s, i) => {
      const isArsenal = s.team?.id === ARSENAL_ID;
      html += `<div class="scorer-row">
        <div class="scorer-rank">${i + 1}</div>
        <div class="scorer-info">
          <div class="scorer-name">${s.player?.name || '–'} ${isArsenal ? '<span style="color:var(--red);font-size:11px">⚽ Arsenal</span>' : ''}</div>
          <div class="scorer-detail">${s.team?.name || ''} &middot; ${s.playedMatches || 0} duels</div>
        </div>
        <div class="scorer-goals">${s.goals || 0} <small>goals</small></div>
      </div>`;
    });
    html += `</div></div>`;
  }

  // Full PL standings
  if (state.standings.length > 0) {
    html += `<div class="section-label">Premier League stand</div>`;
    html += `<div class="card" style="overflow:hidden"><div style="padding:0 14px">`;
    state.standings.forEach(t => {
      const isArs = t.team.id === ARSENAL_ID;
      const top4 = t.position <= 4;
      html += `<div class="scorer-row" style="${isArs ? 'background:rgba(239,1,7,0.08);margin:0 -14px;padding:9px 14px' : ''}">
        <div class="scorer-rank" style="${top4 ? 'color:#4ADE80' : ''}">${t.position}</div>
        <div class="scorer-info">
          <div class="scorer-name">${isArs ? `<strong>${t.team.name}</strong>` : t.team.name}</div>
          <div class="scorer-detail">${t.playedGames} gespeeld &middot; ${t.goalDifference > 0 ? '+' : ''}${t.goalDifference} DS</div>
        </div>
        <div class="scorer-goals">${t.points} <small>ptn</small></div>
      </div>`;
    });
    html += `</div></div>`;
  }

  setHTML('stats-content', html);
}

function barRow(label, valueLabel, pct) {
  return `<div class="stat-bar-row">
    <div class="stat-bar-label"><span>${label}</span><span>${valueLabel}</span></div>
    <div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div>
  </div>`;
}

// ---- NEWS ----
function renderNews() {
  let items = state.news;
  if (state.newsFilter === 'reddit') items = items.filter(n => n.source === 'reddit');
  else if (state.newsFilter === 'arsenal') items = items.filter(n => n.source === 'arsenal');

  if (!items.length) {
    setHTML('news-content', `<div class="loading-card"><p>Geen nieuws gevonden.</p></div>`);
    return;
  }

  let html = '';
  items.slice(0, 40).forEach(item => {
    const isReddit = item.source === 'reddit';
    const ago = timeAgo(new Date(item.pubDate));
    const thumb = item.thumbnail;

    html += `<a class="news-card" href="${item.link}" target="_blank" rel="noopener">`;
    if (thumb) {
      html += `<img class="news-card-img" src="${thumb}" alt="" loading="lazy" onerror="this.style.display='none'">`;
    }
    html += `<div class="news-card-body">
      <div>
        <span class="news-source-badge ${isReddit ? 'reddit' : ''}">
          ${isReddit ? '▲ r/Gunners' : '🔴 arsenal.com'}
        </span>
        ${isReddit && item.score ? `<span class="upvote-badge">▲ ${fmtNum(item.score)}</span>` : ''}
      </div>
      <div class="news-card-title">${escHTML(item.title)}</div>
      <div class="news-card-meta">${ago}${isReddit && item.numComments ? ` &middot; ${item.numComments} reacties` : ''}</div>
      ${item.description ? `<div class="news-card-excerpt">${escHTML(item.description)}</div>` : ''}
    </div></a>`;
  });

  setHTML('news-content', html);
}

// =====================================================
// HELPERS
// =====================================================
function setHTML(id, html) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = html;
}
function loadingHTML(msg = 'Laden…') {
  return `<div class="loading-card"><div class="spinner"></div><p>${msg}</p></div>`;
}
function errorHTML(msg) {
  return `<div class="error-card">⚠️ ${msg}</div>`;
}
function escHTML(str) {
  if (!str) return '';
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function fmtNum(n) {
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return n;
}
function formatDate(d) {
  return d.toLocaleDateString('nl-NL', { weekday: 'short', day: 'numeric', month: 'short' });
}
function formatTime(d) {
  return d.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
}
function timeAgo(date) {
  if (!date) return '';
  const secs = Math.floor((new Date() - date) / 1000);
  if (secs < 60) return 'zojuist';
  if (secs < 3600) return `${Math.floor(secs / 60)} min geleden`;
  if (secs < 86400) return `${Math.floor(secs / 3600)} uur geleden`;
  return `${Math.floor(secs / 86400)} dagen geleden`;
}

// Auto-refresh: 3 min live, 15 min normaal
setInterval(() => {
  const hasLive = state.matches.some(m => m.isLive);
  const mins = hasLive ? 3 : 15;
  if (state.lastFetch && (new Date() - state.lastFetch) > mins * 60 * 1000) {
    if (state.apiKey) loadAll();
  }
}, 60 * 1000);
