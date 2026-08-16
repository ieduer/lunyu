#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(resolve(root, 'data/learning-manifest.json'), 'utf8'));
const dialogues = JSON.parse(readFileSync(resolve(root, 'data/dialogues.json'), 'utf8'));
const context = { globalThis: {} };
vm.runInNewContext(readFileSync(resolve(root, 'assets/js/learning-evidence.js'), 'utf8'), context);
const evidence = context.globalThis.KzLearningEvidence;

assert.equal(manifest.siteKey, 'kz');
assert.equal(manifest.itemCount, 541);
assert.equal(manifest.completionThreshold, 163);
assert.equal(manifest.items.length, 541);
assert.equal(new Set(manifest.items.map((item) => item.resourceKey)).size, 541);
assert.equal(manifest.items[0].resourceKey, 'chapter-1');
assert.equal(manifest.items.at(-1).resourceKey, 'chapter-541');
assert.equal(manifest.items.every((item, index) => item.resourceKey === `chapter-${dialogues[index].id}` && item.itemTitle === dialogues[index].title), true);
assert.equal(dialogues.every((entry) => String(entry.translation || '').trim()), true);
assert.equal(
  manifest.resourceKeySha256,
  createHash('sha256').update(manifest.items.map((item) => item.resourceKey).join('\n')).digest('hex'),
);

const progress = evidence.buildProgress(manifest, dialogues[0]);
assert.equal(progress.itemKey, 'chapter-1');
assert.equal(progress.itemType, 'chapter');
assert.equal(progress.state, 'completed');
assert.equal(progress.progressPercent, 100);
assert.equal(progress.meta.evidenceSchema, 'kz-learning-evidence-v1');
assert.equal(progress.meta.manifestVersion, manifest.manifestVersion);
assert.equal(progress.meta.resourceKeySha256, manifest.resourceKeySha256);
assert.equal(progress.meta.completionKind, 'annotation_revealed');
assert.equal(progress.meta.result, 'completed');
assert.equal(evidence.buildProgress(manifest, { id: 9999 }), null);

const event = evidence.buildEvent(manifest, dialogues[0], 'opaque-test-id', 'https://kz.bdfz.net/');
assert.match(event.recordKey, /^kz:chapter-1:completed:opaque-test-id$/);
assert.equal(event.itemType, 'chapter_completion');
assert.equal(event.contentFormat, 'kz-learning-evidence-v1');
assert.equal(event.payload.resourceKey, 'chapter-1');
assert.equal(event.payload.result, 'completed');
assert.equal(JSON.stringify(event).includes(dialogues[0].text), false);

const anonymousCalls = [];
const anonymous = await evidence.syncChapterCompletion({
  identity: {
    getSession: async () => ({ authenticated: false }),
    syncProgress: async () => anonymousCalls.push('progress'),
    recordEvent: async () => anonymousCalls.push('event'),
  },
  manifest,
  chapter: dialogues[0],
  eventId: 'anon',
  sourceUrl: 'https://kz.bdfz.net/',
});
assert.equal(anonymous.status, 'skipped');
assert.equal(anonymous.reason, 'anonymous');
assert.deepEqual(anonymousCalls, []);

const authenticatedCalls = [];
const sourceCalls = [];
const authenticated = await evidence.syncChapterCompletion({
  identity: {
    getSession: async () => ({ authenticated: true, user: { slug: 'verified-user' } }),
    syncProgress: async (body) => authenticatedCalls.push(['progress', body]),
    recordEvent: async (body) => authenticatedCalls.push(['event', body]),
  },
  manifest,
  chapter: dialogues[0],
  eventId: 'authenticated',
  sourceUrl: 'https://kz.bdfz.net/',
  sourceCompletionImpl: async (sourceManifest, chapter, eventId) => {
    sourceCalls.push([sourceManifest.manifestVersion, chapter.id, eventId]);
    return {
      ok: true,
      sourceSiteKey: 'kz',
      resourceKey: 'chapter-1',
      manifestVersion: sourceManifest.manifestVersion,
      resourceVersion: 'sha256:test',
      recorded: true,
    };
  },
});
assert.equal(authenticated.status, 'synced');
assert.deepEqual(sourceCalls, [[manifest.manifestVersion, dialogues[0].id, 'authenticated']]);
assert.equal(authenticatedCalls.length, 2);
assert.equal(authenticatedCalls[0][0], 'progress');
assert.equal(authenticatedCalls[1][0], 'event');

const failClosedCalls = [];
await assert.rejects(() => evidence.syncChapterCompletion({
  identity: {
    getSession: async () => ({ authenticated: true, user: { slug: 'verified-user' } }),
    syncProgress: async () => failClosedCalls.push('progress'),
    recordEvent: async () => failClosedCalls.push('event'),
  },
  manifest,
  chapter: dialogues[0],
  eventId: 'source-failure',
  sourceUrl: 'https://kz.bdfz.net/',
  sourceCompletionImpl: async () => { throw new Error('source unavailable'); },
}), /source unavailable/);
assert.deepEqual(failClosedCalls, []);

process.stdout.write('kz learning evidence tests passed\n');
