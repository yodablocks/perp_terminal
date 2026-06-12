"""Dataclass to JSON-safe dict conversion for the API layer."""

from __future__ import annotations

from datetime import datetime

from perp_liquidity.analyzers.funding import FundingRankRow
from perp_liquidity.analyzers.liquidations import LiquidationSummary
from perp_liquidity.analyzers.open_interest import OIRankRow
from perp_liquidity.analyzers.slippage import SlippageResult
from perp_liquidity.fetchers.base import Liquidation, OrderBook


def _iso(dt: datetime | None) -> str | None:
    return dt.isoformat() if dt else None


def book_dict(book: OrderBook, depth: int) -> dict:
    return {
        "venue": book.venue,
        "mid": book.mid_price,
        "spread_bps": book.spread_bps,
        "bids": [[lv.price, lv.qty] for lv in book.bids[:depth]],
        "asks": [[lv.price, lv.qty] for lv in book.asks[:depth]],
        "fetched_at": _iso(book.fetched_at),
    }


def funding_dict(row: FundingRankRow) -> dict:
    fr = row.funding_rate
    return {
        "venue": fr.venue,
        "rate_per_period": fr.rate_per_period,
        "period_hours": fr.period_hours,
        "apr": fr.apr_annualized,
        "next_funding_at": _iso(fr.next_funding_at),
        "rank": row.rank,
        "spread_bps": row.spread_bps,
    }


def oi_dict(row: OIRankRow) -> dict:
    oi = row.open_interest
    return {
        "venue": oi.venue,
        "oi_base": oi.oi_base,
        "oi_usd": oi.oi_usd,
        "mark_price": oi.mark_price,
        "rank": row.rank,
        "share_pct": row.market_share_pct,
        "total_usd": row.total_usd,
    }


def slippage_dict(r: SlippageResult) -> dict:
    return {
        "venue": r.venue,
        "side": r.side,
        "clip_usd": r.clip_usd,
        "filled_usd": r.filled_usd,
        "slippage_bps": r.slippage_bps,
        "partial": r.partial,
    }


def liquidation_dict(liq: Liquidation) -> dict:
    return {
        "venue": liq.venue,
        "side": liq.side,
        "price": liq.price,
        "qty_usd": liq.qty_usd,
        "occurred_at": _iso(liq.occurred_at),
    }


def liq_summary_dict(s: LiquidationSummary) -> dict:
    return {
        "count": s.count,
        "total_usd": s.total_usd,
        "long_usd": s.long_usd,
        "short_usd": s.short_usd,
        "long_count": s.long_count,
        "short_count": s.short_count,
        "largest_usd": s.largest_usd,
    }
