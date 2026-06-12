"""Deterministic fake venues for poller and server tests."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from perp_liquidity.fetchers.base import (
    Coverage,
    FundingRate,
    Liquidation,
    OpenInterest,
    OrderBook,
    OrderBookLevel,
    PerpDEXClient,
    TokenNotListed,
)


def make_book(venue: str, mid: float = 100.0, levels: int = 10) -> OrderBook:
    bids = [OrderBookLevel(price=mid - 0.5 - i, qty=50.0) for i in range(levels)]
    asks = [OrderBookLevel(price=mid + 0.5 + i, qty=50.0) for i in range(levels)]
    return OrderBook(venue=venue, token="BTC", bids=bids, asks=asks)


class FakeAlpha(PerpDEXClient):
    """Healthy venue with WS_TAIL liquidations."""

    VENUE = "alpha"
    COVERAGE = {
        "orderbook": Coverage.REST,
        "funding": Coverage.REST,
        "open_interest": Coverage.REST,
        "liquidations": Coverage.WS_TAIL,
    }

    async def get_orderbook(self, token: str) -> OrderBook:
        return make_book(self.VENUE, mid=100.0)

    async def get_funding_rate(self, token: str) -> FundingRate:
        return FundingRate(
            venue=self.VENUE,
            token=token,
            rate_per_period=0.0001,
            period_hours=1.0,
            apr_annualized=0.0001 * 8760,
        )

    async def get_open_interest(self, token: str) -> OpenInterest:
        return OpenInterest(
            venue=self.VENUE, token=token, oi_base=1000.0, oi_usd=100_000.0, mark_price=100.0
        )

    async def get_recent_liquidations(self, token: str, *, lookback_seconds: int = 60):
        return [
            Liquidation(
                venue=self.VENUE,
                token=token,
                side="long",
                price=99.0,
                qty_base=2.0,
                qty_usd=198.0,
                occurred_at=datetime.now(timezone.utc) - timedelta(seconds=1),
            )
        ]


class FakeBeta(PerpDEXClient):
    """Healthy venue without public liquidations, cheaper funding, bigger OI."""

    VENUE = "beta"
    COVERAGE = {
        "orderbook": Coverage.REST,
        "funding": Coverage.REST,
        "open_interest": Coverage.REST,
        "liquidations": Coverage.NOT_AVAILABLE,
    }

    async def get_orderbook(self, token: str) -> OrderBook:
        return make_book(self.VENUE, mid=100.2)

    async def get_funding_rate(self, token: str) -> FundingRate:
        return FundingRate(
            venue=self.VENUE,
            token=token,
            rate_per_period=-0.0002,
            period_hours=8.0,
            apr_annualized=-0.0002 * (8760 / 8),
        )

    async def get_open_interest(self, token: str) -> OpenInterest:
        return OpenInterest(
            venue=self.VENUE, token=token, oi_base=3000.0, oi_usd=300_600.0, mark_price=100.2
        )

    async def get_recent_liquidations(self, token: str, *, lookback_seconds: int = 60):
        raise NotImplementedError("beta does not expose public liquidations")


class FakeDown(PerpDEXClient):
    """Venue that fails every call."""

    VENUE = "down"
    COVERAGE = {
        "orderbook": Coverage.REST,
        "funding": Coverage.REST,
        "open_interest": Coverage.REST,
        "liquidations": Coverage.NOT_AVAILABLE,
    }

    async def get_orderbook(self, token: str) -> OrderBook:
        raise TokenNotListed(self.VENUE, f"{token} not listed")

    async def get_funding_rate(self, token: str) -> FundingRate:
        raise TokenNotListed(self.VENUE, f"{token} not listed")

    async def get_open_interest(self, token: str) -> OpenInterest:
        raise TokenNotListed(self.VENUE, f"{token} not listed")

    async def get_recent_liquidations(self, token: str, *, lookback_seconds: int = 60):
        raise NotImplementedError("down venue")


@pytest.fixture
def fake_fetchers() -> list[type[PerpDEXClient]]:
    return [FakeAlpha, FakeBeta, FakeDown]
