import { pct, countdown } from "../lib/format.js";

export function renderFunding(rows, flips) {
  const el = document.getElementById("funding-table");
  if (!rows.length) {
    el.innerHTML = '<div class="liq-empty">waiting for funding data</div>';
    return;
  }
  const flipSet = new Set(flips);
  const tr = rows
    .map((r) => {
      const cls = r.apr >= 0 ? "pos" : "neg";
      const flip = flipSet.has(r.venue) ? '<span class="badge">FLIP</span>' : "";
      return `<tr>
        <td>${r.venue}${flip}</td>
        <td class="${cls}">${pct(r.apr * 100)}</td>
        <td>${r.period_hours}h</td>
        <td>${countdown(r.next_funding_at)}</td>
      </tr>`;
    })
    .join("");
  el.innerHTML = `<table>
    <thead><tr><th>VENUE</th><th>APR</th><th>PERIOD</th><th>NEXT</th></tr></thead>
    <tbody>${tr}</tbody>
  </table>`;
}
