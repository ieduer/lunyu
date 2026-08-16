#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const app = readFileSync(resolve(root, 'assets/js/app.js'), 'utf8');
const html = readFileSync(resolve(root, 'index.html'), 'utf8');

const displayChapter = app.match(/function displayChapter\(id\) \{([\s\S]*?)\n\}/)?.[1] || '';
const revealAction = app.match(/function handleYangAnnotationClick\(\) \{([\s\S]*?)\n\}/)?.[1] || '';

assert.ok(displayChapter, 'displayChapter function must exist');
assert.equal(/markAsRead|syncChapterCompletion|trackChapterProgress/.test(displayChapter), false, 'navigation/open must not complete learning');
assert.ok(revealAction, 'Yang annotation learning action must exist');
assert.match(revealAction, /addMessage\(`\*\*譯文\*\*/);
assert.match(revealAction, /syncCompletedChapter\(revealedChapter\)/);
assert.match(revealAction, /\.then\(\(result\) =>/);
assert.match(revealAction, /markAsRead\(revealedChapter\.id\)/);
assert.match(html, /data-site-key="kz"/);
assert.match(html, /data-auto-pageview="false"/);
assert.match(html, /assets\/js\/learning-evidence\.js/);
assert.equal(app.includes('lunyu_read_progress'), false, 'legacy navigation-derived local progress must not be promoted');
assert.match(app, /async function trackDialogue[\s\S]*?const identity = await getAuthenticatedIdentity\(\)/);
assert.match(app, /async function syncConversationArchive[\s\S]*?const identity = await getAuthenticatedIdentity\(\)/);
assert.match(app, /parsed\.map\(id => String\(id\)\)/, 'local and server resource ids must normalize to the same type');

process.stdout.write('kz source contract tests passed\n');
