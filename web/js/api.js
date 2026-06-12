export async function getSnapshot(token) {
  const params = new URLSearchParams();
  if (token) params.set("token", token);
  const res = await fetch("/api/snapshot?" + params.toString());
  if (!res.ok) throw new Error("snapshot " + res.status);
  return res.json();
}

export async function getCandles(token, interval, limit = 100) {
  const params = new URLSearchParams({ token, interval, limit });
  const res = await fetch("/api/candles?" + params.toString());
  if (!res.ok) throw new Error("candles " + res.status);
  return res.json();
}

export async function getProfile(token) {
  const params = new URLSearchParams({ token });
  const res = await fetch("/api/profile?" + params.toString());
  if (!res.ok) throw new Error("profile " + res.status);
  return res.json();
}
