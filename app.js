/**
 * Airport Status Frontend
 * Fetches data/status.json and renders airport cards with filtering.
 * Supports SafeAirspace risk levels: closed (Do Not Fly), at-risk, caution, operational
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const DATA_URL = 'data/status.json';
const REFRESH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes client-side refresh

const COUNTRY_FLAGS = {
  'Israel': '🇮🇱', 'Lebanon': '🇱🇧', 'Syria': '🇸🇾', 'Jordan': '🇯🇴',
  'Iraq': '🇮🇶', 'Iran': '🇮🇷', 'UAE': '🇦🇪', 'Qatar': '🇶🇦',
  'Bahrain': '🇧🇭', 'Kuwait': '🇰🇼', 'Saudi Arabia': '🇸🇦',
  'Oman': '🇴🇲', 'Yemen': '🇾🇪', 'Egypt': '🇪🇬',
};

const STATUS_EMOJI = {
  closed: '🔴', 'at-risk': '🟠', caution: '🟡', delayed: '🟠', operational: '🟢', unknown: '⚪',
};

const STATUS_LABEL = {
  closed: 'Do Not Fly', 'at-risk': 'At Risk', caution: 'Caution',
  delayed: 'Delayed', operational: 'Operational', unknown: 'Unknown',
};

// Sort priority: closed → at-risk → caution → delayed → unknown → operational
const STATUS_PRIORITY = { closed: 0, 'at-risk': 1, caution: 2, delayed: 3, unknown: 4, operational: 5 };

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let airportData = null;
let activeFilter = 'all';

// ---------------------------------------------------------------------------
// DOM references
// ---------------------------------------------------------------------------
const grid = document.getElementById('airport-grid');
const updateText = document.getElementById('update-text');
const errorBanner = document.getElementById('error-banner');
const errorMessage = document.getElementById('error-message');

const statClosed = document.querySelector('#stat-closed .stat-number');
const statAtRisk = document.querySelector('#stat-at-risk .stat-number');
const statCaution = document.querySelector('#stat-caution .stat-number');
const statOperational = document.querySelector('#stat-operational .stat-number');
const statTotal = document.querySelector('#stat-total .stat-number');

const filterButtons = document.querySelectorAll('.filter-btn');

// ---------------------------------------------------------------------------
// Fetch data
// ---------------------------------------------------------------------------
async function fetchData() {
  try {
    const res = await fetch(DATA_URL + '?t=' + Date.now());
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    airportData = await res.json();
    hideError();
    render();
  } catch (err) {
    console.error('Failed to fetch data:', err);
    showError(`Failed to load airport data: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------
function render() {
  if (!airportData) return;

  // Update stats
  const summary = airportData.summary || computeSummary(airportData.airports);
  statClosed.textContent = summary.closed || 0;
  statAtRisk.textContent = summary.atRisk || 0;
  statCaution.textContent = summary.caution || 0;
  statOperational.textContent = summary.operational || 0;
  statTotal.textContent = summary.total || 0;

  updateTimestamp();

  // Filter
  let airports = [...airportData.airports];
  if (activeFilter !== 'all') {
    airports = airports.filter((a) => a.status === activeFilter);
  }

  // Sort: closed → at-risk → caution → delayed → operational
  airports.sort((a, b) => {
    const pa = STATUS_PRIORITY[a.status] ?? 99;
    const pb = STATUS_PRIORITY[b.status] ?? 99;
    if (pa !== pb) return pa - pb;
    return a.country.localeCompare(b.country) || a.name.localeCompare(b.name);
  });

  // Group by country
  const grouped = new Map();
  for (const airport of airports) {
    if (!grouped.has(airport.country)) grouped.set(airport.country, []);
    grouped.get(airport.country).push(airport);
  }

  grid.innerHTML = '';

  if (airports.length === 0) {
    grid.innerHTML = '<div class="no-results">No airports match the current filter.</div>';
    return;
  }

  let cardIndex = 0;
  for (const [country, countryAirports] of grouped) {
    const header = document.createElement('div');
    header.className = 'country-header';
    header.innerHTML = `<span class="country-flag">${COUNTRY_FLAGS[country] || '🌍'}</span> ${country}`;
    grid.appendChild(header);

    for (const airport of countryAirports) {
      grid.appendChild(createCard(airport, cardIndex++));
    }
  }
}

// ---------------------------------------------------------------------------
// Create airport card
// ---------------------------------------------------------------------------
function createCard(airport, index) {
  const card = document.createElement('div');
  card.className = `airport-card card-${airport.status}`;
  card.style.animationDelay = `${index * 0.04}s`;

  const emoji = STATUS_EMOJI[airport.status] || '⚪';
  const label = airport.statusLabel || STATUS_LABEL[airport.status] || 'Unknown';

  const statusBadge = `<span class="status-badge status-${airport.status}">${emoji} ${label}</span>`;

  // Risk info (from SafeAirspace)
  let riskHTML = '';
  if (airport.riskText) {
    riskHTML = `<div class="delay-details"><div class="delay-item"><span class="delay-type">Risk</span> · <span class="delay-reason">${airport.riskText}</span></div></div>`;
  }

  // Warnings
  let warningsHTML = '';
  if (airport.warnings && airport.warnings.length > 0) {
    const items = airport.warnings.slice(0, 3).map((w) =>
      `<div class="delay-item"><span class="delay-reason">📋 ${w}</span></div>`
    ).join('');
    warningsHTML = `<div class="delay-details">${items}</div>`;
  }

  // AeroAPI delays
  let delayHTML = '';
  if (airport.delays && airport.delays.length > 0) {
    const items = airport.delays.map((d) => {
      const parts = [];
      if (d.type) parts.push(`<span class="delay-type">${d.type}</span>`);
      if (d.reason) parts.push(`<span class="delay-reason">${d.reason}</span>`);
      if (d.avgMinutes) parts.push(`<span>${d.avgMinutes} min avg</span>`);
      return `<div class="delay-item">${parts.join(' · ')}</div>`;
    }).join('');
    delayHTML = `<div class="delay-details">${items}</div>`;
  }

  card.innerHTML = `
    <div class="card-header">
      <div class="card-airport-info">
        <div class="card-icao">${airport.icao}</div>
        <div class="card-name">${airport.name}</div>
        <div class="card-location">${airport.city}, ${airport.country}</div>
      </div>
      ${statusBadge}
    </div>
    ${riskHTML}${warningsHTML}${delayHTML}
  `;

  return card;
}

// ---------------------------------------------------------------------------
// Timestamp
// ---------------------------------------------------------------------------
function updateTimestamp() {
  if (!airportData?.lastUpdated) return;
  const diffMin = Math.floor((new Date() - new Date(airportData.lastUpdated)) / 60000);
  let text;
  if (diffMin < 1) text = 'Just now';
  else if (diffMin === 1) text = '1 minute ago';
  else if (diffMin < 60) text = `${diffMin} minutes ago`;
  else if (diffMin < 120) text = '1 hour ago';
  else text = `${Math.floor(diffMin / 60)} hours ago`;
  updateText.textContent = `Updated ${text}`;
}

function computeSummary(airports) {
  return {
    total: airports.length,
    closed: airports.filter((a) => a.status === 'closed').length,
    atRisk: airports.filter((a) => a.status === 'at-risk').length,
    caution: airports.filter((a) => a.status === 'caution').length,
    delayed: airports.filter((a) => a.status === 'delayed').length,
    operational: airports.filter((a) => a.status === 'operational').length,
  };
}

function showError(msg) { errorMessage.textContent = msg; errorBanner.classList.remove('hidden'); }
function hideError() { errorBanner.classList.add('hidden'); }

// Filter buttons
for (const btn of filterButtons) {
  btn.addEventListener('click', () => {
    activeFilter = btn.dataset.filter;
    for (const b of filterButtons) b.classList.remove('active');
    btn.classList.add('active');
    render();
  });
}

// Init
fetchData();
setInterval(fetchData, REFRESH_INTERVAL_MS);
setInterval(updateTimestamp, 30000);
