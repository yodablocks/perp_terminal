"""Hyperliquid market profile builder.

Data source: POST /info { type: candleSnapshot, req: { coin, interval, startTime, endTime } }
Returns OHLCV candles. We use 1m candles for the current session (00:00 UTC to now).

Volume distribution per candle:
  The HL API returns volume in base asset units per candle. We don't have per-trade
  price granularity from the candle endpoint, so we use the standard approximation:
  distribute the candle's volume uniformly across its H-L range, binned into $BUCKET_SIZE
  price buckets. This is the same method TradingView uses for session volume profile.
  Result: a histogram where each bar = total base volume traded at that price bucket.

Profile levels:
  POC  = price of control: highest-volume bucket
  VAH  = value area high: upper bound of the range containing 70% of volume (from POC up)
  VAL  = value area low: lower bound (from POC down)
  The value area is built by expanding outward from the POC until 70% of session volume
  is enclosed, following CME TPO methodology.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from datetime import datetime, timezone

import httpx

HL_REST = "https://api.hyperliquid.xyz/info"
BUCKET_SIZE_DEFAULT = 10.0  # USD per bucket; auto-scales for high/low price assets
VALUE_AREA_PCT = 0.70
TIMEOUT = 15.0


# ── return types ─────────────────────────────────────────────────────────────


@dataclass
class ProfileLevel:
    price: float      # bucket midpoint
    volume: float     # base asset volume in this bucket
    is_poc: bool = False
    in_value_area: bool = False


@dataclass
class MarketProfile:
    token: str
    session_start: datetime
    session_end: datetime
    levels: list[ProfileLevel]   # sorted ascending by price
    poc: float                   # price of bucket with most volume
    vah: float                   # value area high
    val: float                   # value area low
    total_volume: float
    candle_count: int
    bucket_size: float
    fetched_at: datetime


# ── bucket size heuristic ─────────────────────────────────────────────────────


def _bucket_size(mark_price: float) -> float:
    """Scale bucket granularity to the asset's price magnitude."""
    if mark_price > 50_000:
        return 50.0    # BTC: $50 buckets
    if mark_price > 5_000:
        return 10.0    # ETH: $10 buckets
    if mark_price > 500:
        return 1.0
    if mark_price > 50:
        return 0.1
    return 0.01


# ── main builder ──────────────────────────────────────────────────────────────


async def fetch_market_profile(
    token: str,
    mark_price: float | None = None,
    client: httpx.AsyncClient | None = None,
) -> MarketProfile:
    """Fetch today's session candles and build a market profile.

    Session = 00:00 UTC to now. Uses 1m candles for max price resolution.
    Passes mark_price for bucket sizing; if None, infers from candle close prices.
    """
    token = token.upper()
    owns_client = client is None
    if owns_client:
        client = httpx.AsyncClient(timeout=TIMEOUT)

    try:
        now_ms = int(time.time() * 1000)
        # Session start: 00:00 UTC today
        now_dt = datetime.now(timezone.utc)
        session_start_dt = now_dt.replace(hour=0, minute=0, second=0, microsecond=0)
        start_ms = int(session_start_dt.timestamp() * 1000)

        resp = await client.post(
            HL_REST,
            json={
                "type": "candleSnapshot",
                "req": {
                    "coin": token,
                    "interval": "1m",
                    "startTime": start_ms,
                    "endTime": now_ms,
                },
            },
        )
        resp.raise_for_status()
        candles = resp.json()

        if not candles:
            raise ValueError(f"no candles returned for {token}")

        # Infer bucket size from mark_price or last close
        if mark_price is None:
            mark_price = float(candles[-1]["c"])
        bucket = _bucket_size(mark_price)

        # ── distribute volume into price buckets ──────────────────────────────
        # volumes: dict from bucket_key (int = floor(price / bucket)) -> total volume
        volumes: dict[int, float] = {}

        for c in candles:
            hi = float(c["h"])
            lo = float(c["l"])
            vol = float(c["v"])   # base asset volume
            if hi <= lo or vol <= 0:
                # Zero-range candle: assign all volume to one bucket
                key = int(lo / bucket)
                volumes[key] = volumes.get(key, 0.0) + vol
                continue
            # How many buckets span this candle?
            lo_key = int(lo / bucket)
            hi_key = int(hi / bucket)
            n_buckets = hi_key - lo_key + 1
            vol_per_bucket = vol / n_buckets
            for k in range(lo_key, hi_key + 1):
                volumes[k] = volumes.get(k, 0.0) + vol_per_bucket

        if not volumes:
            raise ValueError(f"empty volume distribution for {token}")

        # ── find POC ─────────────────────────────────────────────────────────
        poc_key = max(volumes, key=lambda k: volumes[k])
        total_volume = sum(volumes.values())
        target = total_volume * VALUE_AREA_PCT

        # ── expand value area outward from POC ────────────────────────────────
        sorted_keys = sorted(volumes.keys())
        poc_idx = sorted_keys.index(poc_key)
        lo_idx = hi_idx = poc_idx
        accumulated = volumes[poc_key]

        while accumulated < target:
            can_go_down = lo_idx > 0
            can_go_up = hi_idx < len(sorted_keys) - 1
            if not can_go_down and not can_go_up:
                break
            vol_down = volumes[sorted_keys[lo_idx - 1]] if can_go_down else 0
            vol_up = volumes[sorted_keys[hi_idx + 1]] if can_go_up else 0
            if vol_down >= vol_up and can_go_down:
                lo_idx -= 1
                accumulated += vol_down
            else:
                hi_idx += 1
                accumulated += vol_up

        va_keys = set(sorted_keys[lo_idx: hi_idx + 1])

        # ── build levels ──────────────────────────────────────────────────────
        levels = [
            ProfileLevel(
                price=k * bucket + bucket / 2,   # bucket midpoint
                volume=volumes[k],
                is_poc=(k == poc_key),
                in_value_area=(k in va_keys),
            )
            for k in sorted_keys
        ]

        return MarketProfile(
            token=token,
            session_start=session_start_dt,
            session_end=datetime.now(timezone.utc),
            levels=levels,
            poc=poc_key * bucket + bucket / 2,
            vah=sorted_keys[hi_idx] * bucket + bucket,
            val=sorted_keys[lo_idx] * bucket,
            total_volume=total_volume,
            candle_count=len(candles),
            bucket_size=bucket,
            fetched_at=datetime.now(timezone.utc),
        )

    finally:
        if owns_client:
            await client.aclose()


# ── serializer ────────────────────────────────────────────────────────────────


def profile_dict(p: MarketProfile) -> dict:
    return {
        "token": p.token,
        "session_start": p.session_start.isoformat(),
        "session_end": p.session_end.isoformat(),
        "poc": p.poc,
        "vah": p.vah,
        "val": p.val,
        "total_volume": p.total_volume,
        "candle_count": p.candle_count,
        "bucket_size": p.bucket_size,
        "fetched_at": p.fetched_at.isoformat(),
        "levels": [
            {
                "price": lv.price,
                "volume": lv.volume,
                "poc": lv.is_poc,
                "va": lv.in_value_area,
            }
            for lv in p.levels
        ],
    }
