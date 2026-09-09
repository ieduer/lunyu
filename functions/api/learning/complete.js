const SITE_KEY = "kz";
const COMPLETION_KIND = "annotation_revealed";

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...extraHeaders,
    },
  });
}

function rateLimitResponse(code) {
  const minute = code === "RATE_LIMIT_MINUTE";
  const retryAfterSeconds = minute ? 60 : 86400;
  return json({
    ok: false,
    error: minute ? "閱讀進度暫未同步，請於 1 分鐘後重試。" : "已達 24 小時同步上限，請稍後重試。",
    errorCode: code,
    retryable: minute,
    retryAfterSeconds,
  }, 429, { "retry-after": String(retryAfterSeconds) });
}

function text(value, max = 220) {
  return String(value ?? "").trim().slice(0, max);
}

function sameOrigin(request) {
  const origin = request.headers.get("Origin");
  return origin === new URL(request.url).origin;
}

function sessionCookie(request) {
  const cookie = request.headers.get("Cookie") || "";
  return /(?:^|;\s*)bdfz_uc_session=[^;]+/.test(cookie) ? cookie.slice(0, 4096) : "";
}

async function manifestFor(env, request) {
  const response = await env.ASSETS.fetch(new URL("/data/learning-manifest.json", request.url));
  if (!response.ok) throw new Error("learning manifest unavailable");
  return response.json();
}

export async function onRequestPost(context) {
  if (!sameOrigin(context.request)) return json({ error: "cross-origin request rejected" }, 403);
  const cookieHeader = sessionCookie(context.request);
  if (!cookieHeader) return json({ error: "authenticated session required" }, 401);
  if (typeof context.env.GROWTH_EVIDENCE?.recordCompletion !== "function") {
    return json({ error: "growth evidence service unavailable" }, 503);
  }
  let body;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: "invalid json" }, 400);
  }
  const resourceKey = text(body.resourceKey);
  const manifestVersion = text(body.manifestVersion, 120);
  const eventNonce = text(body.eventNonce, 120);
  const hasClientScore = ["score", "progressPercent", "correct", "completed"]
    .some((field) => Object.prototype.hasOwnProperty.call(body, field));
  if (text(body.completionKind, 60) !== COMPLETION_KIND
    || !/^chapter-\d+$/.test(resourceKey)
    || !/^[A-Za-z0-9:_-]{8,120}$/.test(eventNonce)
    || hasClientScore) {
    return json({ error: "invalid completion request" }, 400);
  }
  try {
    const manifest = await manifestFor(context.env, context.request);
    if (manifest?.schemaVersion !== 1
      || manifest.siteKey !== SITE_KEY
      || manifest.manifestVersion !== manifestVersion) {
      return json({ error: "manifest version mismatch" }, 409);
    }
    const item = (manifest.items || []).find((candidate) => candidate.resourceKey === resourceKey);
    if (!item
      || item.itemType !== "chapter"
      || item.resourceKey !== `chapter-${item.chapterId}`) {
      return json({ error: "resource absent from manifest" }, 404);
    }
    const receipt = await context.env.GROWTH_EVIDENCE.recordCompletion(
      cookieHeader,
      { resourceKey, manifestVersion, eventNonce, completionKind: COMPLETION_KIND },
      { typedCompletionRateLimit: true },
    );
    if (receipt?.ok === false && receipt.sourceSiteKey === SITE_KEY
      && receipt.status === "rate_limited" && receipt.httpStatus === 429
      && ["RATE_LIMIT_MINUTE", "RATE_LIMIT_DAY"].includes(receipt.error?.code)) {
      return rateLimitResponse(receipt.error.code);
    }
    if (receipt?.ok !== true
      || receipt.sourceSiteKey !== SITE_KEY
      || receipt.resourceKey !== resourceKey
      || receipt.manifestVersion !== manifestVersion) {
      throw new Error("growth evidence receipt mismatch");
    }
    return json(receipt);
  } catch (error) {
    const message = String(error?.message || "");
    // The accepted predecessor throws these fixed errors. Keep code rollback
    // compatible while only the opted-in KZ caller adopts structured results.
    if (/growth(?:_| )completion(?:_| )rate(?:_| )limit(?:_minute| exceeded: minute)/i.test(message)) {
      return rateLimitResponse("RATE_LIMIT_MINUTE");
    }
    if (/growth(?:_| )completion(?:_| )rate(?:_| )limit(?:_day| exceeded: day)/i.test(message)) {
      return rateLimitResponse("RATE_LIMIT_DAY");
    }
    return json({ error: text(error?.message || "completion failed", 240) }, 503);
  }
}

export function onRequest(context) {
  if (context.request.method !== "POST") return json({ error: "method not allowed" }, 405);
  return onRequestPost(context);
}
