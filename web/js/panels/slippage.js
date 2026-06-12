import { bps, usd } from "../lib/format.js";

const SCALE_CAP_BPS = 5; // cell shading saturates here

let side = "buy";

export function initSlippage(onChange) {
  document.getElementById("side-toggle").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-side]");
    if (!btn) return;
    side = btn.dataset.side;
    document
      .querySelectorAll("#side-toggle button")
      .forEach((b) => b.classList.toggle("active", b === btn));
    onChange();
  });
}

export function renderSlippage(rows) {
  const el = document.getElementById("slippage-matrix");
  const filtered = rows.filter((r) => r.side === side);
  if (!filtered.length) {
    el.innerHTML = '<div class="liq-empty">waiting for book data</div>';
    return;
  }

  const clips = [...new Set(filtered.map((r) => r.clip_usd))].sort((a, b) => a - b);
  const venues = [...new Set(filtered.map((r) => r.venue))].sort();
  const byKey = new Map(filtered.map((r) => [r.venue + "|" + r.clip_usd, r]));

  const head = clips.map((c) => `<th>${usd(c).replace("$", "")}</th>`).join("");
  const body = venues
    .map((v) => {
      const cells = clips
        .map((c) => {
          const r = byKey.get(v + "|" + c);
          if (!r) return "<td>--</td>";
          const alpha = Math.min(r.slippage_bps / SCALE_CAP_BPS, 1) * 0.45;
          const mark = r.partial ? '<span class="partial">*</span>' : "";
          return `<td class="cell"><i style="opacity:${alpha.toFixed(3)}"></i><span>${bps(
            r.slippage_bps
          )}${mark}</span></td>`;
        })
        .join("");
      return `<tr><td>${v}</td>${cells}</tr>`;
    })
    .join("");

  el.innerHTML = `<table>
    <thead><tr><th>VENUE</th>${head}</tr></thead>
    <tbody>${body}</tbody>
  </table>
  <div class="liq-empty" style="padding:6px 12px">* partial fill: book exhausted before clip filled</div>`;
}
