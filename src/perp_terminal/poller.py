"""Background polling over perp-liquidity fetchers.

Design:
- One long-lived client per venue for the app lifetime. Constructed with
  client=None so venue-specific transports apply (ApeX DNS override only
  activates when the fetcher owns its client).
- One market task per venue: orderbook + funding + OI each cycle, failures
  recorded per dimension, never raised.
- One liquidation task per venue whose COVERAGE declares WS_TAIL. The tail
  call blocks for liq_tail_seconds then returns captured events.
- All state lives in memory. The server reads it, never the venues directly.
"""

from __future__ import annotations

import asyncio
import time
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timezone

from perp_liquidity.fetchers.base import (
    Coverage,
    FundingRate,
    Liquidation,
    OpenInterest,
    OrderBook,
    PerpDEXClient,
)


# ── venue state ──────────────────────────────────────────────────────────────


@dataclass
class VenueState:
    venue: str
    token: str | None = None
    book: OrderBook | None = None
    funding: FundingRate | None = None
    oi: OpenInterest | None = None
    errors: dict[str, str] = field(default_factory=dict)
    last_ok_at: datetime | None = None
    latency_ms: float | None = None


# ── poller ───────────────────────────────────────────────────────────────────


class Poller:
    def __init__(
        self,
        fetcher_classes: list[type[PerpDEXClient]],
        token: str = "BTC",
        interval: float = 5.0,
        liq_tail_seconds: int = 30,
        liq_buffer: int = 300,
    ):
        self.fetcher_classes = fetcher_classes
        self.token = token
        self.interval = interval
        self.liq_tail_seconds = liq_tail_seconds

        self.states: dict[str, VenueState] = {
            cls.VENUE: VenueState(venue=cls.VENUE) for cls in fetcher_classes
        }
        self.liquidations: deque[Liquidation] = deque(maxlen=liq_buffer)
        self._seen_tids: set[int] = set()

        self._clients: list[PerpDEXClient] = []
        self._tasks: list[asyncio.Task] = []
        self._running = False

    # ── lifecycle ────────────────────────────────────────────────────────────

    async def start(self) -> None:
        if self._running:
            return
        self._running = True
        for cls in self.fetcher_classes:
            client = cls()
            await client.__aenter__()
            self._clients.append(client)
            self._tasks.append(asyncio.create_task(self._market_loop(client)))
            if cls.COVERAGE.get("liquidations") is Coverage.WS_TAIL:
                self._tasks.append(asyncio.create_task(self._liq_loop(client)))

    async def stop(self) -> None:
        self._running = False
        for t in self._tasks:
            t.cancel()
        await asyncio.gather(*self._tasks, return_exceptions=True)
        self._tasks.clear()
        for c in self._clients:
            await c.__aexit__(None, None, None)
        self._clients.clear()

    def set_token(self, token: str) -> None:
        """Switch active token. State clears; loops fill it on their next cycle."""
        token = token.upper()
        if token == self.token:
            return
        self.token = token
        self.liquidations.clear()
        self._seen_tids.clear()
        for venue in self.states:
            self.states[venue] = VenueState(venue=venue)

    # ── loops ────────────────────────────────────────────────────────────────

    async def _market_loop(self, client: PerpDEXClient) -> None:
        while self._running:
            await self._market_cycle(client)
            await asyncio.sleep(self.interval)

    async def _market_cycle(self, client: PerpDEXClient) -> None:
        token = self.token
        state = self.states[client.VENUE]
        started = time.monotonic()

        results = await asyncio.gather(
            client.get_orderbook(token),
            client.get_funding_rate(token),
            client.get_open_interest(token),
            return_exceptions=True,
        )
        latency_ms = (time.monotonic() - started) * 1000

        if token != self.token:
            return  # token switched mid-flight; drop stale results

        book, funding, oi = results
        errors: dict[str, str] = {}
        any_ok = False

        if isinstance(book, OrderBook):
            state.book = book
            any_ok = True
        elif isinstance(book, BaseException):
            errors["orderbook"] = str(book)

        if isinstance(funding, FundingRate):
            state.funding = funding
            any_ok = True
        elif isinstance(funding, BaseException):
            errors["funding"] = str(funding)

        if isinstance(oi, OpenInterest):
            state.oi = oi
            any_ok = True
        elif isinstance(oi, BaseException):
            errors["open_interest"] = str(oi)

        state.errors = errors
        state.latency_ms = latency_ms
        state.token = token
        if any_ok:
            state.last_ok_at = datetime.now(timezone.utc)

    async def _liq_loop(self, client: PerpDEXClient) -> None:
        while self._running:
            token = self.token
            try:
                events = await client.get_recent_liquidations(
                    token, lookback_seconds=self.liq_tail_seconds
                )
                if token == self.token:
                    for ev in events:
                        if ev.tid not in self._seen_tids:
                            self._seen_tids.add(ev.tid)
                            self.liquidations.extend(events)
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                self.states[client.VENUE].errors["liquidations"] = str(exc)
            # WS_TAIL blocks for the window itself; this guard only matters
            # for fast-returning fakes and error paths.
            await asyncio.sleep(min(1.0, self.liq_tail_seconds))
