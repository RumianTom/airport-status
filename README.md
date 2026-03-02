# ✈️ Middle East Airport Status

Live dashboard showing **closed and at-risk airports** in the Middle East region. Auto-updated every hour via GitHub Actions.

🔗 **Live site:** [https://rumiantom.github.io/airport-status/](https://rumiantom.github.io/airport-status/)

## Features

- 🔴 Real-time closure and delay status for 27 Middle East airports
- 🔄 Auto-updated every hour via FlightAware AeroAPI
- 🎯 Filter by status: Closed / Delayed / Operational
- 🌙 Dark theme with responsive mobile layout
- ⚡ Zero-backend static site hosted on GitHub Pages

## Data Source

Powered by [FlightAware AeroAPI v4](https://www.flightaware.com/commercial/aeroapi/). Airport delay and closure data is fetched hourly and committed to `data/status.json`.

## Setup

### Prerequisites

- Node.js 20+
- [FlightAware AeroAPI key](https://www.flightaware.com/aeroapi/portal/)

### Run locally

```bash
# Fetch fresh data
FLIGHTAWARE_API_KEY=your_key npm run fetch

# Serve the site
npm run serve
```

### GitHub Actions

1. Add your API key as a repository secret: **Settings → Secrets → `FLIGHTAWARE_API_KEY`**
2. Enable GitHub Pages: **Settings → Pages → Source: `main` branch, root `/`**
3. The workflow runs automatically every hour, or trigger manually from the Actions tab

## Tracked Airports

27 airports across: Israel, Lebanon, Syria, Jordan, Iraq, Iran, UAE, Qatar, Bahrain, Kuwait, Saudi Arabia, Oman, Yemen, Egypt.

Edit `config/airports.json` to add or remove airports.

## License

MIT
