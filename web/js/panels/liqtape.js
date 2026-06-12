import { usd, px, ageFromIso } from "../lib/format.js";

export function renderLiquidations(liq) {
  const cov = document.getElementById("liq-coverage");
  cov.textContent =
    "public WS feeds: " + (liq.covered_venues.join(", ") || "none");

  const s = liq.summary;
  document.getElementById("liq-summary").innerHTML =
    `<span><b>${s.count}</b> events</span>` +
    `<span><b>${usd(s.total_usd)}</b> total</span>` +
    `<span>longs <b>${usd(s.long_usd)}</b></span>` +
    `<span>shorts <b>${usd(s.short_usd)}</b></span>` +
    `<span>largest <b>${usd(s.largest_usd)}</b></span>`;

  const tape = document.getElementById("liq-tape");
  if (!liq.events.length) {
    tape.innerHTML =
      '<div class="liq-empty">no liquidations captured yet in this window</div>';
    return;
  }
  tape.innerHTML = liq.events
    .map(
      (e) => `<div class="liq-row ${e.side}">
        <span class="side"></span>
        <span>${e.venue}</span>
        <span>${e.side} @ ${px(e.price)}</span>
        <span class="usd">${usd(e.qty_usd)}</span>
        <span class="age">${ageFromIso(e.occurred_at)}</span>
      </div>`
    )
    .join("");
}
