#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';
import test from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const appSource = readFileSync(resolve(root, 'assets/js/app.js'), 'utf8');
const generatorPath = resolve(root, 'scripts/build_learning_manifest.mjs');
const generatorSource = readFileSync(generatorPath, 'utf8')
    .replace(/^#!.*\n/, '').replace(/^import .*;\n/gm, '').replaceAll('import.meta.url', 'sourceUrl');
const corpusText = readFileSync(resolve(root, 'data/dialogues.json'), 'utf8');
const manifestText = readFileSync(resolve(root, 'data/learning-manifest.json'), 'utf8');
const dialogues = JSON.parse(corpusText), manifest = JSON.parse(manifestText);
const clone = value => JSON.parse(JSON.stringify(value));
const hash = value => createHash('sha256').update(value).digest('hex');
const bookNames = ['學而', '為政', '八佾', '里仁', '公冶長', '雍也', '述而', '泰伯', '子罕', '鄉黨', '先進', '顏淵', '子路', '憲問', '衛靈公', '季氏', '陽貨', '微子', '子張', '堯曰'];
const bookCounts = [16, 24, 26, 26, 28, 30, 38, 21, 31, 27, 26, 24, 30, 44, 42, 14, 26, 11, 25, 3];
const aliases = new Map([[268, 265], [269, 266], [270, 267], ...Array.from({ length: 26 }, (_, i) => [297 + i, 271 + i])]);
const progressKey = 'lunyu_learning_completed_v1', bookmarkKey = 'lunyu_bookmarks';

class Element {
    constructor() {
        this.children = [];
        this.dataset = {};
        this.textContent = '';
        this.style = {};
        const classes = this.classes = new Set();
        this.classList = {
            add: (...values) => values.forEach(value => classes.add(value)),
            remove: (...values) => values.forEach(value => classes.delete(value)),
            contains: value => classes.has(value),
        };
    }
    set className(value) {
        this.classes.clear();
        String(value).split(/\s+/).filter(Boolean).forEach(name => this.classes.add(name));
    }
    appendChild(child) { this.children.push(child); }
    removeChild(child) { this.children = this.children.filter(value => value !== child); }
    contains(child) { return this.children.includes(child); }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    querySelectorAll(selector) {
        return this.children.flatMap(child => [
            ...(child.classList.contains(selector.slice(1)) ? [child] : []),
            ...child.querySelectorAll(selector),
        ]);
    }
    set innerHTML(_value) { this.children = []; }
}

function fixture({ rows = dialogues, receipt = manifest, saved = [], bookmarks = [], initialize = true } = {}) {
    const menu = new Element(), messages = new Element(), yangButton = new Element();
    const storage = new Map([[progressKey, JSON.stringify(saved)], [bookmarkKey, JSON.stringify(bookmarks)]]);
    const calls = { asset: [], mutation: 0, storageWrites: 0, messages: [] };
    const forbidden = () => { calls.mutation++; throw new Error('business action forbidden'); };
    const context = vm.createContext({
        document: { addEventListener() {}, createElement: () => new Element(), querySelectorAll: selector => menu.querySelectorAll(selector) },
        window: { innerWidth: 1000, BdfzIdentity: { syncProgress: forbidden, recordEvent: forbidden, api: forbidden } },
        console: { log() {}, warn() {}, error() {}, debug() {} },
        localStorage: {
            getItem: key => storage.get(key) || null,
            setItem: (key, value) => { calls.storageWrites++; storage.set(key, value); },
        },
        // These are two in-memory static asset responses, never a network request.
        fetch: async (path, options) => {
            calls.asset.push([path, options?.cache]);
            if (path === 'data/dialogues.json') return { ok: true, json: async () => rows };
            if (path === 'data/learning-manifest.json') return { ok: true, json: async () => receipt };
            return forbidden();
        },
        Math: Object.create(Math), rows, receipt, menu, messages, yangButton,
        capture: (text, sender) => { calls.messages.push([text, sender]); return new Element(); },
    });
    vm.runInContext(appSource, context);
    const run = code => vm.runInContext(code, context);
    run('chapterMenuEl = menu; messagesEl = messages; btnYangEl = yangButton; addMessage = capture;');
    if (initialize) run('allChapters = rows; learningManifest = receipt; groupChapters(); renderChapterMenu();');
    return { context, run, storage, calls, menu, yangButton,
        openAll: () => {
            for (let major = 1; major <= 20; major++) {
                context.major = major;
                context.container = menu.children[major - 1];
                run('renderSubChapterMenu(major, container)');
            }
            return menu.querySelectorAll('.sub-chapter-link');
        },
        readOnly: () => {
            assert.equal(calls.mutation, 0);
            assert.equal(calls.storageWrites, 0);
        },
    };
}

function generate(rows, check = false) {
    let written = null;
    const text = rows === dialogues ? corpusText : `${JSON.stringify(rows, null, 2)}\n`;
    const context = vm.createContext({
        createHash, dirname, resolve, fileURLToPath, sourceUrl: pathToFileURL(generatorPath).href,
        readFileSync: path => {
            if (path === resolve(root, 'data/dialogues.json')) return text;
            assert.equal(path, resolve(root, 'data/learning-manifest.json'));
            return manifestText;
        },
        writeFileSync: (path, value) => {
            assert.equal(path, resolve(root, 'data/learning-manifest.json'));
            written = value;
        },
        process: { argv: check ? ['--check'] : [], stdout: { write() {} } },
    });
    vm.runInContext(generatorSource, context);
    return written;
}

test('541 original IDs, content fields, resource coordinates and completion contract are unchanged', () => {
    assert.deepEqual(dialogues.map(row => row.id), Array.from({ length: 541 }, (_, i) => i + 1));
    // Digests captured from the accepted progress-only source before catalogue edits.
    assert.equal(hash(JSON.stringify(dialogues.map(({ id, text, translation, annotations }) => ({ id, text, translation, annotations })))), 'e03baf5e4075148dff5aea7fa40588bc46a6bd438a0b90e5cd064d8ae84a2034');
    assert.equal(hash(JSON.stringify(manifest.items.map(({ resourceKey, chapterId, major, minor }) => ({ resourceKey, chapterId, major, minor })))), 'dbee999a39a48b560a1476d986e27efe9600f04259e29a3da6a4e09c6b6408fa');
    assert.equal(hash(JSON.stringify(manifest.completionContract)), 'a77130bd71e0f09b8ef91e3c0e5f8cac7008207b63f849224eb3d2c53cb4f9cf');
    assert.equal(manifest.manifestVersion, 'kz-79b9c5647108bc9b');
    assert.equal(manifest.resourceKeySha256, '79b9c5647108bc9be8fea0f23e9585cff24e0083e70cadbaf52629e54fdfe6ca');
    assert.equal(manifest.sourceSha256, hash(corpusText));
    assert.equal(manifest.itemCount, 541);
    assert.equal(manifest.completionThreshold, 163);
    assert.deepEqual(manifest.items.map(item => item.resourceKey), dialogues.map(row => `chapter-${row.id}`));
    assert.equal(manifest.items.some(item => Object.hasOwn(item, 'displayAliasOf')), false);
    assert.deepEqual(dialogues.filter(row => Object.hasOwn(row, 'displayAliasOf')).map(row => [row.id, row.displayAliasOf]), [...aliases]);
});

test('actual generator reproduces the manifest in memory and check mode performs no write', () => {
    assert.equal(generate(dialogues), manifestText);
    assert.equal(generate(dialogues, true), null);
});

test('20 traditional book menus contain512 unique coordinates in numeric order', () => {
    const f = fixture();
    assert.deepEqual(f.menu.children.map(container => container.children[0].textContent), bookNames.map((name, i) => `${name} (第 ${i + 1} 章)`));
    const links = f.openAll();
    const chapters = Array.from(f.run('displayCatalogue.chapters'));
    assert.equal(links.length, 512);
    assert.equal(new Set(chapters.map(row => `${row.major}.${row.minor}`)).size, 512);
    assert.deepEqual(links.map(link => Number(link.dataset.chapterId)), chapters.map(row => row.id));
    for (let major = 1; major <= 20; major++) {
        assert.deepEqual(chapters.filter(row => row.major === major).map(row => row.minor), Array.from({ length: bookCounts[major - 1] }, (_, i) => i + 1));
    }
    assert.equal(dialogues[192].title, '泰伯 8.5');
    // Repeated wording in distinct traditional coordinates is not a duplicate record.
    for (const id of [3, 493]) assert.equal(chapters.some(row => row.id === id), true);
    for (const id of aliases.keys()) assert.equal(chapters.some(row => row.id === id), false);
    f.readOnly();
});

test('random reading draws exactly512 canonical chapters without completion or storage writes', () => {
    const f = fixture();
    const chapters = Array.from(f.run('displayCatalogue.chapters'));
    const seen = new Set();
    for (let i = 0; i < 512; i++) {
        f.context.Math.random = () => (i + 0.25) / 512;
        f.run('displayInitialRandomAnalect()');
        const [message, sender] = f.calls.messages.at(-2);
        assert.equal(sender, 'initial');
        assert.equal(message.startsWith(`**隨機章節：${chapters[i].title}**\n\n${chapters[i].text}`), true);
        seen.add(chapters[i].id);
    }
    assert.equal(seen.size, 512);
    assert.equal(f.run('currentAnalect'), null);
    assert.equal(f.calls.asset.length, 0);
    f.readOnly();
});

test('all541 explicit IDs including aliases still open their original raw record without credit replay', () => {
    const f = fixture({ saved: ['268'], bookmarks: [268] });
    for (const row of dialogues) {
        f.context.id = row.id;
        f.run('displayChapter(id)');
        assert.equal(f.run('currentAnalect'), row);
        assert.equal(f.calls.messages.at(-1)[0], `**${row.title}**\n\n${row.text}`);
    }
    f.run("displayChapter('268')");
    assert.equal(f.run('currentAnalect.id'), 268);
    assert.equal(f.run('isBookmarked(268)'), true);
    assert.equal(f.run('isBookmarked(265)'), false);
    assert.equal(f.storage.get(progressKey), '["268"]');
    assert.equal(f.storage.get(bookmarkKey), '[268]');
    assert.equal(f.calls.asset.length, 0);
    f.readOnly();
});

test('alias completion and bookmark counters deduplicate only for display and leave raw histories intact', () => {
    const f = fixture({ saved: [265, '268', 540, '9999'], bookmarks: [265, '268', 540, '9999'] });
    const original = [...f.storage];
    f.run('updateProgressDisplay()');
    assert.equal(f.context.document.title, 'AI論語 (已讀 2/512)');
    assert.deepEqual(JSON.parse(f.run('JSON.stringify(getStats())')), { readCount: 2, bookmarkCount: 2, totalChapters: 512, readPercentage: 0 });
    assert.deepEqual(Array.from(f.run('getReadProgress()')), ['265', '268', '540', '9999']);
    assert.deepEqual(Array.from(f.run('getBookmarks()')), [265, '268', 540, '9999']);
    assert.deepEqual(Array.from(f.run("projectDisplayChapterIds([268, '265', null, {}, '01', 0, -1, 1.5, '9999'])")), ['265']);
    f.storage.set(progressKey, '[]');
    f.run('updateProgressDisplay()');
    assert.equal(f.context.document.title, 'AI論語');
    f.storage.set(progressKey, original[0][1]);
    assert.deepEqual([...f.storage], original);
    f.readOnly();
});

test('both actual validators reject malformed corpus and alias ledgers before generating a manifest', () => {
    const f = fixture();
    const invalid = [
        rows => rows.pop(),
        rows => { [rows[0], rows[1]] = [rows[1], rows[0]]; },
        rows => { rows[1].id = 1; },
        rows => { rows[192].title = '八佾 8.5'; },
        rows => { rows[0].title = '學而 21.1'; },
        rows => { rows[0].title = '學而 1.17'; },
        rows => { rows[0].title = rows[1].title; },
        rows => { delete rows[267].displayAliasOf; },
        rows => { rows[263].displayAliasOf = null; },
        ...[268, 269, 266, 9999, '265'].map(target => rows => { rows[267].displayAliasOf = target; }),
        rows => { rows[267].displayAliasOf = 269; rows[268].displayAliasOf = 268; },
        rows => { rows[264].displayAliasOf = 268; },
        ...['text', 'translation', 'annotations'].map(field => rows => { rows[267][field] += 'fixture mismatch'; }),
        rows => { rows[0].text = ''; },
        rows => { rows[0].translation = null; },
        rows => { rows[0].annotations = {}; },
    ];
    for (const alter of invalid) {
        const rows = clone(dialogues);
        alter(rows);
        f.context.candidate = rows;
        assert.throws(() => f.run('buildDisplayCatalogue(candidate)'));
        assert.throws(() => generate(rows));
    }
    assert.equal(invalid.length, 22);
    f.readOnly();
});

test('paired asset validation rejects manifest identity, item and stale title mismatches', () => {
    const f = fixture();
    const invalid = [
        value => { value.schemaVersion = 2; },
        value => { value.siteKey = 'other'; },
        value => { value.itemCount = 512; },
        value => { value.completionThreshold = 154; },
        value => { value.resourceKeySha256 = 'invalid'; },
        value => { value.manifestVersion = 'invalid'; },
        value => { value.items.pop(); },
        value => { [value.items[0], value.items[1]] = [value.items[1], value.items[0]]; },
        value => { value.items[267].chapterId = '265'; },
        value => { value.items[267].resourceKey = 'chapter-265'; },
        value => { value.items[192].itemTitle = '八佾 8.5'; },
        value => { value.items[0].itemGroup = '学而'; },
        value => { value.items[0].itemType = 'discussion'; },
        value => { value.items[0].major = 2; },
        value => { value.items[0].minor = 2; },
    ];
    for (const alter of invalid) {
        const value = clone(manifest);
        alter(value);
        f.context.candidate = value;
        assert.throws(() => f.run('buildDisplayCatalogue(rows, candidate)'));
    }
    f.readOnly();
});

test('actual loader fetches both assets uncached and rejects a mixed deployment before rendering', async () => {
    const good = fixture({ initialize: false });
    await good.run('loadDialogues()');
    assert.equal(good.menu.children.length, 20);
    assert.equal(good.run('displayCatalogue.chapters.length'), 512);
    assert.deepEqual(good.calls.asset, [['data/dialogues.json', 'no-store'], ['data/learning-manifest.json', 'no-store']]);
    good.readOnly();
    const stale = clone(manifest);
    stale.items[192].itemTitle = '八佾 8.5';
    const bad = fixture({ receipt: stale, initialize: false });
    await bad.run('loadDialogues()');
    assert.equal(bad.menu.children.length, 0);
    assert.equal(bad.run('displayCatalogue'), null);
    assert.equal(bad.yangButton.disabled, true);
    assert.equal(bad.calls.messages.length, 1);
    assert.equal(bad.calls.messages[0][0].startsWith('錯誤：無法載入論語數據。'), true);
    assert.equal(bad.calls.asset.length, 2);
    bad.readOnly();
});
