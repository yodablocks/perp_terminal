// Signature panel: all venues' books on one canvas.
// Each venue gets a row. Bids accumulate leftward from the center axis,
// asks rightward, both binned by bps offset from that venue's own mid.
// Bar height within the row encodes cumulative USD depth, normalized to
// the deepest venue at the window edge, so depth is comparable across rows.

const WINDOW_BPS = 50; // render +/- 50 bps around each venue's mid
const BIN_BPS = 2;
const BINS = WINDOW_BPS / BIN_BPS;

const COLORS = {
  bid: "#2ebd85",
  ask: "#e0524f",
  axis: "#e8a33d",
  label: "#c9d3e0",
  dim: "#5a6678",
  line: "#1c2330",
};

let canvas, ctx, lastBooks = [];

export function initLadder() {
  canvas = document.getElementById("ladder-canvas");
  ctx = canvas.getContext("2d");
  const ro = new ResizeObserver(() => requestAnimationFrame(() => draw(lastBooks)));
  ro.observe(canvas);
}

export function renderLadder(books) {
  lastBooks = books;
  requestAnimationFrame(() => draw(books));
}

function binBook(book) {
  // Cumulative USD per bps bin, bids and asks separately.
  const mid = book.mid;
  const bids = new Array(BINS).fill(0);
  const asks = new Array(BINS).fill(0);
  if (!mid) return { bids, asks };

  for (const [price, qty] of book.bids) {
    const off = ((mid - price) / mid) * 10000;
    if (off < 0 || off >= WINDOW_BPS) continue;
    bids[Math.floor(off / BIN_BPS)] += price * qty;
  }
  for (const [price, qty] of book.asks) {
    const off = ((price - mid) / mid) * 10000;
    if (off < 0 || off >= WINDOW_BPS) continue;
    asks[Math.floor(off / BIN_BPS)] += price * qty;
  }
  // cumulative outward from mid
  for (let i = 1; i < BINS; i++) {
    bids[i] += bids[i - 1];
    asks[i] += asks[i - 1];
  }
  return { bids, asks };
}

function draw(books) {
  if (!canvas) return;
  // clientWidth is 0 before layout completes; fall back to parent.
  const w = canvas.clientWidth || canvas.parentElement.clientWidth || 600;
  const h = canvas.clientHeight || canvas.parentElement.clientHeight || 320;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  if (!books.length) {
    ctx.fillStyle = COLORS.dim;
    ctx.font = "11px ui-monospace, Menlo, monospace";
    ctx.fillText("waiting for venue data", 16, 24);
    return;
  }

  const binned = books.map((b) => ({ book: b, ...binBook(b) }));
  const globalMax = Math.max(
    1,
    ...binned.flatMap((v) => [v.bids[BINS - 1], v.asks[BINS - 1]])
  );

  const labelW = 96;
  const rightW = 120;
  const plotW = Math.max(50, w - labelW - rightW);
  const halfW = plotW / 2;
  const axisX = labelW + halfW;
  const rowH = h / books.length;
  const barMaxH = Math.max(6, rowH - 16);
  const binW = halfW / BINS;

  ctx.font = "11px ui-monospace, Menlo, monospace";
  ctx.textBaseline = "middle";

  binned.forEach((v, i) => {
    const yBase = (i + 1) * rowH - 8;
    const yMid = i * rowH + rowH / 2;

    // row separator
    ctx.strokeStyle = COLORS.line;
    ctx.beginPath();
    ctx.moveTo(0, (i + 1) * rowH + 0.5);
    ctx.lineTo(w, (i + 1) * rowH + 0.5);
    ctx.stroke();

    // bid bars: leftward from axis
    ctx.fillStyle = COLORS.bid;
    for (let b = 0; b < BINS; b++) {
      const bh = (v.bids[b] / globalMax) * barMaxH;
      if (bh < 0.5) continue;
      ctx.globalAlpha = 0.85;
      ctx.fillRect(axisX - (b + 1) * binW, yBase - bh, binW - 0.5, bh);
    }
    // ask bars: rightward
    ctx.fillStyle = COLORS.ask;
    for (let b = 0; b < BINS; b++) {
      const bh = (v.asks[b] / globalMax) * barMaxH;
      if (bh < 0.5) continue;
      ctx.fillRect(axisX + b * binW + 0.5, yBase - bh, binW - 0.5, bh);
    }
    ctx.globalAlpha = 1;

    // labels
    ctx.fillStyle = COLORS.label;
    ctx.textAlign = "left";
    ctx.fillText(v.book.venue, 12, yMid);

    ctx.textAlign = "right";
    ctx.fillStyle = COLORS.dim;
    const spread = v.book.spread_bps;
    ctx.fillText(
      (spread != null ? spread.toFixed(2) : "--") + " bps",
      w - 12,
      yMid - 7
    );
    ctx.fillText(depthLabel(v.bids[BINS - 1] + v.asks[BINS - 1]), w - 12, yMid + 7);
  });

  // center axis on top
  ctx.strokeStyle = COLORS.axis;
  ctx.globalAlpha = 0.9;
  ctx.beginPath();
  ctx.moveTo(axisX + 0.5, 0);
  ctx.lineTo(axisX + 0.5, h);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function depthLabel(usd) {
  if (usd >= 1e6) return (usd / 1e6).toFixed(1) + "M @50";
  if (usd >= 1e3) return (usd / 1e3).toFixed(0) + "K @50";
  return usd.toFixed(0) + " @50";
}
