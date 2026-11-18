// Same-origin AI route (2026-11-18). Until then the page called the shared gateway from the browser with no caller credential,
// so its requests could only be answered by the free model pool. This function is the site's verified caller: it builds the
// gateway request on the server (the browser supplies the prompt text and, where the page uses more than one, a task type from
// the list below; never a model, generation settings or another task family), passes a per-client rate guard first, and waits
// for the gateway's credit lane (Claude first, then OpenAI, then Gemini). The gateway's answer is returned unchanged, so the
// page reads `answer`, `error_code`, `retryable` and `provider_attempt_count` as before. No learner origin is passed on.
import { aiRateGuard } from "../_shared/ai-rate-guard.js";

const CALLER_ID = "kz.bdfz.net";
const SITE_ORIGIN = "https://kz.bdfz.net";
const GUARD_SITE = "kz";
// Task types the page may ask for; the first is the default. Anything else is refused.
const TASK_TYPES = ["chat"];
// One question is one request; a failed one may be repeated by the page. Per client address (hashed), a minute.
const REQUESTS_PER_MINUTE = 10;
const MAX_BODY_BYTES = 256 * 1024;
// The gateway answers a credit-lane request inside 60 s; this function never gives up before it.
const GATEWAY_TIMEOUT_MS = 65_000;
const REQUEST_ID = /^[A-Za-z0-9._:-]{8,120}$/;

const json = (body, status, extra = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra },
});

export async function onRequestPost({ request, env }) {
  // Only this site's own pages: a browser states the page's origin on every POST.
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return json({ error: "此請求來源不被允許", error_code: "ORIGIN_NOT_ALLOWED", retryable: false }, 403);
  }
  const callerToken = String(env?.APIS_CALLER_TOKEN || "").trim();
  if (!env?.APIS || typeof env.APIS.fetch !== "function" || !callerToken) {
    return json({ error: "AI 服務暫時無法使用", error_code: "AI_GATEWAY_UNAVAILABLE", retryable: true, retry_after_seconds: 60 }, 503, { "retry-after": "60" });
  }
  if (Number(request.headers.get("content-length") || 0) > MAX_BODY_BYTES) {
    return json({ error: "請求內容過長", error_code: "PAYLOAD_TOO_LARGE", retryable: false }, 413);
  }
  let raw;
  try { raw = await request.text(); } catch { raw = ""; }
  if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) {
    return json({ error: "請求內容過長", error_code: "PAYLOAD_TOO_LARGE", retryable: false }, 413);
  }
  let body;
  try { body = JSON.parse(raw); } catch { body = null; }
  const prompt = typeof body?.prompt === "string" ? body.prompt : "";
  if (!prompt.trim()) return json({ error: "缺少提問內容", error_code: "INVALID_REQUEST", retryable: false }, 400);
  const asked = String(request.headers.get("x-task-type") || "").trim().toLowerCase();
  const taskType = asked ? asked : TASK_TYPES[0];
  if (!TASK_TYPES.includes(taskType)) return json({ error: "不支援的請求類型", error_code: "INVALID_REQUEST", retryable: false }, 400);

  // Anonymous route: the guard runs after the cheap checks and before the model request, and refuses when its KV binding is
  // missing or failing, so the gateway's paid tiers can never be reached unguarded.
  const refused = await aiRateGuard(request, env, GUARD_SITE, { limit: REQUESTS_PER_MINUTE });
  if (refused) return refused;

  const requestId = String(request.headers.get("x-request-id") || "").trim();
  const headers = {
    "content-type": "application/json",
    "origin": SITE_ORIGIN,
    "x-project-name": CALLER_ID,
    "x-internal-token": callerToken,
    "x-task-type": taskType,
    "x-thinking-level": "low",
  };
  if (REQUEST_ID.test(requestId)) headers["x-request-id"] = requestId;
  let upstream;
  try {
    upstream = await env.APIS.fetch("https://apis.internal/", {
      method: "POST",
      headers,
      body: JSON.stringify({ prompt, taskType }),
      signal: AbortSignal.timeout(GATEWAY_TIMEOUT_MS),
    });
  } catch (error) {
    const timedOut = error?.name === "TimeoutError" || error?.name === "AbortError";
    return json({ error: timedOut ? "AI 服務回應逾時" : "AI 服務暫時無法連線", error_code: timedOut ? "DEADLINE_EXCEEDED" : "UPSTREAM_UNAVAILABLE", retryable: true, retry_after_seconds: 2 }, 503, { "retry-after": "2" });
  }
  const out = { "content-type": upstream.headers.get("content-type") || "application/json; charset=utf-8", "cache-control": "no-store" };
  const retryAfter = upstream.headers.get("retry-after");
  if (retryAfter) out["retry-after"] = retryAfter;
  return new Response(upstream.body, { status: upstream.status, headers: out });
}

export function onRequest() {
  return json({ error: "Method not allowed", error_code: "METHOD_NOT_ALLOWED", retryable: false }, 405, { allow: "POST" });
}
