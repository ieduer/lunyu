import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { onRequestPost } from '../functions/api/learning/complete.js';

const manifest = JSON.parse(readFileSync(new URL('../data/learning-manifest.json', import.meta.url)));
const chapter = JSON.parse(readFileSync(new URL('../data/dialogues.json', import.meta.url)))[0];
const item = manifest.items[0];
const success = { ok: true, sourceSiteKey: 'kz', resourceKey: item.resourceKey, manifestVersion: manifest.manifestVersion, recorded: true };
const evidenceSource = readFileSync(new URL('../assets/js/learning-evidence.js', import.meta.url), 'utf8');
const appSource = readFileSync(new URL('../assets/js/app.js', import.meta.url), 'utf8');
function request() {
  return new Request('https://kz.bdfz.net/api/learning/complete', {
    method: 'POST', headers: { Origin: 'https://kz.bdfz.net', Cookie: 'bdfz_uc_session=fixture', 'content-type': 'application/json' },
    body: JSON.stringify({ resourceKey: item.resourceKey, manifestVersion: manifest.manifestVersion, eventNonce: 'kz-rate-fixture-0001', completionKind: 'annotation_revealed' }),
  });
}
async function endpoint(impl) {
  return onRequestPost({ request: request(), env: {
    ASSETS: { fetch: async () => new Response(JSON.stringify(manifest)) },
    GROWTH_EVIDENCE: { recordCompletion: impl },
  } });
}
for (const [code, seconds, legacy] of [
  ['RATE_LIMIT_MINUTE', 60, 'growth completion rate limit exceeded: minute'],
  ['RATE_LIMIT_DAY', 86400, 'growth completion rate limit exceeded: day'],
]) {
  test(`${code} is 429 for both structured and accepted predecessor RPC behavior`, async () => {
    for (const structured of [false, true]) {
      const response = await endpoint(async (_cookie, _payload, context) => {
        assert.deepEqual(context, { typedCompletionRateLimit: true });
        if (!structured) throw new Error(legacy);
        return { ok: false, sourceSiteKey: 'kz', status: 'rate_limited', httpStatus: 429, error: { code } };
      });
      const body = await response.json();
      assert.equal(response.status, 429);
      assert.equal(response.headers.get('retry-after'), String(seconds));
      assert.equal(body.errorCode, code);
      assert.equal(body.retryAfterSeconds, seconds);
      assert.equal(body.ok, false);
      assert.doesNotMatch(JSON.stringify(body), /SQLITE|fixture|bdfz_uc_session/);
    }
  });
}
test('a forged source or unrelated failure cannot become a valid rate-limit or completion receipt', async () => {
  const otherSource = await endpoint(async () => ({ ok: false, sourceSiteKey: 'yw', status: 'rate_limited', httpStatus: 429, error: { code: 'RATE_LIMIT_MINUTE' } }));
  assert.equal(otherSource.status, 503);
  const busy = await endpoint(async () => { throw new Error('D1_BUSY'); });
  assert.equal(busy.status, 503);
  const valid = await endpoint(async () => success);
  assert.equal(valid.status, 200);
  assert.deepEqual(await valid.json(), success);
});

function browser(storage = new Map(), clock = { now: 1000000 }) {
  const sourceCalls = [], projections = [], timers = [], buttons = [], marked = [], messages = [];
  let nextResponse = () => new Response(JSON.stringify(success));
  const window = {
    location: { origin: 'https://kz.bdfz.net', pathname: '/' },
    crypto: { randomUUID: () => 'kz-stable-event-00000001' },
    sessionStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: key => storage.delete(key),
    },
    BdfzIdentity: {
      getSession: async () => ({ authenticated: true, user: { id: 1 } }),
      syncProgress: async value => { projections.push(['progress', value]); },
      recordEvent: async value => { projections.push(['event', value]); },
    },
  };
  const context = {
    window, Date: class extends Date { static now() { return clock.now; } },
    fetch: async (_url, init) => { sourceCalls.push(JSON.parse(init.body)); return nextResponse(); },
    setTimeout: (callback, delay) => { timers.push({ callback, delay }); },
    document: { createElement: () => {
      const button = { addEventListener: (_name, callback) => { button.click = callback; }, remove: () => { button.removed = true; } };
      buttons.push(button); return button;
    } },
    addMessage: message => messages.push(message),
    markAsRead: id => marked.push(id),
    askGemini: () => { throw new Error('Retry must never call the AI'); },
  };
  vm.createContext(context);
  vm.runInContext(evidenceSource, context);
  vm.runInContext(appSource.slice(0, appSource.indexOf('async function trackDialogue')) + '\nglobalThis.api={syncCompletedChapter,showCompletionRetry,restoreCompletionRetry};learningManifest=globalThis.fixtureManifest;messagesEl={appendChild(){}};', Object.assign(context, { fixtureManifest: manifest }));
  return { ...context.api, window, sourceCalls, projections, timers, buttons, marked, messages, clock, storage, respond: fn => { nextResponse = fn; } };
}
const minuteResponse = () => new Response(JSON.stringify({ ok: false, error: '稍後重試', errorCode: 'RATE_LIMIT_MINUTE', retryAfterSeconds: 60 }), { status: 429 });

test('a minute limit writes no My projection, preserves the event across reload and recovers the same event', async () => {
  const storage = new Map([['unrelated-reading-history', '[7,9]']]);
  const clock = { now: 1000000 };
  const first = browser(storage, clock);
  first.respond(minuteResponse);
  await assert.rejects(first.syncCompletedChapter(chapter), e => e.status === 429 && e.code === 'RATE_LIMIT_MINUTE');
  assert.equal(first.sourceCalls.length, 1);
  assert.equal(first.projections.length, 0);
  const originalNonce = first.sourceCalls[0].eventNonce;
  const reloaded = browser(storage, clock);
  reloaded.restoreCompletionRetry(chapter);
  assert.equal(reloaded.buttons.length, 1);
  assert.equal(reloaded.buttons[0].disabled, true);
  assert.equal(reloaded.sourceCalls.length, 0);
  await assert.rejects(reloaded.syncCompletedChapter(chapter), e => e.status === 429);
  assert.equal(reloaded.sourceCalls.length, 0);
  assert.equal(reloaded.projections.length, 0);
  clock.now += 60000;
  const result = await reloaded.syncCompletedChapter(chapter);
  assert.equal(result.status, 'synced');
  assert.equal(reloaded.sourceCalls.length, 1);
  assert.equal(reloaded.sourceCalls[0].eventNonce, originalNonce);
  assert.equal(reloaded.projections.length, 2);
  assert.match(reloaded.projections[1][1].recordKey, new RegExp(originalNonce + '$'));
  assert.deepEqual([...storage.entries()], [['unrelated-reading-history', '[7,9]']]);
  assert.match(appSource.slice(appSource.indexOf('function displayChapter('), appSource.indexOf('function resetInteractionState(')), /restoreCompletionRetry\(chapter\)/);
});

test('retry button waits without a request, then saves the same chapter without invoking AI', async () => {
  const b = browser();
  b.respond(minuteResponse);
  let failure;
  try { await b.syncCompletedChapter(chapter); } catch (error) { failure = error; }
  b.showCompletionRetry(chapter, failure);
  const button = b.buttons[0];
  assert.equal(button.disabled, true);
  assert.equal(b.timers.length, 1);
  assert.equal(b.timers[0].delay, 60000);
  assert.equal(b.sourceCalls.length, 1);
  b.clock.now += 60000;
  b.timers[0].callback();
  assert.equal(button.disabled, false);
  b.respond(() => new Response(JSON.stringify(success)));
  await button.click();
  assert.equal(b.sourceCalls.length, 2);
  assert.equal(b.sourceCalls[0].eventNonce, b.sourceCalls[1].eventNonce);
  assert.deepEqual(b.marked, [chapter.id]);
  assert.equal(button.removed, true);
  assert.equal(b.timers.length, 1);
});

test('a daily limit and partial projection retain the pending event without automatic network retries', async () => {
  const day = browser();
  day.respond(() => new Response(JSON.stringify({ error: '稍後重試', errorCode: 'RATE_LIMIT_DAY' }), { status: 429 }));
  await assert.rejects(day.syncCompletedChapter(chapter), e => e.retryAfterSeconds === 86400);
  day.clock.now += 60000;
  await assert.rejects(day.syncCompletedChapter(chapter), e => e.status === 429);
  assert.equal(day.sourceCalls.length, 1);
  assert.equal(day.projections.length, 0);
  assert.equal(day.timers.length, 0);
  const partial = browser();
  partial.window.BdfzIdentity.recordEvent = async () => { throw new Error('projection unavailable'); };
  assert.equal((await partial.syncCompletedChapter(chapter)).status, 'partial');
  assert.equal(partial.storage.size, 1);
  partial.window.BdfzIdentity.recordEvent = async value => { partial.projections.push(['event', value]); };
  assert.equal((await partial.syncCompletedChapter(chapter)).status, 'synced');
  assert.equal(partial.sourceCalls[0].eventNonce, partial.sourceCalls[1].eventNonce);
  assert.equal(partial.storage.size, 0);
});

test('anonymous interaction creates no recoverable completion and malformed pending state is ignored', async () => {
  const b = browser(new Map([['lunyu_pending_completion_v1:' + manifest.manifestVersion + ':' + chapter.id, JSON.stringify({eventId: 'bad', notBefore: 0})]]));
  b.restoreCompletionRetry(chapter);
  assert.equal(b.buttons.length, 0);
  b.window.BdfzIdentity.getSession = async () => ({ authenticated: false });
  assert.equal((await b.syncCompletedChapter(chapter)).status, 'skipped');
  assert.equal(b.sourceCalls.length, 0);
  assert.equal(b.storage.size, 0);
});
