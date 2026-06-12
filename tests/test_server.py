"""Snapshot endpoint shape and semantics, via lifespan-managed TestClient."""

import time

from fastapi.testclient import TestClient

from perp_terminal.server import create_app


def _client(fake_fetchers) -> TestClient:
    app = create_app(fake_fetchers, token="BTC", interval=0.05, liq_tail_seconds=1)
    return TestClient(app)


def _wait_snapshot(client: TestClient, want_books: int, timeout: float = 3.0) -> dict:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        snap = client.get("/api/snapshot").json()
        if len(snap["books"]) >= want_books:
            return snap
        time.sleep(0.05)
    raise AssertionError(f"never reached {want_books} books")


def test_health(fake_fetchers):
    with _client(fake_fetchers) as client:
        body = client.get("/api/health").json()
        assert body["status"] == "ok"
        assert body["venues"] == 3


def test_snapshot_shape_and_rankings(fake_fetchers):
    with _client(fake_fetchers) as client:
        snap = _wait_snapshot(client, want_books=2)

        assert snap["token"] == "BTC"
        assert {b["venue"] for b in snap["books"]} == {"alpha", "beta"}

        book = snap["books"][0]
        assert book["mid"] is not None
        assert len(book["bids"]) <= 25
        assert book["bids"][0][0] > book["bids"][1][0]  # best bid first

        # funding ranked ascending by APR: beta (negative) before alpha
        assert [f["venue"] for f in snap["funding"]] == ["beta", "alpha"]
        assert snap["funding"][0]["rank"] == 1

        # OI ranked descending by USD: beta first
        assert [o["venue"] for o in snap["oi"]] == ["beta", "alpha"]
        assert abs(sum(o["share_pct"] for o in snap["oi"]) - 100.0) < 1e-6

        # slippage: 8 rows per healthy venue (4 clips x 2 sides)
        per_venue = {}
        for r in snap["slippage"]:
            per_venue.setdefault(r["venue"], 0)
            per_venue[r["venue"]] += 1
        assert per_venue == {"alpha": 8, "beta": 8}

        # liquidations only from the WS_TAIL venue
        assert snap["liquidations"]["covered_venues"] == ["alpha"]
        assert all(
            e["venue"] == "alpha" for e in snap["liquidations"]["events"]
        )
        assert snap["liquidations"]["summary"]["count"] >= 1


def test_venue_statuses(fake_fetchers):
    with _client(fake_fetchers) as client:
        snap = _wait_snapshot(client, want_books=2)
        status = {v["venue"]: v["status"] for v in snap["venues"]}
        assert status["alpha"] == "ok"
        assert status["beta"] == "ok"
        assert status["down"] == "down"
        down = next(v for v in snap["venues"] if v["venue"] == "down")
        assert "not listed" in down["errors"]["orderbook"]


def test_token_switch_clears_then_refills(fake_fetchers):
    with _client(fake_fetchers) as client:
        _wait_snapshot(client, want_books=2)
        snap = client.get("/api/snapshot", params={"token": "eth"}).json()
        assert snap["token"] == "ETH"
        # books from the BTC cycle must not leak into the ETH snapshot
        assert all(False for _ in snap["books"]) or snap["books"] == []
        snap = _wait_snapshot(client, want_books=2)
        assert snap["token"] == "ETH"


def test_depth_param_caps_levels(fake_fetchers):
    with _client(fake_fetchers) as client:
        _wait_snapshot(client, want_books=2)
        snap = client.get("/api/snapshot", params={"depth": 3}).json()
        for book in snap["books"]:
            assert len(book["bids"]) <= 3
            assert len(book["asks"]) <= 3
