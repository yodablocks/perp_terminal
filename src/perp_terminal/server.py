"""FastAPI server. One snapshot endpoint, one health endpoint, static web UI.

Run: perp-terminal [--host 0.0.0.0] [--port 8010] [--token BTC] [--interval 5]
"""

from __future__ import annotations

import argparse
import asyncio
import os
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

import httpx
from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from perp_liquidity.analyzers.funding import detect_flips, rank_funding
from perp_liquidity.analyzers.liquidations import summarize_liquidations
from perp_liquidity.analyzers.open_interest import rank_open_interest
from perp_liquidity.analyzers.slippage import compute_slippage_multi
from perp_liquidity.fetchers.base import Coverage, PerpDEXClient

from perp_terminal import serialize
from perp_terminal.market_profile import fetch_market_profile, profile_dict
from perp_terminal.poller import Poller

WEB_DIR = Path(__file__).resolve().parents[2] / "web"
STALE_AFTER_INTERVALS = 3
HL_REST = "https://api.hyperliquid.xyz/info"

# Profile cache: one entry per (token, session_date). Refreshed every 60s.
_profile_cache: dict[str, tuple[float, dict]] = {}   # token -> (fetched_ts, profile_dict)
_profile_lock = asyncio.Lock()
PROFILE_TTL = 60.0   # seconds

# Candle cache: token -> (fetched_ts, candles_list)
_candle_cache: dict[str, tuple[float, list]] = {}
CANDLE_TTL = 10.0    # seconds; candles update every minute, so 10s is fine


# ── app factory ──────────────────────────────────────────────────────────────


def create_app(
    fetcher_classes: list[type[PerpDEXClient]] | None = None,
    token: str = "BTC",
    interval: float = 5.0,
    liq_tail_seconds: int = 30,
) -> FastAPI:
    if fetcher_classes is None:
        from perp_liquidity.cli import _default_fetchers

        fetcher_classes = _default_fetchers()

    poller = Poller(
        fetcher_classes,
        token=token,
        interval=interval,
        liq_tail_seconds=liq_tail_seconds,
    )

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        await poller.start()
        yield
        await poller.stop()

    app = FastAPI(title="perp-terminal", lifespan=lifespan)
    app.state.poller = poller

    liq_covered = sorted(
        cls.VENUE
        for cls in fetcher_classes
        if cls.COVERAGE.get("liquidations") is Coverage.WS_TAIL
    )

    # ── api ──────────────────────────────────────────────────────────────────

    @app.get("/api/health")
    async def health() -> dict:
        return {"status": "ok", "token": poller.token, "venues": len(poller.states)}

    @app.get("/api/snapshot")
    async def snapshot(
        token: str | None = Query(default=None),
        depth: int = Query(default=25, ge=1, le=200),
    ) -> dict:
        if token and token.upper() != poller.token:
            poller.set_token(token)

        now = datetime.now(timezone.utc)
        active = poller.token

        venues = []
        books = []
        fundings = []
        ois = []
        slippage = []

        for state in poller.states.values():
            age_s = (
                (now - state.last_ok_at).total_seconds() if state.last_ok_at else None
            )
            if state.last_ok_at is None:
                status = "down" if state.errors else "waiting"
            elif age_s is not None and age_s > poller.interval * STALE_AFTER_INTERVALS:
                status = "stale"
            else:
                status = "ok"
            venues.append(
                {
                    "venue": state.venue,
                    "status": status,
                    "age_s": age_s,
                    "latency_ms": state.latency_ms,
                    "errors": state.errors,
                }
            )

            if state.token != active:
                continue  # data belongs to a previous token
            if state.book is not None:
                books.append(serialize.book_dict(state.book, depth))
                slippage.extend(
                    serialize.slippage_dict(r)
                    for r in compute_slippage_multi(state.book)
                )
            if state.funding is not None:
                fundings.append(state.funding)
            if state.oi is not None:
                ois.append(state.oi)

        funding_rows = [serialize.funding_dict(r) for r in rank_funding(fundings)]
        flips = detect_flips(fundings)
        oi_rows = [serialize.oi_dict(r) for r in rank_open_interest(ois)]

        liqs = [liq for liq in poller.liquidations if liq.token == active]
        liq_events = [serialize.liquidation_dict(liq) for liq in reversed(liqs)][:100]
        liq_summary = serialize.liq_summary_dict(summarize_liquidations(liqs))

        return {
            "token": active,
            "generated_at": now.isoformat(),
            "poll_interval_s": poller.interval,
            "venues": sorted(venues, key=lambda v: v["venue"]),
            "books": sorted(books, key=lambda b: b["venue"]),
            "funding": funding_rows,
            "funding_flips": flips,
            "oi": oi_rows,
            "slippage": slippage,
            "liquidations": {
                "events": liq_events,
                "summary": liq_summary,
                "covered_venues": liq_covered,
            },
        }

    # ── market profile ───────────────────────────────────────────────────────

    @app.get("/api/profile")
    async def profile(token: str = Query(default="BTC")) -> dict:
        token = token.upper()
        hl_state = poller.states.get("hyperliquid")
        mark_price = hl_state.oi.mark_price if (hl_state and hl_state.oi) else None

        async with _profile_lock:
            cached = _profile_cache.get(token)
            if cached and (time.monotonic() - cached[0]) < PROFILE_TTL:
                return cached[1]

        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                p = await fetch_market_profile(token, mark_price=mark_price, client=client)
            result = profile_dict(p)
        except Exception as exc:
            raise HTTPException(status_code=502, detail=str(exc))

        async with _profile_lock:
            _profile_cache[token] = (time.monotonic(), result)

        return result

    @app.get("/api/candles")
    async def candles(
        token: str = Query(default="BTC"),
        interval: str = Query(default="1h"),
        limit: int = Query(default=100, ge=1, le=500),
    ) -> dict:
        """Recent OHLCV candles from Hyperliquid for the price chart."""
        token = token.upper()
        cache_key = f"{token}:{interval}"
        cached = _candle_cache.get(cache_key)
        if cached and (time.monotonic() - cached[0]) < CANDLE_TTL:
            return {"token": token, "interval": interval, "candles": cached[1][-limit:]}

        now_ms = int(time.time() * 1000)
        ms_per_candle = {"1m": 60_000, "5m": 300_000, "15m": 900_000,
                         "1h": 3_600_000, "4h": 14_400_000, "1d": 86_400_000}
        ms_back = ms_per_candle.get(interval, 3_600_000) * (limit + 10)
        start_ms = now_ms - ms_back

        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                resp = await client.post(
                    HL_REST,
                    json={
                        "type": "candleSnapshot",
                        "req": {"coin": token, "interval": interval,
                                "startTime": start_ms, "endTime": now_ms},
                    },
                )
                resp.raise_for_status()
                raw = resp.json()
        except Exception as exc:
            raise HTTPException(status_code=502, detail=str(exc))

        result = [
            {
                "t": c["t"],
                "o": float(c["o"]),
                "h": float(c["h"]),
                "l": float(c["l"]),
                "c": float(c["c"]),
                "v": float(c["v"]),
                "n": c.get("n", 0),
            }
            for c in raw
        ]
        _candle_cache[cache_key] = (time.monotonic(), result)
        return {"token": token, "interval": interval, "candles": result[-limit:]}

    # ── static ───────────────────────────────────────────────────────────────

    if WEB_DIR.is_dir():

        @app.get("/")
        async def index() -> FileResponse:
            return FileResponse(WEB_DIR / "index.html")

        app.mount("/", StaticFiles(directory=WEB_DIR), name="web")

    return app


# ── entry point ──────────────────────────────────────────────────────────────


def main() -> None:
    import uvicorn

    parser = argparse.ArgumentParser(prog="perp-terminal")
    parser.add_argument("--host", default=os.environ.get("PT_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("PT_PORT", "8010")))
    parser.add_argument("--token", default=os.environ.get("PT_TOKEN", "BTC"))
    parser.add_argument(
        "--interval", type=float, default=float(os.environ.get("PT_INTERVAL", "5"))
    )
    args = parser.parse_args()

    app = create_app(token=args.token.upper(), interval=args.interval)
    uvicorn.run(app, host=args.host, port=args.port)


if __name__ == "__main__":
    main()
