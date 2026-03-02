#!/usr/bin/env node

/**
 * Fetches airport delay/closure data from FlightAware AeroAPI v4
 * and writes data/status.json for the static frontend.
 *
 * Usage:
 *   FLIGHTAWARE_API_KEY=your_key node scripts/fetch-data.mjs
 */

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
// Load airport config
// ---------------------------------------------------------------------------
const airports = JSON.parse(
  readFileSync(join(ROOT, 'config', 'airports.json'), 'utf-8')
);

console.log(`📡 Fetching status for ${airports.length} airports…\n`);

// ---------------------------------------------------------------------------
// Fetch delays for a single airport
// ---------------------------------------------------------------------------
async function fetchAirportDelays(icao) {
  const url = `${AEROAPI_BASE}/airports/${icao}/delays`;
  try {
    const res = await fetch(url, {
      headers: { 'x-apikey': API_KEY },
    });

    if (res.status === 404) {
      // No delay data → airport is operational (or not in FA database)
      return { status: 'operational', delays: [] };
    }

    if (!res.ok) {
      console.warn(`  ⚠️  ${icao}: HTTP ${res.status} ${res.statusText}`);
      return { status: 'unknown', delays: [], error: `HTTP ${res.status}` };
    }

    const data = await res.json();
    return parseDelays(data);
  } catch (err) {
    console.warn(`  ⚠️  ${icao}: ${err.message}`);
    return { status: 'unknown', delays: [], error: err.message };
  }
}

// ---------------------------------------------------------------------------
// Parse the AeroAPI delays response
// ---------------------------------------------------------------------------
function parseDelays(data) {
  const delays = [];
  let isClosed = false;

  // AeroAPI returns an array of delay entries
  const entries = data.delays || data.airport_delays || [];

  if (Array.isArray(entries)) {
    for (const entry of entries) {
      const delay = {
        type: entry.type || entry.delay_type || 'unknown',
        reason: entry.reason || entry.category || '',
        avgMinutes: entry.average || entry.average_delay || null,
      };

      // Check for closure indicators
      const typeLower = (delay.type || '').toLowerCase();
      const reasonLower = (delay.reason || '').toLowerCase();
      if (
        typeLower.includes('closure') ||
        typeLower.includes('closed') ||
        typeLower.includes('ground_stop') ||
        reasonLower.includes('closed') ||
        reasonLower.includes('closure')
      ) {
        isClosed = true;
        delay.type = 'closure';
      }

      delays.push(delay);
    }
  }

  if (isClosed) return { status: 'closed', delays };
  if (delays.length > 0) return { status: 'delayed', delays };
  return { status: 'operational', delays: [] };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const results = [];

  // Process airports sequentially to respect rate limits (5/min on free tier)
  for (const airport of airports) {
    process.stdout.write(`  ${airport.icao} ${airport.name}… `);
    const delayInfo = await fetchAirportDelays(airport.icao);
    console.log(statusEmoji(delayInfo.status), delayInfo.status);

    results.push({
      icao: airport.icao,
      name: airport.name,
      city: airport.city,
      country: airport.country,
      lat: airport.lat,
      lon: airport.lon,
      status: delayInfo.status,
      delays: delayInfo.delays,
      ...(delayInfo.error ? { error: delayInfo.error } : {}),
    });

    // Small delay between requests to be polite to the API
    await sleep(300);
  }

  // Build output
  const output = {
    lastUpdated: new Date().toISOString(),
    airports: results,
    summary: {
      total: results.length,
      closed: results.filter((a) => a.status === 'closed').length,
      delayed: results.filter((a) => a.status === 'delayed').length,
      operational: results.filter((a) => a.status === 'operational').length,
      unknown: results.filter((a) => a.status === 'unknown').length,
    },
  };

  // Write output
  const outDir = join(ROOT, 'data');
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, 'status.json');
  writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf-8');

  console.log(`\n✅ Wrote ${outPath}`);
  console.log(
    `   📊 ${output.summary.closed} closed, ${output.summary.delayed} delayed, ${output.summary.operational} operational, ${output.summary.unknown} unknown`
  );
}

function statusEmoji(status) {
  return { closed: '🔴', delayed: '🟠', operational: '🟢', unknown: '⚪' }[
    status
  ] || '⚪';
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((err) => {
  console.error('❌ Fatal error:', err);
  process.exit(1);
});
