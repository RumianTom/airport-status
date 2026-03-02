#!/usr/bin/env node

/**
 * Fetches country-level airspace risk data from SafeAirspace.net
 * and writes data/status.json for the static frontend.
 *
 * Usage:
 *   node scripts/fetch-data.mjs
 */

import * as cheerio from 'cheerio';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

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
  'Cyprus': 'cyprus',
  'Turkey': 'turkey',
  'Pakistan': 'pakistan',
  'Afghanistan': 'afghanistan',
  'Libya': 'libya',
  'Sudan': 'sudan',
  'Somalia': 'somalia',
};

// ---------------------------------------------------------------------------
// Load airport config
// ---------------------------------------------------------------------------
const airports = JSON.parse(
  readFileSync(join(ROOT, 'config', 'airports.json'), 'utf-8')
);

const uniqueCountries = [...new Set(airports.map((a) => a.country))];
console.log(`📡 Fetching risk data for ${uniqueCountries.length} countries (${airports.length} airports)…\n`);

// ---------------------------------------------------------------------------
// Fetch SafeAirspace risk level for a country
// ---------------------------------------------------------------------------
async function fetchCountryRisk(country, slug) {
  const url = `https://safeairspace.net/${slug}/`;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'AirportStatusBot/1.0 (GitHub Pages dashboard)' },
    });

    if (!res.ok) {
      console.warn(`  ⚠️  ${country}: HTTP ${res.status}`);
      return { riskLevel: null, riskText: null, warnings: [] };
    }

    const html = await res.text();
    const $ = cheerio.load(html);

    let riskText = null;
    let riskLevel = null;
    const warnings = [];

    // Find risk level in h3 headings: "Risk Level: One - Do Not Fly"
    $('h3').each((_, el) => {
      const text = $(el).text().trim();
      if (text.startsWith('Risk Level:')) {
        riskText = text.replace('Risk Level:', '').trim();
      }
    });

    // Fallback: search body text
    if (!riskText) {
      const bodyText = $('body').text();
      const match = bodyText.match(/Risk Level:\s*(.+?)(?:\n|$)/);
      if (match) riskText = match[1].trim();
    }

    // Parse risk level
    if (riskText) {
      const lower = riskText.toLowerCase();
      if (lower.includes('one') || lower.includes('do not fly')) riskLevel = 1;
      else if (lower.includes('two') || lower.includes('danger')) riskLevel = 2;
      else if (lower.includes('three') || lower.includes('caution')) riskLevel = 3;
      else if (lower.includes('no warning') || lower.includes('no risk')) riskLevel = 0;
    }

    // Collect NOTAMs/warnings
    $('a').each((_, el) => {
      const text = $(el).text().trim();
      if (text.match(/Notam|CZIB|SFAR|AIC|AIP/i) && text.length < 100) {
        if (!warnings.includes(text)) warnings.push(text);
      }
    });

    return { riskLevel, riskText, warnings };
  } catch (err) {
    console.warn(`  ⚠️  ${country}: ${err.message}`);
    return { riskLevel: null, riskText: null, warnings: [] };
  }
}

// ---------------------------------------------------------------------------
// Map risk level to status
// ---------------------------------------------------------------------------
function riskToStatus(riskLevel) {
  if (riskLevel === 1) return 'closed';
  if (riskLevel === 2) return 'at-risk';
  if (riskLevel === 3) return 'caution';
  return 'operational';
}

function statusLabel(status) {
  return {
    closed: 'Do Not Fly',
    'at-risk': 'Danger Exists',
    caution: 'Exercise Caution',
    operational: 'Operational',
  }[status] || 'Unknown';
}

function statusEmoji(riskLevel) {
  return { 1: '🔴', 2: '🟠', 3: '🟡', 0: '🟢' }[riskLevel] || '🟢';
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const countryRisks = {};

  // Fetch risk levels per country
  for (const country of uniqueCountries) {
    const slug = COUNTRY_SLUGS[country];
    if (!slug) {
      console.log(`  ⏭️  ${country}: no SafeAirspace slug`);
      countryRisks[country] = { riskLevel: 0, riskText: 'No Warnings', warnings: [] };
      continue;
    }

    process.stdout.write(`  ${country}… `);
    const risk = await fetchCountryRisk(country, slug);
    console.log(`${statusEmoji(risk.riskLevel)} ${risk.riskText || 'No data'}`);
    countryRisks[country] = risk;

    await sleep(500);
  }

  // Build per-airport results
  const results = airports.map((airport) => {
    const risk = countryRisks[airport.country] || { riskLevel: 0, riskText: null, warnings: [] };
    const status = riskToStatus(risk.riskLevel);

    return {
      icao: airport.icao,
      name: airport.name,
      city: airport.city,
      country: airport.country,
      lat: airport.lat,
      lon: airport.lon,
      status,
      statusLabel: statusLabel(status),
      riskLevel: risk.riskLevel,
      riskText: risk.riskText || null,
      warnings: (risk.warnings || []).slice(0, 5),
    };
  });

  const output = {
    lastUpdated: new Date().toISOString(),
    airports: results,
    summary: {
      total: results.length,
      closed: results.filter((a) => a.status === 'closed').length,
      atRisk: results.filter((a) => a.status === 'at-risk').length,
      caution: results.filter((a) => a.status === 'caution').length,
      operational: results.filter((a) => a.status === 'operational').length,
    },
  };

  const outDir = join(ROOT, 'data');
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, 'status.json');
  writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf-8');

  console.log(`\n✅ Wrote ${outPath}`);
  console.log(`   📊 ${output.summary.closed} closed, ${output.summary.atRisk} at-risk, ${output.summary.caution} caution, ${output.summary.operational} operational`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((err) => {
  console.error('❌ Fatal error:', err);
  process.exit(1);
});
