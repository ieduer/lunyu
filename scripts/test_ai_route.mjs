// The same-origin AI route: the gateway request is built on the server with the site's caller credential, behind a
// per-client rate guard that refuses when it cannot count.
import test from "node:test";
import assert from "node:assert/strict";
import { onRequestPost, onRequest } from "../functions/api/ai.js";

const CALLER = "kz.bdfz.net", ORIGIN = "https://kz.bdfz.net", TASKS = ["chat"], LIMIT = 10;
function fakeKv({ failGet = false, failPut = false } = {}) {
  const store = new Map(), puts = [];
  return { store, puts,
    async get(key) { if (failGet) throw new Error("kv get"); return store.has(key) ? store.get(key) : null; },
    async put(key, value, options) { if (failPut) throw new Error("kv put"); puts.push({ key, value, options }); store.set(key, value); } };
}
function gateway(answer = { answer: "答", model: "claude-sonnet-5-5", provider_attempt_count: 1 }, status = 200, extraHeaders = {}) {
  const calls = [];
  return { calls, async fetch(url, init) { calls.push({ url: String(url), headers: init.headers, body: JSON.parse(init.body), hasSignal: Boolean(init.signal) }); return new Response(JSON.stringify(answer), { status, headers: { "content-type": "application/json", ...extraHeaders } }); } };
}
const post = (body, headers = {}, address = "203.0.113.7") => new Request(ORIGIN + "/api/ai", { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN, "cf-connecting-ip": address, ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });
const env = (over = {}) => ({ APIS_CALLER_TOKEN: "<TEST_CALLER_TOKEN>", AI_RATE_KV: fakeKv(), APIS: gateway(), ...over });

test("a question is sent as this site's verified caller with a server-built body; the answer comes back unchanged", async () => {
  const e = env();
  const res = await onRequestPost({ request: post({ prompt: "學而時習之是什麼意思？", model: "x", generationConfig: { maxOutputTokens: 99999 }, taskType: "ocr" }, { "x-request-id": "op-12345678" }), env: e });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { answer: "答", model: "claude-sonnet-5-5", provider_attempt_count: 1 });
  assert.equal(res.headers.get("cache-control"), "no-store");
  const call = e.APIS.calls[0];
  assert.equal(call.url, "https://apis.internal/");
  assert.equal(call.headers["x-project-name"], CALLER);
  assert.equal(call.headers["x-internal-token"], "<TEST_CALLER_TOKEN>");
  assert.equal(call.headers["x-task-type"], TASKS[0]);
  assert.equal(call.headers.origin, ORIGIN);
  assert.equal(call.headers["x-request-id"], "op-12345678");
  // only the prompt and the task type reach the gateway: no model, no generation settings, no other field of the browser's body
  assert.deepEqual(call.body, { prompt: "學而時習之是什麼意思？", taskType: TASKS[0] });
  assert.equal(call.hasSignal, true);
  assert.ok(!Object.keys(call.headers).some((h) => /forwarded|connecting-ip|country|real-ip/i.test(h)), "no client origin header is passed on");
});

test("task type: only the listed ones; an unlisted one is refused before the guard and the gateway", async () => {
  for (const t of TASKS) { const e = env(); const res = await onRequestPost({ request: post({ prompt: "q" }, { "x-task-type": t }), env: e }); assert.equal(res.status, 200); assert.equal(e.APIS.calls[0].body.taskType, t); }
  const e = env();
  const res = await onRequestPost({ request: post({ prompt: "q" }, { "x-task-type": "ocr" }), env: e });
  assert.equal(res.status, 400); assert.equal(e.APIS.calls.length, 0); assert.equal(e.AI_RATE_KV.puts.length, 0);
});

test("refusals before any model request: other origin, missing binding or credential, bad or empty body, oversize", async () => {
  const cases = [
    [post({ prompt: "q" }, { origin: "https://evil.example" }), env(), 403, "ORIGIN_NOT_ALLOWED"],
    [post({ prompt: "q" }), env({ APIS_CALLER_TOKEN: "" }), 503, "AI_GATEWAY_UNAVAILABLE"],
    [post({ prompt: "q" }), env({ APIS: undefined }), 503, "AI_GATEWAY_UNAVAILABLE"],
    [post("{not json"), env(), 400, "INVALID_REQUEST"],
    [post({ prompt: "   " }), env(), 400, "INVALID_REQUEST"],
    [post({ prompt: "長".repeat(120000) }), env(), 413, "PAYLOAD_TOO_LARGE"],
  ];
  for (const [request, e, status, code] of cases) {
    const res = await onRequestPost({ request, env: e });
    assert.equal(res.status, status, code); assert.equal((await res.json()).error_code, code);
    if (e.APIS) assert.equal(e.APIS.calls.length, 0, code);
  }
  assert.equal((await onRequest()).status, 405);
});

test("rate guard: refuses without KV or when KV fails; the request after the limit gets 429 without a model request; another client is not affected", async () => {
  for (const kv of [undefined, fakeKv({ failGet: true }), fakeKv({ failPut: true })]) {
    const e = env({ AI_RATE_KV: kv });
    const res = await onRequestPost({ request: post({ prompt: "q" }), env: e });
    assert.equal(res.status, 503); assert.equal((await res.json()).error_code, "AI_RATE_GUARD_UNAVAILABLE"); assert.equal(e.APIS.calls.length, 0);
  }
  const e = env();
  for (let i = 0; i < LIMIT; i += 1) assert.equal((await onRequestPost({ request: post({ prompt: "q" + i }), env: e })).status, 200);
  const limited = await onRequestPost({ request: post({ prompt: "one more" }), env: e });
  assert.equal(limited.status, 429); assert.equal((await limited.json()).error_code, "RATE_LIMITED");
  assert.ok(Number(limited.headers.get("retry-after")) >= 1);
  assert.equal(e.APIS.calls.length, LIMIT);
  assert.equal((await onRequestPost({ request: post({ prompt: "q" }, {}, "198.51.100.9"), env: e })).status, 200);
  assert.ok(e.AI_RATE_KV.puts.every((p) => /^ai-rate:[a-z]+:[a-f0-9]{24}:\d+$/.test(p.key) && !p.key.includes("203.0.113.7") && p.options.expirationTtl === 120));
});

test("a gateway failure is passed through with its status, code and retry time; a gateway that does not answer is a typed 503", async () => {
  const e = env({ APIS: gateway({ error: "busy", error_code: "DEADLINE_EXCEEDED", retryable: true, provider_attempt_count: 2 }, 503, { "retry-after": "7" }) });
  const res = await onRequestPost({ request: post({ prompt: "q" }), env: e });
  assert.equal(res.status, 503); assert.equal(res.headers.get("retry-after"), "7");
  assert.deepEqual(await res.json(), { error: "busy", error_code: "DEADLINE_EXCEEDED", retryable: true, provider_attempt_count: 2 });
  const down = env({ APIS: { async fetch() { throw Object.assign(new Error("timeout"), { name: "TimeoutError" }); } } });
  const r2 = await onRequestPost({ request: post({ prompt: "q" }), env: down });
  assert.equal(r2.status, 503); assert.equal((await r2.json()).error_code, "DEADLINE_EXCEEDED");
});
