// Per-client rate guard for an anonymous AI route on Cloudflare Pages (Pages Functions have no rate-limit binding, so the
// window is a one-minute counter in KV). It bounds how often one client can start a model request; the whole-site bounds
// are the gateway's own (per caller and task: requests a minute, concurrency, and the daily allowance of paid attempts).
//
// Fail closed: without the KV binding, or when KV cannot be read or written, the request is refused before any model call
// (503 AI_RATE_GUARD_UNAVAILABLE). KV accepts one write a second per key, so a client that fires faster than that gets the
// same refusal, which is the intended effect. The key holds a SHA-256 prefix of the site and the client address, never the
// address itself, and expires after two minutes.
//
// Returns null when the request may proceed, otherwise the Response to send.
const WINDOW_SECONDS = 60;
const KEY_TTL_SECONDS = 120;

const refusal = (status, code, message, retryAfter) => new Response(JSON.stringify({ error: message, error_code: code, retryable: true, retry_after_seconds: retryAfter }), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "retry-after": String(retryAfter) },
});

async function clientKey(site, address) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${site}|${address}`)));
  return Array.from(bytes.slice(0, 12), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function aiRateGuard(request, env, site, { limit = 6, kv = env?.AI_RATE_KV, now = () => Date.now() } = {}) {
  if (!kv || typeof kv.get !== "function" || typeof kv.put !== "function") {
    return refusal(503, "AI_RATE_GUARD_UNAVAILABLE", "AI 功能暫時無法使用，請稍後再試", 60);
  }
  const address = String(request.headers.get("cf-connecting-ip") || "").trim() || "unknown";
  const windowId = Math.floor(now() / 1000 / WINDOW_SECONDS);
  try {
    const key = `ai-rate:${site}:${await clientKey(site, address)}:${windowId}`;
    const used = Number.parseInt((await kv.get(key)) || "0", 10) || 0;
    if (used >= limit) {
      const retryAfter = Math.max(1, (windowId + 1) * WINDOW_SECONDS - Math.floor(now() / 1000));
      return refusal(429, "RATE_LIMITED", "請求太頻繁，請稍候一分鐘再試", retryAfter);
    }
    await kv.put(key, String(used + 1), { expirationTtl: KEY_TTL_SECONDS });
    return null;
  } catch {
    return refusal(503, "AI_RATE_GUARD_UNAVAILABLE", "AI 功能暫時無法使用，請稍後再試", 60);
  }
}
