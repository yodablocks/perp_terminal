import { bps, usd } from "../lib/format.js";

let clip = 1000;
let side = "buy";
let lastSlippage = [];

export function initRouter(onChange) {
  document.getElementById("clip-row").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-clip]");
    if (!btn) return;
    clip = parseInt(btn.dataset.clip, 10);
    document.querySelectorAll("#clip-row button")
      .forEach(b => b.classList.toggle("active", b === btn));
    onChange();
  });

  document.getElementById("router-buy").addEventListener("click", () => {
    side = "buy";
    document.getElementById("router-buy").classList.add("active");
    document.getElementById("router-sell").classList.remove("active");
    onChange();
  });

  document.getElementById("router-sell").addEventListener("click", () => {
    side = "sell";
    document.getElementById("router-sell").classList.add("active");
    document.getElementById("router-buy").classList.remove("active");
    onChange();
  });
}

export function renderRouter(slippage) {
  lastSlippage = slippage;
  _render(slippage);
}

function _render(slippage) {
  const el = document.getElementById("router-result");
  const rows = slippage
    .filter(r => r.side === side && r.clip_usd === clip)
    .sort((a, b) => a.slippage_bps - b.slippage_bps);

  if (!rows.length) {
    el.innerHTML = '<div class="liq-empty">no data for this clip size</div>';
    return;
  }

  el.innerHTML = rows.map((r, i) => {
    const bestClass = i === 0 ? " best" : "";
    const partialMark = r.partial
      ? `<span class="partial">PARTIAL</span>` : "";
    return `<div class="router-result-row${bestClass}">
      <span>${r.venue}</span>
      <span class="rank">#${i + 1}</span>
      <span class="slip">${bps(r.slippage_bps)} bps</span>
      <span>${partialMark}</span>
    </div>`;
  }).join("");
}

export function rerenderRouter() {
  _render(lastSlippage);
}
