import { getSnapshot, getCandles, getProfile } from "./api.js";
import { initChart, renderChart } from "./panels/chart.js";
import { initProfile, renderProfile, getPriceRange } from "./panels/profile.js";
import { renderFunding } from "./panels/funding.js";
import { renderOI } from "./panels/oi.js";
import { initSlippage, renderSlippage } from "./panels/slippage.js";
import { initRouter, renderRouter, rerenderRouter } from "./panels/router.js";
import { renderLiquidations } from "./panels/liqtape.js";
import { age } from "./lib/format.js";

const SNAP_MS    = 3000;
const CANDLE_MS  = 15000;
const PROFILE_MS = 60000;

let token    = "BTC";
let interval = "1h";
let lastSnap = null;

// ── venue strip ────────────────────────────────────────────

function renderVenueStrip(venues) {
  document.getElementById("venue-strip").innerHTML = venues
    .map(v => `<span class="v" title="${escapeErrors(v.errors)}">
      <span class="dot ${v.status}"></span>${v.venue}
      ${v.latency_ms != null ? Math.round(v.latency_ms) + "ms" : ""}
    </span>`)
    .join("");
}

function escapeErrors(errors) {
  return Object.entries(errors || {}).map(([k, v]) => `${k}: ${v}`)
    .join("\n").replaceAll('"', "'");
}

// ── chart + profile update ─────────────────────────────────

async function tickCandles() {
  try {
    const data = await getCandles(token, interval, 120);
    const candles = data.candles;
    const range = getPriceRange(candles);
    // Profile is already cached server-side; fetch separately so timings decouple
    let profile = null;
    try {
      profile = await getProfile(token);
    } catch (_) { /* non-fatal: chart renders without profile */ }
    renderChart(candles, profile);
    renderProfile(profile, range);
    document.getElementById("chart-title").innerHTML =
      `HYPERLIQUID · ${token} <span class="sub">market profile + price (${interval})</span>`;
  } catch (err) {
    console.warn("candles:", err.message);
  }
}

// ── snapshot update ────────────────────────────────────────

async function tickSnapshot() {
  try {
    const snap = await getSnapshot(token);
    lastSnap = snap;
    renderVenueStrip(snap.venues);
    renderFunding(snap.funding, snap.funding_flips);
    renderOI(snap.oi);
    renderSlippage(snap.slippage);
    renderRouter(snap.slippage);
    renderLiquidations(snap.liquidations);
    document.getElementById("generated-at").textContent =
      snap.token + " · poll " + snap.poll_interval_s + "s";
  } catch (err) {
    document.getElementById("generated-at").textContent =
      "server unreachable: " + err.message;
  }
}

// ── token / interval switching ─────────────────────────────

function setToken(next) {
  if (next === token) return;
  token = next;
  document.querySelectorAll("#token-tabs button")
    .forEach(b => b.classList.toggle("active", b.dataset.token === token));
  tickSnapshot();
  tickCandles();
}

function setInterval_(next) {
  if (next === interval) return;
  interval = next;
  document.querySelectorAll("#interval-tabs button")
    .forEach(b => b.classList.toggle("active", b.dataset.interval === interval));
  tickCandles();
}

// ── init ───────────────────────────────────────────────────

function main() {
  initChart();
  initProfile();
  initSlippage(() => lastSnap && renderSlippage(lastSnap.slippage));
  initRouter(() => rerenderRouter());

  document.getElementById("token-tabs").addEventListener("click", e => {
    const btn = e.target.closest("button[data-token]");
    if (btn) setToken(btn.dataset.token);
  });

  document.getElementById("interval-tabs").addEventListener("click", e => {
    const btn = e.target.closest("button[data-interval]");
    if (btn) setInterval_(btn.dataset.interval);
  });

  tickSnapshot();
  tickCandles();
  setInterval(tickSnapshot, SNAP_MS);
  setInterval(tickCandles,  CANDLE_MS);
}

main();
