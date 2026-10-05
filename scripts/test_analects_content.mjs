import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import vm from 'node:vm';
const root = new URL('../', import.meta.url);
const source = readFileSync(new URL('assets/js/analects-content.js', root), 'utf8');
const rows = JSON.parse(readFileSync(new URL('data/dialogues.json', root)));
const context = vm.createContext({ crypto: webcrypto, TextDecoder, Uint8Array });
vm.runInContext(source, context);
const api = context.AnalectsContent;
const bundle = { aliases: Object.fromEntries(rows.filter(r => r.displayAliasOf).map(r => [r.id, r.displayAliasOf])),
    chapters: rows.filter(r => !r.displayAliasOf).map(r => ({ id: r.id, original: r.text, translation: r.translation, annotations: [] })) };
test('shared notes map all historical IDs while leaving every source row unchanged', () => {
    const before = JSON.stringify(rows), index = api.reconcile(bundle, rows);
    assert.equal(index.size, 541);
    for (const row of rows) assert.equal(index.get(row.id).id, row.displayAliasOf || row.id);
    assert.equal(JSON.stringify(rows), before);
});
test('conflicting content, alias or incomplete corpus is rejected', () => {
    for (const change of [b => b.chapters.pop(), b => b.chapters[0].original += 'x',
        b => b.chapters[0].translation += 'x', b => b.aliases['268'] = 1,
        b => b.chapters[1].id = b.chapters[0].id]) {
        const changed = structuredClone(bundle); change(changed);
        assert.throws(() => api.reconcile(changed, rows), /analects_content_mismatch/);
    }
});
test('wrong byte length and same-length substituted bytes cannot become trusted notes', async () => {
    await assert.rejects(api.verify(new Uint8Array(2), rows), /mismatch/);
    await assert.rejects(api.verify(new Uint8Array(api.release.size), rows), /mismatch/);
});
test('failed fetch can retry, concurrent readers share one request without sending credentials', async () => {
    let calls = 0;
    const c = vm.createContext({ crypto: webcrypto, TextDecoder, Uint8Array, AbortController, setTimeout, clearTimeout,
        fetch: async (url, options) => { calls++; assert.equal(url, api.release.url); assert.equal(options.credentials, 'omit');
            assert.equal(options.referrerPolicy, 'no-referrer'); return { ok: false }; } });
    vm.runInContext(source, c);
    const attempts = await Promise.allSettled([c.AnalectsContent.load(rows), c.AnalectsContent.load(rows)]);
    assert(attempts.every(x => x.status === 'rejected')); assert.equal(calls, 1);
    await assert.rejects(c.AnalectsContent.load(rows), /unavailable/); assert.equal(calls, 2);
});
test('reading and AI share one annotation reveal and one completion attempt for the exact alias', async () => {
    const app = readFileSync(new URL('assets/js/app.js', root), 'utf8');
    const part = app.slice(app.indexOf('function revealChapterAnnotations()'), app.indexOf('function appendWeibianTerms('));
    let completions = 0, messages = 0, terms = 0;
    const chapter = rows.find(r => r.id === 268);
    const c = vm.createContext({ currentAnalect: chapter, isWaitingForAI: false, revealedAnnotations: null,
        conversationSessionKey: 'synthetic', conversationHistory: [], currentInteractionType: null,
        messagesEl: { querySelector: () => null }, addMessage: () => { messages++; },
        appendWeibianTerms: row => { assert.equal(row.id, 268); terms++; },
        syncCompletedChapter: async row => { assert.equal(row.id, 268); completions++; return { status: 'skipped' }; },
        markAsRead: () => assert.fail('Unauthenticated reading cannot gain progress'), showCompletionRetry: () => {} });
    vm.runInContext(part, c);
    c.revealChapterAnnotations(); c.revealChapterAnnotations(); await Promise.resolve();
    assert.equal(completions, 1); assert.equal(messages, 2); assert.equal(terms, 1);
    c.currentAnalect = null; assert.equal(c.revealChapterAnnotations(), null);
    assert.match(app, /function handleReadAnnotationsClick\(\) \{\s+revealChapterAnnotations\(\);\s+\}/);
    assert.match(app, /function handleYangAnnotationClick\(\) \{\s+const revealed = revealChapterAnnotations\(\);/);
});
