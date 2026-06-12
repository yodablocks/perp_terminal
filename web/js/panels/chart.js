// Candlestick price chart. Drawn on #chart-canvas.
// Candle body: open/close rect. Wick: high/low line.
// Overlays: POC line (amber), VAH/VAL dashed lines, current price dashed.
// No external dependency — raw canvas.

const C = {
  bg:      "#0a0d12",
  up:      "#2ebd85",
  dn:      "#e0524f",
  wick:    "#5a6678",
  poc:     "#e8a33d",
  va:      "rgba(232,163,61,0.10)",
  price:   "rgba(201,211,224,0.5)",
  grid:    "#1c2330",
  label:   "#5a6678",
  text:    "#c9d3e0",
};

const PAD = { top: 20, right: 0, bottom: 28, left: 62 };
const VOL_H_RATIO = 0.18;  // fraction of plotH reserved for volume bars
const VOL_GAP = 4;         // px gap between price and volume sections

let canvas, ctx;
let lastCandles = [];
let lastProfile = null;
let tooltip = null;

export function initChart() {
  canvas = document.getElementById("chart-canvas");
  ctx = canvas.getContext("2d");

  tooltip = document.createElement("div");
  tooltip.id = "chart-tooltip";
  document.body.appendChild(tooltip);

  canvas.addEventListener("mousemove", onMouseMove);
  canvas.addEventListener("mouseleave", () => { tooltip.style.display = "none"; });

  const ro = new ResizeObserver(() => requestAnimationFrame(() => draw(lastCandles, lastProfile)));
  ro.observe(canvas);
}

function onMouseMove(e) {
  if (!lastCandles.length) return;

  const rect = canvas.getBoundingClientRect();
  const mouseX = e.clientX - rect.left;

  const w = rect.width;
  const plotW = w - PAD.left - PAD.right;
  const n = lastCandles.length;
  const candleW = Math.max(1, plotW / n);

  // clamp to the plot area
  if (mouseX < PAD.left || mouseX > w - PAD.right) {
    tooltip.style.display = "none";
    return;
  }

  const idx = Math.min(n - 1, Math.max(0, Math.floor((mouseX - PAD.left) / candleW)));
  const c = lastCandles[idx];
  const up = c.c >= c.o;

  const dt = new Date(c.t);
  const dateStr = dt.getUTCFullYear() + "-"
    + String(dt.getUTCMonth() + 1).padStart(2, "0") + "-"
    + String(dt.getUTCDate()).padStart(2, "0");
  const timeStr = String(dt.getUTCHours()).padStart(2, "0") + ":"
    + String(dt.getUTCMinutes()).padStart(2, "0") + " UTC";

  const priceColor = up ? C.up : C.dn;

  tooltip.textContent = "";

  const timeEl = document.createElement("div");
  timeEl.className = "tt-time";
  timeEl.textContent = `${dateStr} ${timeStr}`;
  tooltip.appendChild(timeEl);

  for (const [label, val] of [["O", fmt(c.o)], ["H", fmt(c.h)], ["L", fmt(c.l)], ["C", fmt(c.c)]]) {
    const row = document.createElement("div");
    row.className = "tt-row";
    const lbl = document.createElement("span");
    lbl.textContent = label;
    const val_ = document.createElement("span");
    val_.style.color = priceColor;
    val_.textContent = val;
    row.appendChild(lbl);
    row.appendChild(val_);
    tooltip.appendChild(row);
  }

  const volRow = document.createElement("div");
  volRow.className = "tt-row tt-vol";
  const vlbl = document.createElement("span");
  vlbl.textContent = "V";
  const vval = document.createElement("span");
  vval.textContent = fmtVol(c.v);
  volRow.appendChild(vlbl);
  volRow.appendChild(vval);
  tooltip.appendChild(volRow);

  tooltip.style.display = "block";

  // position: offset from cursor, flip to stay within viewport
  const TIP_OFFSET = 14;
  const tw = tooltip.offsetWidth;
  const th = tooltip.offsetHeight;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  let left = e.clientX + TIP_OFFSET;
  let top  = e.clientY + TIP_OFFSET;
  if (left + tw > vw - 4) left = e.clientX - tw - TIP_OFFSET;
  if (top  + th > vh - 4) top  = e.clientY - th - TIP_OFFSET;

  tooltip.style.left = left + "px";
  tooltip.style.top  = top  + "px";
}

export function renderChart(candles, profile) {
  lastCandles = candles;
  lastProfile = profile;
  requestAnimationFrame(() => draw(candles, profile));
}

function draw(candles, profile) {
  if (!canvas) return;
  const w = canvas.clientWidth || canvas.parentElement?.clientWidth || 600;
  const h = canvas.clientHeight || canvas.parentElement?.clientHeight || 400;
  const dpr = window.devicePixelRatio || 1;
  canvas.width  = w * dpr;
  canvas.height = h * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  if (!candles.length) {
    ctx.fillStyle = C.label;
    ctx.font = "11px ui-monospace, Menlo, monospace";
    ctx.fillText("loading candles…", PAD.left + 12, PAD.top + 16);
    return;
  }

  const plotW = w - PAD.left - PAD.right;
  const totalH = h - PAD.top - PAD.bottom;
  const volH   = Math.floor(totalH * VOL_H_RATIO);
  const plotH  = totalH - volH - VOL_GAP;
  const volTop = PAD.top + plotH + VOL_GAP;

  // price range with 5% headroom
  const highs = candles.map(c => c.h);
  const lows  = candles.map(c => c.l);
  let pMax = Math.max(...highs);
  let pMin = Math.min(...lows);
  const pad = (pMax - pMin) * 0.05;
  pMax += pad; pMin -= pad;
  const pRange = pMax - pMin || 1;

  const toY = p => PAD.top + plotH * (1 - (p - pMin) / pRange);

  // ── value area background ─────────────────────────────────
  if (profile) {
    const vahY = toY(profile.vah);
    const valY = toY(profile.val);
    ctx.fillStyle = C.va;
    ctx.fillRect(PAD.left, vahY, plotW, valY - vahY);
  }

  // ── price grid ────────────────────────────────────────────
  const nLines = 5;
  ctx.strokeStyle = C.grid;
  ctx.lineWidth = 1;
  ctx.font = "10px ui-monospace, Menlo, monospace";
  ctx.fillStyle = C.label;
  ctx.textAlign = "right";
  for (let i = 0; i <= nLines; i++) {
    const p = pMin + (pRange * i) / nLines;
    const y = toY(p) + 0.5;
    ctx.beginPath(); ctx.moveTo(PAD.left, y); ctx.lineTo(w, y); ctx.stroke();
    ctx.fillText(fmt(p), PAD.left - 4, y + 3);
  }

  // ── candles ───────────────────────────────────────────────
  const n = candles.length;
  const candleW = Math.max(1, plotW / n);
  const bodyW   = Math.max(1, candleW * 0.7);

  candles.forEach((c, i) => {
    const x   = PAD.left + i * candleW + candleW / 2;
    const bodyX = x - bodyW / 2;
    const oY  = toY(c.o);
    const cY  = toY(c.c);
    const hY  = toY(c.h);
    const lY  = toY(c.l);
    const up  = c.c >= c.o;
    const col = up ? C.up : C.dn;

    // wick
    ctx.strokeStyle = C.wick;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, hY); ctx.lineTo(x, lY); ctx.stroke();

    // body
    ctx.fillStyle = col;
    const bodyTop = Math.min(oY, cY);
    const bodyH   = Math.max(1, Math.abs(cY - oY));
    ctx.fillRect(bodyX, bodyTop, bodyW, bodyH);
  });

  // ── volume bars ───────────────────────────────────────────
  const vols = candles.map(c => c.v || 0);
  const maxVol = Math.max(...vols, 1);
  candles.forEach((c, i) => {
    const x    = PAD.left + i * candleW + candleW / 2;
    const barX = x - bodyW / 2;
    const barH = Math.max(1, (c.v / maxVol) * volH);
    ctx.fillStyle = c.c >= c.o ? "rgba(46,189,133,0.45)" : "rgba(224,82,79,0.45)";
    ctx.fillRect(barX, volTop + volH - barH, bodyW, barH);
  });

  // ── POC line ──────────────────────────────────────────────
  if (profile) {
    const pocY = toY(profile.poc) + 0.5;
    ctx.strokeStyle = C.poc;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.moveTo(PAD.left, pocY); ctx.lineTo(w, pocY); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = C.poc;
    ctx.textAlign = "right";
    ctx.font = "9px ui-monospace, Menlo, monospace";
    ctx.fillText("POC " + fmt(profile.poc), PAD.left - 2, pocY - 2);

    // VAH / VAL labels
    const vahY = toY(profile.vah) + 0.5;
    const valY = toY(profile.val) + 0.5;
    ctx.strokeStyle = "rgba(232,163,61,0.4)";
    ctx.setLineDash([2, 4]);
    for (const [y, label] of [[vahY, "VAH"], [valY, "VAL"]]) {
      ctx.beginPath(); ctx.moveTo(PAD.left, y); ctx.lineTo(w, y); ctx.stroke();
      ctx.fillText(label + " " + fmt(profile[label.toLowerCase()]), PAD.left - 2, y - 2);
    }
    ctx.setLineDash([]);
  }

  // ── current price dashed ──────────────────────────────────
  if (candles.length) {
    const last = candles[candles.length - 1];
    const curY = toY(last.c) + 0.5;
    ctx.strokeStyle = C.price;
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 3]);
    ctx.beginPath(); ctx.moveTo(PAD.left, curY); ctx.lineTo(w, curY); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = C.text;
    ctx.textAlign = "right";
    ctx.font = "10px ui-monospace, Menlo, monospace";
    ctx.fillText(fmt(last.c), PAD.left - 2, curY - 2);
  }

  // ── time axis ─────────────────────────────────────────────
  ctx.fillStyle = C.label;
  ctx.textAlign = "center";
  ctx.font = "10px ui-monospace, Menlo, monospace";
  const step = Math.max(1, Math.floor(n / 6));
  for (let i = 0; i < n; i += step) {
    const x = PAD.left + i * candleW + candleW / 2;
    const t = new Date(candles[i].t);
    const label = t.getUTCHours().toString().padStart(2, "0") + ":"
                + t.getUTCMinutes().toString().padStart(2, "0");
    ctx.fillText(label, x, h - 8);
  }
}

function fmt(p) {
  if (p >= 1000) return p.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (p >= 10)   return p.toFixed(2);
  return p.toFixed(4);
}

function fmtVol(v) {
  if (v >= 1e9) return (v / 1e9).toFixed(2) + "B";
  if (v >= 1e6) return (v / 1e6).toFixed(2) + "M";
  if (v >= 1e3) return (v / 1e3).toFixed(1) + "K";
  return v.toFixed(2);
}
