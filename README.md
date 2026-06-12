# perp-terminal

Read-only market terminal across 8 perpetual DEXes: Hyperliquid, Paradex, Lighter, Aster, Extended, EdgeX, ApeX, GRVT.

One screen: cross-venue book depth, funding APR with flip detection, open interest share, walked-book slippage across clip sizes, and a live liquidation tape from the venues that expose one publicly.

Built on [perp-liquidity](https://github.com/yodablocks/perp-liquidity), which provides the 8 venue fetchers and the analyzers. This repo adds a polling service, a snapshot API, and a web UI. Public APIs only. No keys, no execution, no signals.

## Run

```
pip install .
perp-terminal --port 8010
```

Open http://127.0.0.1:8010. Options: `--token BTC --interval 5 --host 0.0.0.0`, or env vars `PT_TOKEN`, `PT_INTERVAL`, `PT_HOST`, `PT_PORT`.

The frontend has no build step. Native ES modules served straight from `web/`. Clone and run.

## Architecture

```
src/perp_terminal/
├── poller.py      # one long-lived client per venue, one market task per venue,
│                  # one WS tail task per venue that exposes liquidations
├── server.py      # FastAPI: GET /api/snapshot, GET /api/health, static mount
└── serialize.py   # dataclasses -> JSON

web/
├── index.html
├── css/terminal.css
└── js/
    ├── main.js            # 2s refresh loop, token tabs, venue status strip
    ├── api.js
    ├── panels/            # ladder (canvas), funding, oi, slippage, liqtape
    └── lib/format.js
```

The poller holds all venue state in memory. The server reads that state and computes rankings and slippage on request via perp-liquidity's pure analyzer functions. The browser polls `/api/snapshot` every 2 seconds.

## Depth panel methodology

Each venue row bins its book by basis-point offset from that venue's own mid (2 bps bins, ±50 bps window) and plots cumulative USD depth, bids leftward, asks rightward. Bar heights are normalized to the deepest venue at the window edge, so depth is comparable across rows. Spread in bps and total depth at ±50 bps are printed per row.

Slippage walks the book against a mid-price reference at 1k / 10k / 100k / 500k USD clips, both sides. Funding is annualized using each venue's actual period (1h / 4h / 8h). Methodology details live in the perp-liquidity README.

## Coverage and honesty

Not every venue exposes everything. Liquidations are public on 3 of 8 venues (Hyperliquid, Lighter, Extended, via websocket). The other 5 are reported as not available rather than approximated. Venue status dots in the header show ok / stale / down with per-venue latency, and errors are surfaced in the API response instead of being swallowed.

## Known limitations

- Single active token at a time. Switching tokens clears state and refills within one poll cycle.
- The liquidation tape covers only the venues with public feeds. It is a sample of the market, not the whole market.
- ApeX is geo-blocked on some ISPs. perp-liquidity ships a DNS override transport that handles this automatically.
- Snapshot polling, not streaming. Phase 2 adds a book recorder and a time-series depth heatmap.

## Tests

```
pip install .[dev]
pytest
```

Tests run against deterministic fake venues implementing the same ABC as the real fetchers. No network required.
