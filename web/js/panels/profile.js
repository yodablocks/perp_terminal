// Market profile panel. Drawn on #profile-canvas.
// Horizontal bars: volume at each price bucket.
// POC = tallest bar (full amber). Value area = shaded amber.
// Outside VA = dim bars. VAH/VAL/POC text labels.
// Synced Y-axis with the chart canvas via shared priceRange.

const C = {
  bg:     "#0a0d12",
  va:     "rgba(232,163,61,0.25)",
  poc:    "#e8a33d",
  out:    "#2a3548",
  label:  "#5a6678",
  line:   "#1c2330",
  text:   "#c9d3e0",
};

const PAD = { top: 20, right: 8, bottom: 28, left: 4 };

let canvas, ctx;
let lastProfile = null;
let lastRange   = null;  // { pMin, pMax } shared from chart

export function initProfile() {
  canvas = document.getElementById("profile-canvas");
  ctx = canvas.getContext("2d");
  const ro = new ResizeObserver(() =>
    requestAnimationFrame(() => draw(lastProfile, lastRange))
  );
  ro.observe(canvas);
}

export function renderProfile(profile, priceRange) {
  lastProfile = profile;
  lastRange   = priceRange;
  requestAnimationFrame(() => draw(profile, priceRange));
}

function draw(profile, range) {
  if (!canvas) return;
  const w = canvas.clientWidth || 110;
  const h = canvas.clientHeight || 400;
  const dpr = window.devicePixelRatio || 1;
  canvas.width  = w * dpr;
  canvas.height = h * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, w, h);

  if (!profile || !range) {
    ctx.fillStyle = C.label;
    ctx.font = "10px ui-monospace, Menlo, monospace";
    ctx.textAlign = "center";
    ctx.fillText("loading", w / 2, h / 2);
    return;
  }

  const plotH = h - PAD.top - PAD.bottom;
  const { pMin, pMax } = range;
  const pRange = pMax - pMin || 1;
  const toY = p => PAD.top + plotH * (1 - (p - pMin) / pRange);

  // Filter levels visible in the current price range
  const visible = profile.levels.filter(
    lv => lv.price >= pMin && lv.price <= pMax
  );
  if (!visible.length) {
    ctx.fillStyle = C.label;
    ctx.font = "10px ui-monospace, Menlo, monospace";
    ctx.textAlign = "center";
    ctx.fillText("no data", w / 2, h / 2);
    return;
  }

  const maxVol = Math.max(...visible.map(lv => lv.volume), 1);
  const barMaxW = w - PAD.left - PAD.right;
  const bucketH = Math.max(
    1,
    plotH * (profile.bucket_size / pRange)
  );

  for (const lv of visible) {
    const y = toY(lv.price + profile.bucket_size / 2);
    const barW = (lv.volume / maxVol) * barMaxW;
    const bh = Math.max(1, bucketH - 0.5);

    if (lv.is_poc) {
      ctx.fillStyle = C.poc;
      ctx.globalAlpha = 0.85;
    } else if (lv.va) {
      ctx.fillStyle = C.va;
      ctx.globalAlpha = 1;
      // draw as filled background first, then a colored bar
      ctx.fillRect(PAD.left, y, barMaxW, bh);
      ctx.fillStyle = "rgba(232,163,61,0.45)";
    } else {
      ctx.fillStyle = C.out;
      ctx.globalAlpha = 1;
    }

    ctx.fillRect(PAD.left, y, barW, bh);
    ctx.globalAlpha = 1;
  }

  // ── POC / VAH / VAL labels ────────────────────────────────
  ctx.font = "9px ui-monospace, Menlo, monospace";
  ctx.textAlign = "left";

  const annotations = [
    { price: profile.poc, label: "POC", color: C.poc },
    { price: profile.vah, label: "VAH", color: "rgba(232,163,61,0.8)" },
    { price: profile.val, label: "VAL", color: "rgba(232,163,61,0.8)" },
  ];

  for (const a of annotations) {
    if (a.price < pMin || a.price > pMax) continue;
    const y = toY(a.price);
    ctx.strokeStyle = a.color;
    ctx.lineWidth = 1;
    ctx.setLineDash(a.label === "POC" ? [] : [2, 3]);
    ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(w, y + 0.5); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = a.color;
    ctx.fillText(a.label, PAD.left + 2, y - 2);
  }
}

// Called by main after chart computes its own price range
export function getPriceRange(candles) {
  if (!candles.length) return null;
  let pMax = Math.max(...candles.map(c => c.h));
  let pMin = Math.min(...candles.map(c => c.l));
  const pad = (pMax - pMin) * 0.05;
  return { pMin: pMin - pad, pMax: pMax + pad };
}
