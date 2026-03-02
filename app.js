/**
 * Airport Status Frontend
 * Fetches data/status.json and renders airport cards with filtering.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const DATA_URL = 'data/status.json';
const REFRESH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes client-side refresh

// Country code → flag emoji mapping
const COUNTRY_FLAGS = {
  'Israel': '🇮🇱', 'Lebanon': '🇱🇧', 'Syria': '🇸🇾', 'Jordan': '🇯🇴',
  'Iraq': '🇮🇶', 'Iran': '🇮🇷', 'UAE': '🇦🇪', 'Qatar': '🇶🇦',
  'Bahrain': '🇧🇭', 'Kuwait': '🇰🇼', 'Saudi Arabia': '🇸🇦',
  'Oman': '🇴🇲', 'Yemen': '🇾🇪', 'Egypt': '🇪🇬',
};

const STATUS_EMOJI = {
  closed: '🔴', delayed: '🟠', operational: '🟢', unknown: '⚪',
};

const STATUS_LABEL = {
  closed: 'Closed', delayed: 'Delayed', operational: 'Operational', unknown: 'Unknown',
};

// Sort priority: closed first, then delayed, then unknown, then operational
const STATUS_PRIORITY = { closed: 0, delayed: 1, unknown: 2, operational: 3 };

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let airportData = null;
let activeFilter = 'all';

// ---------------------------------------------------------------------------
// DOM references
// ---------------------------------------------------------------------------
const grid = document.getElementById('airport-grid');
const loading = document.getElementById('loading');
const updateText = document.getElementById('update-text');
const errorBanner = document.getElementById('error-banner');
const errorMessage = document.getElementById('error-message');

// Stat elements
const statClosed = document.querySelector('#stat-closed .stat-number');
const statDelayed = document.querySelector('#stat-delayed .stat-number');
const statOperational = document.querySelector('#stat-operational .stat-number');
const statTotal = document.querySelector('#stat-total .stat-number');

// Filter buttons
const filterButtons = document.querySelectorAll('.filter-btn');

// ---------------------------------------------------------------------------
// Fetch data
// ---------------------------------------------------------------------------
async function fetchData() {
  try {
    const res = await fetch(DATA_URL + '?t=' + Date.now()); // cache bust
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    airportData = await res.json();
    hideError();
    render();
  } catch (err) {
    console.error('Failed to fetch data:', err);
    showError(`Failed to load airport data: ${err.message}`);
    if (loading) loading.style.display = 'none';
  }
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------
function render() {
  if (!airportData) return;

  // Update stats
  const summary = airportData.summary || computeSummary(airportData.airports);
  statClosed.textContent = summary.closed;
  statDelayed.textContent = summary.delayed;
  statOperational.textContent = summary.operational;
  statTotal.textContent = summary.total;

  // Update timestamp
  updateTimestamp();

  // Filter airports
  let airports = [...airportData.airports];
  if (activeFilter !== 'all') {
    airports = airports.filter((a) => a.status === activeFilter);
  }

  // Sort: closed → delayed → unknown → operational, then alphabetically
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

  // Clear grid
  grid.innerHTML = '';

  if (airports.length === 0) {
    grid.innerHTML = '<div class="no-results">No airports match the current filter.</div>';
    return;
  }

  // Render country groups
  let cardIndex = 0;
  for (const [country, countryAirports] of grouped) {
    // Country header
    const header = document.createElement('div');
    header.className = 'country-header';
    header.innerHTML = `
      <span class="country-flag">${COUNTRY_FLAGS[country] || '🌍'}</span>
      ${country}
    `;
    grid.appendChild(header);

    // Airport cards
    for (const airport of countryAirports) {
      const card = createCard(airport, cardIndex++);
      grid.appendChild(card);
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

  const statusBadge = `
    <span class="status-badge status-${airport.status}">
      ${STATUS_EMOJI[airport.status] || '⚪'} ${STATUS_LABEL[airport.status] || 'Unknown'}
    </span>
  `;

  let delayHTML = '';
  if (airport.delays && airport.delays.length > 0) {
    const items = airport.delays
      .map((d) => {
        const parts = [];
        if (d.type) parts.push(`<span class="delay-type">${d.type}</span>`);
        if (d.reason) parts.push(`<span class="delay-reason">${d.reason}</span>`);
        if (d.avgMinutes) parts.push(`<span>${d.avgMinutes} min avg</span>`);
        return `<div class="delay-item">${parts.join(' · ')}</div>`;
      })
      .join('');

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
    ${delayHTML}
  `;

  return card;
}

// ---------------------------------------------------------------------------
// Timestamp
// ---------------------------------------------------------------------------
function updateTimestamp() {
  if (!airportData?.lastUpdated) return;

  const updated = new Date(airportData.lastUpdated);
  const now = new Date();
  const diffMs = now - updated;
  const diffMin = Math.floor(diffMs / 60000);

  let text;
  if (diffMin < 1) text = 'Just now';
  else if (diffMin === 1) text = '1 minute ago';
  else if (diffMin < 60) text = `${diffMin} minutes ago`;
  else if (diffMin < 120) text = '1 hour ago';
  else text = `${Math.floor(diffMin / 60)} hours ago`;

  updateText.textContent = `Updated ${text}`;
}

// ---------------------------------------------------------------------------
// Compute summary fallback
// ---------------------------------------------------------------------------
function computeSummary(airports) {
  return {
    total: airports.length,
    closed: airports.filter((a) => a.status === 'closed').length,
    delayed: airports.filter((a) => a.status === 'delayed').length,
    operational: airports.filter((a) => a.status === 'operational').length,
    unknown: airports.filter((a) => a.status === 'unknown').length,
  };
}

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------
function showError(msg) {
  errorMessage.textContent = msg;
  errorBanner.classList.remove('hidden');
}

function hideError() {
  errorBanner.classList.add('hidden');
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------
for (const btn of filterButtons) {
  btn.addEventListener('click', () => {
    activeFilter = btn.dataset.filter;

    // Update button state
    for (const b of filterButtons) b.classList.remove('active');
    btn.classList.add('active');

    render();
  });
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
fetchData();

// Auto-refresh
setInterval(fetchData, REFRESH_INTERVAL_MS);

// Update "X minutes ago" every 30 seconds
setInterval(updateTimestamp, 30000);
