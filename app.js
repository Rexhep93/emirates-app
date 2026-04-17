/* =============================================
   ARSENAL FC PWA — app.js
   API: api-football via RapidAPI (gratis tier)
   Reddit: publieke JSON feed (geen key nodig)
   ============================================= */

const ARSENAL_ID  = 42;
const SEASON      = 2024;
const LEAGUE_PL   = 39;   // Premier League
const LEAGUE_UCL  = 2;    // Champions League
const LEAGUE_FAC  = 45;   // FA Cup
const LEAGUE_ELC  = 48;   // EFL Cup
const ALL_LEAGUES = [LEAGUE_PL, LEAGUE_UCL, LEAGUE_FAC, LEAGUE_ELC];

// ---------- STATE ----------
const state = {
  apiKey: null,
  fixtures: [],
  standings: [],
  teamStats: null,
  topScorers: [],
  lineup: null,
  news: [],
  lastFetch: null,
  currentTab: 'home',
  fixtureFilter: 'upcoming',
  newsFilter: 'all',
};

// =====================================================
// INIT
// =====================================================
document.addEventListener('DOMContentLoaded', () => {
  state.apiKey = localStorage.getItem('arsenal_api_key');
  if (!state.apiKey) {
    showSetup();
  } else {
    showApp();
    loadAll();
  }
  bindEvents();
});

function bindEvents() {
  // Setup
  document.getElementById('save-key-btn').addEventListener('click', saveKey);
  document.getElementById('api-key-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') saveKey();
  });

  // Header buttons
  document.getElementById('refresh-btn').addEventListener('click', () => {
    if (!state.refreshing) loadAll(true);
  });
  document.getElementById('settings-btn').addEventListener('click', () => {
    if (confirm('Wil je je API key wijzigen?')) {
      localStorage.removeItem('arsenal_api_key');
      state.apiKey = null;
      showSetup();
    }
  });

  // Tab nav
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // Fixture filter
  document.querySelectorAll('[data-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-filter]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.fixtureFilter = btn.dataset.filter;
      renderFixtures();
    });
  });

  // News source filter
  document.querySelectorAll('[data-source]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-source]').forEach(b => b.classList.remove('active'));
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
  localStorage.setItem('arsenal_api_key', key);
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
async function apiFetch(path) {
  const url = `https://api-football-v1.p.rapidapi.com/v3${path}`;
  const res = await fetch(url, {
    headers: {
      'X-RapidAPI-Key': state.apiKey,
      'X-RapidAPI-Host': 'api-football-v1.p.rapidapi.com',
    }
  });
  if (!res.ok) throw new Error(`API fout: ${res.status}`);
  const data = await res.json();
  if (data.errors && Object.keys(data.errors).length > 0) {
    const msg = JSON.stringify(data.errors);
    throw new Error(`API melding: ${msg}`);
  }
  return data.response;
}

async function redditFetch(subreddit = 'Gunners', sort = 'hot', limit = 20) {
  const url = `https://www.reddit.com/r/${subreddit}/${sort}.json?limit=${limit}&raw_json=1`;
  const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
  if (!res.ok) throw new Error('Reddit niet bereikbaar');
  const data = await res.json();
  return data.data.children.map(c => c.data);
}

async function arsenalRSSFetch() {
  // Arsenal.com RSS via rss2json (gratis, geen key)
  const rssUrl = encodeURIComponent('https://www.arsenal.com/rss/news');
  const url = `https://api.rss2json.com/v1/api.json?rss_url=${rssUrl}&count=15`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    if (data.status !== 'ok') return [];
    return data.items.map(item => ({
      title: item.title,
      link: item.link,
      pubDate: item.pubDate,
      thumbnail: item.thumbnail || item.enclosure?.link || null,
      description: item.description?.replace(/<[^>]+>/g, '').slice(0, 200) || '',
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

  // Show loaders
  setHTML('home-content', loadingHTML('Wedstrijddata laden…'));
  setHTML('lineup-content', loadingHTML('Opstelling laden…'));
  setHTML('fixtures-content', loadingHTML('Fixtures laden…'));
  setHTML('stats-content', loadingHTML('Statistieken laden…'));
  setHTML('news-content', loadingHTML('Nieuws laden…'));

  // Parallel fetches
  const results = await Promise.allSettled([
    fetchFixtures(),
    fetchStandings(),
    fetchTeamStats(),
    fetchTopScorers(),
    fetchNews(),
  ]);

  results.forEach((r, i) => {
    if (r.status === 'rejected') {
      console.error(`Fetch ${i} mislukt:`, r.reason);
    }
  });

  state.lastFetch = new Date();
  document.getElementById('last-updated').textContent = `Bijgewerkt: ${timeAgo(state.lastFetch)}`;

  renderAll();
  btn.classList.remove('spinning');
  state.refreshing = false;
}

// =====================================================
// DATA FETCHERS
// =====================================================
async function fetchFixtures() {
  // Fetch last 10 + next 10
  const [past, upcoming, live] = await Promise.all([
    apiFetch(`/fixtures?team=${ARSENAL_ID}&season=${SEASON}&last=15`),
    apiFetch(`/fixtures?team=${ARSENAL_ID}&season=${SEASON}&next=15`),
    apiFetch(`/fixtures?team=${ARSENAL_ID}&live=all`),
  ]);

  // Merge live into upcoming (live fixtures replace their upcoming counterpart)
  const liveIds = new Set((live || []).map(f => f.fixture.id));
  const upcomingFiltered = (upcoming || []).filter(f => !liveIds.has(f.fixture.id));

  state.fixtures = [
    ...(live || []).map(f => ({ ...f, isLive: true })),
    ...upcomingFiltered,
    ...(past || []),
  ].sort((a, b) => new Date(b.fixture.date) - new Date(a.fixture.date));

  // Try to find lineup from live or most recent finished match
  const liveMatch = (live || [])[0];
  const lastFinished = (past || []).slice().reverse().find(f => f.fixture.status.short === 'FT');
  const lineupSource = liveMatch || lastFinished;

  if (lineupSource) {
    try {
      const lineups = await apiFetch(`/fixtures/lineups?fixture=${lineupSource.fixture.id}`);
      state.lineup = {
        fixture: lineupSource,
        lineups: lineups,
        isLive: !!liveMatch,
      };
    } catch {
      state.lineup = null;
    }
  }
}

async function fetchStandings() {
  const data = await apiFetch(`/standings?league=${LEAGUE_PL}&season=${SEASON}`);
  state.standings = data?.[0]?.league?.standings?.[0] || [];
}

async function fetchTeamStats() {
  const data = await apiFetch(`/teams/statistics?league=${LEAGUE_PL}&season=${SEASON}&team=${ARSENAL_ID}`);
  state.teamStats = data;
}

async function fetchTopScorers() {
  const data = await apiFetch(`/players/topscorers?league=${LEAGUE_PL}&season=${SEASON}`);
  // Filter to Arsenal players only
  const arsenalScorers = (data || []).filter(p => p.statistics[0]?.team?.id === ARSENAL_ID);
  // If <3 Arsenal players in top, get all arsenal players goals
  if (arsenalScorers.length < 3) {
    state.topScorers = (data || []).slice(0, 10);
  } else {
    state.topScorers = arsenalScorers.slice(0, 8);
  }
}

async function fetchNews() {
  const [redditPosts, arsenalNews] = await Promise.allSettled([
    redditFetch('Gunners', 'hot', 25),
    arsenalRSSFetch(),
  ]);

  const reddit = (redditPosts.status === 'fulfilled' ? redditPosts.value : [])
    .filter(p => !p.stickied && p.score > 10)
    .map(p => ({
      source: 'reddit',
      title: p.title,
      link: `https://reddit.com${p.permalink}`,
      pubDate: new Date(p.created_utc * 1000).toISOString(),
      score: p.score,
      thumbnail: p.thumbnail && p.thumbnail.startsWith('http') && !p.thumbnail.includes('self') ? p.thumbnail : null,
      numComments: p.num_comments,
      flair: p.link_flair_text || '',
    }));

  const arsenal = arsenalNews.status === 'fulfilled' ? arsenalNews.value : [];

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

  // Next/live match
  const now = new Date();
  const liveMatch = state.fixtures.find(f => f.isLive);
  const nextMatch = state.fixtures.find(f => new Date(f.fixture.date) > now && !f.isLive);
  const lastMatch = state.fixtures.find(f =>
    new Date(f.fixture.date) < now && !f.isLive && ['FT','AET','PEN'].includes(f.fixture.status.short)
  );

  if (liveMatch) {
    html += `<div class="section-label">🔴 Live</div>`;
    html += matchCardHTML(liveMatch, true);
  }

  if (nextMatch) {
    html += `<div class="section-label">Volgende wedstrijd</div>`;
    html += matchCardHTML(nextMatch, false);
  }

  if (lastMatch && !liveMatch) {
    html += `<div class="section-label">Laatste resultaat</div>`;
    html += matchCardHTML(lastMatch, false);
  }

  // Mini standings
  if (state.standings.length > 0) {
    html += `<div class="section-label">Premier League stand</div>`;
    html += standingsMiniHTML();
  }

  // Recent form from stats
  if (state.teamStats?.form) {
    html += `<div class="section-label">Vorm (laatste 5)</div>`;
    html += formHTML(state.teamStats.form);
  }

  if (!html) {
    html = errorHTML('Kon geen data laden. Controleer je API key en probeer opnieuw.');
  }

  setHTML('home-content', html);
}

function matchCardHTML(f, isLive) {
  const fix = f.fixture;
  const home = f.teams.home;
  const away = f.teams.away;
  const goals = f.goals;
  const status = fix.status;
  const isFinished = ['FT','AET','PEN'].includes(status.short);
  const date = new Date(fix.date);

  // Determine Arsenal win/draw/loss for finished
  let resultClass = '';
  if (isFinished && goals.home !== null) {
    const arsenalHome = home.id === ARSENAL_ID;
    const ars = arsenalHome ? goals.home : goals.away;
    const opp = arsenalHome ? goals.away : goals.home;
    if (ars > opp) resultClass = 'win';
    else if (ars < opp) resultClass = 'loss';
    else resultClass = 'draw';
  }

  const scoreEl = (isLive || isFinished)
    ? `<div class="score-main ${resultClass}">${goals.home ?? 0} - ${goals.away ?? 0}</div>
       ${isLive ? `<div class="score-time"><span class="live-badge">LIVE</span> ${status.elapsed}'</div>` : ''}
       ${isFinished ? `<div class="score-time">${status.long}</div>` : ''}`
    : `<div class="score-vs">vs</div>
       <div class="score-date">${formatDate(date)}<br>${formatTime(date)}</div>`;

  // Events (goals/cards for live/finished)
  let eventsHTML = '';
  if (f.events && f.events.length > 0 && (isLive || isFinished)) {
    const goals_evts = f.events.filter(e => e.type === 'Goal');
    if (goals_evts.length > 0) {
      eventsHTML = `<div class="events-block">`;
      goals_evts.forEach(e => {
        const icon = e.detail === 'Own Goal' ? '⚽🔴' : e.detail.includes('Penalty') ? '🎯' : '⚽';
        const side = e.team.id === home.id ? 'thuis' : 'uit';
        eventsHTML += `<div class="event-row">
          <span class="event-min">${e.time.elapsed}'</span>
          <span class="event-icon">${icon}</span>
          <div class="event-detail">
            <span class="event-player">${e.player?.name || ''}</span>
            ${e.assist?.name ? `<br><span class="event-sub">Assist: ${e.assist.name}</span>` : ''}
          </div>
        </div>`;
      });
      eventsHTML += `</div>`;
    }
  }

  return `<div class="match-card">
    <div class="match-card-header">
      <span class="comp">${f.league?.name || 'Wedstrijd'} &middot; R${f.league?.round?.replace('Regular Season - ','') || ''}</span>
      ${isLive ? '<span class="live-badge">LIVE</span>' : ''}
    </div>
    <div class="match-body">
      <div class="match-teams">
        <div class="team-side">
          ${home.logo ? `<img class="team-logo" src="${home.logo}" alt="${home.name}" loading="lazy">` : `<div class="team-logo-placeholder">⚽</div>`}
          <div class="team-name">${home.name}</div>
        </div>
        <div class="score-block">${scoreEl}</div>
        <div class="team-side right">
          ${away.logo ? `<img class="team-logo" src="${away.logo}" alt="${away.name}" loading="lazy">` : `<div class="team-logo-placeholder">⚽</div>`}
          <div class="team-name">${away.name}</div>
        </div>
      </div>
      ${eventsHTML}
    </div>
    <div class="match-footer">
      <span>📍 ${fix.venue?.name || 'Onbekend'}</span>
      <span>${fix.referee || ''}</span>
    </div>
  </div>`;
}

function standingsMiniHTML() {
  if (!state.standings.length) return '';
  // Show Arsenal + 4 around them
  const arsIdx = state.standings.findIndex(t => t.team.id === ARSENAL_ID);
  if (arsIdx === -1) return '';
  const start = Math.max(0, arsIdx - 3);
  const end = Math.min(state.standings.length - 1, arsIdx + 3);
  const slice = state.standings.slice(start, end + 1);

  let html = `<div class="standings-mini">
    <div class="standings-mini-header">Pos &nbsp;&nbsp; Club &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; Ptn</div>`;
  slice.forEach(t => {
    const isArs = t.team.id === ARSENAL_ID;
    const top4 = t.rank <= 4;
    html += `<div class="standings-mini-row ${isArs ? 'arsenal' : ''}">
      <span class="std-pos ${top4 ? 'top4' : ''}">${t.rank}</span>
      <span class="std-name">${isArs ? `<strong>${t.team.name}</strong>` : t.team.name}</span>
      <span class="std-pts">${t.points}</span>
      <span class="std-detail">${t.all.win}W ${t.all.draw}G ${t.all.lose}V</span>
    </div>`;
  });
  html += `</div>`;
  return html;
}

function formHTML(formStr) {
  if (!formStr) return '';
  const recent = formStr.slice(-10).split('');
  let html = `<div class="form-row">`;
  recent.forEach(r => {
    html += `<div class="form-badge ${r}">${r}</div>`;
  });
  html += `</div>`;
  return html;
}

// ---- LINEUP ----
function renderLineup() {
  if (!state.lineup) {
    setHTML('lineup-content', `
      <div class="no-lineup">
        <div class="big-icon">📋</div>
        <p>Geen opstelling beschikbaar.<br>Opstellingen verschijnen meestal 1 uur voor de wedstrijd.</p>
      </div>`);
    return;
  }

  const { fixture: f, lineups, isLive } = state.lineup;
  const arsenalLineup = lineups?.find(l => l.team.id === ARSENAL_ID);

  if (!arsenalLineup) {
    setHTML('lineup-content', `
      <div class="no-lineup">
        <div class="big-icon">⏳</div>
        <p>Opstelling nog niet bekend voor<br><strong>${f.teams.home.name} vs ${f.teams.away.name}</strong>.</p>
      </div>`);
    return;
  }

  const formation = arsenalLineup.formation || '4-3-3';
  const startXI = arsenalLineup.startXI || [];
  const subs = arsenalLineup.substitutes || [];
  const coach = arsenalLineup.coach?.name || '';

  // Group starters by grid position
  const rows = buildFormationRows(startXI, formation);

  let pitchHTML = `<div class="pitch">`;
  rows.forEach(row => {
    pitchHTML += `<div class="pitch-row">`;
    row.forEach(p => {
      const isGK = p.player.pos === 'G';
      const isCap = p.player.captain;
      pitchHTML += `<div class="player-token">
        <div class="player-shirt ${isGK ? 'gk' : ''}">
          ${p.player.number || '?'}
          ${isCap ? '<span class="captain-badge">C</span>' : ''}
        </div>
        <div class="player-token-name">${shortName(p.player.name)}</div>
      </div>`;
    });
    pitchHTML += `</div>`;
  });
  pitchHTML += `</div>`;

  let html = `<div class="pitch-container">
    <div class="pitch-header">
      <h3>Arsenal ${formation}</h3>
      <p>${f.teams.home.name} vs ${f.teams.away.name} &middot; ${isLive ? '🔴 Live' : formatDate(new Date(f.fixture.date))}</p>
    </div>
    ${pitchHTML}
    <div class="subs-list">
      <h4>Wisselspelers</h4>`;

  subs.forEach(p => {
    html += `<div class="sub-player">
      <div class="sub-num">${p.player.number || '?'}</div>
      <span class="sub-name">${p.player.name}</span>
      <span class="sub-pos">${posLabel(p.player.pos)}</span>
    </div>`;
  });

  html += `</div></div>`;

  // Opponent lineup
  const oppLineup = lineups?.find(l => l.team.id !== ARSENAL_ID);
  if (oppLineup) {
    const oppRows = buildFormationRows(oppLineup.startXI || [], oppLineup.formation || '');
    html += `<div class="section-label" style="margin-top:20px">${oppLineup.team.name} &middot; ${oppLineup.formation}</div>`;
    html += `<div class="card" style="overflow:hidden">`;
    html += `<div class="pitch" style="min-height:300px">`;
    oppRows.forEach(row => {
      html += `<div class="pitch-row">`;
      row.forEach(p => {
        html += `<div class="player-token">
          <div class="player-shirt" style="background:var(--bg4);border-color:var(--border2)">${p.player.number || '?'}</div>
          <div class="player-token-name">${shortName(p.player.name)}</div>
        </div>`;
      });
      html += `</div>`;
    });
    html += `</div></div>`;
  }

  setHTML('lineup-content', html);
}

function buildFormationRows(startXI, formation) {
  // GK first row, then lines from formation
  const gk = startXI.filter(p => p.player.pos === 'G');
  const outfield = startXI.filter(p => p.player.pos !== 'G');

  const lines = formation.split('-').map(Number);
  const rows = [gk];
  let i = 0;
  lines.forEach(count => {
    rows.push(outfield.slice(i, i + count));
    i += count;
  });
  if (outfield.slice(i).length > 0) rows.push(outfield.slice(i));
  return rows.filter(r => r.length > 0);
}

// ---- FIXTURES ----
function renderFixtures() {
  const now = new Date();
  let data;
  if (state.fixtureFilter === 'upcoming') {
    data = state.fixtures
      .filter(f => new Date(f.fixture.date) >= now || f.isLive)
      .sort((a, b) => new Date(a.fixture.date) - new Date(b.fixture.date))
      .slice(0, 20);
  } else {
    data = state.fixtures
      .filter(f => new Date(f.fixture.date) < now && !f.isLive && ['FT','AET','PEN'].includes(f.fixture.status.short))
      .sort((a, b) => new Date(b.fixture.date) - new Date(a.fixture.date))
      .slice(0, 30);
  }

  if (!data.length) {
    setHTML('fixtures-content', `<div class="loading-card"><p>Geen wedstrijden gevonden.</p></div>`);
    return;
  }

  let html = '';
  let lastMonth = '';
  data.forEach(f => {
    const date = new Date(f.fixture.date);
    const month = date.toLocaleDateString('nl-NL', { month: 'long', year: 'numeric' });
    if (month !== lastMonth) {
      html += `<div class="section-label">${month}</div>`;
      lastMonth = month;
    }

    const isFinished = ['FT','AET','PEN'].includes(f.fixture.status.short);
    const arsenalHome = f.teams.home.id === ARSENAL_ID;
    const opponent = arsenalHome ? f.teams.away.name : f.teams.home.name;
    const homeAway = arsenalHome ? 'Thuis' : 'Uit';
    const g = f.goals;
    let scoreHTML = '';
    let scoreClass = '';
    if (f.isLive) {
      scoreHTML = `<span class="live-badge" style="font-size:11px">LIVE ${f.fixture.status.elapsed}'</span>`;
    } else if (isFinished && g.home !== null) {
      const ars = arsenalHome ? g.home : g.away;
      const opp = arsenalHome ? g.away : g.home;
      scoreClass = ars > opp ? 'win' : ars < opp ? 'loss' : 'draw';
      scoreHTML = `${g.home} - ${g.away}`;
    } else {
      scoreHTML = formatTime(date);
    }

    html += `<div class="fixture-row">
      <div class="fixture-date">
        <div class="day">${date.getDate()}</div>
        <div class="month">${date.toLocaleDateString('nl-NL', { month: 'short' })}</div>
      </div>
      <div class="fixture-main">
        <div class="fixture-teams">Arsenal vs ${opponent}</div>
        <div class="fixture-meta">${homeAway} &middot; ${f.league?.name || ''}</div>
      </div>
      ${isFinished || f.isLive
        ? `<div class="fixture-score ${scoreClass}">${scoreHTML}</div>`
        : `<div class="fixture-time">${scoreHTML}</div>`}
    </div>`;
  });

  setHTML('fixtures-content', html);
}

// ---- STATS ----
function renderStats() {
  if (!state.teamStats) {
    setHTML('stats-content', errorHTML('Kon statistieken niet laden.'));
    return;
  }

  const s = state.teamStats;
  const played = s.fixtures?.played?.total || 0;
  const wins = s.fixtures?.wins?.total || 0;
  const draws = s.fixtures?.draws?.total || 0;
  const losses = s.fixtures?.loses?.total || 0;
  const goalsFor = s.goals?.for?.total?.total || 0;
  const goalsAgainst = s.goals?.against?.total?.total || 0;
  const cleanSheets = s.clean_sheet?.total || 0;
  const failedToScore = s.failed_to_score?.total || 0;

  let html = `<div class="section-label">Seizoen 2024/25 — Premier League</div>`;

  // Form
  if (s.form) {
    html += formHTML(s.form);
  }

  // Big stats grid
  html += `<div class="stats-grid">
    <div class="stat-card"><div class="stat-val">${played}</div><div class="stat-label">Gespeeld</div></div>
    <div class="stat-card"><div class="stat-val">${wins}</div><div class="stat-label">Gewonnen</div></div>
    <div class="stat-card"><div class="stat-val">${draws}</div><div class="stat-label">Gelijk</div></div>
    <div class="stat-card"><div class="stat-val red">${losses}</div><div class="stat-label">Verloren</div></div>
    <div class="stat-card"><div class="stat-val">${goalsFor}</div><div class="stat-label">Goals voor</div></div>
    <div class="stat-card"><div class="stat-val red">${goalsAgainst}</div><div class="stat-label">Goals tegen</div></div>
    <div class="stat-card"><div class="stat-val">${cleanSheets}</div><div class="stat-label">Clean sheets</div></div>
    <div class="stat-card"><div class="stat-val">${(goalsFor / Math.max(played, 1)).toFixed(1)}</div><div class="stat-label">Goals / duel</div></div>
  </div>`;

  // Bar stats
  const winPct = played > 0 ? Math.round((wins / played) * 100) : 0;
  const csRate = played > 0 ? Math.round((cleanSheets / played) * 100) : 0;

  html += `<div class="section-label">Percentages</div>`;
  html += barRow('Win percentage', `${winPct}%`, winPct);
  html += barRow('Clean sheet rate', `${csRate}%`, csRate);
  html += barRow('Zonder doelpunt', `${failedToScore}x`, Math.min(failedToScore * 10, 100));

  // Top scorers
  if (state.topScorers.length > 0) {
    html += `<div class="section-label">Topscorers PL</div>`;
    html += `<div class="card"><div style="padding:8px 14px" class="top-scorers-list">`;
    state.topScorers.slice(0, 8).forEach((p, i) => {
      const st = p.statistics[0];
      const isArsenal = st.team.id === ARSENAL_ID;
      html += `<div class="scorer-row">
        <div class="scorer-rank">${i + 1}</div>
        <div class="scorer-info">
          <div class="scorer-name">${p.player.name} ${isArsenal ? '<span style="color:var(--red);font-size:11px">⚽ Arsenal</span>' : ''}</div>
          <div class="scorer-detail">${st.team.name} &middot; ${st.games.appearences || 0} duels</div>
        </div>
        <div class="scorer-goals">${st.goals.total || 0} <small>doelpunten</small></div>
      </div>`;
    });
    html += `</div></div>`;
  }

  // Standings
  if (state.standings.length > 0) {
    html += `<div class="section-label">Premier League stand</div>`;
    html += `<div class="card" style="overflow:hidden">`;
    html += `<div style="padding:0 14px">`;
    state.standings.slice(0, 20).forEach(t => {
      const isArs = t.team.id === ARSENAL_ID;
      const top4 = t.rank <= 4;
      html += `<div class="scorer-row" style="${isArs ? 'background:rgba(239,1,7,0.08);margin:0 -14px;padding:9px 14px' : ''}">
        <div class="scorer-rank ${top4 ? 'top4' : ''}" style="${top4 ? 'color:#4ADE80' : ''}">${t.rank}</div>
        <div class="scorer-info">
          <div class="scorer-name">${isArs ? `<strong>${t.team.name}</strong>` : t.team.name}</div>
          <div class="scorer-detail">${t.all.played} gespeeld &middot; ${t.goalsDiff > 0 ? '+' : ''}${t.goalsDiff} DS</div>
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
  items.slice(0, 30).forEach(item => {
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
function shortName(name) {
  if (!name) return '';
  const parts = name.split(' ');
  if (parts.length <= 1) return name;
  // Last name only, or two if very short
  const last = parts[parts.length - 1];
  return last.length < 4 ? parts.slice(-2).join(' ') : last;
}
function posLabel(pos) {
  const map = { G:'GK', D:'DEF', M:'MID', F:'AAN' };
  return map[pos] || pos || '';
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

// Auto-refresh every 3 minutes if a live match is on, else every 15 min
setInterval(() => {
  const hasLive = state.fixtures.some(f => f.isLive);
  const mins = hasLive ? 3 : 15;
  if (state.lastFetch && (new Date() - state.lastFetch) > mins * 60 * 1000) {
    if (state.apiKey) loadAll();
  }
}, 60 * 1000);
