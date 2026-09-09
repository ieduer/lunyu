#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import test from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const appSource = readFileSync(resolve(root, 'assets/js/app.js'), 'utf8');
const evidenceSource = readFileSync(resolve(root, 'assets/js/learning-evidence.js'), 'utf8');
const dialogues = JSON.parse(readFileSync(resolve(root, 'data/dialogues.json'), 'utf8'));
const manifest = JSON.parse(readFileSync(resolve(root, 'data/learning-manifest.json'), 'utf8'));
const storageKey = 'lunyu_learning_completed_v1';

class Element {
    constructor() {
        this.children = [];
        this.dataset = {};
        this.textContent = '';
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

function fixture({ saved = [], items = [], authenticated = true, storageReadFails = false, storageWriteFails = false, apiFails = false } = {}) {
    const menu = new Element();
    const storage = new Map([[storageKey, JSON.stringify(saved)]]);
    const calls = { api: 0, network: 0, mutation: 0, paths: [] };
    const noMutation = async () => { calls.mutation++; throw new Error('unexpected mutation'); };
    const context = vm.createContext({
        document: {
            addEventListener() {},
            createElement: () => new Element(),
            querySelectorAll: selector => menu.querySelectorAll(selector),
        },
        window: {
            innerWidth: 1000,
            BdfzIdentity: {
                getSession: async () => ({ authenticated, user: authenticated ? { fixture: true } : null }),
                syncProgress: noMutation,
                recordEvent: noMutation,
                api: async path => {
                    calls.api++;
                    calls.paths.push(path);
                    if (apiFails) throw new Error('fixture API unavailable');
                    return { items };
                },
            },
        },
        localStorage: {
            getItem: key => {
                if (storageReadFails) throw new Error('fixture storage read unavailable');
                return storage.get(key) || null;
            },
            setItem: (key, value) => {
                if (storageWriteFails) throw new Error('fixture storage write unavailable');
                storage.set(key, value);
            },
        },
        console: { log() {}, warn() {}, error() {}, debug() {} },
        fetch: () => { calls.network++; throw new Error('network forbidden'); },
        dialogues, manifest, menu,
    });
    vm.runInContext(evidenceSource, context);
    vm.runInContext(appSource, context);
    const run = code => vm.runInContext(code, context);
    run('allChapters = dialogues; learningManifest = manifest; chapterMenuEl = menu; groupChapters(); renderChapterMenu();');
    return {
        context, storage, calls, run,
        hydrate: () => run('hydrateReadProgressFromIdentity()'),
        readIds: () => Array.from(run('getReadProgress()')),
        links: () => menu.querySelectorAll('.sub-chapter-link'),
        open: major => {
            context.major = major;
            context.container = menu.children[major - 1];
            run("toggleSubChapterMenu(major, container, container.querySelector('.major-chapter-btn'))");
            return menu.querySelectorAll('.sub-chapter-link');
        },
        readOnly: () => {
            assert.equal(calls.network, 0);
            assert.equal(calls.mutation, 0);
        },
    };
}

// Current User Center listProgress exposes meta_json as meta, not a top-level
// progressPercent. normalizeProgressMutation stores the normalized number there.
function serverRow(id = 540) {
    const item = manifest.items.find(value => value.chapterId === String(id));
    return {
        siteKey: 'kz', itemKey: item.resourceKey, itemType: 'chapter',
        state: 'completed', score: 100,
        meta: {
            evidenceSchema: 'kz-learning-evidence-v1',
            manifestVersion: manifest.manifestVersion,
            resourceKeySha256: manifest.resourceKeySha256,
            resourceKey: item.resourceKey,
            completionKind: 'annotation_revealed', result: 'completed',
            chapterId: item.chapterId, major: item.major, minor: item.minor,
            progressPercent: 100,
        },
    };
}

test('late and reopened book20 menus restore authenticated chapter540 without a new completion', async () => {
    const f = fixture({ items: [serverRow()] });
    assert.equal(f.links().length, 0);
    await f.hydrate();
    assert.deepEqual(f.readIds(), ['540']);
    assert.deepEqual(f.calls.paths, ['/api/progress?site=kz']);
    const check = () => assert.equal(f.links().find(link => link.dataset.chapterId === '540').classList.contains('read'), true);
    f.open(20); check();
    f.open(20);
    assert.equal(f.links().length, 0);
    f.open(20); check();
    f.readOnly();
});

test('every one of541 original IDs isolates its own menu marker', () => {
    const f = fixture();
    // Keep all books mounted to exercise identical and substring labels together.
    for (let major = 1; major <= 20; major++) {
        f.context.major = major;
        f.context.container = f.context.menu.children[major - 1];
        f.run('renderSubChapterMenu(major, container)');
    }
    const links = f.links();
    assert.equal(links.length, 541);
    assert.equal(new Set(links.map(link => link.dataset.chapterId)).size, 541);
    for (const chapter of dialogues) {
        const id = String(chapter.id);
        f.storage.set(storageKey, JSON.stringify([id]));
        f.run('updateChapterMenuReadStatus()');
        assert.deepEqual(links.filter(link => link.classList.contains('read')).map(link => link.dataset.chapterId), [id]);
    }
    f.readOnly();
});

test('duplicate265 and268 retain independent read, reading, and click identities', () => {
    const f = fixture({ saved: ['265'] });
    f.run("inProgressChapterCache = ['268']");
    f.open(10);
    const first = f.links().find(link => link.dataset.chapterId === '265');
    const second = f.links().find(link => link.dataset.chapterId === '268');
    assert.equal(first.classList.contains('read'), true);
    assert.equal(second.classList.contains('read'), false);
    assert.equal(second.classList.contains('reading'), true);
    f.storage.set(storageKey, JSON.stringify(['268']));
    f.run('updateChapterMenuReadStatus()');
    assert.equal(first.classList.contains('read'), false);
    assert.equal(second.classList.contains('read'), true);
    f.context.clicked = [];
    f.run('displayChapter = id => clicked.push(id)');
    second.onclick({ preventDefault() {} });
    assert.deepEqual(Array.from(f.context.clicked), [268]);
    // Rendering text is not authority, including misleading or missing labels.
    second.textContent = '20.2';
    f.run('updateChapterMenuReadStatus()');
    assert.equal(second.classList.contains('read'), true);
    delete first.dataset.chapterId;
    first.textContent = '10.25';
    f.run('updateChapterMenuReadStatus()');
    assert.equal(first.classList.contains('read'), false);
    f.readOnly();
});

test('normalized meta percentage is authoritative with legacy top-level fallback', async () => {
    const variants = [
        [row => row, true],
        [row => { delete row.meta.progressPercent; row.progressPercent = 100; return row; }, true],
        [row => { row.progressPercent = 20; return row; }, true],
        [row => { row.meta.progressPercent = 20; row.progressPercent = 100; return row; }, false],
    ];
    for (const [alter, accepted] of variants) {
        const f = fixture({ items: [alter(serverRow())] });
        await f.hydrate();
        assert.deepEqual(f.readIds(), accepted ? ['540'] : []);
        f.readOnly();
    }
});

test('invalid identity/evidence and nonnumeric or incomplete percentages cannot create completion', async () => {
    const invalid = [
        row => ({ ...row, siteKey: 'other' }),
        row => ({ ...row, itemType: 'discussion' }),
        row => ({ ...row, itemKey: 'chapter-9999' }),
        row => ({ ...row, state: 'in_progress' }),
        row => ({ ...row, meta: null }),
        row => ({ ...row, meta: [] }),
        ...['evidenceSchema', 'manifestVersion', 'resourceKeySha256', 'resourceKey', 'completionKind', 'result'].map(field => row => ({ ...row, meta: { ...row.meta, [field]: 'invalid' } })),
        ...[undefined, '100', [100], Infinity, NaN, 101, 99, 0].map(progressPercent => row => ({ ...row, meta: { ...row.meta, progressPercent } })),
    ];
    for (const alter of invalid) {
        const f = fixture({ saved: ['7'], items: [alter(serverRow())] });
        await f.hydrate();
        assert.deepEqual(f.readIds(), ['7']);
        assert.deepEqual(JSON.parse(f.storage.get(storageKey)), ['7']);
        f.readOnly();
    }
});

test('one rejected row does not suppress a separate valid receipt and local saved IDs', async () => {
    const invalid = serverRow(265);
    invalid.meta.manifestVersion = 'old-manifest';
    const f = fixture({ saved: [7, '7', '268'], items: [null, invalid, serverRow()] });
    await f.hydrate();
    assert.deepEqual(f.readIds(), ['7', '268', '540']);
    f.readOnly();
});

test('storage write failure keeps raw local IDs and verified remote markers available in memory', async () => {
    const f = fixture({ saved: ['7'], items: [serverRow()], storageWriteFails: true });
    await f.hydrate();
    assert.deepEqual(JSON.parse(f.storage.get(storageKey)), ['7']);
    assert.deepEqual(f.readIds(), ['7', '540']);
    f.open(20);
    assert.equal(f.links().find(link => link.dataset.chapterId === '540').classList.contains('read'), true);
    f.readOnly();
});

test('unavailable storage reads retain only validated server completion in the page cache', async () => {
    const f = fixture({ items: [serverRow()], storageReadFails: true, storageWriteFails: true });
    await f.hydrate();
    assert.deepEqual(f.readIds(), ['540']);
    f.open(20);
    assert.equal(f.links().find(link => link.dataset.chapterId === '540').classList.contains('read'), true);
    f.readOnly();
});

test('anonymous, empty and failed progress reads preserve local history without a write RPC', async () => {
    for (const options of [{ authenticated: false }, { items: [] }, { apiFails: true }]) {
        const f = fixture({ saved: ['268'], ...options });
        await f.hydrate();
        assert.deepEqual(f.readIds(), ['268']);
        f.open(10);
        assert.equal(f.links().find(link => link.dataset.chapterId === '268').classList.contains('read'), true);
        if (options.authenticated === false) assert.equal(f.calls.api, 0);
        f.readOnly();
    }
});
