"""Poller behavior with fake venues."""

import asyncio

from perp_terminal.poller import Poller


async def _started_poller(fake_fetchers, **kw) -> Poller:
    poller = Poller(fake_fetchers, token="BTC", interval=0.05, liq_tail_seconds=1, **kw)
    await poller.start()
    await asyncio.sleep(0.2)
    return poller


async def test_market_state_populates(fake_fetchers):
    poller = await _started_poller(fake_fetchers)
    try:
        alpha = poller.states["alpha"]
        assert alpha.book is not None
        assert alpha.funding is not None
        assert alpha.oi is not None
        assert alpha.errors == {}
        assert alpha.last_ok_at is not None
        assert alpha.latency_ms is not None
        assert alpha.token == "BTC"
    finally:
        await poller.stop()


async def test_failing_venue_records_errors_not_crash(fake_fetchers):
    poller = await _started_poller(fake_fetchers)
    try:
        down = poller.states["down"]
        assert down.book is None
        assert set(down.errors) == {"orderbook", "funding", "open_interest"}
        assert down.last_ok_at is None
        # healthy venues unaffected
        assert poller.states["beta"].book is not None
    finally:
        await poller.stop()


async def test_liquidations_only_from_ws_tail_venues(fake_fetchers):
    poller = await _started_poller(fake_fetchers)
    try:
        venues = {liq.venue for liq in poller.liquidations}
        assert venues == {"alpha"}
        assert len(poller.liquidations) >= 1
    finally:
        await poller.stop()


async def test_set_token_clears_state(fake_fetchers):
    poller = await _started_poller(fake_fetchers)
    try:
        assert poller.states["alpha"].book is not None
        poller.set_token("eth")
        assert poller.token == "ETH"
        assert poller.states["alpha"].book is None
        assert len(poller.liquidations) == 0
        await asyncio.sleep(0.2)
        assert poller.states["alpha"].token == "ETH"
        assert poller.states["alpha"].book is not None
    finally:
        await poller.stop()


async def test_set_token_same_token_is_noop(fake_fetchers):
    poller = await _started_poller(fake_fetchers)
    try:
        book_before = poller.states["alpha"].book
        poller.set_token("BTC")
        assert poller.states["alpha"].book is book_before
    finally:
        await poller.stop()
