// Number and time formatting. All values are display strings.

export function usd(n) {
  if (n == null || !isFinite(n)) return "--";
  const abs = Math.abs(n);
  if (abs >= 1e9) return "$" + (n / 1e9).toFixed(2) + "B";
  if (abs >= 1e6) return "$" + (n / 1e6).toFixed(1) + "M";
  if (abs >= 1e3) return "$" + (n / 1e3).toFixed(1) + "K";
  return "$" + n.toFixed(2);
}

export function px(n) {
  if (n == null || !isFinite(n)) return "--";
  return n >= 1000
    ? n.toLocaleString("en-US", { maximumFractionDigits: 1 })
    : n.toLocaleString("en-US", { maximumFractionDigits: 4 });
}

export function bps(n, digits = 2) {
  if (n == null || !isFinite(n)) return "--";
  return n.toFixed(digits);
}

export function pct(n, digits = 2) {
  if (n == null || !isFinite(n)) return "--";
  const s = n.toFixed(digits) + "%";
  return n > 0 ? "+" + s : s;
}

export function age(seconds) {
  if (seconds == null) return "--";
  if (seconds < 60) return Math.round(seconds) + "s";
  if (seconds < 3600) return Math.floor(seconds / 60) + "m";
  return Math.floor(seconds / 3600) + "h";
}

export function ageFromIso(iso) {
  if (!iso) return "--";
  return age((Date.now() - new Date(iso).getTime()) / 1000);
}

export function countdown(iso) {
  if (!iso) return "--";
  let s = (new Date(iso).getTime() - Date.now()) / 1000;
  if (s <= 0) return "now";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h${String(m).padStart(2, "0")}` : `${m}m`;
}
