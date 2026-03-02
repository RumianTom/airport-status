# ✈️ Middle East Airport Status

Live dashboard showing **closed and at-risk airports** across the Middle East and surrounding conflict zones. Auto-updated every hour.

🔗 **Live site:** [https://rumiantom.github.io/airport-status/](https://rumiantom.github.io/airport-status/)

## Features

- 🔴 Real-time conflict zone risk levels from SafeAirspace.net
- 🟠 **Do Not Fly** / **At Risk** / **Caution** / **Operational** status per airport
- 🔄 Auto-updated every hour via GitHub Actions
- 🎯 Filter by risk level
- 🌙 Dark theme with responsive mobile layout
- ⚡ Zero-backend static site hosted on GitHub Pages

## Data Source

Powered by [SafeAirspace.net](https://safeairspace.net/) — an independent conflict zone and airspace risk database from [OPSGROUP](https://ops.group/).

Risk data is scraped hourly per country and committed to `data/status.json`.

## Tracked Airports

**40 airports** across 21 countries:

Israel, Lebanon, Syria, Jordan, Iraq, Iran, UAE, Qatar, Bahrain, Kuwait, Saudi Arabia, Oman, Yemen, Egypt, Cyprus, Turkey, Pakistan, Afghanistan, Libya, Sudan, Somalia.

Edit `config/airports.json` to add or remove airports.

## Setup

### Run locally

```bash
npm install
node scripts/fetch-data.mjs
npm run serve
```

### GitHub Actions

1. Enable GitHub Pages: **Settings → Pages → Source: `main` branch, root `/`**
2. The workflow runs automatically every hour, or trigger manually from the Actions tab

No API keys required — SafeAirspace data is publicly available.

## License

MIT
