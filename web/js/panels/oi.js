import { usd } from "../lib/format.js";

export function renderOI(rows) {
  const el = document.getElementById("oi-bars");
  if (!rows.length) {
    el.innerHTML = '<div class="liq-empty">waiting for OI data</div>';
    return;
  }
  const maxShare = Math.max(...rows.map((r) => r.share_pct), 1);
  el.innerHTML = rows
    .map(
      (r) => `<div class="oi-row">
        <span>${r.venue}</span>
        <span class="bar"><i style="width:${((r.share_pct / maxShare) * 100).toFixed(1)}%"></i></span>
        <span class="usd">${usd(r.oi_usd)}</span>
        <span class="share">${r.share_pct.toFixed(1)}%</span>
      </div>`
    )
    .join("");
}
