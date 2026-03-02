#!/usr/bin/env node

/**
 * Fetches airport risk/closure data from SafeAirspace.net (conflict zone data)
 * AND FlightAware AeroAPI (operational delays), then writes data/status.json.
 *
 * SafeAirspace provides country-level risk ratings for conflict zones.
 * AeroAPI provides per-airport operational delay data.
 *
 * Usage:
 *   FLIGHTAWARE_API_KEY=your_key node scripts/fetch-data.mjs
 */

import * as cheerio from 'cheerio';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const AEROAPI_BASE = 'https://aeroapi.flightaware.com/aeroapi';

const API_KEY = process.env.FLIGHTAWARE_API_KEY;
if (!API_KEY) {
  console.error('❌ FLIGHTAWARE_API_KEY environment variable is required');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Country → SafeAirspace slug mapping
// ---------------------------------------------------------------------------
const COUNTRY_SLUGS = {
  'Israel': 'israel',
  'Lebanon': 'lebanon',
  'Syria': 'syria',
  'Jordan': 'jordan',
  'Iraq': 'iraq',
  'Iran': 'iran',
  'UAE': 'united-arab-emirates',
  'Qatar': 'qatar',
  'Bahrain': 'bahrain',
  'Kuwait': 'kuwait',
  'Saudi Arabia': 'saudi%20arabia',
  'Oman': 'oman',
  'Yemen': 'yemen',
  'Egypt': 'egypt',
};

// ---------------------------------------------------------------------------
// Load airport config
// ---------------------------------------------------------------------------
const airports = JSON.parse(
  readFileSync(join(ROOT, 'config', 'airports.json'), 'utf-8')
);

console.log(`📡 Fetching status for ${airports.length} airports across ${Object.keys(COUNTRY_SLUGS).length} countries…\n`);

// ---------------------------------------------------------------------------
// 1. Fetch SafeAirspace risk levels per country
// ---------------------------------------------------------------------------
async function fetchSafeAirspaceRisk(country, slug) {
  const url = `https://safeairspace.net/${slug}/`;
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'AirportStatusBot/1.0 (GitHub Pages dashboard)',
      },
    });

    if (!res.ok) {
      console.warn(`  ⚠️  SafeAirspace ${country}: HTTP ${res.status}`);
      return { riskLevel: null, riskText: null, warnings: [], error: `HTTP ${res.status}` };
    }

    const html = await res.text();
    const $ = cheerio.load(html);

    // Find the risk level heading: "### Risk Level: One - Do Not Fly"
    let riskText = null;
    let riskLevel = null;
    let warnings = [];

    // Search for risk level text in h3 elements
    $('h3').each((_, el) => {
      const text = $(el).text().trim();
      if (text.startsWith('Risk Level:')) {
        riskText = text.replace('Risk Level:', '').trim();
      }
    });

    // Also try broader text search in case of different markup
    if (!riskText) {
      const bodyText = $('body').text();
      const riskMatch = bodyText.match(/Risk Level:\s*(.+?)(?:\n|$)/);
      if (riskMatch) {
        riskText = riskMatch[1].trim();
      }
    }

    // Parse risk level number
    if (riskText) {
      const lowerText = riskText.toLowerCase();
      if (lowerText.includes('one') || lowerText.includes('do not fly')) {
        riskLevel = 1; // DO NOT FLY
      } else if (lowerText.includes('two') || lowerText.includes('danger')) {
        riskLevel = 2; // DANGER EXISTS
      } else if (lowerText.includes('three') || lowerText.includes('caution')) {
        riskLevel = 3; // EXERCISE CAUTION
      } else if (lowerText.includes('no warning') || lowerText.includes('no risk')) {
        riskLevel = 0; // NO WARNINGS
      }
    }

    // Collect warning NOTAMs
    $('a').each((_, el) => {
      const text = $(el).text().trim();
      if (text.match(/Notam|CZIB|SFAR|AIC|AIP/i) && text.length < 100) {
        if (!warnings.includes(text)) warnings.push(text);
      }
    });

    return { riskLevel, riskText, warnings };
  } catch (err) {
    console.warn(`  ⚠️  SafeAirspace ${country}: ${err.message}`);
    return { riskLevel: null, riskText: null, warnings: [], error: err.message };
  }
}

// ---------------------------------------------------------------------------
// 2. Fetch AeroAPI delays (supplementary operational data)
// ---------------------------------------------------------------------------
async function fetchAeroAPIDelays(icao) {
  const url = `${AEROAPI_BASE}/airports/${icao}/delays`;
  try {
    const res = await fetch(url, {
      headers: { 'x-apikey': API_KEY },
    });

    if (res.status === 404) {
      return { delays: [] };
    }

    if (!res.ok) {
      return { delays: [], error: `HTTP ${res.status}` };
    }

    const data = await res.json();
    const entries = data.delays || data.airport_delays || [];
    const delays = [];

    if (Array.isArray(entries)) {
      for (const entry of entries) {
        delays.push({
          type: entry.type || entry.delay_type || 'delay',
          reason: entry.reason || entry.category || '',
          avgMinutes: entry.average || entry.average_delay || null,
        });
      }
    }

    return { delays };
  } catch (err) {
    return { delays: [], error: err.message };
  }
}

// ---------------------------------------------------------------------------
// 3. Determine airport status from combined data
// ---------------------------------------------------------------------------
function determineStatus(riskInfo, aeroDelays) {
  // SafeAirspace risk level takes priority for conflict-zone status
  if (riskInfo.riskLevel === 1) return 'closed';      // Do Not Fly
  if (riskInfo.riskLevel === 2) return 'at-risk';      // Danger Exists
  if (riskInfo.riskLevel === 3) return 'caution';      // Exercise Caution

  // Check AeroAPI for operational delays
  if (aeroDelays.delays && aeroDelays.delays.length > 0) {
    const hasClosure = aeroDelays.delays.some((d) => {
      const t = (d.type || '').toLowerCase();
      const r = (d.reason || '').toLowerCase();
      return t.includes('closure') || t.includes('closed') || t.includes('ground_stop') ||
             r.includes('closed') || r.includes('closure');
    });
    if (hasClosure) return 'closed';
    return 'delayed';
  }

  return 'operational'; // No risk, no delays
}

function statusLabel(status) {
  return {
    closed: 'Do Not Fly',
    'at-risk': 'Danger Exists',
    caution: 'Exercise Caution',
    delayed: 'Delayed',
    operational: 'Operational',
    unknown: 'Unknown',
  }[status] || 'Unknown';
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  // Step 1: Fetch SafeAirspace risk levels per unique country
  const uniqueCountries = [...new Set(airports.map((a) => a.country))];
  const countryRisks = {};

  console.log('🌍 Fetching SafeAirspace risk levels…');
  for (const country of uniqueCountries) {
    const slug = COUNTRY_SLUGS[country];
    if (!slug) {
      console.log(`  ⏭️  ${country}: no SafeAirspace slug configured`);
      countryRisks[country] = { riskLevel: null, riskText: null, warnings: [] };
      continue;
    }

    process.stdout.write(`  ${country}… `);
    const risk = await fetchSafeAirspaceRisk(country, slug);
    const emoji = risk.riskLevel === 1 ? '🔴' : risk.riskLevel === 2 ? '🟠' : risk.riskLevel === 3 ? '🟡' : '🟢';
    console.log(`${emoji} ${risk.riskText || 'No data'}`);
    countryRisks[country] = risk;

    await sleep(500); // Be polite
  }

  // Step 2: Fetch AeroAPI delays per airport
  console.log('\n✈️  Fetching AeroAPI delays…');
  const aeroDelays = {};
  for (const airport of airports) {
    process.stdout.write(`  ${airport.icao} ${airport.name}… `);
    const delayInfo = await fetchAeroAPIDelays(airport.icao);
    const hasDelays = delayInfo.delays.length > 0;
    console.log(hasDelays ? `🟠 ${delayInfo.delays.length} delay(s)` : '🟢 none');
    aeroDelays[airport.icao] = delayInfo;

    await sleep(300);
  }

  // Step 3: Combine data
  console.log('\n📊 Combining data…');
  const results = airports.map((airport) => {
    const riskInfo = countryRisks[airport.country] || { riskLevel: null, riskText: null, warnings: [] };
    const aeroInfo = aeroDelays[airport.icao] || { delays: [] };
    const status = determineStatus(riskInfo, aeroInfo);

    return {
      icao: airport.icao,
      name: airport.name,
      city: airport.city,
      country: airport.country,
      lat: airport.lat,
      lon: airport.lon,
      status,
      statusLabel: statusLabel(status),
      riskLevel: riskInfo.riskLevel,
      riskText: riskInfo.riskText || null,
      warnings: (riskInfo.warnings || []).slice(0, 5), // Top 5 warnings
      delays: aeroInfo.delays || [],
    };
  });

  // Build output
  const output = {
    lastUpdated: new Date().toISOString(),
    airports: results,
    summary: {
      total: results.length,
      closed: results.filter((a) => a.status === 'closed').length,
      atRisk: results.filter((a) => a.status === 'at-risk').length,
      caution: results.filter((a) => a.status === 'caution').length,
      delayed: results.filter((a) => a.status === 'delayed').length,
      operational: results.filter((a) => a.status === 'operational').length,
    },
  };

  // Write output
  const outDir = join(ROOT, 'data');
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, 'status.json');
  writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf-8');

  console.log(`\n✅ Wrote ${outPath}`);
  console.log(`   📊 ${output.summary.closed} closed, ${output.summary.atRisk} at-risk, ${output.summary.caution} caution, ${output.summary.delayed} delayed, ${output.summary.operational} operational`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((err) => {
  console.error('❌ Fatal error:', err);
  process.exit(1);
});
