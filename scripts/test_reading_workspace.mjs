import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
const root = new URL('../', import.meta.url);
const rows = JSON.parse(readFileSync(new URL('data/dialogues.json', root)));
const chapters = rows.filter(row => !row.displayAliasOf).map(row => {
    const [, major, minor] = row.title.match(/ (\d+)\.(\d+)$/);
    return { ...row, major: Number(major), minor: Number(minor) };
});
const aliases = new Map(rows.map(row => [String(row.id), String(row.displayAliasOf || row.id)]));
const context = vm.createContext({});
vm.runInContext(readFileSync(new URL('assets/js/reading-workspace.js', root), 'utf8'), context);
const api = context.KzReadingWorkspace;
test('all historical IDs resolve to their original record, not an alias substitute', () => {
    for (const row of rows) {
        assert.equal(api.resolveChapter(String(row.id), chapters, rows), row);
        assert.equal(api.resolveChapter(`chapter-${row.id}`, chapters, rows), row);
    }
});
test('all 512 canonical coordinates resolve without changing corpus bytes', () => {
    for (const row of chapters) assert.equal(api.resolveChapter(`${row.major}.${row.minor}`, chapters, rows), row);
});
test('invalid routes cannot select or coerce a chapter', () => {
    for (const input of ['', '0', '-1', '542', '1e2', '1.01', '1.99', '01', 'chapter-1/..', '<script>', null]) {
        assert.equal(api.resolveChapter(input, chapters, rows), null);
    }
});
test('search has canonical coverage, no alias duplicates, and treats markup as text', () => {
    assert.equal(api.searchChapters(chapters, '學而 1.1')[0].id, 1);
    assert.equal(api.searchChapters(chapters, '').length, 0);
    assert.equal(api.searchChapters(chapters, '<script>').length, 0);
    const matches = api.searchChapters(chapters, '子曰');
    assert(matches.length > 100);
    assert.equal(new Set(matches.map(row => row.id)).size, matches.length);
    assert(matches.every(row => !row.displayAliasOf));
});
test('visible progress deduplicates aliases and rejects unknown history without changing it', () => {
    const saved = ['265', '268', 541, 'junk', -1, '<script>'];
    const before = JSON.stringify(saved), summary = api.progressSummary(chapters, aliases, saved);
    assert.equal(summary.count, 2); assert.equal(summary.total, 512);
    assert.equal(summary.next.id, 1); assert.equal(JSON.stringify(saved), before);
    const completed = api.progressSummary(chapters, aliases, rows.map(row => row.id));
    assert.equal(completed.count, 512); assert.equal(completed.next, null);
});
