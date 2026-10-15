// APIS payload contract 2026-10-15: kz budgets the history it sends and never re-sends a refused or over-size request.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../assets/js/app.js', import.meta.url), 'utf8');
const historySource = app.slice(app.indexOf('const KZ_HISTORY_BUDGET_BYTES'), app.indexOf('// Ask Gemini Helper with Retry'));
const askSource = app.slice(app.indexOf('async function askGemini('), app.indexOf('// AI 導師指令'));
const bytes = (s) => new TextEncoder().encode(JSON.stringify(s)).length;

function historyContext() {
  const ctx = vm.createContext({ TextEncoder });
  vm.runInContext(historySource + '\nthis.formatHistoryForAI = formatHistoryForAI; this.BUDGET = KZ_HISTORY_BUDGET_BYTES;', ctx);
  return ctx;
}

test('history: short conversations are sent whole and unchanged', () => {
  const { formatHistoryForAI } = historyContext();
  const history = [{ role: 'user', content: '學而時習之是什麼意思？' }, { role: 'confucius', content: '意思是……' }, { role: 'system', content: '不送' }];
  assert.equal(formatHistoryForAI(history), '用戶：\n學而時習之是什麼意思？\n\n孔子：\n意思是……');
});

test('history: long conversations keep the newest whole messages within the budget and say how many were left out', () => {
  const { formatHistoryForAI, BUDGET } = historyContext();
  const history = Array.from({ length: 80 }, (_, i) => ({ role: i % 2 ? 'confucius' : 'user', content: `第${i}條` + '論'.repeat(3000) }));
  const out = formatHistoryForAI(history);
  const omitted = Number(out.match(/^（更早的 (\d+) 条对话因篇幅省略）/)[1]);
  assert.ok(omitted > 0);
  assert.ok(bytes(out) <= BUDGET + 200, String(bytes(out)));
  assert.match(out, /第79條/);
  const kept = out.split('\n\n').slice(1);
  assert.equal(kept.length, 80 - omitted);
  for (const block of kept) assert.ok(history.some((m) => block.endsWith(m.content)), 'never cut');
  // The latest message is always kept, even alone over the budget (APIS then refuses it once, without a resend).
  assert.match(formatHistoryForAI([{ role: 'user', content: '長'.repeat(70000) }]), /^用戶：/);
});

function askContext(responses) {
  let fetches = 0;
  const reports = [];
  const ctx = vm.createContext({
    console: { log() {}, warn() {} }, setTimeout: (fn) => { fn(); return 0; }, conversationSessionKey: 's', lastStudentOperationId: 'p', isWaitingForAI: false,
    learningContext: () => ({ sessionKey: 's' }), showLearningRecordState() {}, disableInteractionButtons() {}, enableInteractionButtons() {}, removeLoadingMessage() {},
    captureLearningOperation: () => ({ operation: { operationId: 'a' }, saved: Promise.resolve() }), CLOUD_FLARE_WORKER_URL: 'https://example.invalid',
    fetch: async () => { const r = responses[Math.min(fetches, responses.length - 1)]; fetches += 1; if (r instanceof Error) throw r; return r; },
  });
  vm.runInContext(askSource, ctx);
  return { ask: (prompt) => new Promise((resolve) => { ctx.askGemini(prompt, (text, isError) => { reports.push({ text, isError }); resolve(); }); }), fetches: () => fetches, reports };
}
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('a refused or over-size request is sent once; the reason is shown', async () => {
  for (const [response, pattern] of [
    [json(413, { error_code: 'PAYLOAD_TOO_LARGE', retryable: false, reducible: true }), /對話內容過長/],
    [json(502, { error_code: 'UPSTREAM_OUTPUT_TOO_LARGE', retryable: false }), /回答異常過長/],
    [json(503, { error_code: 'UPSTREAM_OUTPUT_TOO_LARGE', retry_after_seconds: 3 }), /回答異常過長/],
    [json(429, { error_code: 'QUOTA_EXHAUSTED' }), /請求過於頻繁/],
    [json(400, { error_code: 'CLIENT_REQUEST_INVALID' }), /AI請求失敗 \(400\)/],
  ]) {
    const c = askContext([response]);
    await c.ask('synthetic');
    assert.equal(c.fetches(), 1, pattern.source);
    assert.equal(c.reports[0].isError, true);
    assert.match(c.reports[0].text, pattern);
  }
});

test('transient failures keep the two bounded retries', async () => {
  const flaky = askContext([json(503, { error_code: 'DEADLINE_EXCEEDED' }), new TypeError('Failed to fetch'), json(200, { answer: '好' })]);
  await flaky.ask('synthetic');
  assert.equal(flaky.fetches(), 3);
  assert.deepEqual(flaky.reports, [{ text: '好', isError: false }]);
  const down = askContext([json(502, { error_code: 'UPSTREAM_UNAVAILABLE' })]);
  await down.ask('synthetic');
  assert.equal(down.fetches(), 3);
});
