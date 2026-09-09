#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function buildDisplayCatalogue(rows, manifest = null) {
    const bookNames = ['學而', '為政', '八佾', '里仁', '公冶長', '雍也', '述而', '泰伯', '子罕', '鄉黨', '先進', '顏淵', '子路', '憲問', '衛靈公', '季氏', '陽貨', '微子', '子張', '堯曰'];
    const bookCounts = [16, 24, 26, 26, 28, 30, 38, 21, 31, 27, 26, 24, 30, 44, 42, 14, 26, 11, 25, 3];
    const keyHash = '79b9c5647108bc9be8fea0f23e9585cff24e0083e70cadbaf52629e54fdfe6ca';
    if (!Array.isArray(rows) || rows.length !== 541) throw new Error('expected 541 legacy dialogue records');
    if (manifest && (manifest.schemaVersion !== 1 || manifest.siteKey !== 'kz'
        || manifest.itemCount !== 541 || manifest.completionThreshold !== 163
        || manifest.resourceKeySha256 !== keyHash || manifest.manifestVersion !== `kz-${keyHash.slice(0, 16)}`
        || !Array.isArray(manifest.items) || manifest.items.length !== 541)) {
        throw new Error('learning manifest identity mismatch');
    }
    const firstIds = new Map();
    const parsed = rows.map((row, index) => {
        const id = row?.id;
        if (!Number.isInteger(id) || id !== index + 1) throw new Error('dialogue ID/order mismatch');
        const match = typeof row.title === 'string' && row.title.match(/^(\S+) ([1-9]\d*)\.([1-9]\d*)$/);
        const major = Number(match?.[2]), minor = Number(match?.[3]);
        if (!match || match[1] !== bookNames[major - 1] || minor > bookCounts[major - 1]) {
            throw new Error('noncanonical dialogue title');
        }
        if (typeof row.text !== 'string' || !row.text.trim()
            || typeof row.translation !== 'string' || !row.translation.trim()
            || typeof row.annotations !== 'string') throw new Error('invalid dialogue learning content');
        const expectedAlias = id >= 268 && id <= 270 ? id - 3 : id >= 297 && id <= 322 ? id - 26 : null;
        if (expectedAlias === null ? Object.hasOwn(row, 'displayAliasOf') : row.displayAliasOf !== expectedAlias) {
            throw new Error('display alias ledger mismatch');
        }
        const coordinate = `${major}.${minor}`;
        if (!firstIds.has(coordinate)) firstIds.set(coordinate, id);
        if (manifest) {
            const item = manifest.items[index];
            if (item?.resourceKey !== `chapter-${id}` || item.chapterId !== String(id)
                || item.itemType !== 'chapter' || item.itemTitle !== row.title
                || item.itemGroup !== bookNames[major - 1] || item.major !== major || item.minor !== minor) {
                throw new Error('dialogue/manifest item mismatch');
            }
        }
        return { id, title: row.title, bookName: bookNames[major - 1], major, minor };
    });
    const chapters = [], displayIds = new Map(), coordinates = new Set();
    const actualCounts = Array(20).fill(0);
    for (const entry of parsed) {
        const row = rows[entry.id - 1], targetId = row.displayAliasOf ?? row.id;
        const coordinate = `${entry.major}.${entry.minor}`;
        if (Object.hasOwn(row, 'displayAliasOf')) {
            const target = rows[targetId - 1];
            if (!target || Object.hasOwn(target, 'displayAliasOf') || firstIds.get(coordinate) !== targetId
                || ['title', 'text', 'translation', 'annotations'].some(field => row[field] !== target[field])) {
                throw new Error('display alias content/target mismatch');
            }
        } else {
            if (coordinates.has(coordinate)) throw new Error('undeclared duplicate display chapter');
            coordinates.add(coordinate);
            actualCounts[entry.major - 1]++;
            chapters.push({ ...row, major: entry.major, minor: entry.minor });
        }
        displayIds.set(String(row.id), String(targetId));
    }
    if (chapters.length !== 512 || actualCounts.some((count, index) => count !== bookCounts[index])) {
        throw new Error('display chapter coverage mismatch');
    }
    chapters.sort((a, b) => a.major - b.major || a.minor - b.minor);
    return { chapters, displayIds, parsed };
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = resolve(root, 'data/dialogues.json');
const outputPath = resolve(root, 'data/learning-manifest.json');
const sourceText = readFileSync(sourcePath, 'utf8');
const dialogues = JSON.parse(sourceText);

if (!Array.isArray(dialogues) || dialogues.length !== 541) {
  throw new Error(`expected the audited 541 Analects entries, received ${Array.isArray(dialogues) ? dialogues.length : 'invalid JSON'}`);
}

const { parsed } = buildDisplayCatalogue(dialogues);

const namesByMajor = new Map();
for (const entry of parsed) {
  if (entry.bookName && !namesByMajor.has(entry.major)) namesByMajor.set(entry.major, entry.bookName);
}

const items = parsed.map((entry) => ({
  resourceKey: `chapter-${entry.id}`,
  itemTitle: entry.title,
  itemGroup: namesByMajor.get(entry.major) || `第 ${entry.major} 篇`,
  itemType: 'chapter',
  chapterId: String(entry.id),
  major: entry.major,
  minor: entry.minor,
}));

const resourceKeys = items.map((item) => item.resourceKey);
if (new Set(resourceKeys).size !== resourceKeys.length) throw new Error('duplicate learning resource keys');

const resourceKeySha256 = createHash('sha256').update(resourceKeys.join('\n')).digest('hex');
const sourceSha256 = createHash('sha256').update(sourceText).digest('hex');
const manifest = {
  schemaVersion: 1,
  siteKey: 'kz',
  manifestVersion: `kz-${resourceKeySha256.slice(0, 16)}`,
  resourceKeySha256,
  sourceSha256,
  sourcePath: 'data/dialogues.json',
  itemCount: items.length,
  completionThreshold: Math.ceil(items.length * 0.3),
  completionContract: {
    evidenceSchema: 'kz-learning-evidence-v1',
    completionKind: 'annotation_revealed',
    description: 'The signed-in learner explicitly reveals the Yang Bojun translation and available annotations for the selected entry. Opening or navigating to an entry is not completion.',
  },
  items,
};
const output = `${JSON.stringify(manifest, null, 2)}\n`;

if (process.argv.includes('--check')) {
  const current = readFileSync(outputPath, 'utf8');
  if (current !== output) throw new Error(`stale learning manifest: ${outputPath}`);
} else {
  writeFileSync(outputPath, output);
}

process.stdout.write(`${manifest.siteKey} ${manifest.manifestVersion} ${manifest.itemCount} ${manifest.completionThreshold} ${manifest.resourceKeySha256}\n`);
